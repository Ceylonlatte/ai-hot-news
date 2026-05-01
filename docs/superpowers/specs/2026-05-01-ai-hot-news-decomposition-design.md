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

### Phase 0：基础设施（1 SP，~3-5 天）

| SP | 名称 | 关键产出 | 验收标准 |
|----|------|---------|---------|
| **SP-0** | Monorepo + Infra 骨架 | pnpm workspace（5 子包）· Docker Compose（PG+pgvector / Redis）· Prisma 完整 schema 骨架 · CI 流水线 · 搬瓦工部署链路（SSH + Compose pull/up） | 本地 `pnpm dev` 起 5 服务全绿；GitHub Actions 全绿；服务器 `docker compose up -d` 跑空环境健康检查通过 |

### Phase 1：第一刀端到端（1 SP，~2-3 天）

| SP | 名称 | 范围 | 验收 |
|----|------|------|------|
| **SP-1** | RSS → 列表页端到端骨架 | BullMQ 定时 job 抓 1 个 RSS 源（如 OpenAI Blog）→ HotNews 入库（仅 sourceUrl + dedupeHash 去重）→ `GET /hot-news` 分页 API → `/news` 简陋列表页（**无 Aurora 视觉**，纯 Tailwind 默认样式） | 浏览器看到至少 10 条真实 RSS 抓取内容 |

**故意不做**：AI 摘要、热度计算、跨平台合并、Aurora 视觉。**目标：跑通骨架。**

### Phase 2：扩展数据源（2 SP，可并行，各 ~2 天）

| SP | 名称 | 关键点 |
|----|------|--------|
| **SP-2** | HackerNews 抓取器 | HN Firebase API · top / ask / show · 抽象 `Crawler` 插件接口 |
| **SP-3** | Reddit 抓取器 | Reddit OAuth · PRD 推荐 subreddit 列表 · rate limit 处理 |

### Phase 3：内容处理升级（4 SP，部分并行，各 ~2-4 天）

| SP | 名称 | 依赖 |
|----|------|------|
| **SP-4** | 内容清洗 + 多层去重 | URL 规范化 / 内容哈希 / 标题相似度（PG fts），输出 `dedupeHash` |
| **SP-5** | AI 摘要 + 标签分类 | Vercel AI SDK · 摘要 + aiTags（公司/模型/类型）· 插拔式摘要策略接口 · prompt 模板入 `packages/prompts` |
| **SP-6** | 热度分计算 | PRD 6 维公式 · 时间窗参数化（默认 24h）· 入库时计算 + 定时重算（衰减） |
| **SP-7** | 跨平台热点合并 | pgvector embedding 入库 · 余弦相似度查询 · 阈值聚合赋 `groupId` · 归档机制（30 天后冷表） |

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
