# SP-4：内容清洗 + 多层去重 设计

- **日期**：2026-05-04
- **状态**：Draft，待用户审阅
- **所属**：Phase 3 / SP-4（详见 `2026-05-01-ai-hot-news-decomposition-design.md` 第 6 节 Phase 3）
- **预计工作量**：~2-2.5 天
- **本文档定位**：单个子项目实现 spec，用户审阅通过后调用 `writing-plans` 生成 step-by-step 实施计划。

---

## 0. 关键设计原则与边界（重要）

SP-4 的核心是把"入库前的物理重复折叠 + 内容清洗 + 质量过滤"做扎实，**不做任何会损伤跨平台热度信号的事**。

### 0.1 去重 vs 热点发现的边界

| 去重类型 | 例子 | SP-4 行为 | 影响热度 |
|---|---|---|---|
| **物理重复**（同 URL 异形） | `http://x` / `https://x` / `m.x.com` 折叠 | **合并为 1 行** | ❌ 不影响（本就是同一物理资源） |
| **跨平台同事件** | "GPT-5" 在 OpenAI Blog + HN top + r/OpenAI 各 1 行 | **保留 N 行**，留给 SP-7 用 embedding 软合并 | ✅ N 行本身就是热度信号，不能丢 |

**SP-4 绝不引入"跨 URL 标题相似度强制 unique"** —— 那会把"3 个平台同时报道同事件"杀成 1 行，彻底破坏 PRD 的核心价值（跨平台热度感知）。该能力属于 SP-7（pgvector 余弦 ≥0.85 软合并 + 共同 `groupId`，仍保留 N 行）。

### 0.2 三个过滤维度（SP-4 处理前两个，第三个推到 SP-5）

| 维度 | 性质 | SP-4 行为 | 例子 |
|---|---|---|---|
| **1. 合规/非内容** | 数据本身坏的或法律不能展示 | crawler 阶段 **直接不入库** | NSFW、Reddit stickied、URL 解析失败、title 为空 |
| **2. 质量低** | 是新闻但社区不喜欢 | 入库 + `status='HIDDEN'` + `filterReason` | upvote_ratio<0.5、HN score<5 且 descendants<2、title<5 字符 |
| **3. 主题不相关** | 是高质量帖但不是 AI 行业新闻 | **SP-4 不处理 → SP-5 LLM 打 `aiTags` 后由 UI 按 tag 过滤** | r/ChatGPT 的 "Help me write college essay"（高分但是求助）、r/StableDiffusion 的 "My cat as wizard"（高分但是创作 show-off） |

**用户已确认接受 SP-4 完工后约 1-2 周内列表仍存在"高分非主题"内容**（等 SP-5 LLM 上线后由 aiTags 过滤）。

### 0.3 为什么 ArticleExtractor 不在 SP-4

SP-3 spec §1.3 提到"subreddit 热门帖外链正文抽取 → SP-4 ArticleExtractor"，但 SP-4 brainstorming 阶段把它**剥离独立**，原因：

1. ArticleExtractor 是独立子系统：独立 worker、独立 BullMQ 队列、独立 fetch 限速 / Readability 选型 / 错误重试，与"入库前清洗"完全不同的关注点
2. 一个 SP 同时做"入库事务内的清洗去重"+"独立 worker 抓外链"会让边界模糊、代码量翻倍（~4-5 天 vs ~2-2.5 天）
3. ArticleExtractor 的真实消费者是 SP-5 AI 摘要（外链没正文摘要无料可摘），由 SP-5 前置或独立成 SP-4.5 更合理

**SP-4 完工后的 link-post（HN 外链 / Reddit `is_self=false`）保留 SP-3 现状**：`content=title`、`rawHtml=null`、`interactionData.externalUrl=外链` —— 这正是未来 ArticleExtractor 的检测哨兵。

---

## 1. 目标、范围与验收标准

### 1.1 目标

在 SP-1/2/3 已建立的"crawler → IngestionService → HotNews"数据流上，**升级三件事**：

1. **URL 规范化升级**：`packages/utils/url.ts::normalizeUrl()` 加 6 条新规则，让"同一物理 URL 的不同形态"全部折叠到同一 canonical form，间接强化 `sourceUrl` + `dedupeHash` 双唯一约束的实际有效性。
2. **入库前内容清洗**：标题剥常见站名后缀、content 剥模板尾、合并连续空白；产出更干净的文本供 SP-5 摘要 / SP-7 embedding 消费。
3. **维度 2 质量过滤**：crawler 内部按平台规则判定，命中阈值则带 `filterReason` 标记入库；IngestionService 据此写 `status='HIDDEN'`，API 默认过滤掉。

外加一次性 backfill 脚本，把历史 1927 行（SP-3 完工 smoke 凭据）按新规则重新规范化并标 HIDDEN。

### 1.2 In-scope

| 模块 | 内容 |
|---|---|
| `packages/utils/url.ts` | `normalizeUrl()` 加 6 条规则：http→https 折叠 / m./mobile. 子域剥离 / Reddit 老入口规范化 / Twitter host 别名 / 重复 query 合并 / 空 `?` 串剥离 |
| `packages/utils/boilerplate.ts`（新增） | `stripTitleBoilerplate(title)` 剥常见尾部站名（` - X` / ` \| X` / ` — X`），保守正则 + 站名白名单；`stripContentBoilerplate(text)` 剥 `Read more`、`Continue reading`、`This article was first published at...` 等模板尾，合并连续空白 |
| `packages/utils/quality.ts`（新增） | `checkRedditQuality(post): string \| null` / `checkHnQuality(item): string \| null` / `checkUniversalQuality(item): string \| null`；返回 `null` 表示通过、返回字符串即 `filterReason` |
| `packages/utils/dedupe.ts` | **不动算法**（仍是 sha256(normalizedUrl + lowercased title) 前 32 hex），但因为输入 `normalizedUrl` 升级 + 标题先经 `stripTitleBoilerplate`，实际行为变化 |
| `packages/types/src/raw-crawled-item.ts` | 加可选 `filterReason?: string \| null` |
| `packages/db/prisma/schema.prisma` | `HotNews` 加 `filterReason String?` 字段 + migration |
| `apps/worker/src/crawl/crawlers/reddit.crawler.ts` | `toRaw()` 调 `checkRedditQuality(post)` 写 `raw.filterReason` |
| `apps/worker/src/crawl/crawlers/hackernews.crawler.ts` | 同上调 `checkHnQuality(item)` |
| `apps/worker/src/crawl/crawlers/rss.crawler.ts` | **不动**（RSS 无平台特定阈值，universal 兜底由 `IngestionService` 统一调用 `checkUniversalQuality()`） |
| `apps/worker/src/crawl/ingestion.service.ts` | 把 raw.title / raw.contentText 经 boilerplate 清洗后再 hash + 入库；据 `raw.filterReason ?? checkUniversalQuality(...)` 写 `status` + `filterReason` |
| `apps/api/src/hot-news/hot-news.service.ts` | `findMany()` 默认加 `where: { status: 'VISIBLE' }`；不暴露 `?includeHidden=true`（YAGNI） |
| `packages/db/scripts/migrate-sp4.ts`（新增） | 一次性 backfill 脚本：Layer 1 重新 normalize sourceUrl + 重算 dedupeHash + 同 URL 折叠；Layer 2 应用维度 2 阈值标 HIDDEN；幂等 |
| `packages/db/scripts/migrate-sp4.spec.ts`（新增） | 集成测试（跑真 PG）：验证 Layer 1/2 行为、P2002 折叠、幂等 |
| `packages/db/package.json` | 1) 加 `@ai-hot-news/utils: workspace:*` 依赖（脚本要 import normalizeUrl/quality/boilerplate）；2) 加 `vitest` devDep；3) 加 `"migrate-sp4": "tsx scripts/migrate-sp4.ts"` 脚本；4) 加 `"test": "vitest run"` |
| 根 `package.json` | 加 `"db:migrate-sp4": "pnpm --filter @ai-hot-news/db run migrate-sp4"`（与 `db:seed` 风格对齐） |

**不变**：

- `apps/web` 完全不变（API 自动过滤掉 HIDDEN，前端不感知）
- `Crawler` / `CrawlerFactory` / `CrawlScheduler` / `CrawlModule` 接口契约不变
- `Platform` enum、`HotNews` 主键、唯一索引、其他字段不变
- BullMQ 队列名、scheduler 频率不变
- 部署链路、env 变量、deploy.sh 不变（migration 走 `prisma migrate deploy`，backfill 脚本手工跑一次）

### 1.3 Out-of-scope（明确不做）

- **维度 3 主题相关性过滤**：→ SP-5 LLM 打 aiTags
- **ArticleExtractor**（HN/Reddit link-post 外链正文抓取）：→ SP-4.5 独立 SP 或 SP-5 前置
- **跨 URL 标题相似度去重**：→ SP-7 用 pgvector embedding 余弦合并
- **rawHtml 清洗 / sanitize**：→ SP-11 详情页渲染时配 DOMPurify
- **www 子域统一剥离**：策略不一致风险高，**不做**（详见 §5.1 决策）
- **path 大小写规范化**：很多站点 path 大小写敏感，**不做**
- **percent-encoding 规范化**：边界 case 多，YAGNI
- **`GET /hot-news` 加 `?includeHidden=true`**：当前没运维需求，YAGNI；未来真要看可直接 SQL
- **历史数据应用维度 3 过滤**：维度 3 SP-4 不实现，backfill 不做
- **filterReason 反向恢复机制**（即未来阈值调整后批量反转 status）：可手工 SQL，无需脚本
- **per-source 阈值**（按 sub 调 ratio 阈值）：YAGNI，统一阈值起步
- **filterReason 暴露在 API 的 DTO 里**：当前是诊断字段，不暴露给前端

### 1.4 硬验收标准

```bash
# === 单元 + 集成测试全绿 ===
pnpm turbo run lint typecheck build test
# 期望：含新增 ~30 个测试 case 全绿
#   - url.spec.ts: +6 条新规则的 case
#   - boilerplate.spec.ts: 新文件，标题/内容清洗 ~10 case
#   - quality.spec.ts: 新文件，三个 check 函数 ~12 case
#   - reddit.crawler.spec.ts: +3 case 验证 filterReason 写入
#   - hackernews.crawler.spec.ts: +3 case
#   - ingestion.service.integration.spec.ts: +4 case 验证 status='HIDDEN' + filterReason 透传
#   - hot-news.service.spec.ts: +1 case 验证默认 WHERE status='VISIBLE'

# === 本地 dev 端到端 ===
pnpm docker:dev
pnpm db:migrate:deploy        # 应用 sp4_filter_reason migration
pnpm db:seed                   # noop（SP-4 不动 SourceConfig）
pnpm dev                       # 三进程并行

# 等 ~5-7 分钟（重新 boot 抓取后）
# Worker 日志期望含：
#   "REDDIT crawled: source=r/LocalLLaMA fetched=25 inserted=A skipped=B hidden=C failed=0"
#   ↑ 新增 "hidden=C" 计数（C = 维度 2 命中阈值的条目数）

# === API 默认行为验证 ===
curl 'localhost:3001/hot-news?pageSize=200' | jq '.items[].status' | sort -u
# 期望：仅 ["VISIBLE"]（API 默认过滤 HIDDEN）

curl 'localhost:3001/hot-news?pageSize=200' | jq '[.items[]] | length'
# 期望：< 总行数（HIDDEN 被过滤掉）

# === DB 直查验证 HIDDEN 数据保留 ===
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT filter_reason, COUNT(*) FROM hot_news WHERE status='HIDDEN' GROUP BY filter_reason ORDER BY 2 DESC"
# 期望（实际 count 取决于真实 hot 列表）：
#   reddit_low_ratio       | 30
#   reddit_low_engagement  | 20
#   hn_low_engagement      | 15
#   title_too_short        | 2
#   ...

# === 一次性 backfill 验证 ===
pnpm db:migrate-sp4
# 期望日志：
#   [Layer 1] normalize sourceUrl: <N1> 行更新，<N2> 行 P2002 折叠（保留早 publishedAt 的）
#   [Layer 1] 重算 dedupeHash: 1927 行
#   [Layer 2] 维度 2 标 HIDDEN: <N3> 行
#   总耗时: ~10-30 秒

# 跑第二次 backfill 应该 noop（幂等）：
pnpm db:migrate-sp4
# 期望：
#   [Layer 1] normalize sourceUrl: 0 行更新（已对齐）
#   [Layer 1] 重算 dedupeHash: 1927 行（hash 一致，0 写）
#   [Layer 2] 维度 2 标 HIDDEN: 0 行（已标）

# === UI 验证 ===
open http://localhost:3000/news
# 期望：列表里看不到 reddit ratio<0.5、HN score<5 等低质量帖

# === backfill 后字段填充率 ===
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT status, COUNT(*) FROM hot_news GROUP BY status"
# 期望：VISIBLE 居多（~70-85%），HIDDEN 占余量

# === CI ===
# .github/workflows/ci.yml 全绿（含新加单元 + 集成测试）

# === 部署后（push 到 main 触发 deploy.yml）===
# 1. deploy.sh 自动跑 prisma migrate deploy → sp4_filter_reason 落库
# 2. deploy.sh 自动跑 prisma db seed → noop（SourceConfig 不变）
# 3. 重启 worker → 新抓取的条目带 filterReason 入库
# 4. **手工**在 VPS 上跑一次 backfill（不进 deploy.sh，避免每次部署重跑）：
#    ssh deploy@<vps>
#    cd /srv/ai-hot-news && docker compose run --rm api pnpm --filter @ai-hot-news/scripts run migrate-sp4
#    # 或直接通过 docker exec 跑 tsx scripts/migrate-sp4.ts
curl https://<domain>/api/hot-news?pageSize=200 | jq '[.items[].status] | unique'
# 期望: ["VISIBLE"]
```

### 1.5 不会修改的内容

- 不动 SP-0 monorepo 结构、Docker Compose 拓扑、CI 矩阵
- 不动 Prisma schema 的其他字段（仅加 `HotNews.filterReason String?`）
- 不改 `Platform` enum
- 不改 `Crawler` interface（仅 `RawCrawledItem` 加可选 `filterReason`）
- 不改 BullMQ 队列名、抓取频率、SourceConfig 表结构
- 不改 `apps/web` 的任何文件
- 不改 `RSS_USER_AGENT` / `REDDIT_USER_AGENT` / `HN_CONCURRENCY` 等 env 变量
- 不改 `scripts/deploy.sh`（migrate-sp4 是手工一次性脚本，不进自动部署链路）

---

## 2. 架构与数据流

### 2.1 数据流（SP-4 完工形态，相对 SP-3 增量）

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                       Worker 进程（SP-4 增量于 SP-3）                        │
│                                                                            │
│  CrawlProcessor.process(job)                                               │
│   │                                                                        │
│   ├─ crawler.fetch() ──→ RawCrawledItem[]（含可选 filterReason）           │
│   │     ┌─ RedditCrawler.toRaw():                                          │
│   │     │     filterReason = checkRedditQuality(post)  ← SP-4 新增          │
│   │     │     // 返回 'reddit_low_ratio' / 'reddit_low_engagement' / null   │
│   │     │                                                                  │
│   │     ├─ HackerNewsCrawler.toRaw():                                      │
│   │     │     filterReason = checkHnQuality(item)  ← SP-4 新增              │
│   │     │     // 返回 'hn_low_engagement' / null                            │
│   │     │                                                                  │
│   │     └─ RssCrawler.toRaw():                                             │
│   │           filterReason = checkUniversalQuality(item)  ← SP-4 新增       │
│   │           // 仅 universal 规则（title 长度等）                          │
│   │                                                                        │
│   └─ ingestion.ingest(items, source)                                       │
│        ├─ const cleanTitle = stripTitleBoilerplate(raw.title)  ← SP-4       │
│        ├─ const cleanContent = stripContentBoilerplate(raw.contentText) ← SP-4│
│        ├─ const sourceUrl = normalizeUrl(raw.sourceUrl)  ← SP-4 升级（6 条） │
│        ├─ const dedupeHash = computeDedupeHash(sourceUrl, cleanTitle)      │
│        │     // 不变算法，但输入更干净                                      │
│        ├─ // universal 兜底：crawler 没标 filterReason 时仍 check           │
│        │   const finalReason = raw.filterReason                             │
│        │     ?? checkUniversalQuality({title: cleanTitle, ...})             │
│        ├─ const status = finalReason ? 'HIDDEN' : 'VISIBLE'                 │
│        └─ prisma.hotNews.create({                                          │
│              title: cleanTitle, content: cleanContent,                     │
│              sourceUrl, dedupeHash,                                        │
│              status, filterReason: finalReason,                            │
│              ... // 其他字段不变                                            │
│           })                                                                │
└────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                       ┌────────────────────┐
                       │  PostgreSQL        │
                       │  hot_news          │
                       │  + filter_reason   │  ← SP-4 NEW 字段
                       └────────────────────┘
                                  ▲
                                  │
              ┌───────────────────┴───────────────────────────────┐
              │ apps/api: GET /hot-news                            │
              │   service.findMany({                                │
              │     where: { status: 'VISIBLE' }   ← SP-4 NEW 默认  │
              │   })                                                │
              │ apps/web: /news（无变化，自动过滤掉 HIDDEN）        │
              └────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│             一次性 backfill 脚本（上线后手工跑一次，跑完再不动）              │
│                                                                            │
│  scripts/migrate-sp4.ts （pnpm db:migrate-sp4）                             │
│   ├─ Layer 1: URL normalize 升级 + 折叠                                     │
│   │   for each row in hot_news:                                            │
│   │     newUrl = normalizeUrl(row.sourceUrl)                                │
│   │     if newUrl != row.sourceUrl:                                         │
│   │       try UPDATE sourceUrl = newUrl                                     │
│   │       catch P2002: # 折叠到已存在的 canonical row                       │
│   │         keep row with smaller publishedAt, DELETE other                 │
│   │     重算 dedupeHash = computeDedupeHash(newUrl, cleanTitle)              │
│   │     UPDATE dedupeHash if different                                     │
│   │                                                                        │
│   ├─ Layer 2: 维度 2 质量过滤标 HIDDEN                                      │
│   │   for each VISIBLE row:                                                │
│   │     reason = recheckQuality(row)  // 按平台调 quality.ts                │
│   │     if reason:                                                         │
│   │       UPDATE status='HIDDEN', filter_reason=reason                     │
│   │                                                                        │
│   └─ 输出报告：                                                             │
│         [Layer 1] normalize 折叠: 1027 → 1024（删 3 行 P2002 重复）         │
│         [Layer 1] 重算 dedupeHash: 1024 行                                  │
│         [Layer 2] 维度 2 标 HIDDEN: 67 行                                   │
│           reddit_low_ratio       30                                        │
│           reddit_low_engagement  22                                        │
│           hn_low_engagement      13                                        │
│           title_too_short         2                                        │
└────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 模块边界与职责

| 单元 | 输入 | 输出 | 依赖 | 备注 |
|---|---|---|---|---|
| `normalizeUrl(url)` | string URL | canonical URL | 无 | 升级 6 条规则 |
| `stripTitleBoilerplate(title)` | string | string | 站名白名单常量表 | 保守正则 |
| `stripContentBoilerplate(text)` | string | string | boilerplate pattern 数组 | 保守正则 |
| `checkRedditQuality(post)` | RedditPost | filterReason \| null | 无 | 平台特定阈值 |
| `checkHnQuality(item)` | HnItem | filterReason \| null | 无 | 平台特定阈值 |
| `checkUniversalQuality({title})` | { title: string } | filterReason \| null | 无 | platform-agnostic |
| `RedditCrawler`（增量） | 不变 | RawCrawledItem 含 filterReason | quality.ts | toRaw 调 checkRedditQuality |
| `HackerNewsCrawler`（增量） | 不变 | RawCrawledItem 含 filterReason | quality.ts | toRaw 调 checkHnQuality |
| `IngestionService`（增量） | RawCrawledItem[] + SourceLike | IngestResult（含 hidden 计数） | url, boilerplate, dedupe, quality | 入库前清洗 + status 写入 |
| `HotNewsService`（增量） | query DTO | DTO[] | prisma | 默认 WHERE status='VISIBLE' |
| `migrate-sp4.ts`（新） | DB 全表 | UPDATE 报告 | normalizeUrl, quality, prisma | 一次性，幂等 |

### 2.3 关键接口签名

```ts
// packages/utils/src/url.ts —— 升级
export function normalizeUrl(input: string): string;
// 6 条新规则见 §3.1

// packages/utils/src/boilerplate.ts —— 新增
export function stripTitleBoilerplate(title: string): string;
export function stripContentBoilerplate(text: string): string;

// packages/utils/src/quality.ts —— 新增
export const FILTER_REASONS = {
  REDDIT_LOW_RATIO: 'reddit_low_ratio',
  REDDIT_LOW_ENGAGEMENT: 'reddit_low_engagement',
  HN_LOW_ENGAGEMENT: 'hn_low_engagement',
  TITLE_TOO_SHORT: 'title_too_short',
} as const;
export type FilterReason = typeof FILTER_REASONS[keyof typeof FILTER_REASONS];

export interface RedditQualityInput {
  upvote_ratio: number | null;
  score: number;
  num_comments: number;
}
export interface HnQualityInput {
  score: number | null;
  descendants: number | null;
}
export interface UniversalQualityInput {
  title: string;
}

export function checkRedditQuality(post: RedditQualityInput): FilterReason | null;
export function checkHnQuality(item: HnQualityInput): FilterReason | null;
export function checkUniversalQuality(item: UniversalQualityInput): FilterReason | null;

// packages/types/src/raw-crawled-item.ts —— 加字段
export interface RawCrawledItem {
  // ...existing fields...
  filterReason?: string | null;   // ← SP-4 新增
}
```

### 2.4 配置与环境变量

**SP-4 不引入新 env 变量**。所有阈值在 `quality.ts` 内做常量定义，未来想可调时再升级到 ConfigService。

| 变量 | 谁用 | SP-4 变化 |
|---|---|---|
| 现有所有 env（DATABASE_URL / REDIS_URL / *_USER_AGENT / *_TIMEOUT_MS）| 现有 | 不变 |

**质量阈值常量**（`quality.ts` 内部）：

```ts
const REDDIT_LOW_RATIO_THRESHOLD = 0.5;
const REDDIT_LOW_SCORE = 5;
const REDDIT_LOW_COMMENTS = 2;
const HN_LOW_SCORE = 5;
const HN_LOW_DESCENDANTS = 2;
const TITLE_MIN_LENGTH = 5;  // trim 后字符数
```

---

## 3. 模块详细设计

### 3.1 `normalizeUrl()` 升级（6 条新规则）

```ts
// packages/utils/src/url.ts —— 升级后
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid', 'ref', 'source',
]);
const TRACKING_PREFIXES = ['utm_'];

// SP-4 NEW: 移动版 / 镜像 host 规范化映射（exact match）
const HOST_ALIASES: Record<string, string> = {
  // Reddit 老入口
  'old.reddit.com':  'www.reddit.com',
  'np.reddit.com':   'www.reddit.com',
  'new.reddit.com':  'www.reddit.com',
  // Twitter / X
  'mobile.twitter.com': 'x.com',
  'twitter.com':        'x.com',
  'm.x.com':            'x.com',
};

// SP-4 NEW: 移动版子域剥离（前缀匹配，不在 alias 表里的兜底）
const MOBILE_PREFIXES = ['m.', 'mobile.'];

function isTrackingParam(key: string): boolean {
  if (TRACKING_PARAMS.has(key)) return true;
  return TRACKING_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function normalizeUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return input;
  }

  // === Rule 1 (NEW): http → https 折叠 ===
  // 假设：所有 http URL 在 2026 年也都能通过 https 访问
  if (parsed.protocol === 'http:') {
    parsed.protocol = 'https:';
  }

  // === Rule 2 (existing): host 小写 ===
  parsed.hostname = parsed.hostname.toLowerCase();

  // === Rule 3 (NEW): host alias 折叠（exact map 优先）===
  if (HOST_ALIASES[parsed.hostname]) {
    parsed.hostname = HOST_ALIASES[parsed.hostname];
  } else {
    // === Rule 4 (NEW): 移动版子域剥离（前缀匹配，alias 未命中时兜底）===
    for (const prefix of MOBILE_PREFIXES) {
      if (parsed.hostname.startsWith(prefix)) {
        parsed.hostname = parsed.hostname.slice(prefix.length);
        break;
      }
    }
  }

  // === Rule 5 (existing): 剥 hash ===
  parsed.hash = '';

  // === Rule 6 (NEW + existing): 剥 tracking + 重复合并 + 排序 ===
  const seen = new Map<string, string>();  // 自动去重（同 key 多值取最后一个）
  for (const [key, value] of parsed.searchParams.entries()) {
    if (isTrackingParam(key)) continue;
    seen.set(key, value);
  }
  parsed.search = '';
  const sortedKeys = Array.from(seen.keys()).sort();
  for (const k of sortedKeys) {
    parsed.searchParams.append(k, seen.get(k)!);
  }

  // === Rule 7 (NEW): 空 query 串剥离 ===
  // URL.toString() 在 searchParams 为空时**自动**不输出 `?`（WHATWG URL 标准行为）。
  // 此规则无需显式代码，但单元测试必须覆盖以下输入：
  //   normalizeUrl('https://x.com/a?')        → 'https://x.com/a'  （`?` 后无参数）
  //   normalizeUrl('https://x.com/a?utm_x=1') → 'https://x.com/a'  （唯一参数被 tracking 剥掉后空）

  // === Rule 8 (existing): 非根 path 剥尾斜杠 ===
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }

  return parsed.toString();
}
```

> **设计要点**：
> 1. **http → https 折叠是激进但合理的**：现实中 SP-1/2/3 抓的所有源都是 HTTPS，但 RSS feed 偶尔会含 http://link，强制升级避免重复。如果某天遇到只支持 http 的源，再加 host 白名单。
> 2. **HOST_ALIASES 优先于 MOBILE_PREFIXES**：`m.x.com` 走 alias 直达 `x.com`；`m.example.com` 走 mobile 前缀降级到 `example.com`。
> 3. **不动 www 子域**：OpenAI 用裸域、Wikipedia 必须 `en.wikipedia.org`、各家策略不一致，强行统一会引入 false-positive。
> 4. **重复 query 合并**：用 Map 自动去重，同 key 多值取最后一个（实际上 Reddit/HN 不会出现这种 case，但防御性）。
> 5. **percent-encoding 不动**：URL 类内部已经标准化（encode 一致），无需额外处理。

### 3.2 `stripTitleBoilerplate()` 设计

**设计原则**：保守剥离，宁可漏剥也不误剥。常见站名后缀模式：

| 模式 | 例子 | 是否剥 |
|---|---|---|
| `XXX - SiteName` | `"GPT-5 announced - OpenAI Blog"` | ✅ 剥（白名单内 SiteName） |
| `XXX \| SiteName` | `"AI news \| TechCrunch"` | ✅ 剥（白名单内） |
| `XXX — SiteName` | `"Claude 4 — Anthropic"` | ✅ 剥（白名单内） |
| `XXX - The Next Generation` | `"GPT-5 - The Next Generation"` | ❌ 不剥（不在白名单） |
| `XXX :: SiteName` | 极少见 | ❌ 不剥 |

```ts
// packages/utils/src/boilerplate.ts —— 新增
const SITE_NAME_WHITELIST = new Set([
  'OpenAI Blog', 'OpenAI',
  'Anthropic',
  'Google AI Blog', 'Google DeepMind',
  'Hugging Face',
  'TechCrunch', 'The Verge', 'Wired', 'Ars Technica',
  'YouTube', 'Twitter', 'X',
  // ... 实际维护可按需扩展
]);

// 形如 " - X" / " | X" / " — X" (em-dash) 的尾部 separator
const TITLE_SUFFIX_PATTERN = /\s*[\-\|—–]\s+(.+?)\s*$/;

export function stripTitleBoilerplate(title: string): string {
  if (!title) return title;
  const trimmed = title.trim();
  const match = trimmed.match(TITLE_SUFFIX_PATTERN);
  if (!match) return trimmed;
  const candidate = match[1].trim();
  if (SITE_NAME_WHITELIST.has(candidate)) {
    return trimmed.slice(0, match.index!).trim();
  }
  return trimmed;
}
```

**测试用例（spec 里固化）**：

```ts
expect(stripTitleBoilerplate('GPT-5 announced - OpenAI Blog')).toBe('GPT-5 announced');
expect(stripTitleBoilerplate('Claude 4 — Anthropic')).toBe('Claude 4');
expect(stripTitleBoilerplate('AI news | TechCrunch')).toBe('AI news');
expect(stripTitleBoilerplate('GPT-5 - The Next Generation')).toBe('GPT-5 - The Next Generation');  // 不在白名单，不剥
expect(stripTitleBoilerplate('OpenAI Blog')).toBe('OpenAI Blog');  // 整个 title 是站名
expect(stripTitleBoilerplate('  Trim test  ')).toBe('Trim test');  // 仅 trim
expect(stripTitleBoilerplate('')).toBe('');
```

> **未来扩展钩子**：站名白名单可以从环境变量 / DB SourceConfig.metadata 注入，但 SP-4 不做（YAGNI）。

### 3.3 `stripContentBoilerplate()` 设计

**剥离目标**：`Read more →` / `Continue reading` 类尾部模板 + 连续空白合并。

```ts
const CONTENT_TAIL_PATTERNS = [
  /\s*Read\s+more\s*[→\-→»]?\s*$/i,
  /\s*Continue\s+reading\s*[→\-→»]?\s*$/i,
  /\s*This\s+article\s+was\s+first\s+published\s+(at|on)\s+[^\n]+$/i,
  /\s*The\s+post\s+.+?\s+appeared\s+first\s+on\s+[^\n]+$/i,  // WordPress feeds 常见
];

const WHITESPACE_COLLAPSE = /[ \t]+/g;
const NEWLINE_COLLAPSE = /\n{3,}/g;

export function stripContentBoilerplate(text: string): string {
  if (!text) return text;
  let result = text;
  for (const pattern of CONTENT_TAIL_PATTERNS) {
    result = result.replace(pattern, '');
  }
  result = result.replace(WHITESPACE_COLLAPSE, ' ');
  result = result.replace(NEWLINE_COLLAPSE, '\n\n');
  return result.trim();
}
```

> **设计要点**：
> 1. **WordPress feeds 的 "The post X appeared first on Y" 是高频残留**，必剥
> 2. **连续 3+ 换行合并为 2**：保留段落但去 RSS 渲染产生的多余空行
> 3. **不剥 HTML tag**：text 已经是 plain text（`stripHtml()` 在 SP-2 已抽出），SP-4 仅 plain text 层清洗
> 4. **不动 selftext_html 字段**：rawHtml 是另一回事，SP-11 详情页时再处理

### 3.4 `quality.ts` 设计

```ts
// packages/utils/src/quality.ts —— 新增
export const FILTER_REASONS = {
  REDDIT_LOW_RATIO:      'reddit_low_ratio',
  REDDIT_LOW_ENGAGEMENT: 'reddit_low_engagement',
  HN_LOW_ENGAGEMENT:     'hn_low_engagement',
  TITLE_TOO_SHORT:       'title_too_short',
} as const;
export type FilterReason = typeof FILTER_REASONS[keyof typeof FILTER_REASONS];

const REDDIT_LOW_RATIO_THRESHOLD = 0.5;
const REDDIT_LOW_SCORE = 5;
const REDDIT_LOW_COMMENTS = 2;
const HN_LOW_SCORE = 5;
const HN_LOW_DESCENDANTS = 2;
const TITLE_MIN_LENGTH = 5;

export interface RedditQualityInput {
  upvote_ratio: number | null;
  score: number;
  num_comments: number;
}
export interface HnQualityInput {
  score: number | null;
  descendants: number | null;
}
export interface UniversalQualityInput {
  title: string;
}

export function checkRedditQuality(post: RedditQualityInput): FilterReason | null {
  // upvote_ratio 可能为 null（冷帖 < 3 votes Reddit 不计算），跳过此条规则
  if (post.upvote_ratio !== null && post.upvote_ratio < REDDIT_LOW_RATIO_THRESHOLD) {
    return FILTER_REASONS.REDDIT_LOW_RATIO;
  }
  if (post.score < REDDIT_LOW_SCORE && post.num_comments < REDDIT_LOW_COMMENTS) {
    return FILTER_REASONS.REDDIT_LOW_ENGAGEMENT;
  }
  return null;
}

export function checkHnQuality(item: HnQualityInput): FilterReason | null {
  const score = item.score ?? 0;
  const descendants = item.descendants ?? 0;
  if (score < HN_LOW_SCORE && descendants < HN_LOW_DESCENDANTS) {
    return FILTER_REASONS.HN_LOW_ENGAGEMENT;
  }
  return null;
}

export function checkUniversalQuality(item: UniversalQualityInput): FilterReason | null {
  const t = (item.title ?? '').trim();
  if (t.length < TITLE_MIN_LENGTH) {
    return FILTER_REASONS.TITLE_TOO_SHORT;
  }
  return null;
}
```

> **设计要点**：
> 1. **顺序排他**：每个 check 函数返回 first match，多条命中只记最严的一条 reason（约定 reason 隐含优先级）
> 2. **null safe**：`upvote_ratio=null` 跳过该规则（不算违规）；`score=null` 视作 0（HN 极少见但防御）
> 3. **常量内置不外露**：阈值不是 export 的，只有需要 spec 测试时通过测试 fixture 模拟边界值
> 4. **平台 check 返回类型一致**：`FilterReason | null`，方便 IngestionService 统一处理

### 3.5 `RedditCrawler` 增量改造

```ts
// apps/worker/src/crawl/crawlers/reddit.crawler.ts —— 增量
import { checkRedditQuality } from '@ai-hot-news/utils';

  private toRaw(p: RedditPost, subredditHint: string | null): RawCrawledItem {
    const isSelfPost = !!p.is_self;
    const selftextHtml = (p.selftext_html ?? '').trim();
    const subreddit = subredditHint ?? p.subreddit ?? 'unknown';

    // SP-4 NEW: 维度 2 质量过滤判定
    const filterReason = checkRedditQuality({
      upvote_ratio: p.upvote_ratio ?? null,
      score: p.score ?? 0,
      num_comments: p.num_comments ?? 0,
    });

    return {
      title: p.title,
      contentText: isSelfPost ? stripHtml(selftextHtml || p.title) : p.title,
      rawHtml: isSelfPost && selftextHtml ? selftextHtml : null,
      sourceUrl: `https://www.reddit.com/r/${subreddit}/comments/${p.id}`,
      author: p.author && p.author !== '[deleted]' ? p.author : null,
      publishedAt: p.created_utc ? new Date(p.created_utc * 1000) : null,
      interactionData: {
        score: p.score ?? 0,
        comments: p.num_comments ?? 0,
        externalUrl: isSelfPost ? null : (p.url ?? null),
        redditId: p.id,
        redditSubreddit: subreddit,
        redditUpvoteRatio: p.upvote_ratio ?? null,
      },
      filterReason,  // ← SP-4 新增字段
    };
  }
```

`isValidPost` 不动（继续负责维度 1 合规过滤：stickied / over_18 / 缺 title / 缺 id）。

### 3.6 `HackerNewsCrawler` 增量改造

```ts
// apps/worker/src/crawl/crawlers/hackernews.crawler.ts —— 增量
import { checkHnQuality } from '@ai-hot-news/utils';

  private toRaw(item: HnItem): RawCrawledItem {
    const filterReason = checkHnQuality({
      score: item.score ?? null,
      descendants: item.descendants ?? null,
    });

    return {
      // ... existing fields ...
      filterReason,
    };
  }
```

`RssCrawler` **完全不动**：RSS 没有 platform-specific 阈值（score / ratio 字段不存在），让 RssCrawler 写一行 `filterReason = checkUniversalQuality({title})` 反而会把"通用规则"散落进每个 crawler。**统一在 IngestionService 兜底**：crawler 没标 reason 时，IngestionService 调用 `checkUniversalQuality()` 兜底（详见 §3.7 实现）。

> **统一兜底原则**：crawler 标了 reason → 直接用 crawler 的；crawler 没标 → IngestionService 跑 universal check。这意味着 Reddit/HN 帖如果同时低 ratio + 短 title，会优先记 platform-specific reason（如 `reddit_low_ratio`），不会同时记 `title_too_short` —— 一个 reason 足以标 HIDDEN，避免冗余。

### 3.7 `IngestionService` 增量改造

```ts
// apps/worker/src/crawl/ingestion.service.ts —— 增量后
import { Injectable, Logger } from '@nestjs/common';
import { getPrisma, Prisma, type Platform, ContentStatus } from '@ai-hot-news/db';
import {
  computeDedupeHash,
  normalizeUrl,
  stripTitleBoilerplate,
  stripContentBoilerplate,
  checkUniversalQuality,
} from '@ai-hot-news/utils';
import type { RawCrawledItem } from '@ai-hot-news/types';

export interface IngestResult {
  fetched: number;
  inserted: number;
  skipped: number;
  hidden: number;     // ← SP-4 新增
  failed: number;
}

interface SourceLike {
  id: string;
  platform: Platform;
  url: string | null;
  identifier: string | null;
  name: string;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  async ingest(items: RawCrawledItem[], source: SourceLike): Promise<IngestResult> {
    const prisma = getPrisma();
    const result: IngestResult = {
      fetched: items.length,
      inserted: 0,
      skipped: 0,
      hidden: 0,
      failed: 0,
    };

    for (const raw of items) {
      try {
        if (!raw.sourceUrl) {
          result.skipped += 1;
          continue;
        }
        const sourceUrl = normalizeUrl(raw.sourceUrl);

        // SP-4 NEW: 入库前内容清洗
        const cleanTitle = stripTitleBoilerplate(raw.title);
        const cleanContent = stripContentBoilerplate(raw.contentText);

        // SP-4 NEW: 用清洗后的 title 算 dedupeHash
        const dedupeHash = computeDedupeHash(sourceUrl, cleanTitle);

        // SP-4 NEW: universal 兜底（crawler 没标 filterReason 时再 check 一次）
        const finalReason =
          raw.filterReason ??
          checkUniversalQuality({ title: cleanTitle });

        const status: ContentStatus = finalReason
          ? ContentStatus.HIDDEN
          : ContentStatus.VISIBLE;

        try {
          await prisma.hotNews.create({
            data: {
              title: cleanTitle,
              content: cleanContent,
              rawHtml: raw.rawHtml,
              sourcePlatform: source.platform,
              sourceUrl,
              author: raw.author,
              publishedAt: raw.publishedAt ?? new Date(),
              dedupeHash,
              status,
              filterReason: finalReason,
              ...(raw.interactionData != null
                ? { interactionData: raw.interactionData as Prisma.InputJsonValue }
                : {}),
            },
          });
          if (status === ContentStatus.HIDDEN) {
            result.hidden += 1;
          } else {
            result.inserted += 1;
          }
        } catch (createErr) {
          if ((createErr as { code?: string }).code === 'P2002') {
            result.skipped += 1;
          } else {
            throw createErr;
          }
        }
      } catch (err) {
        this.logger.warn(`Ingest item failed: ${raw.sourceUrl} → ${(err as Error).message}`);
        result.failed += 1;
      }
    }
    return result;
  }
}
```

### 3.8 `HotNewsService` 增量改造（API 默认过滤）

```ts
// apps/api/src/hot-news/hot-news.service.ts —— 增量
async findMany(query: GetHotNewsQueryDto): Promise<HotNewsListResponseDto> {
  const where: Prisma.HotNewsWhereInput = {
    status: ContentStatus.VISIBLE,  // ← SP-4 NEW 默认过滤
    // ... 其他可选 where 条件
  };
  // ... rest unchanged
}
```

> **API 契约不变**：DTO 不暴露 `status` / `filterReason` 字段（前端不感知），只是 `findMany` 内部默认过滤掉 HIDDEN。未来 SP-24 后台管理页需要看 HIDDEN 时再加专门的 admin endpoint。

### 3.9 Schema migration

```prisma
// packages/db/prisma/schema.prisma —— 增量
model HotNews {
  // ... existing fields ...
  status          ContentStatus @default(VISIBLE)
  filterReason    String?       // ← SP-4 NEW
  interactionData Json?
  // ... rest unchanged ...
}
```

```sql
-- packages/db/prisma/migrations/<timestamp>_sp4_filter_reason/migration.sql
ALTER TABLE "hot_news" ADD COLUMN "filter_reason" TEXT;
-- 不加索引（filter_reason 用于诊断，不查询热路径）
```

---

## 4. 历史数据 backfill 设计

### 4.1 一次性脚本职责

> **位置**：`packages/db/scripts/migrate-sp4.ts`（与 `seed.ts` 同体系，在 `packages/db` 内享受 Prisma client + tsx loader）；通过 `pnpm db:migrate-sp4` 在根目录调用。

```ts
// packages/db/scripts/migrate-sp4.ts （概念性，实际代码在 plan 阶段细化）
import { getPrisma, ContentStatus, Platform } from '@ai-hot-news/db';
import {
  normalizeUrl,
  computeDedupeHash,
  stripTitleBoilerplate,
  checkRedditQuality,
  checkHnQuality,
  checkUniversalQuality,
} from '@ai-hot-news/utils';

async function main() {
  const prisma = getPrisma();
  const stats = {
    layer1NormalizeUpdated: 0,
    layer1Collapsed: 0,
    layer1HashUpdated: 0,
    layer2Hidden: 0 as Record<string, number>,
  };

  // === Layer 1: URL normalize 升级 + 折叠 + 重算 dedupeHash ===
  const allRows = await prisma.hotNews.findMany({
    select: {
      id: true,
      sourceUrl: true,
      title: true,
      publishedAt: true,
      sourcePlatform: true,
      interactionData: true,
      dedupeHash: true,
    },
    orderBy: { publishedAt: 'asc' },  // 早的优先（折叠时保留）
  });

  for (const row of allRows) {
    const newUrl = normalizeUrl(row.sourceUrl);
    const cleanTitle = stripTitleBoilerplate(row.title);
    const newHash = computeDedupeHash(newUrl, cleanTitle);

    if (newUrl !== row.sourceUrl || newHash !== row.dedupeHash) {
      try {
        await prisma.hotNews.update({
          where: { id: row.id },
          data: {
            sourceUrl: newUrl,
            dedupeHash: newHash,
            // 顺便回填 cleanTitle（如果 stripTitleBoilerplate 改了）
            title: cleanTitle,
          },
        });
        if (newUrl !== row.sourceUrl) stats.layer1NormalizeUpdated++;
        if (newHash !== row.dedupeHash) stats.layer1HashUpdated++;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          // 折叠：保留 publishedAt 早的（已存在的那行）、删当前 row
          await prisma.hotNews.delete({ where: { id: row.id } });
          stats.layer1Collapsed++;
        } else {
          throw err;
        }
      }
    }
  }

  // === Layer 2: 维度 2 质量过滤标 HIDDEN ===
  const visibleRows = await prisma.hotNews.findMany({
    where: { status: ContentStatus.VISIBLE },
    select: {
      id: true,
      title: true,
      sourcePlatform: true,
      interactionData: true,
    },
  });

  for (const row of visibleRows) {
    let reason: string | null = null;
    const ix = row.interactionData as Record<string, unknown> | null;

    if (row.sourcePlatform === Platform.REDDIT && ix) {
      reason = checkRedditQuality({
        upvote_ratio: typeof ix.redditUpvoteRatio === 'number' ? ix.redditUpvoteRatio : null,
        score: typeof ix.score === 'number' ? ix.score : 0,
        num_comments: typeof ix.comments === 'number' ? ix.comments : 0,
      });
    } else if (row.sourcePlatform === Platform.HACKERNEWS && ix) {
      reason = checkHnQuality({
        score: typeof ix.score === 'number' ? ix.score : null,
        descendants: typeof ix.comments === 'number' ? ix.comments : null,
      });
    }
    if (!reason) {
      reason = checkUniversalQuality({ title: row.title });
    }

    if (reason) {
      await prisma.hotNews.update({
        where: { id: row.id },
        data: {
          status: ContentStatus.HIDDEN,
          filterReason: reason,
        },
      });
      const reasons = stats.layer2Hidden as Record<string, number>;
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
  }

  console.log(JSON.stringify(stats, null, 2));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### 4.2 幂等性

| 第一次跑 | 第二次跑 |
|---|---|
| Layer 1: 大量 normalize 更新 + 少量折叠 | Layer 1: 0 更新（已对齐）、0 折叠（duplicates 已删） |
| Layer 1: 大量 dedupeHash 重算 | Layer 1: 0 更新（hash 一致） |
| Layer 2: 大量标 HIDDEN | Layer 2: 0 标（已 HIDDEN，filter 跳过 status=VISIBLE 的查询） |

### 4.3 P2002 折叠策略

**保留 publishedAt 早的，删除晚的**。理由：

1. 早的行通常 `crawledAt` 也早 → `interactionData` 可能是初始低分数据
2. 晚的行通常 `interactionData` 是更新后的高分数据
3. **但保留早的更安全**：不删错（"删早保晚"如果晚的是错抓也丢真历史），早的至少是稳定历史

**这是 trade-off**，未来 SP-6 热度公式有"refresh-interaction-data" worker 后，自然会更新 score / comments，所以保留早的不影响热度准确性。

### 4.4 不进 deploy.sh 的理由

backfill 是**一次性**的：跑完一次就再不需要跑了（之后所有新行都按新规则进库）。如果进 deploy.sh，每次 deploy 都跑一遍：

- 不破坏（脚本幂等），但浪费 ~10-30 秒部署时间
- 多次 deploy 后 backfill 报告永远是 `0 updated`，反而误导运维

**手工跑一次**：第一次部署 SP-4 后 ssh 到 VPS 跑 `docker compose run --rm api pnpm migrate-sp4`，跑完写 commit log 标记"SP-4 backfill done @ <date>"。

---

## 5. 设计决策与可选方案

### 5.1 URL 规范化范围：保守 vs 中量 vs 激进

| 方案 | 决策 | 理由 |
|---|---|---|
| A. 保守 3 条（http→https + 重复 query + 空 query） | ❌ 拒绝 | 漏掉 m./mobile. + Reddit / Twitter 别名等高频镜像 |
| **B. 中量 6 条** | ✅ 已选 | 实际数据中已经看到的镜像源全收；www / percent-encoding 不动避免误折叠 |
| C. 激进 8 条（B + www 子域 + percent-encoding） | ❌ 拒绝 | www 策略各家不一致（OpenAI 裸域、Wikipedia 必带），强行统一会有 false-positive |

### 5.2 dedupeHash 算法：不动 vs 加 contentHash 字段

| 方案 | 决策 | 理由 |
|---|---|---|
| A. 不动 + 不 backfill（仅 normalizeUrl 升级） | ❌ 拒绝 | 历史 dedupeHash 算法基于旧 normalize，新行按新算法，库内不一致 |
| **B. 不动算法 + backfill 重算历史行** | ✅ 已选 | schema 不动 + 一次性脚本 + 幂等 |
| C. 加 `contentHash` 字段 | ❌ 拒绝 | 内容初筛是 SP-7 跨平台合并的工具，SP-4 强行加属于 over-design |

### 5.3 维度 2 过滤后处理：不入库 vs 入库 HIDDEN

| 方案 | 决策 | 理由 |
|---|---|---|
| A. 直接不入库 | ❌ 拒绝（用户原选，brainstorming 中改决策） | 已删数据回不来；阈值 ground truth 不知道；SP-7 跨平台合并的"覆盖度信号"丢失 |
| **B. 入库 + status='HIDDEN' + filterReason** | ✅ 已选 | 阈值可调；SP-7 可用 HIDDEN 行做信号增强；运维 SQL 诊断；DB 体量影响可忽略（+0.5MB/年） |
| C. 入库 + 30 天清理 | ❌ 拒绝 | YAGNI，体量根本不需要清理 |

### 5.4 维度 2 阈值集：保守 vs 中量 vs 激进

| 方案 | 决策 | 理由 |
|---|---|---|
| A. 保守 3 条（仅 reddit ratio + universal title 空 + URL 解析失败） | ❌ 拒绝 | 漏掉 HN low score / 短 title 等明显低质 |
| **B. 中量 6 条** | ✅ 已选 | 覆盖主要平台的低质量 + 通用兜底，不到激进的 emoji / 空白率（这些误杀风险高） |
| C. 激进 9 条（B + emoji 占比 + content 空白率 + NSFW 关键词） | ❌ 拒绝 | NSFW 已由 SP-3 over_18 标记处理；emoji 标题可能是真新闻 |

### 5.5 维度 3 主题相关性：SP-4 关键词层 vs 推迟 SP-5 LLM

| 方案 | 决策 | 理由 |
|---|---|---|
| A. SP-4 引入关键词层（白名单 + 反向"水帖" pattern） | ❌ 拒绝（用户决策） | 词表维护负担、可能漏新话题、和 SP-5 LLM 双层冗余 |
| **B. SP-4 不动 + SP-5 LLM 一次到位** | ✅ 已选 | 接受 SP-4 完工后约 1-2 周内列表仍有"高分非主题"内容；SP-5 LLM 上线后用 aiTags 自然过滤 |
| C. 混合：SP-4 兜底 + SP-5 LLM 主 | ❌ 拒绝 | 双层逻辑维护成本；LLM 上线后关键词层基本不触发，等于死代码 |

### 5.6 过滤逻辑层级：crawler vs ingestion vs DI service

| 方案 | 决策 | 理由 |
|---|---|---|
| **A. crawler 内判定 + utils/quality.ts 共享工具函数** | ✅ 已选 | crawler 知 platform 字段语义；utils 集中阈值；与 SP-3 RedditCrawler.isValidPost 模式一致 |
| B. IngestionService 集中判定 | ❌ 拒绝 | platform-agnostic 的 service 要 hardcode 知道 reddit 用 redditUpvoteRatio 等字段，反而耦合 |
| C. 注入 QualityChecker 服务（NestJS DI） | ❌ 拒绝 | 当前阈值不需要运行时配置，YAGNI；未来真有需求再升级到 DI |

### 5.7 ArticleExtractor 归属：SP-4 vs SP-4.5 vs SP-5 前置

| 方案 | 决策 | 理由 |
|---|---|---|
| A. SP-4 一次包含 | ❌ 拒绝 | SP-4 估算从 ~2.5 天 → ~4-5 天；ArticleExtractor 是独立子系统（独立 worker / 队列），与"入库前清洗"关注点不同 |
| **B. SP-4.5 独立 spec / 或 SP-5 前置** | ✅ 已选 | ArticleExtractor 真实消费者是 SP-5 AI 摘要，SP-5 前置更合理；SP-4 完工后保留 link-post `content=title, rawHtml=null` 现状作为检测哨兵 |

### 5.8 backfill 脚本归属：进 deploy.sh vs 手工

| 方案 | 决策 | 理由 |
|---|---|---|
| A. 进 deploy.sh，每次 deploy 跑一次 | ❌ 拒绝 | 一次性脚本进自动链路浪费部署时间；多次 deploy 后报告永远 0 updated 误导运维 |
| **B. 手工跑一次（第一次 SP-4 部署后 ssh 到 VPS）** | ✅ 已选 | 跑完写 commit log 标记，干净 |

---

## 6. Web、API、部署影响

### 6.1 Web `/news`

**完全无变化**。API 默认过滤 HIDDEN，前端 SSR 自然只看到 VISIBLE 项。

### 6.2 API

**契约不变**（DTO 字段不增不减），仅 `findMany` 内部默认 `WHERE status='VISIBLE'`。

> 未来 SP-24 后台管理页需要看 HIDDEN 时，加 `GET /admin/hot-news?includeHidden=true` 专门 endpoint，不污染普通 endpoint。

### 6.3 部署

**`scripts/deploy.sh` 完全无变化**。

部署后**手工**一次性跑 backfill：

```bash
# 推荐方式：在 VPS 主机上的 monorepo 根目录跑（VPS 上有 Node 22 + pnpm + 完整源码）
ssh deploy@<vps>
cd /srv/ai-hot-news
pnpm db:migrate-sp4

# 备用方式：通过 docker exec 进 api 容器跑（如果主机没装 pnpm）
docker compose exec api sh -c "cd packages/db && tsx scripts/migrate-sp4.ts"
```

prisma migration 走自动链路：

```bash
# scripts/deploy.sh 已有
$COMPOSE run --rm --entrypoint sh api -c "cd packages/db && npx prisma migrate deploy"
# ↑ 自动应用 sp4_filter_reason migration
```

---

## 7. 测试矩阵

| 测试 | 文件 | 类型 | 关键 case |
|---|---|---|---|
| `normalizeUrl` 6 条新规则 | `packages/utils/src/url.spec.ts`（**扩展**） | 单元 | http→https 折叠；HOST_ALIASES 全 4 条；mobile/m. 前缀剥离；www 不动；重复 query 合并；空 `?` 串剥离；alias 优先于前缀（`m.x.com → x.com` 直达 alias）；非映射 host 不动 |
| `stripTitleBoilerplate` | `packages/utils/src/boilerplate.spec.ts`（**新增**） | 单元 | 白名单内 sites 全剥（`- OpenAI Blog` / `\| TechCrunch` / `— Anthropic`）；白名单外不剥；空 title；纯空白 trim；尾部 `-` 但不是 site name 不剥；中间含 `-` 不剥（仅匹配尾部）|
| `stripContentBoilerplate` | 同上 | 单元 | `Read more →` 剥；`Continue reading` 剥；WordPress `The post X appeared first on Y` 剥；连续空白合并；连续 3+ 换行合并为 2；空字符串 |
| `checkRedditQuality` | `packages/utils/src/quality.spec.ts`（**新增**） | 单元 | upvote_ratio 0.4 → REDDIT_LOW_RATIO；ratio=null 跳过 ratio 规则；score=3 + comments=0 → REDDIT_LOW_ENGAGEMENT；score=10 + comments=5 → null（通过）；score=3 + comments=5 → null（高互动救回）|
| `checkHnQuality` | 同上 | 单元 | score=3 + descendants=0 → HN_LOW_ENGAGEMENT；score=10 + descendants=5 → null；score=null + descendants=null → HN_LOW_ENGAGEMENT |
| `checkUniversalQuality` | 同上 | 单元 | title='' → TITLE_TOO_SHORT；title='abc' → TITLE_TOO_SHORT；title='hello world' → null；title='   ' → TITLE_TOO_SHORT（trim 后） |
| `RedditCrawler` toRaw 写 filterReason | `apps/worker/src/crawl/crawlers/reddit.crawler.spec.ts`（**扩展**） | 单元 | 维度 1 仍 isValidPost 过滤（不变）；新增：低 ratio post → `raw.filterReason='reddit_low_ratio'`；高 ratio post → `raw.filterReason=null`；checkRedditQuality 被正确调用 |
| `HackerNewsCrawler` toRaw 写 filterReason | `apps/worker/src/crawl/crawlers/hackernews.crawler.spec.ts`（**扩展**） | 单元 | 低 score 低 descendants → `raw.filterReason='hn_low_engagement'`；高 score → null |
| `RssCrawler` 通过 universal 兜底 | `apps/worker/src/crawl/crawlers/rss.crawler.spec.ts`（**扩展**） | 单元 | RSS 不主动写 filterReason（保持 null），让 IngestionService 调 universal |
| `IngestionService` SP-4 行为 | `apps/worker/src/crawl/ingestion.service.integration.spec.ts`（**扩展**） | 集成（真 PG） | raw.filterReason 透传写库；status='HIDDEN' 写入；title/content 经过 boilerplate 清洗后入库；dedupeHash 用 cleanTitle 算；universal 兜底（raw.filterReason=null + title 短 → 仍写 HIDDEN）；hidden 计数正确 |
| `HotNewsService` 默认过滤 | `apps/api/src/hot-news/hot-news.service.spec.ts`（**扩展**） | 单元 | 默认查询不返回 HIDDEN 项；status 不在 DTO 输出 |
| `migrate-sp4.ts` 集成 | `packages/db/scripts/migrate-sp4.spec.ts`（**新增**，跑真 PG） | 集成 | 准备 5 条 fixture（含 1 条 sourceUrl 异形 + 同 canonical 已存在重复 → 折叠；2 条 reddit 低 ratio → 标 HIDDEN；1 条短 title → 标 HIDDEN；1 条正常 → 不动）；跑脚本验证：normalize 折叠 1 行、HIDDEN 标 3 行；二次跑幂等（0 写） |

CI：

- `pnpm turbo lint typecheck build` —— 现有
- `pnpm turbo test` —— 现有，自动捕获新测试
- 集成测试沿用 PG service container

**测试 fixture 准备清单**：

```ts
// quality.spec.ts 不需要 fixture 文件，inline test data
// boilerplate.spec.ts 不需要 fixture 文件，inline test data
// migrate-sp4.spec.ts 需要 5-10 条 hot_news 行的 SQL setup（直接 prisma.hotNews.createMany）
```

---

## 8. 错误处理 + 升级钩子

### 8.1 分层错误处理

| 失败类型 | 行为 |
|---|---|
| `normalizeUrl(invalidUrl)` | 已有 try/catch：返回原值不变 |
| `stripTitleBoilerplate(null/undefined)` | 防御性返回原值 |
| `stripContentBoilerplate(null/undefined)` | 同 |
| `checkRedditQuality(post)` 字段缺失 | TypeScript 类型 `number / null`，运行时 `?? 0` 兜底 |
| `IngestionService.create` P2002（dedupeHash 重复） | 现有 try/catch：result.skipped++ |
| backfill Layer 1 P2002 折叠 | DELETE 当前 row，stats.layer1Collapsed++ |
| backfill 中途异常 | 整个脚本退出（exit 1），半成品状态 → 重跑（幂等）|

### 8.2 升级钩子（spec 显式记录）

| 触发条件 | 当前实现 | 升级路径 |
|---|---|---|
| 阈值需要可配（运维想 SQL UPDATE 试不同阈值） | 阈值是 quality.ts 内常量 | 升级到 NestJS ConfigService 或 DB-stored config，阈值变更后重启 worker 生效 |
| 需要按 sub / 按 RSS 源调阈值 | 全平台统一阈值 | 把阈值从 quality.ts 常量提到 SourceConfig.metadata JSON，crawler 读 source.metadata.thresholds 传给 quality 函数 |
| 需要把 HIDDEN 项暴露给运维 | API 默认过滤、不暴露 | 加 `GET /admin/hot-news?includeHidden=true` 配 admin 鉴权 |
| 需要从 HIDDEN 反转回 VISIBLE（阈值改了想恢复） | 手工 SQL `UPDATE hot_news SET status='VISIBLE' WHERE filter_reason='reddit_low_ratio'` | 加批量恢复脚本 `scripts/unhide.ts --reason=reddit_low_ratio` |
| **维度 3 主题相关性过滤** | SP-4 不做 | **SP-5**：LLM 给所有行打 aiTags（包括对历史 HIDDEN 行也打 → 如果 LLM 判定相关，可恢复）；UI 按 aiTags 过滤；filterReason='off_topic' 是 SP-5 才会出现的值 |
| 需要清洗 rawHtml | SP-4 不做 | **SP-11**：详情页渲染时调 DOMPurify 等 sanitize 库 |
| 需要 ArticleExtractor 抽取 link-post 外链 | SP-4 不做 | **SP-4.5 / SP-5 前置**：独立 worker 按 `WHERE source_platform IN ('HACKERNEWS', 'REDDIT') AND raw_html IS NULL AND interaction_data->>'externalUrl' IS NOT NULL` 选定，调 Mozilla Readability 等抽取，回填 rawHtml + content |
| 跨平台同事件软合并 | SP-4 不做 | **SP-7**：pgvector embedding 余弦 ≥0.85 → 共同 groupId（保留 N 行） |
| 需要更激进的过滤（emoji 主导、空白率高） | 当前不做 | 直接在 quality.ts 加新规则，加 unit test，灰度部署 |

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| `normalizeUrl` http→https 折叠误把仅支持 http 的源弄到 https → 抓取失败 | 低（2026 年绝大多数源都支持 HTTPS） | 留 normalize 函数返回任何异常都回退原 URL（已有 try/catch）；如真发生，加 host 白名单跳过强转 |
| `HOST_ALIASES` 表漏映射或映射错误 | 中 | 表小（4 条 Reddit + 3 条 Twitter）+ 单元测试覆盖每条 + Twitter 别名等到 SP-22 上线时再实测 |
| `stripTitleBoilerplate` 误剥真标题（如 "GPT-5 - The Next Generation"） | 中 | **白名单制**：只剥已知 site name；不在白名单的尾部 ` - X` 一律保留；测试 case 覆盖 |
| `stripContentBoilerplate` 误剥真内容尾部（如某文章真的以 "Read more about this in our paper" 结尾） | 低 | 模式保守（要求严格匹配 `Read more →` 含箭头）；如真误剥仅影响 SP-5 摘要质量，不丢条目 |
| 维度 2 阈值过严，把真新闻误标 HIDDEN | 中 | status=HIDDEN 数据保留，运维 SQL 反转一行命令；阈值在 quality.ts 集中可调；上线后 1-2 周观察 `SELECT filter_reason, COUNT(*)` 分布 |
| backfill 脚本中途失败留半成品状态 | 中 | 脚本幂等（重跑安全）；按 publishedAt 顺序处理（早→晚），失败时 stats 已 console.log 部分进度 |
| backfill P2002 折叠时删错（删了应保留的） | 低 | 用 `orderBy: publishedAt asc` 早的优先 → P2002 时删的是后跑到的（晚的），保留早的，符合预期 |
| API 默认 `WHERE status='VISIBLE'` 改动忘了 SP-9/10/11 等下游 | 中 | spec 明确记录"DTO 不变" → 任何消费 GET /hot-news 的 SP 不感知；新加 endpoint（如 SP-9 /stats/today）默认也只统计 VISIBLE 项 |
| 历史 1927 行 backfill 跑得很慢（如 5 分钟） | 低 | 行数小（< 10K），即便逐行 update 也只需 30 秒；如未来增长到 100K+ 可改批量 update |
| **用户感知到 SP-4 完工后列表仍有"高分非主题"内容**（维度 3 等 SP-5） | **高（已知** | spec 显式记录用户已接受此 trade-off；SP-5 紧随其后；SP-5 完工时 LLM 自动处理 |

---

## 10. 完工 Checklist

```text
[ ] packages/utils/src/url.ts 升级 6 条规则 + 单元测试通过（≥10 case）
[ ] packages/utils/src/boilerplate.ts 新增 + 单元测试通过（≥10 case）
[ ] packages/utils/src/quality.ts 新增 + 单元测试通过（≥12 case）
[ ] packages/utils/src/index.ts re-export 新模块
[ ] packages/types/src/raw-crawled-item.ts 加 filterReason?: string | null
[ ] packages/db/prisma/schema.prisma 加 HotNews.filterReason String?
[ ] packages/db/prisma/migrations/<ts>_sp4_filter_reason 生成 + 提交
[ ] apps/worker/src/crawl/crawlers/reddit.crawler.ts toRaw 调 checkRedditQuality
[ ] apps/worker/src/crawl/crawlers/reddit.crawler.spec.ts 加测试
[ ] apps/worker/src/crawl/crawlers/hackernews.crawler.ts toRaw 调 checkHnQuality
[ ] apps/worker/src/crawl/crawlers/hackernews.crawler.spec.ts 加测试
[ ] apps/worker/src/crawl/crawlers/rss.crawler.spec.ts 验证 RSS 不主动写 filterReason
[ ] apps/worker/src/crawl/ingestion.service.ts 入库前清洗 + 写 status/filterReason + IngestResult.hidden
[ ] apps/worker/src/crawl/ingestion.service.integration.spec.ts 加测试（≥4 case）
[ ] apps/api/src/hot-news/hot-news.service.ts 默认 WHERE status='VISIBLE'
[ ] apps/api/src/hot-news/hot-news.service.spec.ts 加测试
[ ] packages/db/scripts/migrate-sp4.ts 新增 + 集成测试通过（幂等性 + P2002 折叠）
[ ] packages/db/package.json 加 migrate-sp4 脚本
[ ] 根 package.json 加 db:migrate-sp4 → pnpm --filter @ai-hot-news/db run migrate-sp4
[ ] CI 全绿（lint + typecheck + build + test，含 ~30 个新测试 case）
[ ] 本地 pnpm dev → worker 日志含 "REDDIT crawled: ... hidden=N"（N 为新过滤数）
[ ] curl localhost:3001/hot-news?pageSize=200 | jq '.items[].status' → 仅 ["VISIBLE"]
[ ] docker exec ... psql -c "SELECT filter_reason, COUNT(*) FROM hot_news WHERE status='HIDDEN' GROUP BY filter_reason"
    → 看到合理分布
[ ] pnpm db:migrate-sp4 跑一次（本地）→ 报告含 Layer 1 / Layer 2 stats
[ ] pnpm db:migrate-sp4 跑第二次 → 报告全 0 (幂等验证)
[ ] open localhost:3000/news → 看不到 ratio<0.5 的低分 reddit 帖
[ ] push 到 main → CI 通过 → deploy.yml 自动执行 prisma migrate deploy（filter_reason 列加上）
[ ] **手工**：ssh 到 VPS 跑一次 backfill：
    ssh deploy@<vps>
    cd /srv/ai-hot-news && pnpm db:migrate-sp4
    # 报告（Layer 1/2 stats）写进 commit message 或 decomposition spec §11 状态追踪
[ ] curl https://<domain>/api/hot-news?pageSize=200 | jq '.items | length'
    → 数量 < 历史总数（HIDDEN 被过滤）
[ ] decomposition spec §6 + §11 回写：SP-4 完成 + 决策日志加 §5 的 8 条决策
[ ] decomposition spec §11 状态追踪表加 SP-4 行（commit 范围、产出特征、对后续 SP 的契约影响）
```

---

## 11. 后续步骤

本 spec 经用户审阅批准后：

1. 调用 `writing-plans` skill，把本 spec 转化为 step-by-step 实施计划文档（`docs/superpowers/plans/2026-05-XX-sp4-content-cleaning-dedup-plan.md`）
2. 计划文档审阅通过后，进入 SP-4 实施
3. SP-4 完成（Checklist 全打勾）后：
   - **回写 decomposition spec §6 + §11**：标记 SP-4 完成 + 把 §6 SP-4 行从"⏳"改"✅"
   - **回写决策日志**：8 条 SP-4 决策（§5）
   - 启动 **下一阶段**：按 decomposition spec 路线，下一个最优是 **SP-5（AI 摘要 + aiTags）**——因为：
     - 维度 3 主题相关性的解决方案在 SP-5
     - SP-5 的 aiTags 是 SP-7 跨平台合并的输入之一
     - 用户体验立刻改善（"非主题但高分"内容会消失）
   - 或并行启动 **SP-4.5 ArticleExtractor**（独立 spec）：因为 SP-5 摘要 link-post 时需要外链正文，ArticleExtractor 是 SP-5 的前置依赖
