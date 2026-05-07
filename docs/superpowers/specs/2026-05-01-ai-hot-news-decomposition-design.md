# AI Hot News：PRD 整体评审与分阶段拆解设计

- **日期**：2026-05-01
- **状态**：Draft，待用户审阅
- **基于**：
  - PRD：`docs/PRD/AI Hot News 热点信息聚合网站3 PRD.md`（V3，1090 行）
  - 视觉设计：`docs/Design/AI Hot News Aurora.html`（已锁定为最终视觉）
- **本文档定位**：本文是**拆解 / 路线图 spec**，不是单个子项目的实现 spec。每个子项目（SP）后续会有自己独立的 `brainstorming → spec → plan → implementation` 循环。

---

## 1. 目标与约束

### 1.1 交付目标

把 V3 PRD 描述的多子系统平台，分解为**可独立交付、有明确验收标准、可顺序或并行执行**的子项目（Sub-Project，简称 SP），并给出推荐实施顺序。

### 1.2 关键约束

| 维度 | 决策 |
|---|---|
| **使用场景** | 个人自用工具（单用户，不考虑商业化、不考虑多租户） |
| **拆解策略** | 纵切端到端 + 横向扩展（先用 1 条 RSS 跑通骨架，再逐项扩展能力） |
| **视觉设计** | Aurora HTML 设计稿锁定为最终视觉；P4 阶段对应落地 |
| **预算** | AI 摘要月成本预算待定。SP-5 提供"插拔式摘要策略" — 一个 NestJS Provider 接口 / Strategy Pattern，可注入不同实现（默认全量、按热度阈值跳过、按平台白名单、按聚合事件 group 只跑一次等），便于成本明确后切换 |
| **部署目标** | 搬瓦工 VPS + Docker Compose（5 容器：web / api / worker / postgres / redis） |

### 1.3 与原 PRD 的偏离记录（已与用户对齐）

| 项目 | PRD 建议 | 本设计采用 | 理由 |
|---|---|---|---|
| 后端框架 | NestJS | NestJS（保留）| 用户偏好 |
| 前端框架 | Next.js | Next.js 15 + App Router | 一致 |
| ORM | Prisma | Prisma（保留）| 用户偏好 |
| 队列 | BullMQ | BullMQ + Redis（保留）| 用户偏好 |
| 数据库 | PostgreSQL | PostgreSQL + **pgvector**（P0 即引入）| 跨平台合并需要语义相似度 |
| 用户体系 | 完整用户 + 权限 | 单用户极简（环境变量 admin），User 表预留 | 个人自用 |
| AI 标签 | 单一 `tags[]` 字段 | 拆为 `aiTags[]` + `matchedKeywords[]` | 语义不同，便于扩展 |
| AI 摘要策略 | 未明确 | 插拔式摘要策略接口（默认全量、可配阈值限流） | 控制成本不确定 |

---

## 2. 系统架构

### 2.1 部署拓扑

```text
┌─────────────────────────────────────────────────────────────┐
│              搬瓦工 VPS · Docker Compose (5 容器)             │
│                                                              │
│  Caddy/Nginx  ──HTTPS──▶  ┌──────────┐    ┌──────────┐      │
│                            │ Web      │───▶│ API      │      │
│                            │ Next.js  │    │ NestJS   │      │
│                            └──────────┘    └────┬─────┘      │
│                                                 │            │
│                                                 ▼            │
│                                       ┌──────────────────┐   │
│                                       │ PostgreSQL       │   │
│                                       │ + pgvector       │   │
│                                       └────────┬─────────┘   │
│                                                ▲             │
│                                                │             │
│                            ┌──────────┐        │             │
│                            │ Redis    │◀── BullMQ ─┐         │
│                            └──────────┘            │         │
│                                                    │         │
│                            ┌──────────────────────────────┐ │
│                            │ Worker (NestJS standalone)   │ │
│                            │  - 抓取调度 / AI / 热度 /     │ │
│                            │    命中检测 / 推送             │ │
│                            └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
       │                        │
       ▼                        ▼
  外部数据源:                外部 AI / SMTP:
  RSS / HN / Reddit /         OpenAI / Claude /
  Twitter (P7)                Gemini / SMTP
```

### 2.2 仓库结构（monorepo, pnpm workspace）

```text
ai-hot-news/
├── apps/
│   ├── web/              # Next.js 15 (App Router) + Tailwind + shadcn/ui
│   ├── api/              # NestJS REST API
│   └── worker/           # NestJS standalone, 跑 BullMQ Worker
├── packages/
│   ├── db/               # Prisma schema + client（apps 共用）
│   ├── types/            # 共享 DTO / interface
│   ├── ui/               # Aurora 视觉组件库（P4 抽离）
│   └── prompts/          # AI prompt 模板（P3 引入）
├── docker/
│   ├── docker-compose.yml          # 本地 dev
│   └── docker-compose.prod.yml     # 搬瓦工 prod
├── .github/workflows/
│   ├── ci.yml            # lint + typecheck + build
│   └── deploy.yml        # SSH 到搬瓦工 docker compose pull && up -d
└── docs/
    ├── PRD/
    ├── Design/
    └── superpowers/specs/
```

### 2.3 完整技术栈

| 层 | 技术 | 备注 |
|---|---|---|
| 前端 | Next.js 15 (App Router) + Tailwind CSS + shadcn/ui + TanStack Query + Zustand | 与 Aurora 设计风格匹配 |
| 后端 API | NestJS + Prisma + class-validator | REST，OpenAPI 文档自动生成 |
| Worker | NestJS standalone application + BullMQ | 独立进程，与 API 共享 Prisma client |
| 数据库 | PostgreSQL 16 + pgvector | 向量检索做跨平台合并 |
| 队列 / 缓存 | Redis 7 | BullMQ 队列后端 + 业务缓存 |
| AI | Vercel AI SDK（provider 抽象，OpenAI / Claude / Gemini 可切换） | 含插拔式摘要策略 |
| 认证 | NestJS JWT + 配置文件 admin 账号 | User 表预留多账号扩展 |
| 部署 | 搬瓦工 VPS + Docker Compose + Caddy/Nginx 反代 + Let's Encrypt | 单机部署 |
| CI/CD | GitHub Actions（lint/typecheck/build + SSH 部署） | 主分支自动部署 |

---

## 3. 数据模型设计

P0 阶段就要落地完整 schema 骨架，避免后续频繁迁移。详细字段在 SP-0 spec 中确定，本节给出关键设计决策。

### 3.1 核心模型清单

| 模型 | 启用阶段 | 说明 |
|---|---|---|
| `HotNews` | P0 落表，P1 写入 | 热点主表，含 embedding / dedupeHash / groupId |
| `SourceConfig` | P0 落表，P1 写入 | 数据源配置（RSS URL、HN topic、Reddit subreddit 等） |
| `User` | P0 占位，P5 启用 | 单用户场景下只有 admin 一行；预留多用户 |
| `KeywordMonitor` | P0 占位，P5 启用 | 用户监控关键词配置 |
| `KeywordHit` | P0 占位，P5 启用 | HotNews ↔ KeywordMonitor 中间表 |
| `Notification` | P0 占位，P5 启用 | 通知记录 |
| `KeywordTimeSeries` | P0 占位，P6 启用 | 时序聚合（按小时/天） |
| `DailyReport` | P0 占位，P6 启用 | AI 日报内容 |

### 3.2 HotNews 关键字段（最重要，必须 P0 完整）

```prisma
model HotNews {
  id              String   @id @default(cuid())
  title           String
  summary         String?                    // P3 才填充
  content         String   @db.Text
  rawHtml         String?  @db.Text          // 保留原文便于重生成摘要
  sourcePlatform  Platform                   // enum: TWITTER | RSS | HACKERNEWS | REDDIT
  sourceUrl       String   @unique           // URL 去重（先做规范化）
  author          String?
  publishedAt     DateTime
  crawledAt       DateTime @default(now())

  // 处理结果
  aiTags          String[] @default([])      // AI 生成标签：公司/模型/类型/技术方向
  matchedKeywords String[] @default([])      // 命中的用户关键词（V0.2 起填充）
  heatScore       Float    @default(0)
  heatLevel       HeatLevel @default(LOW)    // BURST | HOT | NORMAL | LOW
  embedding       Unsupported("vector(1536)")?  // OpenAI text-embedding-3-small

  // 去重 / 合并
  dedupeHash      String   @unique           // 规范化 URL + 标题哈希
  groupId         String?                    // 跨平台合并后的事件组 ID（P3 写入）

  status          ContentStatus @default(VISIBLE)  // VISIBLE | HIDDEN | PENDING
  interactionData Json?                            // {likes, reposts, comments, upvotes}

  hits            KeywordHit[]
  group           HotNewsGroup? @relation(fields: [groupId], references: [id])

  @@index([publishedAt(sort: Desc)])
  @@index([heatScore(sort: Desc)])
  @@index([groupId])
  @@index([sourcePlatform, publishedAt])
}
```

### 3.3 已解决的设计争议

| # | 争议 | 决策 |
|---|------|------|
| 1 | aiTags 与 matchedKeywords 是否合并？ | **拆开**。aiTags 由 AI 生成，matchedKeywords 由命中检测写入 |
| 2 | 是否 P0 引入 pgvector？ | **是**。P3 跨平台合并需要，提前建表免迁移 |
| 3 | 是否保存原始 HTML？ | **是**。`rawHtml` 字段，便于后续重生成摘要 |
| 4 | URL 去重 vs 内容去重？ | **双层**：`sourceUrl` 唯一索引 + `dedupeHash`（规范化 URL + 标题哈希）唯一索引 |

---

## 4. Aurora 设计稿盘点（P4 实施依据）

### 4.1 页面清单（5 个页面 + 1 个详情）

| 页面 | 路由 | 核心模块 |
|---|---|---|
| Dashboard 首页 | `/` | 4 统计卡 / 热度榜单 / 增速最快 / 信源分布 / 我的提醒 / 24h 热度波形（HeatCurve） |
| Hot Feed 热点流 | `/feed` | 三层 Filter（时间/平台/类型）+ 双列卡片网格 |
| Detail 详情 | `/feed/[id]` | AI 摘要分析（4 维：影响级别/社区情绪/跨平台/时效性）+ 关联标签 + 相关热点 + 热度趋势 + 互动数据 + 来源分布 |
| Keyword Radar 监控 | `/radar` | 雷达图 SVG（极坐标 + 扫描线）+ 关键词列表 + 选中详情 + 新增模态框 |
| Trends 趋势 | `/trends` | 公司声量排名 + 多系列折线（模型讨论热度）+ 增速最快卡片网格 |
| Vault 内容库 | `/vault` | 搜索框 + 推荐标签 + 序号结果列表 |

### 4.2 9 个核心可复用组件（packages/ui）

`Pill` · `HeatBadge` · `Tag` · `PageHeader` · `Filter` · `MiniSpark` · `HeatCurve` · `Radar` · Glass 玻璃容器系列（`<GlassCard>` / `<GlassSoft>` / hover 变体）

### 4.3 Sidebar 与全局元素

- 5 项导航 + Radar 通知徽标
- 系统状态卡（数据抓取 / AI 摘要 / 推送服务）
- 用户卡（单用户场景显示固定 admin 信息）
- aurora-blob 浮动背景 + grad / grad-soft 渐变 token

### 4.4 实施策略（P4 SP-8 强制约束）

- **不要直接照搬内联 style**
- 颜色/字体 → Tailwind theme tokens（`tailwind.config.ts` 中扩展）
- 静态样式 → Tailwind class
- 动态样式（如 HeatBadge 按分数着色）→ `clsx` + Tailwind variants
- SVG 组件（HeatCurve / Radar / MiniSpark）→ 保持 React SVG，抽成独立组件
- 动画（fade-up / fill-bar / pulse-ring）→ Tailwind `@keyframes` + 自定义 utility

---

## 5. PRD 评审：12 个缺口的处理方式

| # | 缺口 | 严重度 | 处理方式 | 解决阶段 |
|---|------|------|------|------|
| 1 | AI 摘要成本控制策略缺失 | 🔴 高 | spec 里写"插拔式摘要策略"接口（默认全量、可配阈值限流） | P3 / SP-5 |
| 2 | 跨平台热点合并的相似度方案未定 | 🔴 高 | pgvector + OpenAI `text-embedding-3-small` + 余弦相似度（阈值 0.85，阈值在 P3 spec 中调优） | P3 / SP-7 |
| 3 | 热度公式时间窗未定义 | 🟡 中 | 默认 24h，参数化可配 | P3 / SP-6 spec |
| 4 | 抓取频率 vs 监控频率未区分 | 🟡 中 | 监控频率 ≥ 抓取频率，否则前端给出提示 | P5 / SP-14 spec |
| 5 | URL 去重 vs 内容去重策略不明 | 🟡 中 | 双层：sourceUrl + dedupeHash 唯一索引 | P0（已确定） |
| 6 | aiTags vs matchedKeywords 未区分 | 🔴 高 | schema 拆开 | P0（已确定） |
| 7 | 过期/归档机制未定 | 🟡 中 | 30 天后归档到冷表（archived_hot_news），保持主表性能 | P3 / SP-7 spec |
| 8 | 抓取失败的重试 + 告警机制 | 🟡 中 | BullMQ 默认重试（3 次指数退避）+ 失败 job 写 SourceConfig.status；告警邮件等 P5 邮件后再做 | P0 + P5 |
| 9 | 关键词同义词/排除词的实现方式 | 🟡 中 | 同义词 OR 匹配；排除词命中后置过滤 | P5 / SP-16 spec |
| 10 | Aurora 是否锁定 | 🟢 低 | **已锁定** | — |
| 11 | 原始内容存储格式 | 🟡 中 | content（plain text）+ rawHtml（原文）双存 | P0（已确定） |
| 12 | V0.1"基础关键词匹配" vs V0.2"用户关键词监控" 是否同物 | 🟡 中 | **不同**：V0.1 不做，V0.2（P5）实现用户自定义关键词，两者不重叠 | — |

---

## 6. 子项目完整清单（27 个 SP）

> **状态图例**：✅ 已交付 · 🚧 进行中 · ⏳ 待开始（未明确标注的均为 ⏳）。详情见 §11 "已完成 SP 状态追踪"。

### Phase 0：基础设施（1 SP，~3-5 天）

| SP | 状态 | 名称 | 关键产出 | 验收标准 |
|----|------|------|---------|---------|
| **SP-0** | ✅ | Monorepo + Infra 骨架 | pnpm workspace（5 子包）· Docker Compose（PG+pgvector / Redis）· Prisma 完整 schema 骨架 · CI 流水线 · 搬瓦工部署链路（SSH + Compose pull/up） | 本地 `pnpm dev` 起 5 服务全绿；GitHub Actions 全绿；服务器 `docker compose up -d` 跑空环境健康检查通过 |

### Phase 1：第一刀端到端（1 SP，~2-3 天）

| SP | 状态 | 名称 | 范围 | 验收 |
|----|------|------|------|------|
| **SP-1** | ✅ | RSS → 列表页端到端骨架 | BullMQ 定时 job 抓 1 个 RSS 源（如 OpenAI Blog）→ HotNews 入库（仅 sourceUrl + dedupeHash 去重）→ `GET /hot-news` 分页 API → `/news` 简陋列表页（**无 Aurora 视觉**，纯 Tailwind 默认样式） | 浏览器看到至少 10 条真实 RSS 抓取内容 |

**故意不做**：AI 摘要、热度计算、跨平台合并、Aurora 视觉。**目标：跑通骨架。**

### Phase 2：扩展数据源（2 SP，可并行，各 ~2 天）

| SP | 状态 | 名称 | 关键点 |
|----|------|------|--------|
| **SP-2** | ✅ | HackerNews 抓取器 | HN Firebase API · top / ask / show · 抽象 `Crawler` 插件接口 |
| **SP-3** | ✅ | Reddit 抓取器 | Reddit 公开 `.json` 端点（无 OAuth）· 8 个 AI subreddit hot 列表 · 60min crawlInterval · 429 / 5xx 处理 |

### Phase 3：内容处理升级（4 SP，部分并行，各 ~2-4 天）

| SP | 状态 | 名称 | 依赖 |
|----|------|------|------|
| **SP-4** | ✅ | 内容清洗 + 多层去重 | URL 规范化 / 内容哈希 / 标题相似度（PG fts），输出 `dedupeHash` |
| **SP-4.5** | ✅ | RSS 时效性窗口 + 平台分区 | RSS 入库 cutoff = 7d · API `?platforms` + 后端窗口表（HN/Reddit 48h、RSS 7d）· 一次性 cleanup `< now-7d` 的历史 RSS · `crawlInterval` 30min → 1d · 前端社区/权威媒体双 tab |
| **SP-4.6** | ✅ | RSS 数据源扩展 | Anthropic 换 GitHub raw 镜像并启用 · 新增 Cursor Blog / Claude Blog / Claude Code Changelog · `normalizeUrl` 加 `code.claude.com/docs/en/changelog` 精确路径白名单保留 Mintlify changelog `#X.Y.Z` 锚点 · 不动 schema / `dedupeHash` / SP-4.5 7d 入库窗口 · 7 个 RSS 源全部 `crawlInterval=86400` |
| **SP-4.7** | ✅ | ArticleExtractor（HN/Reddit 外链正文抓取） | Firecrawl + Jina chain · 独立 worker / 独立队列 / 独立 fetch 限速 · `extractStatus / extractAttempts` 字段 · ingest 阶段 link-post 哨兵命中 → push extract:<id> · 抽取成功后 `summary=NULL` 重入 summary 队列 |
| **SP-5** | ✅ | AI 摘要 + 标签分类（含 v3.2 / v3.3 / v3.4 三轮迭代） | v3.2：Vercel AI SDK + OpenRouter / DeepSeek-V3.2 · `packages/prompts` 受控词表 + prompt builder + 鲁棒 parser · `SummarizationStrategy` 接口（V1 实现 `SummarizeAllVisibleStrategy`）· BullMQ `summary` 队列 + boot backstop · ingest 入口 L0 主题过滤（keywords.md，非 AI 不入库）· HN quality 阈值 5/2 → 20/5 · Reddit 8 sub → 13 sub bundle 合并 · 一次性 wipe 脚本 `wipe-hot-news-pre-sp5.ts` 。<br/>v3.3：新增 `titleZh String?` 列（中文标题翻译，原 `title` 不动）· 摘要恰好 2 行 / `\n` 分隔 / 60-90 字 · Reddit 阈值再提升（ratio 0.5→0.7 / score 5→10 / comments 2→5）· cleanup 脚本 `cleanup-reddit-quality-v3-3.ts` 按新阈值删现有行 · boot backstop 加 `queue.clean(0, 0, 'failed')` 前置（修 BullMQ jobId dedupe stuck bug） 。<br/>v3.4：摘要 prompt rewrite —— 取消硬换行，改为单段 50-80 字连贯陈述 + 中立新闻派语调 + 套话 / 营销腔黑名单 + 对照 ✗/✓ 示例。 |
| **SP-6** | ⏳ | 热度分计算 | PRD 6 维公式 · 时间窗参数化（默认 24h）· 入库时计算 + 定时重算（衰减） |
| **SP-7** | ⏳ | 跨平台热点合并 | pgvector embedding 入库 · 余弦相似度查询 · 阈值聚合赋 `groupId` · 归档机制（30 天后冷表） |

### Phase 4：Aurora 前端落地（5 SP）

| SP | 名称 | Aurora 对应 | 关键工作 |
|----|------|-----------|---------|
| **SP-8** | Aurora 视觉系统 + App 骨架 | `Sidebar` + 9 个 atoms + tokens + 动画 | `packages/ui` 抽出组件 · Tailwind theme 扩展 · 全局 aurora-blob 背景 · 路由壳子（radar/trends/vault 显示 placeholder） |
| **SP-9** | Dashboard 首页 + Stats API | `HomePage` | 4 卡统计（接 `GET /stats/today`）· 热度榜单（接 `GET /hot-news?sort=heat&limit=6`）· 信源分布（接 `GET /stats/sources`）· 24h `HeatCurve`（接 `GET /stats/heat-curve`）· 增速最快（接 `GET /stats/trending-keywords`）· 我的提醒（占位 placeholder，P5 接通真数据） |
| **SP-10** | 热点流 FeedPage | `FeedPage` | 三层 Filter（时间/平台/类型）· 双列卡片 · 分页（无限滚动 or 翻页） |
| **SP-11** | 热点详情 DetailPage | `DetailPage` | AI 摘要 4 维分析 · 关联标签 · 相关热点（基于 `groupId`，接 `GET /hot-news/:id/related`）· 热度趋势 SVG（接 `GET /hot-news/:id/heat-history`）· 互动数据 · 来源分布 · 收藏按钮（占位，P5 启用） |
| **SP-12** | 内容库 VaultPage | `VaultPage` | 搜索框 + 推荐标签 + 序号列表（PG fts 全文检索） |

### Phase 5：关键词监控 + 推送（6 SP）

| SP | 名称 | 关键工作 | 估算 |
|----|------|---------|------|
| **SP-13** | 极简单用户认证 | NestJS JWT + 配置文件 admin 账号 + Web 端登录页 + middleware；User 表预留多账号 | ~1 天 |
| **SP-14** | 关键词 CRUD API | KeywordMonitor 表 · 同义词/排除词/触发规则字段 · `monitorFrequency ≥ crawlInterval` 校验 | ~2 天 |
| **SP-15** | 关键词监控页 UI（含 Radar SVG） | 雷达图 SVG（极坐标 + requestAnimationFrame 扫描线）· 关键词列表（含 MiniSpark + 状态指示灯 pulse-ring）· 选中详情面板 · 新增模态框 | **~3-4 天** |
| **SP-16** | 命中检测 worker | 消费每条新 HotNews · 同义词 OR 匹配 · 排除词后置过滤 · 写 KeywordHit 中间表 + 反写 HotNews.matchedKeywords | ~2 天 |
| **SP-17** | 触发条件 + 站内通知 | minCount / minHeatScore / growthRate 判断 · Notification 表 · NotificationCenter UI · Sidebar Radar 通知徽标接通 · 详情页"推送渠道"接通 | ~3 天 |
| **SP-18** | 邮件推送 | Nodemailer + SMTP 配置 + 模板 · 失败重试 + 失败邮件告警（PRD 缺口 #8 收尾） | ~2 天 |

### Phase 6：趋势分析（3 SP，各 ~2-3 天）

| SP | 名称 | 关键工作 |
|----|------|---------|
| **SP-19** | KeywordTimeSeries 时序聚合 + API | 按小时/天聚合关键词命中数 · `GET /trends/keywords` · `GET /trends/companies` · `GET /trends/models` |
| **SP-20** | 趋势分析页 TrendsPage | 公司声量排名（进度条形式）· 多系列折线（**Recharts**，比 ECharts 体积小）· 增速 Top 8 卡片网格 |
| **SP-21** | AI 日报自动生成 | 每日定时 job · 24h 热点喂 LLM 生成日报 · DailyReport 表 · 日报页（路由 `/daily-report/[date]`）· Dashboard"生成今日日报"按钮接通 |

### Phase 7：高阶能力（5 SP，各 ~3-5 天）

| SP | 名称 | 关键点 |
|----|------|---------|
| **SP-22** | Twitter/X 抓取器 | 成本评估 + X API 申请 · 关键词搜索 + 指定账号监控 · 推文互动数据 |
| **SP-23** | 多渠道推送抽象 | 统一 `PushAdapter` 接口 · 飞书 / 钉钉 / Telegram / Webhook adapter |
| **SP-24** | 后台管理界面 | 数据源管理 / 关键词字典 / 内容质量管理 / 推送日志（仅 admin 可见） |
| **SP-25** | 浏览器插件（可选） | PRD P2 提及 · 划词监控 / 当前页面 AI 摘要 |
| **SP-26** | AI 分享文案生成 | 详情页 ✨ 按钮接通 · 小红书 / Twitter thread / 博客标题 / 公众号大纲多模板 |

---

## 7. 关键路径与并行机会

### 7.1 依赖图

```text
                  SP-0 (基础设施)
                     │
                     ▼
                  SP-1 (RSS 端到端骨架)
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   SP-2 (HN)    SP-3 (Reddit)  SP-4 (去重)
                                  │
                                  ▼
                         ┌─────────────┐
                         ▼             ▼
                    SP-5 (AI 摘要)  SP-6 (热度)
                         │             │
                         └──────┬──────┘
                                ▼
                          SP-7 (跨平台合并)
                                │
                                ▼
                          SP-8 (Aurora 视觉系统)
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
           SP-9 (首页)    SP-10 (列表)    SP-11 (详情)    SP-12 (内容库)
                │               │               │               │
                └───────────────┴──★ MVP ★──────┴───────────────┘
                                │
                                ▼
                         SP-13 (认证)
                                │
                                ▼
                         SP-14 (关键词 API)
                          │            │
                          ▼            ▼
                      SP-15 (UI)   SP-16 (检测)
                                       │
                                       ▼
                                  SP-17 (站内通知)
                                       │
                                       ▼
                                  SP-18 (邮件)
                                       │
                                       ▼
                                  SP-19/20/21 (趋势 / 日报)
                                       │
                                       ▼
                                  SP-22..26 (P7 高阶)
```

### 7.2 关键路径与里程碑

```text
M1 = SP-0 完成        → 服务器跑起来空环境              (~第 1 周)
M2 = SP-1 完成        → 浏览器看到第一条真实 RSS        (~第 2 周)
M3 = SP-2/3/4 完成   → 三个数据源 + 去重               (~第 3-4 周)
M4 = SP-5/6/7 完成   → AI 摘要 + 热度 + 跨平台合并跑通 (~第 5-6 周)
M5 = P4 完成 ★ MVP   → 个人可用 read-only 站点上线     (~第 7-8 周)
M6 = P5 完成          → V0.2 关键词监控 + 邮件         (~第 11 周)
M7 = P6 完成          → V0.4 趋势 + AI 日报             (~第 13 周)
M8 = P7 完成          → 完整能力（含 Twitter）         (~第 17 周)
```

> **估算前提**：业余时间投入，每周 ~10-15 小时。如全职投入可压缩 1/3 时间。

### 7.3 并行机会

| 可并行组合 | 说明 |
|---|---|
| SP-2 ‖ SP-3 | HN 与 Reddit 抓取器互不依赖，完全并行 |
| SP-4 ‖ SP-5 ‖ SP-6 | 去重 / AI 摘要 / 热度计算 三者输入相同（HotNews 行），可并行实现 |
| SP-9 ‖ SP-10 ‖ SP-11 ‖ SP-12 | 在 SP-8 视觉系统完成后，4 个前端页面完全并行 |
| SP-15 ‖ SP-16 | 关键词页 UI 与命中检测 worker 互不阻塞 |

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| AI 摘要月成本超预算 | 中 | SP-5 实现"插拔式摘要策略"，提供按热度/平台/类型限流的开关 |
| 搬瓦工 VPS 性能不足以同时跑 worker + embedding 推理 | 中 | embedding 走 OpenAI API（不本地推理）；worker 用 BullMQ 限流；预留 Phase 5 后再评估是否分服务器 |
| Twitter API 成本过高 | 高 | 移到 P7 末尾；MVP 期不依赖；可选用 RSSHub 等免费替代方案降级 |
| Aurora 设计稿 React 内联 style 落到 Tailwind 工作量被低估 | 中 | SP-8 spec 里强制要求"实施策略"小节，先做 token 抽取再做组件 |
| pgvector 在搬瓦工 PostgreSQL 镜像不可用 | 低 | Docker 镜像用 `pgvector/pgvector:pg16`，已验证可在通用 VPS 跑 |
| 个人项目动力损耗（写到一半放弃） | 高 | 选 Strategy B（纵切端到端），M2 第 2 周就能在浏览器看到效果 |
| 关键词同义词的语义匹配可能不够智能 | 低 | V1 先用 OR 字符串匹配；P7 阶段可考虑用 embedding 做语义同义词扩展 |

---

## 9. 后续步骤

本文档批准后：

1. **立即下一步**：针对 **SP-0（Monorepo + Infra 骨架）** 启动 brainstorming → spec → plan → implement 循环。SP-0 spec 文件命名规范：`docs/superpowers/specs/<YYYY-MM-DD>-sp0-monorepo-infra-design.md`（日期为该 spec 实际撰写日）
2. **后续 SP**：每个 SP 完成后再启动下一个 SP 的 brainstorming，避免一次性规划过细导致设计漂移
3. **本文档维护**：SP-0 实施完成后回写本文档"已完成 SP"清单；如发现拆解需要调整（合并/拆分/重排），更新本文档并 commit

---

## 10. 决策日志（Decision Log）

| 决策日期 | 决策 | 替代方案 | 决策理由 |
|---|---|---|---|
| 2026-05-01 | 全栈 Next.js + NestJS 拆分（不合一） | 全栈 Next.js | 用户偏好严格拆分 |
| 2026-05-01 | Prisma | Drizzle | 用户偏好 |
| 2026-05-01 | BullMQ + Redis | pg-boss | 用户偏好 |
| 2026-05-01 | 搬瓦工 VPS + Docker Compose | Vercel + 托管 PG | 用户已有服务器 |
| 2026-05-01 | P0 引入 pgvector | P3 再引入 | 避免后续大改 schema |
| 2026-05-01 | 单用户极简认证（User 表预留） | 完整多用户 | 个人自用 |
| 2026-05-01 | aiTags + matchedKeywords 拆开 | 合并 tags[] | 语义不同，扩展性更好 |
| 2026-05-01 | Strategy B：纵切端到端 + 横向扩展 | 按 PRD V0.1-V0.4 节奏 | 个人项目防失去动力，最快看到反馈 |
| 2026-05-01 | Aurora 设计稿锁定为最终视觉 | 后续重新设计 | 设计稿完成度高，5 页面 + 9 组件已成型 |
| 2026-05-01 | Recharts > ECharts | ECharts | 体积更小 + React 集成更顺 |
| 2026-05-01 | 总 SP 数 27 | 26 | 新增 SP-26 分享文案生成 |
| 2026-05-03 | SP-2 抽象 `Crawler` 接口 + `CrawlerFactory` + 重命名 BullMQ 队列 `rss-crawl → crawl` | 在 RssCrawler 上原地加 if-platform 分支 | 平台路由由工厂集中（O(N) 接入新平台）；旧队列在新 worker 启动时 `obliterate` 一次以避免遗留任务 |
| 2026-05-03 | SP-2 `RawCrawledItem` 加可选 `interactionData?: Record<string,unknown> \| null` | 每平台一张影子表 | 字段约定 spec §4.2 标准化（HN: `hnId/score/comments/externalUrl`，Reddit/X 各加自己前缀字段），未来 SP-3/SP-22 直接复用 |
| 2026-05-03 | SP-2 HN crawler 直读 Firebase API `https://hacker-news.firebaseio.com/v0/{topstories,askstories,showstories}.json` | 用第三方 SDK | 官方 API 稳定 + 零依赖；`p-limit` 控制 N+1 fetch 并发，`HN_CONCURRENCY=10` / `HN_FETCH_TIMEOUT_MS=15000` 可调 |

### SP-3 Reddit 抓取器（2026-05-04）

1. **抓取通道改为 Reddit 公开 `.json` 端点（v1 OAuth 路线废弃）**：Reddit 2025 末上线 Responsible Builder Policy，self-service OAuth 关闭，必须人工审核且周期不确定。改走 `https://www.reddit.com/r/<sub>/hot.json`：~60 req/min/IP，本项目 8 req/h 远低于限制；零凭据管理；与 OAuth 返回字段一致。详见 SP-3 spec §0 / §5.1。
2. **8 个 sub 全开 + hot 25**：与 PRD §7.5.2 推荐对齐；`hot` 半小时变化 ≤10 条，25 覆盖率充分；运维可手工 SQL `UPDATE source_configs SET enabled=false WHERE identifier='X'` 关掉噪音 sub，下次 deploy seed 不覆盖手工改动。
3. **60 分钟 `crawlInterval`**：Reddit 帖半衰期 ≥6h；与 HN 30 分钟错开节奏；8 sub × 25 帖 × 0.3 新增比例 / h ≈ 60 行/h ≈ 1500 行/天，磁盘压力可控。
4. **不抓评论原文**：`interactionData.comments` 仅记计数；评论数据真实消费者是 SP-5 AI 摘要，到时候独立 worker 按"高热度帖"按需抓更经济。
5. **`SourceConfig.url` 优先 vs `identifier` 拼接**：标准 sub 模式 seed 极简（只填 identifier）；未来扩展形态（关键词搜索 / 多 sub 集群）零代码改动接入，crawler `resolveUrl()` 一处处理。
6. **crawler 输出的 `sourceUrl` 不带尾斜杠**（与 `normalizeUrl()` canonical form 对齐）：原计划照搬 Reddit permalink 形如 `/r/<sub>/comments/<id>/`（尾斜杠），但 `packages/utils/src/url.ts::normalizeUrl()` 会去掉尾斜杠后入库，导致 `RedditCrawler.toRaw()` 输出 `/r/<sub>/comments/<id>/` 与库内 `/r/<sub>/comments/<id>` 不一致，集成测试 `findFirstOrThrow` 会 P2025。修法：`RedditCrawler` 直接生成无尾斜杠 URL；HN crawler 已天然无尾斜杠，规则统一。

### SP-4 内容清洗 + 多层去重（2026-05-04）

1. **去重 vs 热点发现的硬边界**：SP-4 只折叠"物理重复"（同 URL 异形如 http→https、m.x.com→x.com），跨平台同事件保留 N 行交给 SP-7 用 pgvector 余弦软合并 + groupId。SP-4 绝不引入跨 URL 标题相似度强制 unique，避免杀掉 PRD 核心的"3 个平台同时报道"热度信号。
2. **过滤分三个维度**：维度 1 合规/非内容 → crawler 阶段直接不入库（SP-3 沿用）；维度 2 质量低 → 入库 + `status='HIDDEN'` + `filterReason`；维度 3 主题不相关 → SP-4 不做，等 SP-5 LLM 打 `aiTags`。
3. **维度 2 选 HIDDEN 而非不入库**：阈值的 ground truth 现在不知道，HIDDEN 留数据可一行 SQL 反转测试；SP-7 跨平台合并时 HIDDEN 行可参与 group 形成做"覆盖度信号增强"；DB 体量影响 < 0.001%（+0.5MB/年）可忽略。
4. **维度 3 推到 SP-5 而非 SP-4 关键词层**：避免词表维护负担 + 双层冗余；SP-5 LLM 自然处理新话题；接受 SP-4 完工后约 1-2 周内列表仍有"高分非主题"内容的 trade-off。
5. **URL 规范化 6 条新规则**：http→https 折叠、Reddit 老入口 alias（`old/np/new.reddit.com → www.reddit.com`）、Twitter host alias（`twitter.com / mobile.twitter.com / m.x.com → x.com`）、`m.` / `mobile.` 子域剥离、重复 query 合并（last-wins）、空 `?` 串剥离。**不动 www 子域**（OpenAI 裸域 vs Wikipedia 必带子域，策略不一致）。
6. **过滤逻辑分层**：platform-specific 阈值（`checkRedditQuality` / `checkHnQuality`）放在 crawler `toRaw()` 写入 `RawCrawledItem.filterReason`；platform-agnostic 兜底（`checkUniversalQuality({ title })`）由 `IngestionService` 在清洗后调用。所有阈值集中在 `packages/utils/src/quality.ts` 的 `FILTER_REASONS` 单一事实源。
7. **`dedupeHash` 用清洗后标题计算**：原 SP-1 用 `raw.title` 做 hash，但带 `" - OpenAI Blog"` 后缀的 RSS 与不带后缀的去重等价但 hash 不同；`IngestionService` 把 `stripTitleBoilerplate` 提到 `computeDedupeHash` 之前，跨 feed 变体也能折叠成同一 dedupeHash。
8. **ArticleExtractor 剥离 SP-4 独立**：SP-3 spec 把 ArticleExtractor 标在 SP-4 里，但 brainstorming 时确认该子系统独立性强（独立 worker / 独立队列 / 独立 fetch 限速）。原计划占用 SP-4.6 编号，但该编号在 2026-05-04 已被"RSS 数据源扩展"实际占用，ArticleExtractor 子项目改在 SP-4.7 或 SP-5 前置规划。SP-4 完工后 link-post 保留 `content=title, rawHtml=null` 现状作为检测哨兵。
9. **backfill 脚本不进 deploy.sh**：一次性脚本进自动链路浪费部署时间；多次 deploy 后报告永远 0 updated 误导运维。手工 ssh 跑一次写进 commit log 标记。Backfill 期间避免 ingest 写入（worker 可临时停），避免 P2002 lookup 与并发 INSERT 竞态——这是单 writer 假设。
10. **P2002 collapse 必须按 publishedAt 决策**（code-review catch）：原实现「冲突时删当前迭代行」在「老行 `http://`、新行已 canonical `https://`」组合下会误删较早行。修法：P2002 时 `findFirst` 查冲突方，比 `publishedAt` 删较新者，再 retry 当前行的 update；用 `deletedRowIds: Set<string>` 跳过预取列表里已被删的 id 避免 P2025。回归测试 `Layer 1: ... OLDER wins` 锁定语义。**这一 bug 若没 review 直接上 VPS 跑 backfill，会丢历史最早期数据，影响 SP-7 跨平台热度合并的早期信号——keystone review 价值的直接证据**。
11. **一次性 prod 脚本必须用 worker image 跑 + 包名 import + helper 封装**（部署阶段 catch，post-mortem 决策）：第一次在 prod 跑 `migrate-sp4.ts` 时连撞三个坑——(a) plan 假设 host 装了 pnpm/Node，但 VPS host 没装；(b) fallback `docker compose exec api ... npx tsx scripts/migrate-sp4.ts` 失败：api Dockerfile 没 COPY `packages/db/scripts/`，且 api 是 NestJS standalone bundle，把 `@ai-hot-news/utils` inline 了，runtime 没 `node_modules/@ai-hot-news/utils`；(c) `migrate-sp4.ts` 用 `'../src/index.js'` 相对路径 import，prod image 里只有 `dist/` 没 `src/`，必须 sed 改写。修法（已固化，详见 commit `chore(sp4): post-mortem fixes — bake one-shot scripts into the prod image`）：① 一次性脚本统一用包名 import（`'@ai-hot-news/db'` / `'@ai-hot-news/utils'`），与 `seed.ts` 对齐——dev/test 走 pnpm self-link 解析、prod 走 dist 解析，两端无歧义；② **worker image** 是一次性脚本的天然宿主（已 COPY `packages/utils/dist` + 有 `@ai-hot-news/utils` symlink），`apps/worker/Dockerfile` 加 `COPY packages/db/scripts` 让脚本随镜像走；③ `scripts/run-prod-oneshot.sh` 封装 `docker compose run`，自动从 `docker compose ps worker` 抓当前运行的 IMAGE_TAG（避免 `.env` 里 `IMAGE_TAG=latest` fallback 与 deploy.sh 用的 `:sha-<commit>` 漂移）。**SP-7 pgvector backfill / SP-19 KeywordTimeSeries 历史聚合 / 任何后续 SP 的一次性脚本必须遵守这套 pattern**：放 `packages/db/scripts/`（或 `packages/<owner>/scripts/`）、用包名 import、命令形如 `bash scripts/run-prod-oneshot.sh packages/db scripts/migrate-spX.ts`。

### SP-4.5 RSS 时效性窗口 + 平台分区（2026-05-04）

> 详细设计：`docs/superpowers/specs/2026-05-04-sp4-5-rss-windowing-design.md`

1. **窗口由"内容产出节奏"决定，不是拉取频率**：RSS 周产出 ~10 篇 → 7d 窗口；HN/Reddit 日产出几百 → 48h 窗口。统一窗口策略不可行——SP-4 部署后实测 48h 窗口 RSS 0 条（OpenAI 上线时一次性灌入 929 条 2015 至今历史，feed 协议层无增量过滤）。
2. **平台分 tab 而非混排**：`publishedAt desc` 排序混排会让"权威媒体 7d 旧文"全部沉到 Reddit 48h 新热点之后，"权威媒体专区"产品价值消失。前端 2 个固定 tab：社区（HN+Reddit 48h）/ 权威媒体（RSS 7d）。
3. **RSS 拉取从 30min 降到 1d**：30min 是过度轮询（OpenAI 一周才发 7 篇）。1d 一次：OpenAI 新博客 ≤ 24h 延迟、调用量从 192 次/天 → 4 次/天。**HN/Reddit 拉取频率不动**（论坛热度衰减快、需高频）。
4. **cutoff 在 IngestionService 而非 Crawler**：Crawler 保持"原样翻译 feed"职责单一；cutoff 是"业务策略"，集中在 ingestion 层一处管理；未来加新 RSS source 0 改 crawler。`IngestionService` 新增 `isWithinIngestWindow(raw, source, now)` 早返，`IngestResult` 新增 `skippedOutsideWindow` 计数。
5. **API 不暴露 windowHours 给前端**：窗口大小是后端"业务策略"，前端只传 `?platforms=`。`PLATFORM_WINDOW_HOURS` 表硬编码在 `HotNewsService`。避免前端误传超大窗口（如 8760h）触发慢查询。
6. **API 默认请求等价 `platforms=HACKERNEWS,REDDIT`**：这是首页常用 view。如果未来 RSS 重要性上升，改默认即可（一行 default value）。多平台 query 用 `OR` 列表保留平台不同窗口的可能性，不写成单 AND。
7. **HN/Reddit 不删 DB 老数据**：HN 48h 之外 ~498 条 / Reddit 48h 之外 ~27 条无类似 RSS "OpenAI 2015" 的明显荒诞；保留 30d 内全部行作为未来"上周热门"/时间轴分析的数据基础。API 端 window 过滤已经足够把它们挡在首页之外。
8. **物理 DELETE 历史 RSS 而非 HIDDEN 标记**：用户在 brainstorming 显式选择"清理"。trade-off 接受：1119 条全是 ≥7 天前过期内容，业务无价值；不可逆但可通过 RSS feed 重抓部分恢复（cutoff 调大时）。**这是 SP-4.5 唯一与 SP-4「保留 + HIDDEN」哲学相悖的决策——明确以"用户原话 + RSS 内容老到无业务意义"作为正当性**。
9. **不实现 HTTP Conditional GET（YAGNI）**：能降 90% 网络流量但当前 8 MB/天 RSS 流量本就可忽略；加 `source_configs.lastModified/etag` 字段 + 改 fetch 实现 + 错误处理收益不抵成本。RSS source 数量上百再说。
10. **SP-4.5 不动 SP-4 已交付的 quality/dedupe/cleaning**：本期只在最外层加窗口过滤（API 出口 + Ingestion 入口）+ RSS 拉取节流，SP-4 内部逻辑零改动。**模块边界清晰：cleaning 在 ingestion 中段、cutoff 在 ingestion 早段、windowing 在 API 出口——三层互不干扰**。

### clawfeed 学到的两个点（2026-05-03，brainstorming 阶段）

1. **URL auto-detect**（feed URL 自动识别 RSS / Atom / JSON / OPML）：→ 未来 SP-24 后台管理页 UX 参考，单用户场景目前 YAGNI。
2. **source_packs**（按主题分享 source 集合）：→ 未来 SP-24 / 多用户场景 UX 参考，单用户场景目前 YAGNI。

---

## 11. 已完成 SP 状态追踪

> **维护策略**：每个 SP 完成（merge to main + smoke 验证通过）后追加一行；标注关键 commit 范围、完成日期、产出特征、对后续 SP 的契约影响。

| SP | 完成日期 | Commit 范围 | 关键产出 | 对后续 SP 的契约影响 |
|----|---------|-----------|---------|------------------|
| **SP-0** | 2026-05-02 | `fde9829..b87e7df`（含 `Merge SP-0`） | pnpm/turbo monorepo · `apps/{web,api,worker}` + `packages/{db,types,utils}` · Docker Compose（PG + pgvector + Redis）· Prisma schema（HotNews / SourceConfig / KeywordMonitor / KeywordHit ...）· CI · VPS 部署链路 | 后续 SP 直接消费的基础。`packages/types` 是跨进程契约的源头；`packages/utils` 沉淀跨 crawler 公共逻辑 |
| **SP-1** | 2026-05-03 | `fde9829..7e6a491^`（即 SP-2 docs 之前）·SP-1 plan: `docs/superpowers/plans/2026-05-02-sp1-rss-list-end-to-end-plan.md` | RssCrawler · CrawlScheduler（BullMQ repeat job，原队列名 `rss-crawl`）· CrawlProcessor · IngestionService（unique sourceUrl + try/catch 抑制 P2002）· `GET /hot-news` 分页 + DTO · `/news` 列表页（纯 Tailwind） | RSS 数据流端到端打通。`Crawler` 接口在 SP-2 才被抽象；SP-1 的 `IngestionService.SourceLike` 在 SP-2 改为通用 `Platform` |
| **SP-2** | 2026-05-03 | `35da0fe..81f2c70`（13 commits + 2 docs）·spec: `2026-05-03-sp2-hackernews-crawler-design.md` ·plan: `2026-05-03-sp2-hackernews-crawler-plan.md` | `Crawler` 接口 + `CrawlerFactory`（platform → crawler 路由）· `HackerNewsCrawler`（top/ask/show, p-limit, AbortSignal.timeout）· `stripHtml` 抽到 `@ai-hot-news/utils` · `RawCrawledItem.interactionData` 字段约定 · `HotNews.interactionData` 透传 · BullMQ 队列重命名 `rss-crawl → crawl` 并 `obliterate` 老队列 · seed 加 HN top/ask/show 三条 SourceConfig（identifier 而非 url）· `/news` platform 徽章渲染（`HN`/`RSS`/`Reddit`/`X` 4 色） | **接口契约**：`Crawler.fetch(): Promise<RawCrawledItem[]>` 是后续所有平台抓取器的统一形态。**字段约定（spec §4.2）**：`interactionData` 各平台前缀字段命名固化（HN: `hnId`/Reddit: `redditId,redditSubreddit`/X: `twTweetId,twReposts`）。**SP-3/SP-22 影响**：直接 `case Platform.REDDIT/TWITTER` 加进 `CrawlerFactory.create()` switch + 在 `CrawlScheduler.platform IN [...]` 列表里加上即可，零结构改动 |
| **SP-3** | 2026-05-04 | `7994e79..afa11be`（9 commits）+ 本 docs commit ·spec: `2026-05-03-sp3-reddit-crawler-design.md`（v2 公开 `.json` 路线）·plan: `2026-05-03-sp3-reddit-crawler-plan.md` | `RedditCrawler` 走 Reddit 公开 `.json` 端点（无 OAuth），`resolveUrl()` 支持 `SourceConfig.url` 优先 / `identifier` 回退两种模式 · 8 个 AI subreddit hot 列表（LocalLLaMA / MachineLearning / artificial / OpenAI / ChatGPT / singularity / StableDiffusion / ClaudeAI），60min crawlInterval · `interactionData` 6 字段（`score / comments / externalUrl / redditId / redditSubreddit / redditUpvoteRatio`）· 显式 429 + 5xx 错误处理 · `REDDIT_USER_AGENT` 强制要求（`(by /u/<owner>)` 后缀）+ `REDDIT_FETCH_TIMEOUT_MS` 可调 · `CrawlerFactory` / `CrawlScheduler` / `IngestionService` 全部按 §11 "Onboarding 标准流程" 5 步走 · `RedditCrawler.toRaw()` 输出无尾斜杠 sourceUrl 与 `normalizeUrl()` canonical form 对齐 | **新平台扩展形态**：`SourceConfig.url` 优先 vs `identifier` 拼接的双轨模式被 `RedditCrawler.resolveUrl()` 固化，未来加关键词搜索源 / 多 sub 集群源时 seed 直接填 `url` 字段，零代码改动接入。**URL canonical form 约定**：所有 crawler 的 `toRaw().sourceUrl` 必须与 `normalizeUrl()` 输出一致（无尾斜杠、无 tracking params、hash 已剥离），否则集成测试 `findFirstOrThrow` 会 P2025；HN / Reddit 已对齐，新平台 SP 必须遵守。**Onboarding 流程验证通过**：完全按 §11 "Onboarding 新平台 SP 的标准流程" 5 步实施，零结构改动 |
| **SP-4.5** | 2026-05-04 | `da31a09..c962c65`（13 commits = 2 docs + 9 feat + 1 test + 1 robustness fix）·spec: `2026-05-04-sp4-5-rss-windowing-design.md` ·plan: `2026-05-04-sp4-5-rss-windowing-plan.md` | `IngestionService.isWithinIngestWindow()` 7d cutoff（RSS-only 平台早返、null `publishedAt`→drop、`>=` 边界）→ 进 `result.skipped`，不新增 `IngestResult` 字段 · `cleanup-rss-pre-window.ts` 一次性 `deleteMany WHERE sourcePlatform='RSS' AND publishedAt < now-7d`，dual-mode entrypoint（`require.main` + `argv[1].endsWith`）+ 集成测试（删除/HN-Reddit-不动/边界），整测试套件并发安全靠 `packages/db/vitest.config.ts: fileParallelism=false` · `sp4-5-update-rss-interval.sql` 幂等 SQL（`WHERE crawlInterval <> 86400`）· `ListHotNewsQuery.platforms?: AllowedPlatform[]` DTO 字段（`@Transform` trim+upper、`@IsIn` 校验、未知平台→400）· `HotNewsService.list(page, size, platforms?)` + `PLATFORM_WINDOW_HOURS: Record<Platform, number>`（HN=48 / Reddit=48 / RSS=168 / Twitter=48 占位 typesafe）+ `DEFAULT_PLATFORMS=['HACKERNEWS','REDDIT']`（`platforms?.length ? platforms : DEFAULT_PLATFORMS` 同时处理 `undefined` 与 `[]`）· `where = { status: 'VISIBLE', OR: [{sourcePlatform, publishedAt: {gte: now-hours*ms}}, ...] }`，`findMany` 与 `count` 共享同一 where · `HotNewsController.list()` 透传 `query.platforms` · `fetchHotNewsList(page, size, platforms?: FeedPlatform[])` Web 层 fetch + `URLSearchParams` 序列化为 `?platforms=A,B` · `apps/web/app/news/_components/feed-tabs.tsx` 服务端组件（`?tab=community\|media`，default community）· `/news/page.tsx` 用 `TAB_PLATFORMS` map 把 tab 转 `platforms[]` 传给 fetcher，EmptyState 移到 `<main>` 内（保留 tabs 始终可见）· `Pagination` 改用 Next `UrlObject` 形式（`{pathname:'/news', query:{tab,page}}`）以兼容 `typedRoutes:true`，渲染 URL 仍为 `/news?tab=...&page=...` | **API 默认行为变更（breaking）**：`GET /hot-news` 默认从「全部平台 VISIBLE」变成「HN+REDDIT 48h VISIBLE」。任何不带 `?platforms=` 的旧客户端会少看到 RSS。Web 端配套切换到 `?tab=` 协议；外部脚本如有依赖需升级。**新平台扩展点**：`PLATFORM_WINDOW_HOURS` 是 `Record<Platform, number>` exhaustive，未来加 Twitter / 任何新 Platform 必须同时填窗口；`ALLOWED_PLATFORMS`（DTO）和 `FeedPlatform`（web）是 union string，新平台需三处同步。**Ingest cutoff 契约**：RSS-only，HN/Reddit 仍依赖 SP-4 quality 维度过滤；将来若有新「snapshot 型协议」（GitHub trending、产品周报等）应该挂同款 cutoff，`isWithinIngestWindow` 是命名锚点。**一次性脚本契约（继续遵守 SP-4 §10 决策 11）**：`cleanup-rss-pre-window.ts` 用包名 import + `scripts/run-prod-oneshot.sh` 调用，prod 部署需先 stop worker 维持 single-writer。**`fileParallelism=false` 并发安全契约（新增）**：`packages/db` 集成测试共享一个 dev DB，全局性 deleteMany 测试与其他 spec 并行会冲突；新增 db-package 测试若是「全局性写」必须意识到该 fileParallelism 关闭、测试断言改 prefix-scoped 而非全局精确计数（用例 1 修过同款 flake，commit `c962c65`）。**前端 typedRoutes 兼容**：`next.config.ts: typedRoutes=true` 下任何含 `${string-union}` 的 `Link href` 必须用 `UrlObject` 形式 `{pathname, query}`，模板字符串无法静态收窄。后续 SP-? 想给 `/news` 加更多 query 参数照同款写。**RSS 拉取节流**：crawlInterval 30min→1d，最坏延迟 24h；如果运营反馈 OpenAI/Anthropic 新博客上线滞后明显，可短期调回 1800 而无需改代码（DB-driven）。**Web 测试基础设施债**（implicit）：`apps/web` 至今无 vitest infra（`test` script 是 `echo 'no tests yet (P4)'`），Task 7 的 fetchHotNewsList 改动跳过单测靠 typecheck + Task 11 prod smoke 兜底；如果未来 web 逻辑分支变多应单独开 SP 装 vitest+jsdom+RTL，目前 YAGNI。 |
| **SP-4** | 2026-05-04 | `aa9e03a..652c981`（14 commits）·spec: `2026-05-04-sp4-content-cleaning-dedup-design.md` ·plan: `2026-05-04-sp4-content-cleaning-dedup-plan.md` | `normalizeUrl` 6 条新规则（http→https / Reddit alias / Twitter alias / m./mobile. 剥离 / 重复 query 合并 last-wins / 空 `?` 串剥离）· `stripTitleBoilerplate`（13 站点白名单 + 4 种 dash/pipe 分隔符）+ `stripContentBoilerplate`（4 种 RSS 尾部模式 + 空白/换行折叠）· `quality.ts` 三函数（`checkRedditQuality` / `checkHnQuality` / `checkUniversalQuality`）+ `FILTER_REASONS` 4 常量 · `RawCrawledItem.filterReason?: string \| null` 字段（types 包）· `HotNews.filterReason String?` 列 + Prisma migration（`20260504073513_sp4_filter_reason`，camelCase 列名）· `RedditCrawler.toRaw()` / `HackerNewsCrawler.toRaw()` 写入 `filterReason` · `IngestionService` 入库前清洗（cleanTitle/cleanContent 先于 dedupeHash 计算）+ `raw.filterReason ?? checkUniversalQuality()` 兜底 + status/filterReason 写入 + `IngestResult.hidden` 计数 · `CrawlProcessor` 日志含 `hidden=` · `HotNewsService` 默认 `WHERE status=VISIBLE` · `packages/db/scripts/migrate-sp4.ts` 一次性 backfill（Layer 1 normalize + Layer 2 quality）含按 `publishedAt` 决策的 P2002 collapse · `pnpm db:migrate-sp4` 根脚本 · `packages/db/test/setup-env.ts` 让 turbo test 自动 load `.env` | **新过滤维度契约**：dimension 1 (compliance) → drop in crawler；dimension 2 (quality) → ingest with `status='HIDDEN'` + `filterReason`；dimension 3 (topic) → defer to SP-5 LLM。**HIDDEN 数据保留契约**：SP-7 跨平台合并消费 HIDDEN 行做覆盖度信号增强；SP-5 LLM 上线后可重新判定 status；任何写入路径必须维护两条不变量「`VISIBLE & filterReason!=NULL` count=0」「`HIDDEN & filterReason=NULL` count=0」。**utils 内阈值约定**：所有 quality 阈值集中在 `packages/utils/src/quality.ts`，未来想 per-source 调整可升级到 `SourceConfig.metadata` 注入。**API 默认契约**：`GET /hot-news` 默认 `WHERE status='VISIBLE'`，不暴露 `?includeHidden=true`（YAGNI）。**清洗流水线契约**：`stripTitleBoilerplate` → `stripContentBoilerplate` → `computeDedupeHash(sourceUrl, cleanTitle)` → quality verdict → status，新 crawler 必须遵守这一前后顺序。**P2002 backfill collapse 算法**：P2002 时 findFirst 查冲突方比 `publishedAt`，删较新者并 retry 当前 update；不可在 backfill 期间并发写入（单 writer 假设）。**一次性 prod 脚本契约**（post-mortem，详见 §10 决策 11）：脚本放 `packages/db/scripts/`、用包名 import（`'@ai-hot-news/db'` / `'@ai-hot-news/utils'`）、worker Dockerfile `COPY packages/db/scripts`、运维通过 `bash scripts/run-prod-oneshot.sh packages/db scripts/<script>.ts` 调用；后续 SP-7 pgvector backfill / SP-19 KeywordTimeSeries 聚合等所有一次性脚本必须遵守。|
| **SP-4.6** | 2026-05-05 | `5af5ffe..05fb692`（6 commits）·spec: `2026-05-04-sp4-6-rss-sources-expansion-design.md` ·plan: `2026-05-04-sp4-6-rss-sources-expansion-plan.md` | seed 加 4 个新 RSS 源（Anthropic GitHub raw mirror + Cursor Blog + Claude Blog + Claude Code Changelog）·  `normalizeUrl` 加 `code.claude.com/docs/en/changelog` 精确路径白名单保留 Mintlify changelog `#X.Y.Z` 锚点（其它 host 仍剥 fragment）· seed.ts dual-mode（apply 主路径）+ `sp4.6-add-rss-sources.sql` 幂等 SQL fallback · 7 RSS 源全部 `crawlInterval=86400`（24h）· prod 数据点：default RSS total 9 → 27（4 个新源全部抓到，含 5 条 Mintlify changelog `#X.Y.Z` 各自唯一）| **`normalizeUrl` 精确路径白名单契约**：保留 fragment 是该函数的破例行为，未来如有同款"fragment 是唯一 ID"协议需求（如某 changelog 站点）请加白名单条目 `(host, exact_path)` 而不是松动 host-level 规则。**RSS 源管理 = pure DB 操作**：seed 改动是 idempotent upsert，prod deploy 通过 `prisma db seed` 自动 apply；如果未来想动态加/减 RSS 源（例如关键词搜索源、用户订阅源），路径已铺好。|
| **SP-4.7** | 2026-05-05 | PR #1-#4（squash `d3a52183 / a06ee87c / 9317d4a4 / 52cf4e3`）·spec: `2026-05-05-sp4-7-article-extractor-design.md` ·plan: `2026-05-05-sp4-7-article-extractor-plan.md` | `apps/worker/src/extract/` 完整模块（`extract.module.ts` / `extract.queue.ts` / `extract.service.ts` / `extract.processor.ts` + chain / firecrawl / jina providers）· `HotNews` 加 `extractStatus String?` + `extractAttempts Int @default(0)` 列（migration `20260505072156_sp4_7_extract_status` + 部分索引 `hot_news_extract_pending_idx`）· `IngestionService` 在 ingest 阶段对 link-post 哨兵（HN/Reddit `interactionData.externalUrl` 存在且 `content==title`）触发 `extract:<id>` 入队 · `extractStatus=EXTRACTED` 后 `summary=NULL` 重入 `summary:<id>` 队列触发 SP-5 重摘 · `apps/worker/src/redis/redis.module.ts` 抽出 `RedisModule` 共享 `REDIS_CONNECTION` token（PR #2 修 SummarizeModule / ExtractModule queue providers UnknownDependenciesException 同款 bug）· `docker/docker-compose.prod.yml` worker.environment 显式透传 `FIRECRAWL_API_KEY / JINA_API_KEY / EXTRACT_CONCURRENCY`（PR #3 修：compose 只透传显式声明的变量）· `wipe-hot-news-pre-ai.ts` 一次性脚本（"AI 阶段开机"操作） | **PR-driven workflow 起点**：SP-4.7 是首个 ship via 4 个 PR 而非 main 直推的 SP，hot-fix 路径（PR #2 / #3）成为后续 SP 的标准模板。**`RedisModule` 契约**：任何 inject `REDIS_CONNECTION` 的新 module 必须 `imports: [RedisModule]`，否则 unit test (`apps/worker/src/redis/redis.module.spec.ts`) 阶段就红 — SP-5 / SP-6 / SP-7 等所有用 BullMQ 的新 module 必须遵守。**`docker-compose.prod.yml` env 透传契约**：worker.environment 段必须显式 `FOO: ${FOO}` 才会注入到容器；只在 `.env` 写不够。后续任何新增 worker 端 env var 都必须**同步**改 compose（不要省略）。**ingest → extract → summary 三段触发链**：SP-5 v3.4 仍依赖该链路 — link-post 第一次摘要可能基于 `content==title` 出 degraded 摘要，SP-4.7 跑完后 `summary=NULL` 重入队让 SP-5 再跑一次。**一次性脚本契约**（继续 SP-4 §10 决策 11）：`packages/db/scripts/` + 包名 import + `bash scripts/run-prod-oneshot.sh` 调用。 |
| **SP-5** | 2026-05-07 | PR #5-#7（squash `00d1273 / 93f59ce / 54de248`）·spec: `2026-05-05-sp5-ai-summary-tags-design.md` + `2026-05-05-sp5-ai-topic-filtering-design.md` (v3.2) ·plan: `2026-05-05-sp5-ai-summary-tags-plan.md` + `2026-05-06-sp5-ai-topic-filtering-v3-2-plan.md` | `packages/prompts/` 新 workspace 包（taxonomy 受控词表 + buildSystemPrompt / buildUserPrompt / parseSummarizeResponse + esbuild bundle 同 utils pattern + `keywords.md` 自动 copy + `matchesAiTopic`）· `apps/worker/src/summarize/` 完整模块（`summarize.module.ts` / `summarize.queue.ts` / `summarize.processor.ts` / `summarize.service.ts` / `llm-client.ts` + `strategies/{strategy.interface,summarize-all-visible}.ts`）· Vercel AI SDK + `@ai-sdk/openai` (OpenRouter compat) + `SUMMARY_CONCURRENCY=3` BullMQ Worker · `IngestionService` ingest 阶段 L0-skip（status=VISIBLE → push `summary:<id>`；非 AI / 低质量 → `result.skipped++` 不入库，**HIDDEN 通道彻底废弃**）· HN quality 阈值 score 5→**20**, descendants 2→**5** · Reddit 8 个 sub → 1 个 13-sub bundle (`r/ChatGPT+OpenAI+singularity+ArtificialInteligence+artificial+ClaudeAI+PromptEngineering+AI_Agents+vibecoding+LLMDevs+cursor+agi+LangChain/hot.json`) + 9 单 sub 各保留 60min · `consolidate-sp5-sources.ts` + `wipe-hot-news-pre-sp5.ts` 一次性脚本 · `HotNewsListItemDto` 加 `summary / aiTags` 字段 · `/news` 渲染 summary · `.env.example` + `docker-compose.prod.yml` 加 `OPENROUTER_API_KEY / SUMMARY_MODEL / LLM_BASE_URL / SUMMARY_CONCURRENCY` 透传 | **API 契约扩展**：`HotNewsListItemDto.summary: string \| null` + `aiTags: string[]`（prefix-encoded `company:X / model:Y / category:Z / tech:W`）。null 表示 worker 还没处理 / boot backstop 会 catch up。**HIDDEN 通道废弃**：v3.2 起 ingest 不再写 `status='HIDDEN'`，所有不达标的 → `result.skipped++` 不入库。SP-7 跨平台合并若想用历史 HIDDEN 信号需另起方案。**L0 主题过滤约定**：`keywords.md`（仓库根，开发者维护）→ `packages/prompts` 在 build 阶段 copy 进 bundle → ingest 阶段 `matchesAiTopic(title + content)` 判断；新增/调整关键词只需改 `keywords.md` + 重新 build prompts。**Boot backstop 契约**：`OnApplicationBootstrap` 扫 `summary IS NULL` 重入摘要队列 — 任何 prompt 版本 bump / 一次性 `UPDATE summary=NULL` 都依赖此机制 catch up。**插拔策略接口**（PRD §6 契约）：`SummarizationStrategy.shouldSummarize()` 返 `'allow' \| 'skip:<reason>'`；V1 仅实现 `SummarizeAllVisibleStrategy`，未来按热度阈值 / 平台白名单 / group-once 等限流策略可加新实现而不动 service 层。**LLM provider 抽象**：通过 Vercel AI SDK，`SUMMARY_MODEL` / `LLM_BASE_URL` env var 切换 provider 零代码改动（OpenRouter / OpenAI / Anthropic / 本地 ollama 都能跑）。 |
| **SP-5-v3.3** | 2026-05-07 | `0e1904b / c64fe93`（commit `0e1904b` v3.3 主体 + `c64fe93` boot backstop fix） | `HotNews.titleZh String?` 列（migration `20260507135326_sp5_title_zh`）+ LLM prompt v2 同时输出 `titleZh`（10-30 字、保留专有名词、原文中文则复用）· parser 加 titleZh 字段 + 100 字硬上限 + null 兜底 · summary v2 改恰好 2 行 / 25-45 字一句 / `\n` 分隔 + `normalizeToTwoLines` LLM drift 兜底 · Web 用 `titleZh ?? title` 主显示 + 原 title 写入 `<a title>` tooltip + `whitespace-pre-line` + `line-clamp-2` · Reddit quality 阈值再升级（ratio 0.5→0.7 / score 5→10 / comments 2→5；拦截标题党 `score=0,comments=151,ratio=0.50` + 伸手党 `score=1,comments=2,ratio=1.00` 两种典型）· `cleanup-reddit-quality-v3-3.ts` 一次性脚本（按新阈值删现有 Reddit 行，prod 实测 33/110 删除 = 30%）· `SummarizeModule.onApplicationBootstrap` 加 `queue.clean(0, 0, 'failed')` 前置（c64fe93）—— 修 BullMQ jobId dedupe stuck bug：failed 集合 100 个 stale jobId hash 会让 boot backstop 的 `queue.add(jobId)` silently no-op | **SP-5 schema 扩展**：`HotNews.titleZh` 是 v3.3 起永久字段，所有 LLM 调用都会填。**spec §0.1 contract still holds**：原 `title` 不动，`titleZh` 是独立的"展示用中文标题"。**前端兜底链**：`titleZh ?? title` —— null 时 fallback 原标题，避免空白卡片。**Reddit quality 阈值新基线**：`packages/utils/src/quality.ts` 三常量 0.7 / 10 / 5 是后续所有 Reddit 数据源 SP（多语言 sub / 关键词搜索 sub 等）的默认起点；如果新 sub 信号噪声分布显著不同应通过 SourceConfig.metadata 注入 per-sub override 而不是改全局常量。**BullMQ jobId dedupe 教训**（写进 `apps/worker/src/summarize/summarize.module.ts` 注释 + `summarize.module.spec.ts` 回归 case）：`queue.add(name, data, { jobId })` 当 jobId 在 wait/active/completed/failed **任何**集合存在时被视为 dup，silently no-op。任何"mass UPDATE summary=NULL 重摘"运维操作都依赖 boot backstop 的 `queue.clean(0, 0, 'failed')` 前置；后续 SP-7 embedding backfill 等触发重摘的 SP 必须意识到这一点（**已知未修隐患**：`completed` 集合也会撞 dedupe，但因为 `removeOnComplete: count=100` + 单进程 worker 自然消化 + jobId 形式 `summarize-<rowId>` 是按行唯一的，正常 ingest 路径不会撞；只有手工 wipe 重摘才会，需要时手工 redis-cli 清 completed） |
| **SP-5-v3.4** | 2026-05-07 | `042289c` | summary prompt rewrite from "exactly 2 lines, 25-45 chars each, joined by \n, total 60-90 字" → "single coherent paragraph, 50-80 字, no forced newline; LLM may use ONE \n only when there are genuinely two independent dimensions" · 增加套话 / 营销腔黑名单（"文章探讨了 / 该 X / 此举旨在 / 重磅 / 一文看懂" 等）· 加 2 个对照 ✗/✓ 示例锚定语感 · `SUMMARIZE_PROMPT_VERSION` 2→3 · `normalizeToTwoLines` 保留作 LLM drift 兜底（实际几乎不触发） | **Prompt 风格契约**：v3.4 起的所有 SP-5 摘要都是单段中立新闻派（"腾讯 AI 速递 / 少数派 Matrix" 风格），不再是"事实 + 解读"双行卡片。SP-11 详情页 4 维分析 / SP-21 AI 日报等下游 SP 如果想要更结构化的输出，应当用**新的 prompt** 而非复用 SP-5 的 summary（SP-5 summary 已经回归"卡片列表用的精炼 brief"定位）。**`whitespace-pre-line` 兼容性**：UI 仍保留该 CSS，覆盖 LLM 偶发输出 1 个 \n 的 dual-dimension case；删除该 CSS 不破坏 v3.4 主流场景但会让 dual-dimension case 文本挤成一行。 |

### SP-3 端到端 smoke 凭据（2026-05-04）

- **DB 实测**：本地 backfill 后 `hot_news` 共 1927 行（RSS=1129、HACKERNEWS=610、REDDIT=188），`sourcePlatform` 列分布正确，`interactionData` JSON 列 188/188 = 100% 填充率（HN 610/610 同样 100%、RSS 0/1129 = 0%，符合各平台契约）。样本：`{score: 219, comments: 51, redditId: "1t1p098", externalUrl: "https://i.redd.it/...", redditSubreddit: "ClaudeAI", redditUpvoteRatio: 0.96}`，与 SP-3 spec §4 约定完全一致。
- **公开 `.json` 端点 reachability 实测**：直接 `curl -A "ai-hot-news-bot/0.1 (by /u/anonymous)" 'https://www.reddit.com/r/OpenAI/hot.json?limit=5&raw_json=1'` 返回 HTTP 200 + 标准 `Listing` payload，包含 `id / title / score / num_comments` 全字段；本机 IP 未触发 429。
- **8 个 sub 全部 backfill**：worker 启动 ~3 分钟内 8 个 `crawl-boot-cmopz800*` 任务全部 `completed`（BullMQ events stream 验证），`/news` 渲染 36 个 `bg-red-50 text-red-700` Reddit 徽章覆盖全部 8 个 subreddit（含 r/LocalLLaMA / r/MachineLearning / r/artificial / r/OpenAI / r/ChatGPT / r/singularity / r/StableDiffusion / r/ClaudeAI）。
- **Idempotency 实测**：`pnpm db:seed` 二次跑 8 个 Reddit candidates 全走 UPDATE 路径（非 INSERT），`source_configs` REDDIT 行数恒等于 8；`IngestionService` REDDIT 路径的 first-write-wins 行为由集成测试 `does NOT overwrite interactionData on duplicate sourceUrl` 自动验证（commit `5f9bde7`）。
- **测试矩阵**：worker 45/45 + api 3/3 + 其他全绿；含新增 13/13 `RedditCrawler` 单元测试 + 3/3 `IngestionService` REDDIT 集成测试 + 4/4 `CrawlerFactory` + 4/4 `CrawlScheduler`。`pnpm turbo run lint typecheck` 16/16 cached/clean，`pnpm turbo run build` 7/7 通过。

### SP-4 端到端 smoke 凭据（2026-05-04）

- **本地 backfill 实测**：`pnpm db:migrate-sp4` 在本地 1129 行（全 RSS）DB 上输出
  ```json
  { "layer1NormalizeUpdated": 0, "layer1Collapsed": 0, "layer1HashUpdated": 0, "layer2Hidden": {} }
  ```
  全零是预期：本地 dev 库自 SP-3 起从未跑过 reddit/HN crawl（HN 610 / Reddit 188 是 prod-only 数据），且本地 RSS 都是已 canonical `https://...` 形态、无 boilerplate 后缀、标题 ≥5 字符。Layer 2 只对 VISIBLE 行跑且需平台 metadata 触发，本地无素材；真实非零 stats 留待 VPS prod 1927 行验证。
- **VPS prod backfill 实测**（2026-05-04 18:35 UTC+8，commit `45afb09` 部署 ~14 min 后）：worker stop → 在 prod 一次性 worker 容器内（mount host `packages/db/scripts/migrate-sp4.ts`）跑 backfill → worker start。`pageSize=50` 上限是 SP-1 时定的 DTO 限制；script 输出：
  ```json
  {
    "layer1NormalizeUpdated": 0,
    "layer1Collapsed": 0,
    "layer1HashUpdated": 0,
    "layer2Hidden": {
      "hn_low_engagement": 150,
      "reddit_low_engagement": 81,
      "title_too_short": 1,
      "reddit_low_ratio": 12
    }
  }
  ```
  Layer 1 全 0 说明 SP-3 时定下的"crawler 输出与 `normalizeUrl` canonical form 对齐"契约确实在生效——历史所有 URL 都已规范，Layer 1 是空操作；这一信号反过来证明 SP-3 spec §11 "Onboarding 标准流程"对 url canonical 的要求没被任何 crawler 违反。Layer 2 命中 244 行（10.8%），分布与各平台特征一致：HN low_engagement 150 远超 Reddit（HN 信号噪声更高，新提交多沉底）；Reddit low_ratio 12 行很少（Reddit 1.0 默认 ratio 较稳定）。`title_too_short` 仅 1 行说明白名单 boilerplate 剥离没误伤合法标题。
- **DB 不变量实测**（backfill 后立即查询）：
  ```
  total                  = 2268
  VISIBLE                = 2022
  HIDDEN                 = 246  (= 244 backfill + 2 baseline 已实时打)
  visible_with_reason    = 0    ✅ 不变量 1
  hidden_without_reason  = 0    ✅ 不变量 2
  filterReason 分布：
    hn_low_engagement    = 150
    reddit_low_engagement= 83  (= 81 backfill + 2 baseline)
    reddit_low_ratio     = 12
    title_too_short      = 1
  ```
  Total = VISIBLE + HIDDEN（无数据丢失）。两条契约不变量在真实 prod 数据上首次验证全绿——SP-4 review M3 关注的"HIDDEN 存在时不变量是否仍成立"得到证据。
- **DB 一致性不变量实测**（本地）：`SELECT COUNT(*) FROM hot_news WHERE status='VISIBLE' AND "filterReason" IS NOT NULL` = **0**；`SELECT COUNT(*) FROM hot_news WHERE status='HIDDEN' AND "filterReason" IS NULL` = **0**。两条契约不变量在 backfill 后均成立。`HOT_NEWS` 列分布：1129 VISIBLE / 0 HIDDEN（本地仅 RSS、无低质量素材）。
- **测试矩阵**：utils 67/67（dedupe + strip-html + url 17 + boilerplate 19 + quality 18，含 4 边界测试 + 1 P2002 方向回归）+ worker 全包 PASS（含 `IngestionService` integration 13/13 + `RedditCrawler` 16/16 + `HackerNewsCrawler` 14/14 + `CrawlerFactory` + `CrawlScheduler`）+ api 6/6（含新 `HotNewsService.spec.ts` 3/3）+ db scripts 6/6（migrate-sp4 integration 含 `OLDER wins` 回归）。`pnpm turbo run test --concurrency=1` 9/9 task 全绿；`pnpm turbo run lint typecheck` 16/16 cached/clean。
- **Idempotency 实测**：`pnpm db:migrate-sp4` 二次跑输出全 0；`pnpm db:seed` 二次跑 SourceConfig 行数恒等于 14（不动）。
- **Review 循环价值证据**：Task 12 backfill 脚本 code-review 抓到一个 **CRITICAL P2002 方向 bug**——「冲突时删当前迭代行」会在「老行 `http://`、新行已 canonical `https://`」组合下误删较早行。修法是按 `publishedAt` 决策 + `deletedRowIds: Set` 跳过预删 id，并加 `Layer 1: when older row is legacy and newer row is already canonical, OLDER wins` 回归测试。**若直接上 VPS 跑 backfill 会丢历史最早期数据，影响 SP-7 早期热度信号——keystone task 必须 review 的直接证据**。
- **VPS API smoke**（2026-05-04 18:36 UTC+8，worker 重启后）：`curl 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=50' | jq '.total'` = **2025**；同时 `SELECT COUNT(*) FROM hot_news` = **2275**（VISIBLE=2025、HIDDEN=250）。**API total = DB VISIBLE 完全对齐**，差值 250 行 HIDDEN 不对外暴露 → SP-4 §6 `HotNewsService.list()` 默认 `WHERE status='VISIBLE'` 契约在端到端验证。worker 在 backfill 后 1 分钟内 ingest 7 行新数据（2275-2268），其中 4 行被实时打 HIDDEN（250-246）、3 行 VISIBLE，说明 ingest-time quality filter 在 prod **实时生效**——`RedditCrawler` / `HackerNewsCrawler` 的 `toRaw()` 写入 `filterReason` + IngestionService 兜底 + status 写入流水线一气呵成。

### SP-4.5 端到端 smoke 凭据（2026-05-04）

- **本地测试矩阵**（commit `c962c65` push 前的 `pnpm turbo run lint/typecheck/test`）：
  - lint：10/10 cached/clean。
  - typecheck：10/10 cached/clean。
  - test：9/9 任务全绿，含 `@ai-hot-news/worker` 59/59（含 4 个 SP-4.5 RSS 窗口用例）+ `@ai-hot-news/api` 18/18（含 4 个 SP-4.5 service 平台窗口用例 + 1 空数组回归 + 2 controller passthrough 用例）+ `@ai-hot-news/db` 9/9（含 3 cleanup-rss-pre-window 集成用例 + 6 migrate-sp4 回归）。
  - 一处 robustness fix（commit `c962c65`）：把 cleanup-rss-pre-window 用例 #1 的 `expect(stats.deleted).toBe(1)` 放宽到 `>= 1`，避免污染 dev DB 时假阳。和 Task 2 review 里早就标记的脆弱点同款，`>= 1` + prefix-scoped remaining 行断言够强。
- **Prod baseline（部署/cleanup 前，2026-05-04 22:13 UTC+8）**：
  ```
  RSS         | VISIBLE |  1129
  HACKERNEWS  | VISIBLE |   640
  HACKERNEWS  | HIDDEN  |   161
  REDDIT      | VISIBLE |   290
  REDDIT      | HIDDEN  |   130
  total = 2350
  RSS publishedAt 范围: 2015-12-11 → 2026-05-01 (max 已落后当下 ≥3d)
  RSS crawlInterval (DB): 全 1800s
  ```
- **Prod cleanup 实测**（2026-05-04 22:32 UTC+8，commit `c962c65` 部署完成 + worker stop 后，`scripts/run-prod-oneshot.sh` 因 worker 已 stop 拿不到 image tag → 走 inline `IMAGE_TAG="sha-c962c65..." docker compose run` 等价路径）：
  ```json
  {
    "cutoff": "2026-04-27T14:33:41.810Z",
    "toDelete": 1120,
    "deleted": 1120,
    "remainingRss": 9
  }
  ```
  1120 行（baseline 1129 + 部署期间 worker 又 ingest 了 1 行 pre-window）一次性 DELETE，仅留 9 行 ≥7d 内的 RSS。
- **Prod SQL 实测**：`UPDATE source_configs SET "crawlInterval"=86400 WHERE platform='RSS' AND "crawlInterval"<>86400` 输出 `UPDATE 4`，覆盖 4 个 RSS 源（OpenAI / Google Research / Google DeepMind / Anthropic-disabled），二次跑期可观察 idempotent。
- **DB 不变量实测**（worker restart 后 ~30s）：
  ```
  RSS         | VISIBLE |    9     ← 1129 - 1120 ✅
  HACKERNEWS  | VISIBLE |  640     ← 不变 ✅
  HACKERNEWS  | HIDDEN  |  164     ← 161 + 3（worker restart 后实时 ingest 增量，SP-4 quality filter 持续生效）
  REDDIT      | VISIBLE |  294     ← 290 + 4
  REDDIT      | HIDDEN  |  136     ← 130 + 6
  RSS publishedAt 范围: 2026-04-28 → 2026-05-01 (全部 < 7d ✅)
  ```
  HN/Reddit 全部存活（哪怕 HIDDEN 也没动），cleanup 脚本「RSS-only」契约在真 prod 数据上验证；新 ingest 行的 SP-4 HIDDEN/VISIBLE 比例（13:7）与 SP-4 smoke 时的整体比例同序，说明 SP-4.5 没回归 SP-4 行为。
- **VPS API smoke**（默认 vs RSS vs HACKERNEWS）：
  ```
  /api/hot-news?pageSize=50              total=399  items: HN+REDDIT, 全 < 48h ✅
  /api/hot-news?platforms=RSS&pageSize=50 total=9   items: 全 RSS, 全 ≤ 7d ✅
  /api/hot-news?platforms=HACKERNEWS      total=140 items: 全 HACKERNEWS ✅
  ```
  - **默认 = HN+REDDIT 48h** 由 `DEFAULT_PLATFORMS=['HACKERNEWS','REDDIT']` 兜底，total 399 比 SP-4 smoke 的 2025 少了 ~80% 是预期（窗口从全历史→48h）。
  - **`?platforms=RSS` 命中所有 9 行**（DB VISIBLE RSS = 9，API total = 9，完全对齐），证明 7d 窗口 + status=VISIBLE 同时生效且无任何 HIDDEN 漏出。
  - **单平台过滤** API total=140，`unique platforms = {'HACKERNEWS'}`，证明 platforms 参数 `IsIn` 校验 + service `OR` 子句精确路由。
- **Worker scheduler 实测**：worker startup 日志显示 `[CrawlScheduler] Registered 14 enabled sources: 3 HACKERNEWS, 8 REDDIT, 3 RSS`（Anthropic disabled 不进队列），紧随 `Old queue 'rss-crawl' obliterated` + Liveness writer started。3 个 RSS 源以 86400s（24h）注册到 BullMQ repeat job，DB-driven 配置生效。
- **deploy.yml 自动 smoke**：CI 25324681962 → Deploy SSH 部署 + `/api/health` + `/api/hot-news?pageSize=1` 双绿后再做的本次 SP-4.5 后端操作，整链路无 step 失败。
- **后续观察项**（不阻塞 SP-4.5 完成，留给运营/后续 SP）：
  - RSS 24h 调度间隔下，OpenAI/Anthropic 等若发新博客最坏延迟 ≤24h。如果 dashboard 反馈"上线慢"，把 `crawlInterval` 临时 6h（21600）即可，零代码改动。
  - 9 行 RSS visible 数据较少，下一波 OpenAI/Anthropic 发新博客后会自然增长；当前 `权威媒体` tab 内容稀疏属正常。

### SP-4.6 端到端 smoke 凭据（2026-05-05）

- **本地测试矩阵**（commit `05fb692` push 前）：
  - `pnpm --filter @ai-hot-news/utils test -- url.spec`：**20/20 全绿**（含 SP-4.6 4 个新 case）。
  - `pnpm turbo run lint typecheck test`：**21/21 任务全绿**，所有 8 个测试文件 / 59 个 worker 测试 / 全部 api / db / utils 单测 PASS。Worker integration `inserts new items and dedupes repeated ingests` 等用例的 P2002 报错是**故意**触发的去重断言，非回归。
  - `pnpm --filter @ai-hot-news/web build`：编译 + 5 静态页面生成全绿，无 typedRoutes 回归。
  - 本地 SP-4.6 SQL fallback 在已 seed 的 dev DB 上 idempotent dry-run：`UPDATE 1 / DELETE 0 / INSERT 0 × 3` ——seed.ts 主路径与 SQL fallback 路径目标状态完全等价。
- **Prod baseline（部署前，2026-05-05 02:36 UTC+8）**：
  ```
  /api/hot-news?platforms=RSS&pageSize=50  total=9
    hosts: openai.com=6, research.google=2, deepmind.google=1
  ```
  无 cursor.com / claude.com / www.anthropic.com / code.claude.com 任何源——SP-4.6 前 Anthropic disabled、其他 3 个新源压根不存在。
- **Auto-deploy 链路触发**：`git push origin main` (`05fb692`) → GitHub Actions CI → Deploy SSH → `scripts/deploy.sh "sha-05fb692..."` 自动跑：(a) `prisma migrate deploy` (no-op，schema 未改) → (b) `prisma db seed`（按 SP-4.6 改动后的 `seedRss()` apply 7 行 RSS） → (c) `docker compose up -d` → (d) `restart worker`（让 BullMQ 重新注册 enabled 源）。`/api/health` + `/api/hot-news?pageSize=1` 部署内置 smoke 双绿。
- **Post-deploy state（2026-05-05 02:43 UTC+8，deploy 完成后约 3 分钟首轮抓取后）**：
  ```
  /api/hot-news?platforms=RSS&pageSize=50  total=27   (+18 vs baseline)
    hosts: claude.com=9, openai.com=6, code.claude.com=5, cursor.com=2,
           research.google=2, www.anthropic.com=2, deepmind.google=1
  ```
  7 个 distinct host 全部出现（4 个老源 + 4 个新源 — Anthropic 通过新 mirror 重新激活）。`/api/health` 返回 `uptime: 74.13s`，证明 worker 在 deploy 期间确实被 restart 过。
- **关键不变量验证 — Mintlify changelog fragment 保留 hack**：
  ```json
  /api/hot-news?platforms=RSS&pageSize=50, items where sourceUrl LIKE 'https://code.claude.com%':
  [
    { sourceUrl: "https://code.claude.com/docs/en/changelog#2-1-126", title: "2.1.126", publishedAt: "2026-05-01" },
    { sourceUrl: "https://code.claude.com/docs/en/changelog#2-1-123", title: "2.1.123", publishedAt: "2026-04-29" },
    { sourceUrl: "https://code.claude.com/docs/en/changelog#2-1-122", title: "2.1.122", publishedAt: "2026-04-28" },
    { sourceUrl: "https://code.claude.com/docs/en/changelog#2-1-120", title: "2.1.120", publishedAt: "2026-04-28" },
    { sourceUrl: "https://code.claude.com/docs/en/changelog#2-1-121", title: "2.1.121", publishedAt: "2026-04-28" }
  ]
  ```
  **5 条 changelog item 各自带不同 `#X.Y.Z` anchor，全部通过 `HotNews.sourceUrl @unique` 约束** → SP-4.6 normalizeUrl 精确路径白名单（`(code.claude.com, /docs/en/changelog)`）在 prod **完美工作**。如果 hack 失效，5 条会全部撞同一个剥 fragment 后的 `https://code.claude.com/docs/en/changelog`，最多入 1 条。这是 SP-4.6 唯一的"破例"性质改动，prod 数据是它生效的最强证据。
- **SP-4.5 7d 入库窗口持续生效**：Cursor feed 上游有 19 条 item（追溯到 2026-02-13），但只入了 **2 条**（4-30 / 4-29）；Anthropic mirror 上游历史更长，只入了 **2 条**；Claude blog 因 7d 窗口内发文密度高入了 9 条；Mintlify changelog 上游有几十个版本，只入了 7d 内的 5 条。**SP-4.6 数据源扩展不会污染历史 — SP-4.5 cutoff 是天然防御层**。
- **不变量回顾（与 spec §7 一致）**：
  - `HotNews.sourceUrl @unique` 仍然 unique（5 条 changelog 各 row id 不同、sourceUrl 不同 → unique 约束 OK）
  - `dedupeHash` 算法零变化（`computeDedupeHash` 函数体未触）
  - SP-4.5 `RSS_INGEST_WINDOW_MS = 7d` / `PLATFORM_WINDOW_HOURS` / `/api/hot-news?platforms=` 行为零变化
  - 其他 RSS 源（OpenAI / Google Research / Google DeepMind）prod 数据点数与 baseline 一致（6 / 2 / 1），未受影响
  - `normalizeUrl` 在 `code.claude.com/docs/en/changelog` 之外的所有 URL 上行为零变化（其余 6 个 RSS 源、HN、Reddit 全部 sourceUrl 不带 fragment）
- **后续观察项**：
  - Cursor 第 3 篇文章（4-23 NAB）publishedAt 在 7d 窗口外约 2 天，下次 OpenAI/Cursor 发新博客（≤24h 拉取一次）后会上桶。无需干预。
  - Claude Code Changelog 是发布频率最高的源（约 2-3 天一版本）；7d 窗口下稳态约 2-4 条 item。
  - 如未来 Anthropic 修复官方 RSS（`https://www.anthropic.com/news/rss`），可考虑切回官方源，第三方 mirror 仅作 fallback。

### SP-2 端到端 smoke 凭据（2026-05-03）

- **DB 实测**：clean baseline → boot backfill 后 `hot_news` 共 1734 行（RSS=1129、HACKERNEWS=605），`sourcePlatform` 列分布正确，`interactionData` JSON 列内容形如 `{hnId:47952185, score:2, comments:0, externalUrl:"https://github.com/..."}`，与 spec §4.2 完全一致。
- **Idempotency 实测**：第二次重启 worker 后 backfill counts 完全不变（依赖 SP-1 的 `unique(sourceUrl)` + IngestionService P2002 try/catch 抑制；交互数据不被覆盖）。
- **UI 实测**：`/news` p1 渲染 20 个橙色 `HN` 徽章（class `bg-orange-50 text-orange-700`）、p50 渲染 20 个蓝色 `RSS` 徽章（class `bg-blue-50 text-blue-700`），SSR HTML 直接验证通过。
- **测试矩阵**：52/52 自动化测试绿（含 6/6 PostgreSQL integration test 验证 HN interactionData 透传 + 重复 sourceUrl 不覆盖语义）；worker/types/utils typecheck + lint 全清。
- **SP-2 收尾 session 修复的 dev/deploy 遗留**（commits `c66673d` / `cfea0b4` / `d6d6a69`）：
  - **Auto-deploy seed**：`scripts/deploy.sh` 现在在 `prisma migrate deploy` 之后**自动**跑一次 `prisma db seed` 并 restart worker。SP-2 首次 deploy `cdc78cd` 时因为没有这一步，prod 一度只有 RSS=1129 行没有 HN — 修复后 `cfea0b4` 触发的 deploy 立即把 prod 拉到 RSS+HN 混合 1734 行。详见下方 "Onboarding 新平台 SP 的标准流程"。
  - **`pnpm dev` race condition**：根因不是 nest watch，是 `apps/{api,worker}/nest-cli.json` 的 `deleteOutDir: true` 让 `nest start --watch --tsc` 启动时清空 dist 目录，导致 node 立即 require 失败。改为 `false` + `dev` script 改成 `tsc + nest start --watch` 形态后 cold start 干净。
  - **`engines.node` 收紧**：从 `>=22.0.0` 收紧到 `>=22.0.0 <23.0.0`，避免 Node 25 等更新主版本误用。`.npmrc` 加 `engine-strict=true` 让本机 install 直接 fail-fast。
  - **Next.js 15.5 `<Html>` /500 build error**：vercel/next.js#83784 的上游 bug，**只影响本机 Node 25 + standalone build**，CI 在 Node 22 上一直 green、docker prod 镜像构建一直 green。已加 `app/not-found.tsx` + `app/global-error.tsx` 作为社区推荐 workaround，等上游修复后可清理。

### Onboarding 新平台 SP 的标准流程（auto-deploy seed 约定，2026-05-03 起生效）

SP-2 收尾时把 `prisma db seed` 嵌进 `scripts/deploy.sh`，**新增数据源平台从此变成纯代码改动**，零手工 ssh。SP-3（Reddit）/ SP-22（Twitter） 等后续平台 SP 的接入流程：

1. **`packages/db/prisma/seed.ts`**：追加新平台的 `<Platform>Candidate` 类型 + candidates 数组 + `seed<Platform>()` 函数，跟 `seedHn()` 对齐（findFirst-then-update-or-create on (platform, identifier)；如果新平台天然有 url 唯一键也可走 `upsert(platform_url)` 像 RSS 那样）。在 `main()` 里加 `await seed<Platform>()` 调用。
2. **`apps/worker/src/crawl/crawler.factory.ts`**：在 switch 里加一个 `case Platform.<NEW>: return new <New>Crawler(...)` 分支（O(1) 改动）。
3. **`apps/worker/src/crawl/crawl.scheduler.ts`**：把 `Platform.<NEW>` 加到 `findMany.where.platform.in [...]` 数组（1 行）。
4. **`apps/web/app/news/_components/news-item.tsx`**：在 `PLATFORM_LABEL` + `PLATFORM_BADGE_CLASS` map 里加新平台的展示 label + tailwind class（已经 SP-2 时把 RSS/HN/REDDIT/TWITTER 4 个 badge 全占好位）。
5. **数据库 schema**：通常**不需要改** — `interactionData` 是 JSONB 字段，按 spec §4.2 字段命名约定（`<platform>Id` / `<platform><Field>`）填进去即可。Prisma `Platform` enum 已在 SP-0 schema 里包含 `RSS / HACKERNEWS / REDDIT / TWITTER`。

push 到 main 后 GitHub Actions 自动跑 CI → Build images → Deploy（含 `prisma db seed` + `restart worker`），新平台数据约 3-5 分钟后开始流入 prod。无需手工 ssh、无需手工 seed、无需手工 restart。

### 推进路线提示（更新于 SP-4.6 部署完成）

SP-4.6 已落地：commit `5af5ffe..05fb692` 6 个 commit（2 docs + 1 feat-utils + 1 feat-db + 1 chore-sql + 1 docs-status）全部 push 到 main、CI/Deploy 全绿、prod 4 个新源全部抓到（含 Mintlify changelog fragment 保留 hack 验证 5 条不同 `#X.Y.Z` 入库）、`/api/hot-news?platforms=RSS` total 9 → 27。Tasks 1-6 全部 ✅。

SP-4.6 把"SP-4.6"编号占用，原计划占用此编号的 ArticleExtractor 子项目改在 **SP-4.7** 或 **SP-5 前置**规划。下一步可选路径：

1. **SP-5（AI 摘要 + aiTags）**：SP-4 brainstorming 时把"维度 3 主题相关性过滤"明确推到了 SP-5（LLM 打 `aiTags` 后 UI 按 tag 过滤）。SP-5 落地后 `/news` 列表才会真正"只剩想看的"——非 AI 主题内容（甚至 RSS 7d 窗口内的非主题文章）会自然过滤掉。
2. **SP-4.7（原 SP-4.6 ArticleExtractor）**：✅ COMPLETED 2026-05-05（详见下方专门小节）。HN/Reddit link-post 外链正文抓取已上线，prod 当前 EXTRACTED 占有效 link-post 比例 ~99%，FAILED < 1%。
3. **SP-7（pgvector 跨平台合并）**：依赖 SP-5 `aiTags` + embedding 双信号。SP-5 完工后可直接推。
4. **Web 测试基础设施 SP（YAGNI / 待触发）**：`apps/web` 至今无 vitest infra；SP-4.5 Task 7 的 fetchHotNewsList 改动只能跑 typecheck 兜底。如果 web 层后续 logic 分支变多（SP-5 摘要展示、SP-7 cluster 视图等），单独开 SP 装 vitest+jsdom+RTL 比较合适，目前先 YAGNI。

建议下一步：在 **SP-5 vs SP-4.7** 之间二选一进 brainstorming（或先二者并行 brainstorming 看哪个更快收敛）。

### 推进路线提示（更新于 SP-4.7 部署完成）

SP-4.7 ArticleExtractor 已落地：

- spec: `docs/superpowers/specs/2026-05-05-sp4-7-article-extractor-design.md`
- plan: `docs/superpowers/plans/2026-05-05-sp4-7-article-extractor-plan.md`
- main 落地 PR: [#1 feat(sp4.7): ArticleExtractor — Firecrawl + Jina chain](https://github.com/Ceylonlatte/ai-hot-news/pull/1) (squash `d3a52183`)
- 部署热修 PR1：[#2 fix(sp4.7): hoist REDIS_CONNECTION into shared RedisModule](https://github.com/Ceylonlatte/ai-hot-news/pull/2) (squash `a06ee87c`)
  - 抓到的 bug：SP-4.7 把 `REDIS_CONNECTION` 留在了 SP-4 的 `CrawlModule.providers`，新加的 `SummarizeModule` / `ExtractModule` 的 queue providers 找不到这个 token，prod worker 直接 `UnknownDependenciesException` crash-loop。模块各自的 spec 都用 mock 没动 Nest DI 容器，所以 unit/integration 阶段没暴露。
  - 防回归：新增 `apps/worker/src/redis/redis.module.spec.ts` 用 `Test.createTestingModule` 真编译 `SummarizeModule + RedisModule`，强制约束「下个新模块若 inject `REDIS_CONNECTION` 但忘 `imports: [RedisModule]` 会 unit-test 阶段就红」。
- 部署热修 PR2：[#3 fix(sp4.7): pass FIRECRAWL/JINA/EXTRACT_CONCURRENCY into worker container](https://github.com/Ceylonlatte/ai-hot-news/pull/3) (squash `9317d4a4`)
  - 抓到的 bug：`docker-compose.prod.yml` 的 `worker.environment` 只显式列了 `DATABASE_URL/REDIS_URL/NODE_ENV`，新加的 3 个 SP-4.7 key 写在了 `.env` 里却没 `${...}` 透传，容器里全是空。导致 firecrawl provider 没 key 抛错 → fallback 到匿名 jina → jina 立刻 rate-limit → 全部 link-post 走完 3 attempts 标 FAILED。
- prod deploy: 2026-05-05 18:21 UTC+8（PR #3 deploy run `25370807728`，sha `9317d4a4`）
- prod wipe: 2026-05-05 17:53 UTC+8 跑 `wipe-hot-news-pre-ai.ts`，删 1650 → 0 rows
- prod 二次 reset：fix #3 之后将 PR #2 deploy 期间残留的 536 行 `extractStatus='FAILED'`（jina 限流误标）UPDATE 回 `PENDING/extractAttempts=0`，restart worker 让 boot backstop 重新入队
- prod smoke（部署后 ~30 分钟）：

| 指标 | 值 | 阈值 |
|---|---|---|
| 总行数 | 811 | — |
| `extractStatus IS NULL`（self-post / RSS） | 178 | 合理 |
| `EXTRACTED` | 527 + 持续上升 | — |
| `FAILED` | 7 (0.86% of link-posts) | < 10% ✓ |
| `PENDING`（in-flight） | 99 | 收敛中 |
| `EXTRACTED && content==title` | 0 | = 0 ✓ |
| `VISIBLE && filterReason IS NOT NULL` | 0 | = 0 ✓ |
| 5 行最近 EXTRACTED `clen vs tlen` | 7054/9006/14123/8226/38328 vs 11–78 | content >> title ✓ |

下一步推进顺序更新为：

1. **SP-5（AI 摘要 + aiTags）** —— spec/plan 已经写好（`docs/superpowers/specs/2026-05-05-sp5-ai-summary-tags-design.md`），且 SP-4.7 已经替每个新 EXTRACTED 行 `summary=null + 入 summary 队列`，SP-5 ship 后会自动消化这些 pending summary 任务，无需 backfill。
2. **SP-7（pgvector 跨平台合并）**：依赖 SP-5 `aiTags` + embedding 双信号。SP-5 完工后可直接推。
3. **Web 测试基础设施 SP（YAGNI / 待触发）**：保持现状。

### 推进路线提示（更新于 SP-5 v3.4 部署完成）

SP-5 三轮迭代（v3.2 主体 + v3.3 标题翻译 + 双行摘要 + Reddit 阈值收紧 + boot backstop fix + v3.4 自然语流 prompt rewrite）已全部落地：

- v3.2 主体 PR: [#5](https://github.com/Ceylonlatte/ai-hot-news/pull/5) (`00d1273`) + 热修 [#6](https://github.com/Ceylonlatte/ai-hot-news/pull/6) (`93f59ce`) + DTO 暴露 [#7](https://github.com/Ceylonlatte/ai-hot-news/pull/7) (`54de248`)
- v3.3 主体 commit: `0e1904b`（直推 main）+ 热修 `c64fe93`（boot backstop clean failed）
- v3.4 commit: `042289c`（直推 main）
- prod 部署：2026-05-07 14:25 UTC+8 完成 v3.3，14:55 UTC+8 修 BullMQ stuck，22:14 UTC+8 上线 v3.4
- prod 实测：~163 visible rows，summary + titleZh 全填充，单段中立新闻派语调；Reddit cleanup 删 33/110 = 30%（标题党 14 + 伸手党 19）

下一步推进顺序更新为：

1. **SP-7（pgvector 跨平台合并）** —— SP-5 现已稳定输出 `aiTags`（prefix-encoded `company:X / model:Y` 等），跨平台同事件可以靠 `tag 重叠 + embedding 余弦相似度`双信号合并。spec / plan / brainstorming 三件套尚未启动；建议先 brainstorming 收敛 schema（embedding 列、groupId 写入策略、归档冷表），再 spec → plan → implement。
2. **SP-6（热度分计算）** —— 与 SP-7 互不阻塞，但下游 SP-9 Dashboard 首页需要 `heatScore` 才能渲染热度榜单；如果用户优先想要前端可视化，SP-6 可前置。
3. **SP-8（Aurora 视觉系统）→ MVP** —— SP-7 落地后可启动 Aurora 设计稿落地，达成 §7.2 M5 MVP 里程碑（个人可用 read-only 站点）。
4. **Web 测试基础设施 SP（YAGNI / 待触发）**：保持现状；SP-8 落地后 web 分支会变多，再单独开 SP 装 vitest+jsdom+RTL。

**SP-5 已知未修隐患（write-up）**：
- `BullMQ.queue.add(jobId)` 当 jobId 在 `completed` 集合也存在时会 dedupe（c64fe93 只清了 `failed`）。正常 ingest 不会撞（jobId 形式 `summarize-<rowId>` 按行唯一），仅"手工 mass UPDATE summary=NULL 重摘"运维操作会撞（要求手工 redis-cli 清 completed）。SP-7 embedding backfill 等下游 SP 如果要触发重摘需注意。
- v3.4 prompt 套话黑名单 LLM 不会 100% 遵守（实测 ~5/6 样本完全干净，1/6 仍出现"文章指出"等元叙述）。如需 100% 干净可加 few-shot 反例 + 调 temperature 0；当前 95%+ 改善已足够，YAGNI。
