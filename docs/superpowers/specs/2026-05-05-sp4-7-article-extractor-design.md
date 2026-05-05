# SP-4.7 — ArticleExtractor（HN/Reddit 外链正文抽取）

- **状态**：spec 待用户审核
- **依赖**：
  - SP-2（HackerNews crawler，`interactionData.externalUrl` 字段约定）
  - SP-3（Reddit crawler，`interactionData.externalUrl` 同 HN 约定，self-post 已不带 externalUrl）
  - SP-4（IngestionService 入库流水线 / `status='HIDDEN'` + `filterReason` 契约）
  - SP-4.5（API window + status=VISIBLE 默认过滤；本 SP 不破坏）
  - 一次性脚本范式（`scripts/run-prod-oneshot.sh` + worker image + 包名 import；详见 SP-4 §10 决策 11）
- **被依赖**：SP-5（消费 link-post 真正文做摘要；本 SP 与 SP-5 通过"重摘信号"解耦，详见 §0.2）
- **本文件**：`docs/superpowers/specs/2026-05-05-sp4-7-article-extractor-design.md`
- **预计工作量**：~2-2.5 天（独立 worker / 队列 / Firecrawl + Jina chain / +2 列 schema migration / wipe 脚本 / 单元 + 集成测试）

---

## 0. 关键设计原则与边界

### 0.1 SP-4.7 只做"link-post 外链正文抽取"

**输入**：`HotNews` 行满足 `interactionData.externalUrl != null AND content == title`（SP-3 留下的 link-post 哨兵）。

**输出**：UPDATE 同一行 `content` = 外链文章主体纯文本、`rawHtml` = 外链文章 HTML、`extractStatus = 'EXTRACTED'`。**同时**置 `summary = NULL` + `aiTags = []`，并 push 一条 `summary:<id>` 消息进 SP-5 队列触发重摘。

**不做**：

- ❌ 入库时同步抓正文（会阻塞 BullMQ worker，crawl scheduler 全乱）
- ❌ 抓 self-post 正文（Reddit `is_self=true` SP-3 已写完整 selftext_html，HN ask/show 也写了 text）
- ❌ 抓评论树（评论摘要消费者不存在；如果 SP-5 后续需要可独立 SP）
- ❌ 抓多媒体（图片描述 / 视频 transcribe → YAGNI）
- ❌ 改 link-post 的 `title`（即使 Firecrawl 返回更准的标题也不覆盖；title 列在整个生命周期保持 SP-3 拿到的原 post 标题）

### 0.2 与 SP-5 的契约（解耦点）

| 维度 | SP-4.7 | SP-5 |
|---|---|---|
| 触发 | ingest 阶段哨兵命中 → push `extract:<id>` | ingest 阶段无条件 push `summary:<id>`（status=VISIBLE 行）；SP-4.7 抽取成功后**再次** push 同 id |
| 写入字段 | `content` / `rawHtml` / `extractStatus` / `extractAttempts` | `summary` / `aiTags` |
| 触发对方 | 抽取成功后 enqueue `summary:<id>`（重摘信号） | 不触发 SP-4.7（SP-5 永远只读 `content`） |
| 等待对方 | 不等。link-post 第一次摘要时 SP-4.7 可能还没跑完，会基于 `content == title` 出 degraded 摘要；SP-4.7 跑完后 `summary=NULL` 重新入队，SP-5 再跑一次出真摘要 |
| 失败传染 | SP-4.7 永久失败（`extractStatus='FAILED'`）→ SP-5 仍会基于 `content == title` 出 degraded 摘要并保留；不阻塞 |

**桥接哲学**：`HotNews.content` 是**单一事实源**，永远指向"当前最佳可用文本"。SP-4.7 负责把它从 title 升级到真正文，升级时清掉 `summary` / `aiTags` 让 SP-5 重算。两 SP 通过这个 shared mutable column + queue message 解耦，编码上互不依赖、可任意先后 ship。

### 0.3 三方 SaaS 优先 vs 本地解析的取舍

**选**：Firecrawl Cloud API 优先 + Jina r.jina.ai fallback。**不选** `@mozilla/readability + jsdom` 本地解析。

理由：

| 维度 | 三方 SaaS | 本地 readability+jsdom |
|---|---|---|
| Worker CPU | 仅 fetch + JSON parse | jsdom parse ~30-50MB / page，concurrency 受限 |
| Image 增量 | 0 | ~5MB |
| SPA / JS 渲染 | Firecrawl 内置 Playwright，覆盖现代 React/Next 单页博客 | 不渲染，遇 SPA 失败 |
| 成本 | Firecrawl free 500 页/月 + Jina free 1M tok/月 = 月度覆盖 ~25-35% 流量 | $0 |
| 隐私 | URL 全部外发给两家 | 0 外发 |
| 失败模式 | 三方挂 / quota 用尽 | 启发式失误 |
| 个人项目优先级 | ✅ 加快 ship + 鲁棒性更高 | ❌ 个人长期工具维护 jsdom 边界场景成本高 |

接受的 trade-off：当 Firecrawl 月 quota 用尽 + Jina 也用尽时，剩余 link-post `extractStatus='FAILED'`，SP-5 基于 title 出 degraded 摘要。预估月度 link-post 量 ~70-130/天 × 30 天 = ~2100-3900/月，free 配额覆盖约 25-35%，**预算用尽后接受跳过**（不付费）。

### 0.4 与 SP-4 / SP-4.5 的边界

- **不动** SP-4 的 `filterReason` / `status` 写入逻辑（在 IngestionService `prisma.create` 之前；本 SP 加的逻辑在 `prisma.create` **之后**，事务内追加 update + queue add）
- **不动** SP-4.5 的 `RSS_INGEST_WINDOW_MS` / `PLATFORM_WINDOW_HOURS` / `DEFAULT_PLATFORMS`
- **不动** RSS 链路（RSS feed item 已经自带 contentText，crawler 阶段就填好；不会进入 link-post 哨兵）
- **不动** `dedupeHash` 算法（虽然 SP-4.7 会修改 `content`，但 `dedupeHash = sha256(sourceUrl + cleanTitle)` 不依赖 content，hash 不会因抽取而变化）

---

## 1. 目标、范围与验收标准

### 1.1 目标

为 SP-3 留下的 link-post 哨兵（`interactionData.externalUrl != null AND content == title`）提供异步、可降级、可观测的外链正文抽取能力，使 SP-5 摘要 + aiTags 能基于真正文工作；同时不影响 ingest 主链路吞吐和 SP-4 / SP-4.5 已交付契约。

### 1.2 In-scope

| 模块 | 内容 |
|---|---|
| `packages/db/prisma/schema.prisma` | `HotNews` 加 `extractStatus String?` + `extractAttempts Int @default(0)`；新 migration `_sp4_7_extract_status` |
| `packages/db/scripts/wipe-hot-news-pre-ai.ts`（新增） | AI 阶段开机一次性脚本：`prisma.hotNews.deleteMany({})`，wipe 历史所有 hot_news；与 SP-5 共用 |
| `apps/worker/src/extract/`（新增模块） | `extract.module.ts` / `extract.queue.ts` / `extract.processor.ts` / `extract.service.ts` / `providers/{provider.interface,firecrawl,jina,chain}.ts` + 单测 |
| `apps/worker/src/extract/extract.queue.ts` | BullMQ queue `extract` + 独立 Worker（concurrency=2）+ providers token |
| `apps/worker/src/crawl/ingestion.service.ts` | 入库后追加：哨兵命中 → 同事务 update `extractStatus='PENDING'` → push `extract:<id>` |
| `apps/worker/src/crawl/crawl.module.ts` | imports `ExtractModule` 拿到 `EXTRACT_QUEUE` token，注入 `IngestionService` 用于 enqueue |
| `apps/worker/src/extract/providers/firecrawl.provider.ts` | 调 Firecrawl `/v1/scrape`，返 `markdown` + `html`，处理 402/429/4xx/5xx |
| `apps/worker/src/extract/providers/jina.provider.ts` | 调 `https://r.jina.ai/<url>`（带 `Accept: application/json`），返 `content`，处理 402/429/4xx/5xx |
| `apps/worker/src/extract/providers/chain.ts` | Firecrawl → Jina 顺序 fallback；`PermanentFetchError` 立即抛出；抽到 < 200 字算失败试下一家 |
| `apps/worker/src/extract/extract.service.ts` | 主流程：拉 row → check status → chain.extract → UPDATE content+rawHtml+summary=NULL+aiTags=[]+extractStatus → push `summary:<id>`；失败时累 attempts，attempts ≥ 3 或 PermanentFetchError 时置 'FAILED' |
| `apps/worker/src/extract/extract.processor.ts` | BullMQ job processor，调 ExtractService.run |
| Worker boot backstop | `WHERE extractStatus='PENDING'` orphan scan，重新入队（处理 worker 上次崩溃漏队的 job） |
| `.env.example` | 加 `FIRECRAWL_API_KEY` / `JINA_API_KEY` 占位 |
| `apps/worker/src/summarize/summarize.queue.ts`（**条件性**） | **如果 SP-4.7 在 SP-5 之前 ship**：SP-4.7 创建 stub 版本（仅 SUMMARY_QUEUE token + queueProvider，无 worker）。**如果 SP-5 已 ship**：SP-5 已经创建好该文件，SP-4.7 只 import 不修改。详见 §4.13 |
| `apps/worker/src/summarize/summarize.module.ts`（**条件性**） | 同上：stub 仅 export SUMMARY_QUEUE，让 ExtractModule `imports: [SummarizeModule]` 拿到 token。SP-5 ship 时把 worker / service / strategy / processor 加进同一 module |

**单元 + 集成测试预算**：

- `firecrawl.provider.spec.ts`（5 case：200 / 402 / 429 / 404 / 5xx mock fetch）
- `jina.provider.spec.ts`（4 case：200 / 402 / 404 / 网络错）
- `chain.spec.ts`（4 case：第一家成功 / 第一家 quota → 第二家成功 / 都 quota / PermanentFetchError 立即抛）
- `extract.service.spec.ts`（4 case：成功 UPDATE + 触发重摘 / 永久失败标 FAILED / attempts 累加 / 已 EXTRACTED 跳过）
- `extract.processor.spec.ts`（2 case：BullMQ job → service 流转 / 失败抛错让 BullMQ retry）
- `ingestion.service.integration.spec.ts` 加 case：HN link-post → 入队 + extractStatus=PENDING；HN self-post → 不入队
- `wipe-hot-news-pre-ai.spec.ts`（2 case：清空 hot_news / 不动 source_configs）

合计 **~22 case**。

### 1.3 Out-of-scope（明确不做）

- ❌ 抽取多媒体（图片 OCR / 视频 transcribe）
- ❌ per-host rate limiting（Firecrawl/Jina 自己负责礼貌抓取）
- ❌ robots.txt 检查（同上）
- ❌ User-Agent 池（我们只调 SaaS）
- ❌ 自适应 quota 探测（pre-check `/v1/team/credit-usage`）— 每次试 + 失败 fallback 已够好
- ❌ 抽取 dashboard / 监控页 — 用 SQL 查 `extractStatus` 分布即可
- ❌ 评论树抽取
- ❌ self-post（Reddit `is_self=true` 或 HN ask/show）的二次抓取 — SP-3 已写好 selftext_html / text
- ❌ 抽取后的二次清洗（去广告 / 去推广）— trust 三方输出
- ❌ Firecrawl self-hosted（接受 cloud API + free quota）
- ❌ FAILED 行的自动重试 cron — 人工 SQL 重置 `extractStatus='PENDING' AND extractAttempts=0` 即可
- ❌ HotNews.title 覆盖（即使 Firecrawl 返回更准确的标题也保留 SP-3 原 title）
- ❌ extractStatus 暴露在 `/api/hot-news` DTO（诊断字段，不上前端）

### 1.4 硬验收标准

```bash
# === 单元 + 集成测试全绿 ===
pnpm turbo run lint typecheck build test
# 期望含新增 ~22 case 全绿

# === migration 落库 ===
pnpm db:migrate:dev
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c "\d hot_news" | grep -E 'extractStatus|extractAttempts'
# 期望两列出现

# === 本地 dev 端到端 ===
echo "FIRECRAWL_API_KEY=fc-xxx" >> .env
echo "JINA_API_KEY=jina_xxx" >> .env  # 可选
pnpm dev

# 等 ~5-7 分钟（HN top 抓取 + 至少一个 link-post 进入 extract 队列）
# Worker 日志期望含：
#   "[Extract] hotNewsId=cm... url=https://blog.example.com/x → EXTRACTED via firecrawl (1834 chars)"

# === DB 直查 extractStatus 分布 ===
docker exec ... -c "SELECT \"extractStatus\", COUNT(*) FROM hot_news GROUP BY 1"
# 期望：null（self-post / RSS）+ EXTRACTED + 少量 PENDING（in-flight）；FAILED < 10%

# === content 真的被覆盖 ===
docker exec ... -c "SELECT \"extractStatus\", LENGTH(title) AS tlen, LENGTH(content) AS clen FROM hot_news WHERE \"extractStatus\"='EXTRACTED' LIMIT 5"
# 期望：所有 EXTRACTED 行 clen >> tlen（content 是真正文，不是 title 兜底）

# === Quota fallback 验证（人工触发）===
# 临时把 FIRECRAWL_API_KEY 设为无效值 → 重启 worker → 观察 chain fallback Jina
# Worker 日志应含 "firecrawl 401 ... → fallback jina"

# === DB 不变量验证 ===
# 不变量 1: SP-4 的 filterReason / status 关系仍成立
docker exec ... -c "SELECT COUNT(*) FROM hot_news WHERE status='VISIBLE' AND \"filterReason\" IS NOT NULL"
# 期望: 0

# 不变量 2: extractStatus 状态机一致
docker exec ... -c "SELECT COUNT(*) FROM hot_news WHERE \"extractStatus\"='EXTRACTED' AND content = title"
# 期望: 0（EXTRACTED 必然 content != title）

# === wipe 脚本验证（pre-AI 一次性）===
pnpm --filter @ai-hot-news/db run test
# 期望 wipe-hot-news-pre-ai.spec.ts 2/2 绿

# === CI ===
# .github/workflows/ci.yml 全绿（含新加单元 + 集成测试）

# === 部署后（push 到 main 触发 deploy.yml）===
# deploy.sh 自动跑 prisma migrate deploy → _sp4_7_extract_status 落库
# deploy.sh 自动 restart worker → ExtractModule 加载、boot backstop 跑

# 部署 + wipe 完成后 ~30 分钟：
curl https://hotnews.shinpeionline.top/api/hot-news?platforms=HACKERNEWS&pageSize=5 | jq '.items[].sourceUrl'
# 看一个 HN link-post 的 sourceUrl，然后 SQL 查它的 content：
# 期望: content 是真正文（500-5000 字），不再是 title 兜底
```

### 1.5 不会修改的内容

- 不动 SP-0 monorepo 结构、Docker Compose 拓扑、CI 矩阵
- 不动 Prisma schema 其他字段（仅加 2 列）
- 不改 `Platform` enum
- 不改 `Crawler` interface / `RawCrawledItem` 类型
- 不改 BullMQ `crawl` 队列 / scheduler 频率 / SourceConfig 表结构
- 不改 `apps/web` 任何文件（API 不暴露 extractStatus）
- 不改 `apps/api`（HotNewsService 不读 extractStatus）
- 不改 SP-4 / SP-4.5 的 ingest cleanup / cutoff / window 逻辑
- 不改 deploy.sh（一次性 wipe 是手工 SSH 操作，不进自动链路）

---

## 2. 架构与数据流

### 2.1 数据流（与 SP-3 / SP-4 / SP-4.5 现状对比）

```text
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                            crawler (HN / Reddit / RSS)                               │
│                                       │                                              │
│                                       ▼                                              │
│  IngestionService.ingest():                                                          │
│    (前置不变) cutoff window → cleanTitle/cleanContent → dedupeHash → quality verdict   │
│                                       │                                              │
│                                       ▼                                              │
│    prisma.hotNews.create({ status, filterReason, content, rawHtml, ... })            │
│                                       │                                              │
│                  ┌────────────────────┴────────────────────┐                         │
│                  │                                         │                         │
│                  ▼                                         ▼                         │
│   isLinkPost (新增):                          status=VISIBLE 总是入 summary:        │
│   externalUrl != null AND                     await summaryQueue.add(                │
│   content == title                                'summarize',                       │
│                  │                                { hotNewsId },                     │
│                  ▼                                { jobId: 'summarize-<id>' });      │
│   await prisma.hotNews.update({                                                      │
│     where: { id }, data: {                                                           │
│       extractStatus: 'PENDING' }});                                                  │
│   await extractQueue.add(                                                            │
│     'extract', { hotNewsId },                                                        │
│     { jobId: 'extract-<id>',                                                         │
│       attempts: 3,                                                                   │
│       backoff: exponential 60s });                                                   │
└──────────────────────────────────────────────────────────────────────────────────────┘
                       │                                            │
                       ▼                                            ▼
            BullMQ queue 'extract'                       BullMQ queue 'summary'
                       │                                            │
                       ▼                                            ▼
            ┌──────────────────────────────┐          ┌─────────────────────────────┐
            │ SP-4.7 worker (concurrency=2)│          │ SP-5 worker (concurrency=3) │
            │ ExtractService.run(id):      │          │ SummarizeService.run(id):   │
            │  1. row = findUnique(id)     │          │  ...（详 SP-5 spec）         │
            │  2. if EXTRACTED/FAILED skip │          └─────────────────────────────┘
            │  3. url = extUrl from JSON   │
            │  4. chain.extract(url):      │
            │       try Firecrawl          │
            │       on quota → Jina        │
            │       on PermanentErr → 抛   │
            │       on 太短 → next         │
            │  5a. 成功:                    │
            │      UPDATE content,         │
            │             rawHtml,         │
            │             summary=NULL,    │
            │             aiTags=[],       │
            │             extractStatus='EXTRACTED', │
            │             extractAttempts++│
            │      summaryQueue.add('summarize', {id})│
            │  5b. 失败:                    │
            │      UPDATE extractStatus =  │
            │        (attempts+1>=3 || perm)│
            │          ? 'FAILED'          │
            │          : 'PENDING'         │
            │      attempts++              │
            │      if PENDING: throw → BMQ retry │
            └──────────────────────────────┘
```

### 2.2 状态机（`HotNews.extractStatus`）

```text
                              ┌─────────────┐
   非 link-post (RSS / self-) │             │ ← 终态
   ────────────────────────▶ │  null       │
                              └─────────────┘

   link-post 入库 (ingest 同事务):       ┌─────────────┐
   externalUrl != null && ───────────▶  │ 'PENDING'   │
   content == title                     │             │
                                        └──────┬──────┘
                                               │ worker 拉到 → fetch + 抽取
                                               │
                              ┌────────────────┴────────────────┐
                              │ 成功（contentText >= 200 字符）  │ 失败
                              ▼                                 ▼
                       ┌─────────────┐                ┌──────────────────┐
                       │ 'EXTRACTED' │                │ 'PENDING' (retry)│
                       │             │                │ extractAttempts++│
                       └─────────────┘                └────────┬─────────┘
                            ▲                                  │
                            │                                  │ attempts >= 3
                            │                                  │  OR PermanentFetchError
                            │                                  ▼
                            │                          ┌──────────────────┐
                            └──────────────────────────│ 'FAILED'         │
                            人工 SQL: UPDATE             │ (终态，不再重试)  │
                            extractStatus='PENDING',     └──────────────────┘
                            extractAttempts=0
```

### 2.3 与 ingest 主链路的关系

ingest 现有流水线（SP-4 完工形态）：

```text
crawler.fetch() → IngestionService.ingest() →
  cutoff → clean → dedupeHash → quality verdict →
  prisma.hotNews.create({ status, filterReason, ... }) →
  返回 IngestResult
```

SP-4.7 新增的扩展点**只在 `prisma.hotNews.create` 成功之后**：

```text
... → prisma.hotNews.create() → created row
                                  │
                                  ▼
              （SP-4.7 新增）isLinkPost(created)?
                                  │
                            ┌─────┴─────┐
                            │ yes        │ no
                            ▼            ▼
              update extractStatus='PENDING'  pass
              + extractQueue.add(...)
                            │
                            ▼
              （SP-5 入队，不是 SP-4.7 责任 — 写在 SP-5 spec）
              if status=VISIBLE: summaryQueue.add(...)
```

由于 BullMQ `add()` 是 Redis 写入（毫秒级），不会显著延长 ingest 路径。`prisma.update + queue.add` 不在同一 DB 事务里 — 接受弱一致：worker 重启后 boot backstop 扫 `extractStatus='PENDING'` 重入队，幂等性靠 `jobId='extract-<id>'`。

---

## 3. 数据模型变更

### 3.1 新加字段

```prisma
model HotNews {
  // ... existing fields preserved verbatim ...

  filterReason    String?       // SP-4 既有

  // SP-4.7 新增
  extractStatus   String?       // null | 'PENDING' | 'EXTRACTED' | 'FAILED'
  extractAttempts Int @default(0)

  // ... rest unchanged ...

  @@index([publishedAt(sort: Desc)])
  @@index([heatScore(sort: Desc)])
  @@index([groupId])
  @@index([sourcePlatform, publishedAt])
  // SP-4.7 新增 partial index：worker boot scan + cron backstop 扫 PENDING/FAILED
  // 不在 prisma 直接写 partial index，靠 SQL migration 直接 CREATE
}
```

### 3.2 Migration SQL

`packages/db/prisma/migrations/<ts>_sp4_7_extract_status/migration.sql`：

```sql
-- SP-4.7: track ArticleExtractor state per HotNews row
ALTER TABLE "hot_news"
  ADD COLUMN "extractStatus"   TEXT,
  ADD COLUMN "extractAttempts" INTEGER NOT NULL DEFAULT 0;

-- Partial index: worker boot scan looks at PENDING + FAILED only.
-- VISIBLE/EXTRACTED rows (the vast majority) skip the index.
CREATE INDEX "hot_news_extract_pending_idx"
  ON "hot_news" ("extractStatus")
  WHERE "extractStatus" IN ('PENDING', 'FAILED');
```

### 3.3 不变量（写入路径必须维护）

1. `extractStatus = 'EXTRACTED'` 蕴含 `content != title`（抽到了真正文）
2. `extractStatus = 'PENDING'` 蕴含 row 已或正在被 extractQueue 处理（worker boot backstop 保证）
3. `extractStatus IS NULL` 蕴含 row 不是 link-post（**或** SP-4.7 上线之前入库的历史行 — 但历史会被 wipe 清掉）
4. `extractAttempts >= 1` 蕴含 worker 至少跑过一次

API 默认行为不变（`GET /hot-news` 仍只 `WHERE status='VISIBLE'`），不查 `extractStatus`。

---

## 4. 模块布局与详细实现

### 4.1 Worker 模块树

```
apps/worker/src/extract/
├── extract.module.ts                  (NestJS Module: providers + worker + boot backstop)
├── extract.queue.ts                   (Queue/Worker 工厂 — 与 crawl/queue.provider.ts 风格一致)
├── extract.processor.ts               (BullMQ job processor → ExtractService.run)
├── extract.service.ts                 (核心：拉 row → chain → UPDATE → 触发重摘)
├── providers/
│   ├── provider.interface.ts          (export interface ExtractProvider + 自定义 Error 类型)
│   ├── firecrawl.provider.ts          (Firecrawl /v1/scrape client)
│   ├── jina.provider.ts               (r.jina.ai client)
│   ├── chain.ts                       (Firecrawl → Jina fallback)
│   └── *.spec.ts
├── extract.service.spec.ts
├── extract.processor.spec.ts
└── extract.module.spec.ts             (boot backstop 行为)
```

### 4.2 队列 / Worker DI（参照 `crawl/queue.provider.ts`）

```ts
// extract.queue.ts
import { Provider } from '@nestjs/common';
import { Queue, Worker, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';

export const EXTRACT_QUEUE_NAME = 'extract';
export const EXTRACT_QUEUE = Symbol('EXTRACT_QUEUE');
export const EXTRACT_WORKER = Symbol('EXTRACT_WORKER');

export const extractQueueProvider: Provider = {
  provide: EXTRACT_QUEUE,
  useFactory: (connection: IORedis): Queue =>
    new Queue(EXTRACT_QUEUE_NAME, { connection: connection as unknown as ConnectionOptions }),
  inject: [REDIS_CONNECTION],
};

export function createExtractWorker(
  processor: (jobName: string, jobData: unknown) => Promise<void>,
  connection: IORedis,
): Worker {
  return new Worker(
    EXTRACT_QUEUE_NAME,
    async (job) => processor(job.name, job.data),
    { connection: connection as unknown as ConnectionOptions, concurrency: 2 },
  );
}
```

`concurrency: 2` 因 Firecrawl free 单 IP 并发限制 ~2 + 我们不想压到上限。生产可由 env 调（`EXTRACT_CONCURRENCY=2`）。

### 4.3 Provider 接口

```ts
// providers/provider.interface.ts
export interface ExtractedArticle {
  contentText: string;        // 纯文本主体（已剥 nav/ads/footer）
  rawHtml: string | null;     // 可选 HTML（Firecrawl 返；Jina 不返）
  /**
   * 三方可能返回更准确的标题；SP-4.7 不强制覆盖 HotNews.title。
   * 仅作为日志 / 调试观察用，extract.service 也不消费。
   */
  title?: string | null;
}

export interface ExtractProvider {
  readonly name: 'firecrawl' | 'jina';
  extract(url: string, signal: AbortSignal): Promise<ExtractedArticle>;
}

/**
 * 三类错误用于 chain.ts 的不同 fallback 决策：
 *  - QuotaExceededError    → fallback 到下一 provider
 *  - TransientFetchError   → fallback；都失败时让 BullMQ retry
 *  - PermanentFetchError   → 立即终止整个 chain（4xx 不会变成 200）
 */
export class QuotaExceededError extends Error {
  constructor(public provider: 'firecrawl' | 'jina') {
    super(`${provider} quota / rate exceeded`);
    this.name = 'QuotaExceededError';
  }
}
export class TransientFetchError extends Error {
  constructor(message: string) { super(message); this.name = 'TransientFetchError'; }
}
export class PermanentFetchError extends Error {
  constructor(message: string) { super(message); this.name = 'PermanentFetchError'; }
}
```

### 4.4 Firecrawl Provider

`https://api.firecrawl.dev/v1/scrape`，POST：

| HTTP Status | 行为 |
|---|---|
| 200 | parse `data.data.markdown` (主) + `data.data.html` (raw) + `data.data.metadata.title` |
| 402 | `QuotaExceededError('firecrawl')`（payment required = quota out） |
| 429 | `QuotaExceededError('firecrawl')`（rate limit，对我们等价于 quota 用尽，fallback 即可） |
| 401 / 403 | `PermanentFetchError`（API key 失效，不该 retry） |
| 404 / 410 | `PermanentFetchError`（外链不存在） |
| 5xx | `TransientFetchError`（chain 试 Jina；都失败让 BullMQ retry） |

```ts
// providers/firecrawl.provider.ts
import {
  ExtractProvider,
  ExtractedArticle,
  QuotaExceededError,
  TransientFetchError,
  PermanentFetchError,
} from './provider.interface';

export class FirecrawlProvider implements ExtractProvider {
  readonly name = 'firecrawl' as const;

  async extract(url: string, signal: AbortSignal): Promise<ExtractedArticle> {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY not configured');

    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'html'],
        onlyMainContent: true,
      }),
      signal,
    });

    if (res.status === 402 || res.status === 429) {
      throw new QuotaExceededError('firecrawl');
    }
    if (res.status === 401 || res.status === 403) {
      throw new PermanentFetchError(`firecrawl auth ${res.status}`);
    }
    if (res.status === 404 || res.status === 410) {
      throw new PermanentFetchError(`firecrawl ${res.status}`);
    }
    if (!res.ok) {
      throw new TransientFetchError(`firecrawl ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      data?: { markdown?: string; html?: string; metadata?: { title?: string } };
    };
    const markdown = data?.data?.markdown ?? '';
    const html = data?.data?.html ?? null;
    const title = data?.data?.metadata?.title ?? null;

    return { contentText: markdown, rawHtml: html, title };
  }
}
```

### 4.5 Jina Provider

`https://r.jina.ai/<url>`，GET，header `Accept: application/json` 拿 JSON 而非 raw markdown：

| HTTP Status | 行为 |
|---|---|
| 200 | parse `data.data.content` |
| 402 / 429 | `QuotaExceededError('jina')` |
| 404 / 410 | `PermanentFetchError` |
| 5xx | `TransientFetchError` |

```ts
// providers/jina.provider.ts
import { ExtractProvider, ExtractedArticle, QuotaExceededError,
  TransientFetchError, PermanentFetchError } from './provider.interface';

export class JinaProvider implements ExtractProvider {
  readonly name = 'jina' as const;

  async extract(url: string, signal: AbortSignal): Promise<ExtractedArticle> {
    const apiKey = process.env.JINA_API_KEY; // 可选；匿名 rate 较低
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal,
    });

    if (res.status === 402 || res.status === 429) {
      throw new QuotaExceededError('jina');
    }
    if (res.status === 404 || res.status === 410) {
      throw new PermanentFetchError(`jina ${res.status}`);
    }
    if (!res.ok) {
      throw new TransientFetchError(`jina ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      data?: { content?: string; title?: string };
    };
    const content = data?.data?.content ?? '';
    const title = data?.data?.title ?? null;

    return { contentText: content, rawHtml: null, title };
  }
}
```

### 4.6 Chain（Fallback 编排）

```ts
// providers/chain.ts
import {
  ExtractProvider,
  ExtractedArticle,
  PermanentFetchError,
  TransientFetchError,
  QuotaExceededError,
} from './provider.interface';

const MIN_CONTENT_LENGTH = 200; // 抽到太短当作失败
const TOTAL_TIMEOUT_MS = 45_000;

export interface ChainResult {
  result: ExtractedArticle;
  usedProvider: 'firecrawl' | 'jina';
}

export class ExtractChain {
  constructor(private readonly providers: ExtractProvider[]) {}

  async extract(url: string): Promise<ChainResult> {
    const signal = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
    let lastErr: Error | null = null;

    for (const p of this.providers) {
      try {
        const result = await p.extract(url, signal);
        if (!result.contentText || result.contentText.length < MIN_CONTENT_LENGTH) {
          lastErr = new TransientFetchError(
            `${p.name} content too short (${result.contentText.length} chars)`,
          );
          continue;
        }
        return { result, usedProvider: p.name };
      } catch (err) {
        lastErr = err as Error;
        // PermanentFetchError 立即终止整个 chain（4xx 不会因 fallback 变 200）
        if (err instanceof PermanentFetchError) throw err;
        // QuotaExceededError / TransientFetchError → 继续 next provider
      }
    }
    throw lastErr ?? new TransientFetchError('All providers failed');
  }
}
```

### 4.7 ExtractService（核心流程）

```ts
// extract.service.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { getPrisma } from '@ai-hot-news/db';
import { ExtractChain } from './providers/chain';
import { PermanentFetchError } from './providers/provider.interface';
import { SUMMARY_QUEUE } from '../summarize/summarize.queue'; // SP-5 提供

const MAX_ATTEMPTS = 3;

@Injectable()
export class ExtractService {
  private readonly logger = new Logger(ExtractService.name);

  constructor(
    private readonly chain: ExtractChain,
    @Inject(SUMMARY_QUEUE) private readonly summaryQueue: Queue,
  ) {}

  async run(hotNewsId: string): Promise<void> {
    const prisma = getPrisma();
    const row = await prisma.hotNews.findUnique({
      where: { id: hotNewsId },
      select: {
        id: true,
        title: true,
        content: true,
        extractStatus: true,
        extractAttempts: true,
        interactionData: true,
      },
    });
    if (!row) {
      this.logger.warn(`Row ${hotNewsId} not found, skip`);
      return;
    }
    if (row.extractStatus === 'EXTRACTED') return;
    if (row.extractStatus === 'FAILED') return;

    const url = (row.interactionData as { externalUrl?: string } | null)?.externalUrl;
    if (!url || typeof url !== 'string' || !/^https?:/.test(url)) {
      // 边界：哨兵被破坏（人工改了 interactionData）→ 标 null 跳过
      await prisma.hotNews.update({
        where: { id: hotNewsId },
        data: { extractStatus: null },
      });
      return;
    }

    try {
      const { result, usedProvider } = await this.chain.extract(url);
      const cleanText = this.cleanText(result.contentText);

      await prisma.hotNews.update({
        where: { id: hotNewsId },
        data: {
          content: cleanText,
          rawHtml: result.rawHtml,
          summary: null,    // 重摘信号
          aiTags: [],       // 重摘信号
          extractStatus: 'EXTRACTED',
          extractAttempts: row.extractAttempts + 1,
        },
      });

      // 重摘入队（jobId 自然幂等）
      await this.summaryQueue.add(
        'summarize',
        { hotNewsId },
        {
          jobId: `summarize-${hotNewsId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );

      this.logger.log(
        `Extracted ${url} via ${usedProvider} (${cleanText.length} chars), re-summarize queued`,
      );
    } catch (err) {
      const attempts = row.extractAttempts + 1;
      const isPermanent = err instanceof PermanentFetchError;
      const reachedLimit = attempts >= MAX_ATTEMPTS;
      const finalStatus = (isPermanent || reachedLimit) ? 'FAILED' : 'PENDING';

      await prisma.hotNews.update({
        where: { id: hotNewsId },
        data: {
          extractStatus: finalStatus,
          extractAttempts: attempts,
        },
      });

      const msg = (err as Error).message;
      if (finalStatus === 'PENDING') {
        this.logger.warn(`Extract attempt ${attempts}/${MAX_ATTEMPTS} failed for ${url}: ${msg}, will retry`);
        throw err; // 让 BullMQ 重试（exponential backoff 60s）
      }
      this.logger.warn(`Extract permanently failed for ${url} (${attempts}/${MAX_ATTEMPTS}): ${msg}`);
      // FAILED 终态，不抛 → BullMQ 看作 success 不重试
    }
  }

  private cleanText(raw: string): string {
    // 折叠 3+ 连续换行 → 2 个；去首尾空白；最长截到 50K（防极端长文）
    return raw
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 50_000);
  }
}
```

### 4.8 ExtractProcessor

```ts
// extract.processor.ts
import { Logger } from '@nestjs/common';
import { ExtractService } from './extract.service';

const logger = new Logger('ExtractProcessor');

export interface ExtractJobData {
  hotNewsId: string;
}

export async function processExtractJob(
  data: ExtractJobData,
  service: ExtractService,
): Promise<void> {
  await service.run(data.hotNewsId);
}
```

### 4.9 ExtractModule（含 boot backstop）

```ts
// extract.module.ts
import {
  Module, OnModuleDestroy, OnApplicationBootstrap, Inject, Logger,
} from '@nestjs/common';
import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { getPrisma } from '@ai-hot-news/db';
import { REDIS_CONNECTION } from '../crawl/queue.provider';
import { ExtractService } from './extract.service';
import {
  EXTRACT_QUEUE,
  EXTRACT_QUEUE_NAME,
  EXTRACT_WORKER,
  createExtractWorker,
  extractQueueProvider,
} from './extract.queue';
import { processExtractJob, type ExtractJobData } from './extract.processor';
import { FirecrawlProvider } from './providers/firecrawl.provider';
import { JinaProvider } from './providers/jina.provider';
import { ExtractChain } from './providers/chain';
import { SummarizeModule } from '../summarize/summarize.module';

@Module({
  imports: [SummarizeModule], // 拿到 SUMMARY_QUEUE token
  providers: [
    extractQueueProvider,
    {
      provide: ExtractChain,
      useFactory: () => new ExtractChain([new FirecrawlProvider(), new JinaProvider()]),
    },
    ExtractService,
    {
      provide: EXTRACT_WORKER,
      useFactory: (connection: IORedis, service: ExtractService): Worker => {
        const worker = createExtractWorker(
          async (_jobName, jobData) =>
            processExtractJob(jobData as ExtractJobData, service),
          connection,
        );
        worker.on('failed', (job, err) => {
          new Logger('ExtractWorker').error(
            `Job ${job?.id ?? '<no-id>'} failed: ${err.message}`,
          );
        });
        return worker;
      },
      inject: [REDIS_CONNECTION, ExtractService],
    },
  ],
  exports: [EXTRACT_QUEUE], // CrawlModule 需要 push 入队
})
export class ExtractModule
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ExtractModule.name);

  constructor(
    @Inject(EXTRACT_QUEUE) private readonly queue: Queue,
    @Inject(EXTRACT_WORKER) private readonly worker: Worker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Boot backstop: 上次 worker 崩前可能有些 row 已经 update extractStatus='PENDING'
    // 但 queue.add 失败了，或者 BullMQ 任务已被 obliterate；扫一遍重新入队。
    // 幂等：jobId='extract-<id>' 让 BullMQ 跳重复。
    const orphans = await getPrisma().hotNews.findMany({
      where: { extractStatus: 'PENDING' },
      select: { id: true },
    });
    for (const r of orphans) {
      await this.queue.add(
        'extract',
        { hotNewsId: r.id },
        {
          jobId: `extract-${r.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
    }
    this.logger.log(`Boot backstop: re-queued ${orphans.length} PENDING extract jobs`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}
```

### 4.10 IngestionService 改动（最小切口）

`apps/worker/src/crawl/ingestion.service.ts`，注入 `EXTRACT_QUEUE`，在 `prisma.hotNews.create` 成功后追加：

```ts
// 在 result.inserted += 1 / result.hidden += 1 之后追加（VISIBLE 行才考虑）
// 此处假设 created.id 是 create 返回的 row id

if (status === ContentStatus.VISIBLE) {
  // SP-5: 总是入 summary 队列
  await this.summaryQueue.add(
    'summarize',
    { hotNewsId: created.id },
    {
      jobId: `summarize-${created.id}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  );

  // SP-4.7: 仅 link-post 入 extract 队列
  const extUrl = (raw.interactionData as { externalUrl?: string } | null)?.externalUrl;
  const isLinkPost =
    typeof extUrl === 'string'
    && /^https?:/.test(extUrl)
    && cleanContent === cleanTitle;  // SP-3 的哨兵语义
  if (isLinkPost) {
    await prisma.hotNews.update({
      where: { id: created.id },
      data: { extractStatus: 'PENDING' },
    });
    await this.extractQueue.add(
      'extract',
      { hotNewsId: created.id },
      {
        jobId: `extract-${created.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    );
  }
}
```

注意：`status === HIDDEN` 行**不**入两个队列（SP-4 quality 已判定低质，无需 LLM / 抽取成本）。

`IngestionService` 构造函数加 `@Inject(SUMMARY_QUEUE)` + `@Inject(EXTRACT_QUEUE)` 两个 token，分别由 `SummarizeModule` 和 `ExtractModule` export。

### 4.11 Wipe 脚本（AI 阶段开机一次性）

`packages/db/scripts/wipe-hot-news-pre-ai.ts`：

```ts
import { getPrisma } from '@ai-hot-news/db';

interface WipeResult {
  before: number;
  deleted: number;
  after: number;
}

export async function runWipe(): Promise<WipeResult> {
  const prisma = getPrisma();
  const before = await prisma.hotNews.count();
  console.log(`[wipe-pre-ai] Before: ${before} rows`);

  const result = await prisma.hotNews.deleteMany({});
  const after = await prisma.hotNews.count();
  console.log(`[wipe-pre-ai] Deleted ${result.count} rows, after: ${after}`);

  return { before, deleted: result.count, after };
}

// dual-mode entrypoint（与 cleanup-rss-pre-window.ts 一致风格）
const isDirectRun =
  require.main === module ||
  (typeof process !== 'undefined' &&
    process.argv[1] &&
    process.argv[1].endsWith('wipe-hot-news-pre-ai.ts'));

if (isDirectRun) {
  runWipe()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

`packages/db/package.json` 加：

```json
"wipe-pre-ai": "tsx scripts/wipe-hot-news-pre-ai.ts"
```

根 `package.json` 不加（一次性脚本，避免误用）。

### 4.12 .env.example 同步

```bash
# === SP-4.7 Article Extractor ===
FIRECRAWL_API_KEY=                   # required, get from https://firecrawl.dev/app/api-keys
JINA_API_KEY=                        # optional, anonymous works at lower rate
EXTRACT_CONCURRENCY=2                # optional, defaults to 2
```

`docker/docker-compose.prod.yml` 不变（worker 服务的 `env_file: ../.env` 已经覆盖所有变量）。

### 4.13 Stub `summarize/` module（SP-4.7 先 ship 场景下）

**触发条件**：合并 SP-4.7 PR 时，仓库里**还没有** `apps/worker/src/summarize/summarize.queue.ts` 文件（即 SP-5 尚未 ship）。

**SP-4.7 需要 scaffold 的最小内容**：

```ts
// apps/worker/src/summarize/summarize.queue.ts
import { Provider } from '@nestjs/common';
import { Queue, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';

export const SUMMARY_QUEUE_NAME = 'summary';
export const SUMMARY_QUEUE = Symbol('SUMMARY_QUEUE');

export const summaryQueueProvider: Provider = {
  provide: SUMMARY_QUEUE,
  useFactory: (connection: IORedis): Queue =>
    new Queue(SUMMARY_QUEUE_NAME, { connection: connection as unknown as ConnectionOptions }),
  inject: [REDIS_CONNECTION],
};
```

```ts
// apps/worker/src/summarize/summarize.module.ts (stub)
import { Module } from '@nestjs/common';
import { SUMMARY_QUEUE, summaryQueueProvider } from './summarize.queue';

@Module({
  providers: [summaryQueueProvider],
  exports: [SUMMARY_QUEUE],
})
export class SummarizeModule {}
```

`apps/worker/src/worker.module.ts` 加 `imports: [..., SummarizeModule]`（让 stub queue 在 root 起来）。

**效果**：

- ExtractService 可以 `await this.summaryQueue.add('summarize', { hotNewsId })` push 到 Redis
- 没有 worker 消费 → 消息在 Redis 队列里堆积（BullMQ 队列可承载万级 job 不爆）
- SP-5 ship 时把 worker / service / strategy / processor 全加进 `summarize/`，并扩展 `summarize.module.ts` 加 worker provider 与 service。stub 文件会被自然演进，**不需要重写**

**反向场景**：如果 SP-5 先 ship，那么 `summarize/` 目录已就位，SP-4.7 import 即可不需要 scaffold。SP-4.7 PR 也不会因为多写了 stub 而冲突 —— `git diff` 显示文件已存在，跳过创建。

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Firecrawl + Jina 都用尽 quota | 中 | 接受 `extractStatus='FAILED'`；SP-5 用 title-only 出 degraded 摘要；月初 quota reset 时人工 SQL `UPDATE extractStatus='PENDING' AND extractAttempts=0 WHERE extractStatus='FAILED'` 重启重抽 |
| Firecrawl API 改 schema | 中 | provider 隔离；如果 Firecrawl `/v1/scrape` 改了响应格式，只动 firecrawl.provider.ts 一文件；Jina 兜底独立工作不受牵连 |
| Jina r.jina.ai 服务下线 | 中 | chain 顺序仍工作；但 Firecrawl quota 用尽后所有都失败；月度估算 25-35% 流量受影响。短期降级，不阻塞 SP-5 / SP-7 |
| jsdom-style HTML 抽取的不准 → 三方也不准 | 中 | Firecrawl/Jina 都用类似启发式（Readability-style），仍可能"抽到 sidebar"；但 prompt 加 "事实导向" 约束，degraded 内容 LLM 也能容忍 |
| 抽取成功但 contentText < 200 字 → fallback Jina 也短 → FAILED | 低 | 个别页面（如纯图片帖、Tweet 引用页、404 软重定向）就该是 FAILED；不是 bug |
| BullMQ retry 与 attempts 累加双重计数 | 低 | DB 的 `extractAttempts` 是真实计数器；BullMQ `attempts:3` 只是底层重试机制；最终 `extractStatus='FAILED'` 由 DB 计数器决定，BullMQ 看作 success（不抛错）避免 "BullMQ retried 3 × DB attempts 3 = 9 次" |
| 哨兵被破坏（人工 SQL 改 interactionData）→ worker 报错 | 低 | extract.service 兜底 `extractStatus=null`；UPDATE 后跳过 |
| boot backstop 大量 PENDING 启动雪崩 | 低 | concurrency=2 + Firecrawl 单 IP 并发 ~2 自然限速；worst case 千行 PENDING 跑 ~10 分钟 |
| 抽取过程中 row 被 worker 同时更新（concurrent SP-5）| 低 | SP-5 写 `summary/aiTags`，SP-4.7 写 `content/rawHtml/extractStatus + summary=NULL/aiTags=[]`；Postgres row-level lock 自然串行；worst case SP-5 写完 summary，SP-4.7 立刻 NULL 它，触发再次 SP-5 → 多花一次 LLM 成本但语义正确 |

---

## 6. 测试策略

### 6.1 单元测试

| 文件 | 关键 case |
|---|---|
| `firecrawl.provider.spec.ts` | mock fetch：200 → contentText 解析；402 → QuotaExceededError；429 → QuotaExceededError；404 → PermanentFetchError；5xx → TransientFetchError |
| `jina.provider.spec.ts` | mock fetch：200 / 402 / 404 / 网络错（fetch reject） |
| `chain.spec.ts` | (a) 第一家成功 → 不调第二家；(b) 第一家 quota → 第二家成功；(c) 都 quota → 抛最后一个错；(d) 第一家 PermanentFetchError → 立即抛不试第二家；(e) 第一家成功但短 → 试第二家 |
| `extract.service.spec.ts` | mock chain + prisma：(a) 成功 UPDATE + summaryQueue.add 调用 1 次；(b) PermanentFetchError → status=FAILED + attempts=1；(c) 第 3 次 TransientFetchError → status=FAILED；(d) 第 1 次 TransientFetchError → status=PENDING + 抛错让 BullMQ retry；(e) 已 EXTRACTED → 直接 return 不调 chain |
| `extract.processor.spec.ts` | (a) 正常 job → service.run 调用 1 次；(b) service throw → processor 也抛（让 BullMQ 看到 fail） |
| `extract.module.spec.ts` | boot backstop：mock prisma.findMany 返 N 行 PENDING → queue.add 调用 N 次 + jobId 形式正确 |

### 6.2 集成测试

`apps/worker/src/crawl/ingestion.service.integration.spec.ts` 加 case：

- **HN link-post**（`s.url = 'https://github.com/x', text = ''` → `interactionData.externalUrl = 'https://github.com/x'`, `content = title`）→ ingest 后 DB row `extractStatus='PENDING'`；mock extractQueue.add 被调用 1 次 + jobId 正确
- **HN self-post**（`s.url = null, s.text = '...'` → `interactionData.externalUrl = null`）→ ingest 后 `extractStatus IS NULL`；extractQueue.add **不**被调用
- **Reddit link-post**（`is_self=false`）→ 同 HN link-post
- **Reddit self-post**（`is_self=true`）→ 同 HN self-post
- **HIDDEN 行**（quality 命中）→ 即使是 link-post 也不入 extract 队列

### 6.3 wipe 脚本集成测试

`packages/db/scripts/wipe-hot-news-pre-ai.spec.ts`：

- 准备 N 行 hot_news + M 行 source_configs → runWipe() → assert hot_news count=0、source_configs count 不变
- 空表跑 → 0 deleted（不报错）

整测试套件靠 `packages/db/vitest.config.ts: fileParallelism=false`（SP-4.5 已开），避免与 cleanup-rss-pre-window 等其他写全表的测试并发冲突。

### 6.4 烟测（部署后）

- 部署完成 + wipe 完成后 ~30 分钟，curl `/api/hot-news?platforms=HACKERNEWS&pageSize=5` 拿一个 HN link-post id，psql 查它的 content 是真正文（500-5000 字）
- `SELECT extractStatus, COUNT(*) FROM hot_news GROUP BY 1` → null + EXTRACTED 占绝大多数；FAILED < 10%；PENDING in-flight 少量
- worker 日志 grep `Extracted .* via firecrawl` 与 `Extracted .* via jina` 比例反映 fallback 频率

---

## 7. 部署运维

### 7.1 部署流程（push 到 main 触发 deploy.yml）

1. CI build worker image（含 SP-4.7 代码）
2. `scripts/deploy.sh "sha-<commit>"`：
   - `prisma migrate deploy` → 应用 `_sp4_7_extract_status` migration
   - `prisma db seed` → noop（SourceConfig 不变）
   - `docker compose up -d` → 拉新镜像
   - `restart worker` → 加载新代码 + boot backstop 跑（首次 deploy 时空表，不会扫到 PENDING）
3. deploy.sh 内置 smoke：`/api/health` + `/api/hot-news?pageSize=1` 双绿

### 7.2 AI 阶段开机一次性 wipe（先于 SP-4.7 / SP-5 任一 ship 之前）

```bash
# 准备：FIRECRAWL_API_KEY / JINA_API_KEY / OPENROUTER_API_KEY 已 ssh 写到 /srv/ai-hot-news/.env
# stop worker：维持 single-writer，避免 wipe 与 ingest 写入竞态
ssh deploy@<vps>
cd /srv/ai-hot-news
docker compose -f docker/docker-compose.prod.yml --env-file .env stop worker

# wipe（包名 import + worker image，与 SP-4.5 cleanup-rss-pre-window 一样的 pattern）
bash scripts/run-prod-oneshot.sh packages/db scripts/wipe-hot-news-pre-ai.ts
# 期望日志：
#   [wipe-pre-ai] Before: 27xx rows
#   [wipe-pre-ai] Deleted 27xx rows, after: 0

# 重启 worker：boot 后所有 crawler 会重新拉一轮（HN top now / Reddit hot now / RSS 7d 内）
docker compose -f docker/docker-compose.prod.yml --env-file .env start worker

# 等 ~5-10 分钟（首轮 crawl + ingest）
curl 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=5' | jq '.total'
# 期望：~100-300（HN 90 + Reddit 200 + RSS 9 量级，dedupe 后）

# 再等 ~10-15 分钟（SP-4.7 worker 跑完入队的 link-post）
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT \"extractStatus\", COUNT(*) FROM hot_news GROUP BY 1 ORDER BY 1 NULLS FIRST"
# 期望：null + EXTRACTED + 少量 PENDING/FAILED
```

### 7.3 月度运维：FAILED 行重抽（quota reset 后）

每月 1 号（free quota 滚动 reset 后），可选地：

```sql
-- prod psql
UPDATE hot_news
   SET "extractStatus" = 'PENDING', "extractAttempts" = 0
 WHERE "extractStatus" = 'FAILED'
   AND interactionData->>'externalUrl' IS NOT NULL;
```

worker 重启后 boot backstop 会扫这批 PENDING 重跑。如果不重抽，FAILED 行就永远停在 title-only degraded 状态，SP-5 摘要也是 degraded。**接受现状是合法选择**。

### 7.4 应急回退

如果 SP-4.7 上线后发现 chain 全失败（API key 错 / Firecrawl 服务挂等），不需要回滚 commit：

```bash
# 临时关掉 SP-4.7：手工 SQL
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "UPDATE hot_news SET \"extractStatus\" = 'FAILED' WHERE \"extractStatus\" = 'PENDING'"
# 之后所有 link-post 都跳过抽取，SP-5 用 title 兜底。修好后重置 PENDING 即可。
```

更激进：rollback to 上一个 worker image（deploy.yml 重 push 上一个 sha 即可）。`_sp4_7_extract_status` migration 可保留（向后兼容，不影响 SP-3/4/4.5 行为）。

---

## 8. 不变量回顾

实施完成后必须仍然成立：

1. `HotNews.sourceUrl @unique` 不变（dedupeHash 算法不变 → P2002 行为不变）
2. SP-4 的 `status='VISIBLE' && filterReason IS NOT NULL` count = 0
3. SP-4 的 `status='HIDDEN' && filterReason IS NULL` count = 0
4. **新增**：`extractStatus='EXTRACTED' && content == title` count = 0（成功抽取必然 content != title）
5. **新增**：`extractStatus IS NULL && (interactionData->>'externalUrl' IS NOT NULL && content == title)` count = 0（link-post 入库时必然标 PENDING；wipe 之后所有历史 null 都已被清掉）
6. SP-4.5 的 `RSS_INGEST_WINDOW_MS` / `PLATFORM_WINDOW_HOURS` / `DEFAULT_PLATFORMS` 行为不变
7. `GET /hot-news` 默认仍只返 `status='VISIBLE'` 行
8. `apps/web` 的 `feed-tabs` / `news-item` / `pagination` 渲染零变化

---

## 9. 完成定义（DoD）

- [ ] `packages/db/prisma/schema.prisma` 加两列 + migration `_sp4_7_extract_status` 落库；`pnpm db:migrate:dev` 本地、`prisma migrate deploy` prod 双绿
- [ ] `packages/db/scripts/wipe-hot-news-pre-ai.ts` + spec 写好；`pnpm --filter @ai-hot-news/db run test` 全绿
- [ ] `apps/worker/src/extract/` 完整模块 + 单测 + 集成测试，ingestion.service 改动不破坏现有 13 个 integration spec
- [ ] `pnpm turbo run lint typecheck build test` 全绿（含新增 ~22 case）
- [ ] `.env.example` 加 FIRECRAWL_API_KEY / JINA_API_KEY 占位
- [ ] PR review 通过，merge 到 main，CI/Deploy 全绿
- [ ] AI 阶段开机：FIRECRAWL_API_KEY 写到 `/srv/ai-hot-news/.env`、stop worker、wipe 执行、start worker、~10 分钟后 `extractStatus` 分布合理
- [ ] 部署 + wipe 完成 ~30 分钟内：`/api/hot-news?platforms=HACKERNEWS&pageSize=5` 返一个 link-post，DB 查它的 content 是真正文（≥500 字）
- [ ] decomposition design doc 加 SP-4.7 状态行 + 部署凭据
