# SP-5 — AI 摘要 + aiTags 分类

- **状态**：spec 待用户审核
- **依赖**：
  - SP-2/3/4（HotNews 主表 + status/filterReason + crawler 流水线）
  - SP-4.5（API window + status=VISIBLE 默认过滤；本 SP 不破坏）
  - 一次性脚本范式（`scripts/run-prod-oneshot.sh` + worker image + 包名 import；详见 SP-4 §10 决策 11）
- **可并行**：SP-4.7（ArticleExtractor）。两 SP 通过 `HotNews.content` 单一事实源 + queue 重摘信号解耦，编码上互不依赖、可任意先后 ship（详见 §0.2）
- **本文件**：`docs/superpowers/specs/2026-05-05-sp5-ai-summary-tags-design.md`
- **预计工作量**：~2.5-3 天（新 `packages/prompts` workspace 包 / Vercel AI SDK + OpenRouter 接入 / Strategy interface + 一个 V1 实现 / 独立 worker / 队列 / IngestionService 入队 / 单元 + 集成测试）

---

## 0. 关键设计原则与边界

### 0.1 SP-5 只做"对每行 HotNews 算 summary + aiTags"

**输入**：`HotNews` 行满足 `status='VISIBLE'` 且 `summary IS NULL`（包含两类行：①新入库行；②SP-4.7 抽取后被置 NULL 的行）。

**输出**：UPDATE 同一行 `summary` = 中文 80-150 字摘要、`aiTags` = prefix-encoded 字符串数组（`company:OpenAI` / `model:GPT-5` / `category:Release` / `tech:Agents`）。

**不做**：

- ❌ 入库时同步调 LLM（会阻塞 BullMQ worker，HN top 拉 25 行就锁 1-2 分钟）
- ❌ 决定 row 是否展示（`status` 由 SP-4 quality 维度决定，SP-5 不改）
- ❌ 抓 link-post 外链正文（→ SP-4.7 负责；SP-5 只读 `content` 列，不论 link-post 还是 self-post）
- ❌ 详情页摘要（4 维分析：影响级别 / 社区情绪 / 跨平台 / 时效性）→ SP-11 详情页时再做
- ❌ 跨平台合并 / embedding（→ SP-7 pgvector）
- ❌ 关键词命中（→ SP-16 命中检测 worker）
- ❌ 修改 `HotNews.title`（即使 LLM 给出更好标题也不覆盖）

### 0.2 与 SP-4.7 的契约（解耦点）

| 维度 | SP-5 | SP-4.7 |
|---|---|---|
| 触发 | (a) ingest 阶段无条件 push（status=VISIBLE 行）；(b) SP-4.7 抽取成功后再次 push 同 id；(c) worker boot backstop 扫 `summary IS NULL` 入队 | ingest 阶段哨兵命中 → push extract:<id> |
| 写入字段 | `summary` / `aiTags` | `content` / `rawHtml` / `extractStatus` / `extractAttempts` |
| 触发对方 | 不触发 SP-4.7（SP-5 永远只读 `content`） | 抽取成功后 enqueue summary:<id>（重摘信号） |
| 等待对方 | 不等。link-post 第一次摘要可能基于 `content == title` 出 degraded 摘要；SP-4.7 跑完后 `summary=NULL` 重新入队，SP-5 再跑一次出真摘要 | 不等。SP-4.7 永远只读自己的字段 |

**桥接哲学**：`HotNews.content` 是**单一事实源**。SP-5 永远基于"当前 content"做摘要，不关心是 title 兜底还是真正文。`summary IS NULL` 是"该重算"的唯一信号。

### 0.3 插拔式策略 vs YAGNI

PRD §6 + decomposition spec §1.2 / §5 / §8 三处都明确"插拔式摘要策略接口"是 SP-5 关键产出（cost 控制不确定时按热度阈值 / 平台白名单 / 聚合事件 group 限流）。

但本 SP 实测预算（DeepSeek-v3.2 via OpenRouter ~$1.3/月跑 3000 行），**真正实现策略 V1 的经济收益是 0**。所以本 SP：

- ✅ 实现 `SummarizationStrategy` interface（PRD 契约）
- ✅ 实现一个默认实现：`SummarizeAllVisibleStrategy`（status=VISIBLE 全摘，唯一过滤是 `status !== 'VISIBLE'` 跳过）
- ❌ 不实现 HeatThreshold / PlatformWhitelist / GroupOnce 等其他策略（接口预留即可，未来 SP-5.1 / SP-7 收尾时按需补）
- ❌ 不写 strategy 选择的 env 变量 / DB 配置 — V1 硬编码 SummarizeAllVisible

### 0.4 与 SP-4 / SP-4.5 的边界

- **不动** SP-4 的 `filterReason` / `status` 写入逻辑（SP-5 入队条件 `status=VISIBLE`，HIDDEN 行不入队节省 LLM 调用）
- **不动** SP-4.5 的 `RSS_INGEST_WINDOW_MS` / `PLATFORM_WINDOW_HOURS` / `DEFAULT_PLATFORMS`
- **不动** `dedupeHash` 算法、SourceConfig 表、`Crawler` interface
- **不读** `extractStatus`（SP-4.7 字段，SP-5 不关心是否抽取成功，永远基于 `content` 现状）

### 0.5 历史数据 wipe（与 SP-4.7 共用）

PRD 上线节奏：SP-4.7 / SP-5 哪个先 ship 都行，但**先 ship 的那个之前**跑一次 `packages/db/scripts/wipe-hot-news-pre-ai.ts` 清空 `hot_news`。这是"AI 阶段开机"操作，由 SP-4.7 spec §4.11 + §7.2 主导（SP-5 共用，不重复定义）。

**wipe 之后**：SP-5 不写 backfill 脚本（无历史可填）；boot backstop（§4.7）扫 `summary IS NULL` 自然把 wipe 后陆续 ingest 的新行入队。

---

## 1. 目标、范围与验收标准

### 1.1 目标

为每行 status=VISIBLE HotNews 生成一段中文摘要（80-150 字）+ 4 维度结构化标签（companies / models / category / tech），让 SP-8/9/10/11（Aurora 前端）可以按 tag 过滤、详情页展示摘要、列表卡片显示精炼信息。同时不影响 ingest 主链路吞吐、不破坏 SP-4 / SP-4.5 已交付契约、月度成本预算 ≤$2。

### 1.2 In-scope

| 模块 | 内容 |
|---|---|
| `packages/prompts/`（新增 workspace 包） | `package.json` (`name: @ai-hot-news/prompts`) / `src/index.ts` / `src/taxonomy.ts`（companies/models/categories 受控词表）/ `src/summarize.prompt.ts`（buildSystemPrompt + buildUserPrompt + SUMMARIZE_PROMPT_VERSION 常量） / `src/parse.ts`（parseSummarizeResponse → typed result + bounded fallback） / 单测 |
| `apps/worker/package.json` | 加 `ai` (Vercel AI SDK) + `@ai-sdk/openai` + `@ai-hot-news/prompts: workspace:*` 依赖 |
| `apps/worker/src/summarize/`（新增模块） | `summarize.module.ts` / `summarize.queue.ts` / `summarize.processor.ts` / `summarize.service.ts` / `llm-client.ts` / `strategies/{strategy.interface,summarize-all-visible}.ts` + 单测 |
| `apps/worker/src/summarize/summarize.queue.ts` | BullMQ queue `summary` + 独立 Worker（concurrency=3）+ providers token |
| `apps/worker/src/crawl/ingestion.service.ts` | 入库后追加：`status=VISIBLE` → push `summary:<id>`（与 SP-4.7 改动同一处；本 SP 与 SP-4.7 任一个 ship 时这一改动都需要做，提交时谁先合并谁主导） |
| `apps/worker/src/crawl/crawl.module.ts` | imports `SummarizeModule` 拿到 `SUMMARY_QUEUE` token，注入 `IngestionService` 用于 enqueue |
| Worker boot backstop | `WHERE status='VISIBLE' AND summary IS NULL` orphan scan，重新入队 |
| `.env.example` | 加 `OPENROUTER_API_KEY` / `SUMMARY_MODEL` / `LLM_BASE_URL` 占位 |

**单元 + 集成测试预算**：

- `packages/prompts/test/taxonomy.spec.ts`（4 case：词表非空、TAXONOMY 类型 readonly、companies 不重复、categories 严格 8 项）
- `packages/prompts/test/parse.spec.ts`（12 case：合法 JSON / 字段缺失 / 非法 JSON / 多余字段 / 数组超长截断 / category 非法值 / 空 summary / summary 超长截断 / array 元素非 string / response 含前后噪音 / null 值 / 空 response）
- `packages/prompts/test/summarize.prompt.spec.ts`（3 case：system prompt 含 taxonomy companies、user prompt 含 title + content 截断到 6000 字、prompt version 常量存在）
- `apps/worker/src/summarize/llm-client.spec.ts`（3 case：缺 OPENROUTER_API_KEY 抛错、默认 model 是 deepseek-v3.2、env override 工作）
- `apps/worker/src/summarize/summarize.service.spec.ts`（5 case：mock LLM 成功 → UPDATE summary+aiTags / strategy='skip:HIDDEN' 不调 LLM / LLM 返非法 JSON → summary 仍 NULL + 不抛错 / row 不存在 → 跳过 / row.status='HIDDEN' → 跳过）
- `apps/worker/src/summarize/strategies/summarize-all-visible.spec.ts`（3 case：VISIBLE → allow / HIDDEN → skip:status_HIDDEN / PENDING → skip:status_PENDING）
- `apps/worker/src/summarize/summarize.processor.spec.ts`（2 case：正常 job → service.run / service throw → processor 抛）
- `apps/worker/src/summarize/summarize.module.spec.ts`（boot backstop：mock prisma.findMany 返 N 行 → queue.add N 次）
- `apps/worker/src/crawl/ingestion.service.integration.spec.ts` 加 case：VISIBLE 行 ingest 后 summaryQueue.add 调用 1 次；HIDDEN 行 ingest 后 summaryQueue.add 不调用

合计 **~33 case**。

### 1.3 Out-of-scope（明确不做）

- ❌ 详情页 4 维分析（影响级别 / 社区情绪 / 跨平台 / 时效性）— SP-11
- ❌ AI 日报（24h 全局摘要）— SP-21
- ❌ 分享文案生成 — SP-26
- ❌ 关键词监控的"AI 真假识别 / 相关性分析"（yupi 风格）— 我们不做这个，是不同产品定位
- ❌ 摘要 cache（同 URL 多次摘要复用）— LLM 调用是 per-row 已自然 dedupe（dedupeHash unique）
- ❌ Strategy V1 之外的实现（HeatThreshold / PlatformWhitelist 等）— 接口预留
- ❌ Prompt 版本化的自动 re-summarize（人工 SQL `UPDATE summary=NULL` + worker boot backstop 自动捡起）
- ❌ summaryGeneratedAt 列 / summaryModel 列 / summaryTokensIn 列 — 调试 Q 走 OpenRouter dashboard / SQL `WHERE summary IS NOT NULL`
- ❌ aiTags 暴露在 `/api/hot-news` DTO — SP-8/10 实施时再 wire（schema 已就位）
- ❌ taxonomy 动态化（admin UI 改词表）— SP-24 后台管理时再做
- ❌ summary 富文本 / 多语言切换 — V1 锁定中文纯文本
- ❌ degraded 摘要的特殊标记（让 UI 知道 "这是 title-only 摘要"）— SP-4.7 抽取后会自动重摘，degraded 不会停留太久；YAGNI
- ❌ Streaming（边生成边写入）— `generateText` 整段返够好，无 UI 即时反馈需求

### 1.4 硬验收标准

```bash
# === 单元 + 集成测试全绿 ===
pnpm turbo run lint typecheck build test
# 期望含新增 ~33 case 全绿

# === 本地 dev 端到端 ===
echo "OPENROUTER_API_KEY=sk-or-v1-xxx" >> .env
echo "SUMMARY_MODEL=deepseek/deepseek-v3.2" >> .env  # 默认值，可省
pnpm dev

# 等 ~3-5 分钟（boot scan 入队 + LLM 陆续调用）
# Worker 日志期望含：
#   "[Summarize] hotNewsId=cm... → done (2.1s, summary=87 chars, tags=4)"

# === DB 验证 ===
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT COUNT(*) FILTER (WHERE summary IS NOT NULL) AS done, COUNT(*) FILTER (WHERE summary IS NULL) AS pending FROM hot_news WHERE status='VISIBLE'"
# 期望：稳态后 done > 0，pending 趋向 0

# === aiTags prefix 约定验证 ===
docker exec ... -c "SELECT unnest(\"aiTags\") AS tag, COUNT(*) FROM hot_news WHERE summary IS NOT NULL GROUP BY tag ORDER BY 2 DESC LIMIT 30"
# 期望：tag 形如 'company:OpenAI' / 'model:GPT-5' / 'category:Release' / 'tech:Agents'
# 期望：所有 tag 都带 ':' prefix（无裸标签）

# === Strategy 行为验证 ===
# 手工把一行 status 改 HIDDEN，然后 trigger summary（手工 redis-cli LPUSH）→ 应跳过
docker exec ... -c "UPDATE hot_news SET status='HIDDEN', summary=NULL WHERE id='cm...'"
# 看 worker 日志应含: '[Summarize] hotNewsId=cm... → skip:status_HIDDEN'

# === Prompt version manual re-summarize 验证 ===
# 模拟：人工 NULL 一些 row 后 worker 重启
docker exec ... -c "UPDATE hot_news SET summary=NULL, \"aiTags\"='{}' WHERE id IN (SELECT id FROM hot_news WHERE status='VISIBLE' ORDER BY publishedAt DESC LIMIT 5)"
# restart worker 看到 boot backstop 日志 + 新 LLM 调用

# === Cost 真实测量（24h 后）===
# 跑 24h 后查 OpenRouter dashboard：
#   实际 token 消耗与估算 ±50% 内（input ~130K/天 / output ~25K/天 量级）
#   总成本 24h ≤ $0.10

# === DB 不变量验证 ===
# 不变量 1: SP-4 关系仍成立
docker exec ... -c "SELECT COUNT(*) FROM hot_news WHERE status='VISIBLE' AND \"filterReason\" IS NOT NULL"
# 期望: 0

# 不变量 2: 没有 status=HIDDEN 行被摘要
docker exec ... -c "SELECT COUNT(*) FROM hot_news WHERE status='HIDDEN' AND summary IS NOT NULL"
# 期望: 0（HIDDEN 行不入队，永远不该有 summary；除非历史遗留 — wipe 后应 0）

# 不变量 3: aiTags prefix 约定
docker exec ... -c "SELECT COUNT(*) FROM hot_news WHERE \"aiTags\" != '{}' AND EXISTS (SELECT 1 FROM unnest(\"aiTags\") t WHERE t NOT LIKE '%:%')"
# 期望: 0（所有 tag 必须 'prefix:value' 格式）

# === CI / Deploy ===
# 部署后 ~30 分钟：
curl https://hotnews.shinpeionline.top/api/hot-news?pageSize=10 | jq '.items[].summary' | head -5
# 期望: 所有 items 有 summary（中文 80-150 字）
```

### 1.5 不会修改的内容

- 不动 SP-0 monorepo 结构、Docker Compose 拓扑、CI 矩阵
- 不动 Prisma schema（`HotNews.summary` / `aiTags` 列已存在；零 migration）
- 不改 `Platform` enum
- 不改 `Crawler` interface / `RawCrawledItem` 类型
- 不改 BullMQ `crawl` / `extract` 队列
- 不改 `apps/web` 任何文件（API 自动透传 summary/aiTags 已在 SP-1 schema；本 SP 不改 DTO，等 SP-8/10 实施时再 expose 给前端）
- 不改 `apps/api` 的 HotNewsService / DTO（`summary` / `aiTags` 暂不进 list response — Phase 4 SP-10 实施时再 wire）
- 不改 SP-4 / SP-4.5 的 ingest cleanup / cutoff / window 逻辑
- 不改 deploy.sh

---

## 2. 架构与数据流

### 2.1 数据流（与 SP-3/4/4.5/4.7 现状对比）

```text
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                            crawler (HN / Reddit / RSS)                               │
│                                       │                                              │
│                                       ▼                                              │
│  IngestionService.ingest():                                                          │
│    cutoff window → cleanTitle/cleanContent → dedupeHash → quality verdict →           │
│    prisma.hotNews.create(...) →                                                      │
│                                       │                                              │
│       ┌───────────────────────────────┴────────────────────────────────────┐         │
│       │                                                                    │         │
│       ▼                                                                    ▼         │
│   isLinkPost? (SP-4.7)                                       status==VISIBLE?        │
│   externalUrl != null && content==title                              │               │
│        │                                                              ▼               │
│        ▼ yes                                                  await summaryQueue.add( │
│   update extractStatus='PENDING'                                'summarize',          │
│   await extractQueue.add(...)                                   { hotNewsId },        │
│                                                                 { jobId: 'summarize-<id>' });│
└──────────────────────────────────────────────────────────────────────────────────────┘
                                                                          │
                                                                          ▼
                                                            BullMQ queue 'summary'
                                                                          │
                                                                          ▼
                                                  ┌────────────────────────────────────┐
                                                  │ SP-5 worker (concurrency=3)        │
                                                  │ SummarizeService.run(id):          │
                                                  │  1. row = findUnique(id)           │
                                                  │  2. strategy.shouldSummarize(row)  │
                                                  │     - 'allow' → next               │
                                                  │     - 'skip:reason' → log + return │
                                                  │  3. system = buildSystemPrompt()   │
                                                  │     user   = buildUserPrompt({     │
                                                  │       title, content,              │
                                                  │       sourcePlatform              │
                                                  │     })                             │
                                                  │  4. text = await callLlm(s, u)     │
                                                  │       (Vercel AI SDK +             │
                                                  │        OpenRouter compat)          │
                                                  │  5. parsed = parseSummarizeResponse│
                                                  │       (text)                       │
                                                  │     - null → log + return          │
                                                  │       (summary 仍 NULL)            │
                                                  │  6. UPDATE hot_news SET            │
                                                  │       summary, aiTags WHERE id=X   │
                                                  └────────────────────────────────────┘

      （SP-4.7 抽取成功后会再次 summaryQueue.add 同 id；jobId 自然幂等会 enqueue 一个新 job）
```

### 2.2 LLM 调用形态

```ts
// 单次调用：一个 LLM call 出 summary + 4 维 aiTags
const text = await generateText({
  model: createOpenAI({
    baseURL: process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
  })(process.env.SUMMARY_MODEL ?? 'deepseek/deepseek-v3.2'),
  system: SYSTEM_PROMPT,
  prompt: USER_PROMPT,
  temperature: 0.2,
  maxTokens: 500,
  abortSignal: AbortSignal.timeout(30_000),
});

// LLM 返一段（可能含前后噪音的）JSON：
// { summary, companies[], models[], category, tech[] }
// parser regex 提取 JSON 块，bounded fallback 到 prefix-encoded aiTags[]
```

### 2.3 Strategy interface 形态

```ts
// strategies/strategy.interface.ts
export type StrategyVerdict = 'allow' | `skip:${string}`;

export interface SummarizationStrategy {
  /**
   * 根据 row 元数据决定是否调 LLM。
   * 'allow' → 走 LLM；'skip:<reason>' → 跳过（不算失败、不入计数器）。
   */
  shouldSummarize(row: {
    id: string;
    sourcePlatform: 'TWITTER' | 'RSS' | 'HACKERNEWS' | 'REDDIT';
    publishedAt: Date;
    status: 'VISIBLE' | 'HIDDEN' | 'PENDING';
    interactionData: Record<string, unknown> | null;
    heatScore: number;
  }): StrategyVerdict;
}

// V1 默认实现
export class SummarizeAllVisibleStrategy implements SummarizationStrategy {
  shouldSummarize(row: { status: 'VISIBLE' | 'HIDDEN' | 'PENDING' }): StrategyVerdict {
    if (row.status !== 'VISIBLE') return `skip:status_${row.status}`;
    return 'allow';
  }
}

// 未来可能的实现（不在 SP-5 范围）：
// - HeatThresholdStrategy(threshold) → row.heatScore < threshold ? skip : allow
// - PlatformWhitelistStrategy(['HACKERNEWS', 'RSS']) → not in list ? skip
// - GroupOnceStrategy → 同 groupId 只摘一次（依赖 SP-7 跨平台合并）
```

V1 worker 启动时硬编码 `new SummarizeAllVisibleStrategy()`。未来想换策略只需在 `summarize.module.ts` 改一行 useFactory。

---

## 3. 模块布局与详细实现

### 3.1 `packages/prompts/` 完整结构

```
packages/prompts/
├── package.json                      (name: @ai-hot-news/prompts, no runtime deps)
├── src/
│   ├── index.ts                      (re-export taxonomy + summarize prompt builders + parse)
│   ├── taxonomy.ts                   (受控词表常量)
│   ├── summarize.prompt.ts           (system + user prompt builders + SUMMARIZE_PROMPT_VERSION)
│   └── parse.ts                      (parseSummarizeResponse + typed SummarizeResult)
├── test/
│   ├── taxonomy.spec.ts
│   ├── summarize.prompt.spec.ts
│   └── parse.spec.ts
├── tsconfig.json                     (extends root)
├── eslint.config.mjs                 (extends root)
└── vitest.config.ts                  (default)
```

`packages/prompts/package.json`：

```json
{
  "name": "@ai-hot-news/prompts",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit",
    "build": "echo 'no-op (types-only package)'",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

`pnpm-workspace.yaml` 已经 glob `packages/*`，新增包零配置。

### 3.2 `packages/prompts/src/taxonomy.ts`

```ts
/**
 * SP-5 受控词表（companies / models / categories）+ 自由维度 (tech)。
 * 词表升级时：
 *   1. 在此处加新条目
 *   2. 决定是否要批量重摘历史（SQL UPDATE summary=NULL WHERE summary IS NOT NULL）
 *      触发 worker boot backstop 自然 backfill
 */

export const TAXONOMY = {
  companies: [
    'OpenAI',
    'Anthropic',
    'Google',
    'Meta',
    'DeepMind',
    'Microsoft',
    'Mistral',
    'xAI',
    'DeepSeek',
    'ByteDance',
    'Alibaba',
    'Tencent',
    'Baidu',
    'Cohere',
    'Stability AI',
    'NVIDIA',
    'Apple',
    'Amazon',
    'Hugging Face',
    'Cursor',
  ] as const,
  models: [
    'GPT-5',
    'GPT-4o',
    'GPT-4',
    'o3',
    'o1',
    'Claude-4',
    'Claude-3.5-Sonnet',
    'Claude-3-Opus',
    'Claude-3-Haiku',
    'Gemini-2',
    'Gemini-1.5-Pro',
    'Gemini-Flash',
    'Llama-4',
    'Llama-3',
    'Mistral-Large',
    'DeepSeek-V3',
    'DeepSeek-R1',
    'Qwen-2.5',
    'Phi-4',
  ] as const,
  categories: [
    'Release',     // 新版/新模型/新产品发布
    'Research',    // 论文/研究成果
    'Tutorial',    // 教程/最佳实践
    'Opinion',     // 观点/评论/讨论
    'Tooling',     // 工具/SDK/库
    'Benchmark',   // 测评/对比
    'Incident',    // 事故/争议/服务中断
    'Product',     // 产品功能/UX 更新
  ] as const,
  // tech: 自由生成，无受控词表
} as const;

export type Company = typeof TAXONOMY.companies[number];
export type Model = typeof TAXONOMY.models[number];
export type Category = typeof TAXONOMY.categories[number];
```

### 3.3 `packages/prompts/src/summarize.prompt.ts`

```ts
import { TAXONOMY } from './taxonomy.js';

/**
 * Prompt 版本。改 system / user prompt body 时 +1，并：
 *   1. ssh prod psql: UPDATE hot_news SET summary=NULL, "aiTags"='{}' WHERE summary IS NOT NULL;
 *   2. restart worker → boot backstop 扫 NULL 重摘
 * V1 = 1。
 */
export const SUMMARIZE_PROMPT_VERSION = 1;

/**
 * 6KB（≈ 1500-2000 token）— 输入正文超过这个长度截断尾部。
 * 大多数 HN/Reddit/RSS 文章 < 6KB；超长博客（>10KB）摘要质量损失可接受，prompt 输入成本控制在 ~1300 token 量级。
 */
const MAX_USER_CONTENT_CHARS = 6000;

export function buildSystemPrompt(): string {
  return `你是 AI 行业资讯摘要专家。

任务：给定一段技术文章/论坛帖的标题 + 正文（可能是英文或中文），用中文输出 2-3 句简洁摘要 + 4 维度结构化标签。

【受控词表 — 严格只能从下列列表选择】
- companies: ${TAXONOMY.companies.join(' | ')}
- models: ${TAXONOMY.models.join(' | ')}
- category: ${TAXONOMY.categories.join(' | ')}（恰选 1 个最贴切的）

【自由维度】
- tech: 1-3 个技术方向关键词（举例：Agents / RAG / Multimodal / Function Calling / MoE / Long Context / Fine-tuning / Inference Optimization / Tool Use 等）

【输出格式】严格 JSON，字段如下，不要输出 markdown 代码块包裹也不要输出额外文字：
{
  "summary": "中文 80-150 字，2-3 句话，事实导向，不带营销腔",
  "companies": ["..."],
  "models": ["..."],
  "category": "...",
  "tech": ["..."]
}

【重要约束】
- 标签如果不在受控词表里，宁可空数组也不要硬塞别的词
- summary 用中文，无论原文是英文还是中文
- 不出现"小编觉得 / 一起看看"等营销表达`;
}

export interface UserPromptInput {
  title: string;
  content: string;
  sourcePlatform: string;
}

export function buildUserPrompt(input: UserPromptInput): string {
  const trimmed = input.content.slice(0, MAX_USER_CONTENT_CHARS);
  const truncatedHint =
    input.content.length > MAX_USER_CONTENT_CHARS
      ? '\n\n[内容已截断，仅展示前 6000 字]'
      : '';
  return `平台：${input.sourcePlatform}
标题：${input.title}
正文：
${trimmed}${truncatedHint}`;
}
```

### 3.4 `packages/prompts/src/parse.ts`

```ts
import { TAXONOMY } from './taxonomy.js';

export interface SummarizeResult {
  /** 已 trim + 截断到 ≤400 字符 */
  summary: string;
  /** prefix-encoded: 'company:OpenAI' / 'model:GPT-5' / 'category:Release' / 'tech:Agents' */
  aiTags: string[];
}

/**
 * 鲁棒 JSON 提取：LLM 经常输出额外的 markdown 包装 / 前后空白 / "好的" 之类的开场白。
 * 用 /\{[\s\S]*\}/ 抓第一个 {...} 块。失败返 null。
 */
function extractJson(raw: string): unknown | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function isCompany(s: string): boolean {
  return (TAXONOMY.companies as readonly string[]).includes(s);
}
function isModel(s: string): boolean {
  return (TAXONOMY.models as readonly string[]).includes(s);
}
function isCategory(s: string): boolean {
  return (TAXONOMY.categories as readonly string[]).includes(s);
}

const MAX_TAGS_PER_DIM = 3;
const MAX_SUMMARY_CHARS = 400;

export function parseSummarizeResponse(raw: string): SummarizeResult | null {
  const obj = extractJson(raw) as Record<string, unknown> | null;
  if (!obj) return null;

  const summary = String(obj.summary ?? '').trim().slice(0, MAX_SUMMARY_CHARS);
  if (!summary) return null;

  const tags: string[] = [];

  for (const c of asStringArray(obj.companies).slice(0, MAX_TAGS_PER_DIM)) {
    if (isCompany(c)) tags.push(`company:${c}`);
  }
  for (const m of asStringArray(obj.models).slice(0, MAX_TAGS_PER_DIM)) {
    if (isModel(m)) tags.push(`model:${m}`);
  }
  if (typeof obj.category === 'string' && isCategory(obj.category)) {
    tags.push(`category:${obj.category}`);
  }
  for (const t of asStringArray(obj.tech).slice(0, MAX_TAGS_PER_DIM)) {
    // tech 自由维度，不验受控词表，但截断长度
    const trimmed = t.trim().slice(0, 30);
    if (trimmed) tags.push(`tech:${trimmed}`);
  }

  return { summary, aiTags: tags };
}
```

### 3.5 `apps/worker/src/summarize/llm-client.ts`

```ts
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

export interface LlmCallResult {
  text: string;
  tokensIn: number;   // OpenRouter 返回
  tokensOut: number;
  durationMs: number;
}

export async function callLlm(systemPrompt: string, userPrompt: string): Promise<LlmCallResult> {
  const baseURL = process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');

  const provider = createOpenAI({ baseURL, apiKey });
  const modelId = process.env.SUMMARY_MODEL ?? 'deepseek/deepseek-v3.2';

  const start = Date.now();
  const { text, usage } = await generateText({
    model: provider(modelId),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.2,
    maxTokens: 500,
    abortSignal: AbortSignal.timeout(30_000),
  });

  return {
    text,
    tokensIn: usage?.promptTokens ?? 0,
    tokensOut: usage?.completionTokens ?? 0,
    durationMs: Date.now() - start,
  };
}
```

### 3.6 `summarize.queue.ts` / `summarize.processor.ts`（参照 ExtractQueue）

> **跨 SP 备注**：如果 SP-4.7 已经先 ship，那么 `summarize.queue.ts` + `summarize.module.ts` 的 stub 已存在（详见 SP-4.7 spec §4.13）。本 SP 不重新创建该文件，而是**扩展**它 —— 在 `summarize.module.ts` 加 worker / service / strategy 三个 provider，把 `SummarizeAllVisibleStrategy` 与 `OnApplicationBootstrap`（boot backstop）的实现接进去。如果 SP-5 先 ship，这两个文件由 SP-5 从零创建，行为完全一致。


```ts
// summarize.queue.ts
import { Provider } from '@nestjs/common';
import { Queue, Worker, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';

export const SUMMARY_QUEUE_NAME = 'summary';
export const SUMMARY_QUEUE = Symbol('SUMMARY_QUEUE');
export const SUMMARY_WORKER = Symbol('SUMMARY_WORKER');

export const summaryQueueProvider: Provider = {
  provide: SUMMARY_QUEUE,
  useFactory: (connection: IORedis): Queue =>
    new Queue(SUMMARY_QUEUE_NAME, { connection: connection as unknown as ConnectionOptions }),
  inject: [REDIS_CONNECTION],
};

export function createSummaryWorker(
  processor: (jobName: string, jobData: unknown) => Promise<void>,
  connection: IORedis,
): Worker {
  const concurrency = parseInt(process.env.SUMMARY_CONCURRENCY ?? '3', 10);
  return new Worker(
    SUMMARY_QUEUE_NAME,
    async (job) => processor(job.name, job.data),
    {
      connection: connection as unknown as ConnectionOptions,
      concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 3,
    },
  );
}

// summarize.processor.ts
import { SummarizeService } from './summarize.service';

export interface SummaryJobData {
  hotNewsId: string;
}

export async function processSummaryJob(
  data: SummaryJobData,
  service: SummarizeService,
): Promise<void> {
  await service.run(data.hotNewsId);
}
```

### 3.7 `summarize.service.ts`（核心）

```ts
import { Injectable, Logger } from '@nestjs/common';
import { getPrisma, ContentStatus } from '@ai-hot-news/db';
import { buildSystemPrompt, buildUserPrompt, parseSummarizeResponse } from '@ai-hot-news/prompts';
import { callLlm } from './llm-client';
import { SummarizationStrategy } from './strategies/strategy.interface';

@Injectable()
export class SummarizeService {
  private readonly logger = new Logger(SummarizeService.name);

  constructor(private readonly strategy: SummarizationStrategy) {}

  async run(hotNewsId: string): Promise<void> {
    const prisma = getPrisma();
    const row = await prisma.hotNews.findUnique({
      where: { id: hotNewsId },
      select: {
        id: true,
        title: true,
        content: true,
        sourcePlatform: true,
        publishedAt: true,
        status: true,
        interactionData: true,
        heatScore: true,
      },
    });
    if (!row) {
      this.logger.warn(`Row ${hotNewsId} not found, skip`);
      return;
    }

    const verdict = this.strategy.shouldSummarize({
      id: row.id,
      sourcePlatform: row.sourcePlatform,
      publishedAt: row.publishedAt,
      status: row.status as 'VISIBLE' | 'HIDDEN' | 'PENDING',
      interactionData: row.interactionData as Record<string, unknown> | null,
      heatScore: row.heatScore,
    });
    if (verdict !== 'allow') {
      this.logger.log(`hotNewsId=${hotNewsId} → ${verdict}`);
      return;
    }

    let llmText = '';
    let durationMs = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    try {
      const result = await callLlm(
        buildSystemPrompt(),
        buildUserPrompt({
          title: row.title,
          content: row.content,
          sourcePlatform: row.sourcePlatform,
        }),
      );
      llmText = result.text;
      durationMs = result.durationMs;
      tokensIn = result.tokensIn;
      tokensOut = result.tokensOut;
    } catch (err) {
      // LLM 失败：保留 summary IS NULL，让 BullMQ 重试（attempts=3 exponential）
      this.logger.warn(`LLM call failed for ${hotNewsId}: ${(err as Error).message}, will retry`);
      throw err;
    }

    const parsed = parseSummarizeResponse(llmText);
    if (!parsed) {
      // LLM 返非法 JSON：保留 summary IS NULL，但**不重试**（重跑同 prompt 大概率仍然非法）
      // 等 prompt 升级或 row 内容变化时（如 SP-4.7 抽取后）再次入队会重试
      this.logger.warn(
        `Failed to parse LLM response for ${hotNewsId} (${durationMs}ms, in=${tokensIn} out=${tokensOut}), raw text first 200 chars: ${llmText.slice(0, 200)}`,
      );
      return;
    }

    try {
      await prisma.hotNews.update({
        where: { id: hotNewsId },
        data: {
          summary: parsed.summary,
          aiTags: parsed.aiTags,
        },
      });
    } catch (err) {
      // P2025 = row 已被删除（罕见竞态）→ 跳过
      if ((err as { code?: string }).code === 'P2025') return;
      throw err;
    }

    this.logger.log(
      `hotNewsId=${hotNewsId} → done (${durationMs}ms, in=${tokensIn}, out=${tokensOut}, summary=${parsed.summary.length}c, tags=${parsed.aiTags.length})`,
    );
  }
}
```

### 3.8 Strategy 实现

```ts
// strategies/strategy.interface.ts
export type StrategyVerdict = 'allow' | `skip:${string}`;

export interface SummarizationStrategy {
  shouldSummarize(row: {
    id: string;
    sourcePlatform: 'TWITTER' | 'RSS' | 'HACKERNEWS' | 'REDDIT';
    publishedAt: Date;
    status: 'VISIBLE' | 'HIDDEN' | 'PENDING';
    interactionData: Record<string, unknown> | null;
    heatScore: number;
  }): StrategyVerdict;
}

// strategies/summarize-all-visible.strategy.ts
import { SummarizationStrategy, StrategyVerdict } from './strategy.interface';

export class SummarizeAllVisibleStrategy implements SummarizationStrategy {
  shouldSummarize(row: { status: 'VISIBLE' | 'HIDDEN' | 'PENDING' }): StrategyVerdict {
    if (row.status !== 'VISIBLE') return `skip:status_${row.status}` as StrategyVerdict;
    return 'allow';
  }
}
```

### 3.9 SummarizeModule（含 boot backstop）

```ts
// summarize.module.ts
import {
  Module, OnModuleDestroy, OnApplicationBootstrap, Inject, Logger,
} from '@nestjs/common';
import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { getPrisma } from '@ai-hot-news/db';
import { REDIS_CONNECTION } from '../crawl/queue.provider';
import { SummarizeService } from './summarize.service';
import {
  SUMMARY_QUEUE,
  SUMMARY_QUEUE_NAME,
  SUMMARY_WORKER,
  createSummaryWorker,
  summaryQueueProvider,
} from './summarize.queue';
import { processSummaryJob, type SummaryJobData } from './summarize.processor';
import { SummarizationStrategy } from './strategies/strategy.interface';
import { SummarizeAllVisibleStrategy } from './strategies/summarize-all-visible.strategy';

const STRATEGY_TOKEN = Symbol('SUMMARIZATION_STRATEGY');

@Module({
  providers: [
    summaryQueueProvider,
    {
      provide: STRATEGY_TOKEN,
      useFactory: (): SummarizationStrategy => new SummarizeAllVisibleStrategy(),
    },
    {
      provide: SummarizeService,
      useFactory: (strategy: SummarizationStrategy) => new SummarizeService(strategy),
      inject: [STRATEGY_TOKEN],
    },
    {
      provide: SUMMARY_WORKER,
      useFactory: (connection: IORedis, service: SummarizeService): Worker => {
        const worker = createSummaryWorker(
          async (_jobName, jobData) =>
            processSummaryJob(jobData as SummaryJobData, service),
          connection,
        );
        worker.on('failed', (job, err) => {
          new Logger('SummaryWorker').error(
            `Job ${job?.id ?? '<no-id>'} failed: ${err.message}`,
          );
        });
        return worker;
      },
      inject: [REDIS_CONNECTION, SummarizeService],
    },
  ],
  exports: [SUMMARY_QUEUE], // ExtractModule + CrawlModule 都需要 push 入队
})
export class SummarizeModule
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SummarizeModule.name);

  constructor(
    @Inject(SUMMARY_QUEUE) private readonly queue: Queue,
    @Inject(SUMMARY_WORKER) private readonly worker: Worker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Boot backstop: 处理两种情况：
    //  1) worker 上次崩前队列任务丢失但 row 已 ingest 完成（summary IS NULL）
    //  2) prompt 升级时人工 SQL UPDATE summary=NULL 之后等下次 worker restart backfill
    //  3) SP-4.7 在 SP-5 worker 没运行时抽取并 NULL 了 summary
    // 幂等：jobId='summarize-<id>'。
    const orphans = await getPrisma().hotNews.findMany({
      where: { status: 'VISIBLE', summary: null },
      select: { id: true },
    });
    for (const r of orphans) {
      await this.queue.add(
        'summarize',
        { hotNewsId: r.id },
        {
          jobId: `summarize-${r.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
    }
    this.logger.log(`Boot backstop: re-queued ${orphans.length} pending summarize jobs`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}
```

### 3.10 IngestionService 改动（与 SP-4.7 同一处）

详见 SP-4.7 spec §4.10。本 SP 与 SP-4.7 共享同一个改动 — 谁先 ship 谁主导这一段代码，另一个 SP review 时关注它没破坏自己的契约。

伪代码（同时含两 SP）：

```ts
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
  // ...（详 SP-4.7 spec §4.10）
}
```

### 3.11 .env.example 同步

```bash
# === SP-5 AI Summary + Tags ===
OPENROUTER_API_KEY=                  # required, get from https://openrouter.ai/settings/keys
SUMMARY_MODEL=deepseek/deepseek-v3.2 # optional, default
LLM_BASE_URL=https://openrouter.ai/api/v1  # optional, default (set to https://api.openai.com/v1 for direct OpenAI)
SUMMARY_CONCURRENCY=3                # optional, default 3
```

`docker/docker-compose.prod.yml` 不变（worker 服务的 `env_file: ../.env` 已覆盖所有变量）。

---

## 4. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| OpenRouter / DeepSeek 服务挂 | 中 | env 一行 swap：`SUMMARY_MODEL=openai/gpt-4o-mini` 或 `LLM_BASE_URL=https://api.openai.com/v1` + `SUMMARY_MODEL=gpt-4o-mini` 即可 hotswap；BullMQ 自动 retry 已经 attempt 失败的 job |
| LLM 返非法 JSON 比例 > 5% | 中 | parse.ts 鲁棒提取（regex 抓 `{...}`）+ bounded fallback 只取受控词表内 tag；试运行 24h 后看 `worker grep 'Failed to parse'` 比例，如果 > 5% 调 prompt（加 "严格 JSON 输出，无 markdown 包裹" 约束） |
| 中文 summary 长度严重偏离 80-150 字 | 低 | parse 截断到 400 字符上限（多余截掉）；如系统性偏短可改 prompt "至少 80 字"。temperature=0.2 已让长度稳定 |
| aiTags 全部命中受控词表外 → tags=[] | 低 | 受控词表 covers OpenAI/Anthropic/Google 等头部，tech 自由维度兜底；少数纯中国互联网公司（小红书 / 知乎）暂不在词表，等 SP-5.1 / 用户反馈后扩展 |
| HIDDEN 行被人工 status='VISIBLE' 后还是 summary=NULL | 低 | boot backstop 会扫到；要立即生效可手动 redis-cli 触发或 worker restart |
| Token 估算偏差导致月度成本超预算 | 低 | 24h smoke 后看 OpenRouter dashboard，超出预算 30% 时换 GPT-4o-mini（更便宜） |
| 同一 row 短时间内被多次 enqueue（ingest + SP-4.7 抽取后 + boot backstop）| 低 | jobId='summarize-<id>' 让 BullMQ 自动去重；若已在队列，新 add 直接 skip |
| Vercel AI SDK 升级 break | 低 | 锁定版本到 package.json 具体 patch，跟随 turbo 缓存，重大升级时单独 SP 处理 |
| LLM 把英文 summary 输出 | 低 | system prompt 显式要求中文；temperature=0.2；如出现 bug 加 user prompt 末尾"用中文回答" |
| Strategy `'skip:reason'` 被 BullMQ 看作成功消耗 attempts | 不会 | service.run 不抛错 → BullMQ 看 success → 不重试。语义正确 |

---

## 5. 测试策略

### 5.1 单元测试

| 文件 | 关键 case |
|---|---|
| `packages/prompts/test/taxonomy.spec.ts` | TAXONOMY 类型 readonly / companies 不重复 / categories 严格 8 项 / models 不重复 |
| `packages/prompts/test/summarize.prompt.spec.ts` | system prompt 含 OpenAI（受控词表渲染）/ user prompt 截断 6000 字 + 截断 hint / SUMMARIZE_PROMPT_VERSION 是 number |
| `packages/prompts/test/parse.spec.ts` | 完整合法 JSON / 缺 summary 字段返 null / 完全非法 JSON / 多余字段忽略 / category 非法值忽略 / company 不在词表忽略 / tech 自由维度通过 / 数组超 3 个截断 / summary 超 400 字符截断 / response 含前后噪音（如"好的，根据要求...{...}"）/ summary 空字符串返 null / 完全空 response 返 null |
| `apps/worker/src/summarize/llm-client.spec.ts` | 缺 OPENROUTER_API_KEY 抛错 / 默认 modelId 是 deepseek-v3.2 / env override 工作 |
| `apps/worker/src/summarize/strategies/summarize-all-visible.spec.ts` | VISIBLE → 'allow' / HIDDEN → 'skip:status_HIDDEN' / PENDING → 'skip:status_PENDING' |
| `apps/worker/src/summarize/summarize.service.spec.ts` | mock callLlm + prisma：(a) VISIBLE 行 + 合法 JSON → UPDATE summary+aiTags / (b) HIDDEN 行 → 不调 LLM / (c) row 不存在 → 跳过 / (d) LLM 返非法 JSON → summary 仍 NULL + 不抛错 / (e) UPDATE P2025 → 跳过 |
| `apps/worker/src/summarize/summarize.processor.spec.ts` | (a) 正常 job → service.run 调用 1 次 / (b) service throw → processor 抛 |
| `apps/worker/src/summarize/summarize.module.spec.ts` | boot backstop：mock prisma.findMany 返 N 行 → queue.add 调用 N 次 + jobId 形式 |

### 5.2 集成测试

`apps/worker/src/crawl/ingestion.service.integration.spec.ts` 加 case：

- **VISIBLE 行 ingest**（mock summary queue.add）→ summary queue.add 调用 1 次 + jobId='summarize-<created.id>'
- **HIDDEN 行 ingest**（filterReason 命中）→ summary queue.add **不**调用
- **链路从 ingest → BullMQ → service**（如果 testcontainers 可用，跑真 Redis）：mock LLM client，验证全链路（VISIBLE 行 ingest → queue → worker → DB UPDATE）

### 5.3 烟测（部署后）

- 部署完成后 ~30 分钟（boot backstop 跑完 + 一轮新 crawl 入队）：
  - `SELECT COUNT(*) FILTER (WHERE summary IS NOT NULL) FROM hot_news WHERE status='VISIBLE'` 应 > 0
  - 抽 5 条 `SELECT id, title, summary FROM hot_news WHERE summary IS NOT NULL ORDER BY publishedAt DESC LIMIT 5` 人工读 summary 是不是中文 80-150 字、与 title 内容相符
  - `SELECT unnest(aiTags) AS t, COUNT(*) FROM hot_news GROUP BY 1 ORDER BY 2 DESC LIMIT 30` 看 tag 分布合理（company:OpenAI / Anthropic / category:Release 应该高频出现）
- OpenRouter dashboard：查 24h 实际 token 消耗 + 总 spend，与估算 ($0.04/天 ~ $0.10/天) 对齐 ±50%

---

## 6. 部署运维

### 6.1 部署流程（push 到 main 触发 deploy.yml）

1. CI build worker image（含 SP-5 代码 + `@ai-hot-news/prompts` workspace 包，esbuild bundle 时 packages/prompts 的 ts 直接进 worker bundle）
2. `scripts/deploy.sh "sha-<commit>"`：
   - `prisma migrate deploy` → noop（SP-5 不动 schema）
   - `prisma db seed` → noop（SourceConfig 不变）
   - `docker compose up -d` → 拉新镜像
   - `restart worker` → 加载新代码 + boot backstop 跑（首次 deploy 时表里如果有 wipe 后陆续 ingest 的 NULL 行，boot backstop 会扫到入队）
3. deploy.sh 内置 smoke：`/api/health` + `/api/hot-news?pageSize=1` 双绿

### 6.2 Pre-flight：env 写入

在 SP-5 ship 之前 ssh prod，把 `OPENROUTER_API_KEY` 写到 `/srv/ai-hot-news/.env`。CI / GitHub Actions 不知道这个 key（不放 secret，因为 SP-5 worker 不在 CI 跑）；只 worker 容器的 `env_file:` 加载会读到。

### 6.3 AI 阶段开机一次性 wipe

详见 SP-4.7 spec §7.2。SP-4.7 / SP-5 共用一个 wipe 脚本，按"AI 阶段开机"执行一次（无论先 ship 哪个）。

如果 SP-5 是先 ship 的那个：

```bash
ssh deploy@<vps>
cd /srv/ai-hot-news

# Pre-flight：确认 env 已写
grep OPENROUTER_API_KEY .env
# 期望: OPENROUTER_API_KEY=sk-or-v1-...

# stop worker → wipe → start worker
docker compose -f docker/docker-compose.prod.yml --env-file .env stop worker
bash scripts/run-prod-oneshot.sh packages/db scripts/wipe-hot-news-pre-ai.ts
docker compose -f docker/docker-compose.prod.yml --env-file .env start worker
```

### 6.4 月度运维：prompt 升级触发批量重摘

prompt 文案改进时（SUMMARIZE_PROMPT_VERSION +1）：

```sql
-- 先在本地验证新 prompt 的效果，确认更好
-- ssh prod
ssh deploy@<vps>
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "UPDATE hot_news SET summary=NULL, \"aiTags\"='{}' WHERE summary IS NOT NULL"
-- 然后 restart worker
cd /srv/ai-hot-news
docker compose -f docker/docker-compose.prod.yml --env-file .env restart worker
-- worker 启动 → boot backstop 扫所有 NULL 行入队 → SP-5 重摘
```

成本：~3000 行 × $0.0004 ≈ **$1.2 一次性**。

### 6.5 应急回退

如果 LLM 持续失败（OpenRouter 挂 / API key 错 / DeepSeek 服务下线）：

```bash
# 临时停 SP-5：drain summary queue + worker stop summary processor
# 最简：直接 OPENROUTER_API_KEY 改成空 → llm-client 抛错 → BullMQ retry 直到 attempt 用尽
# 或 docker exec redis redis-cli DEL bull:summary:*

# 修好后：
# 1. 恢复 OPENROUTER_API_KEY（或换 SUMMARY_MODEL=openai/gpt-4o-mini）
# 2. restart worker → boot backstop 重新扫所有 summary IS NULL 入队
```

更激进：rollback to 上一个 worker image（deploy.yml 重 push 上一个 sha 即可）。SP-5 schema 是 noop migration，不会卡 rollback。

---

## 7. 不变量回顾

实施完成后必须仍然成立：

1. `HotNews.sourceUrl @unique` 不变
2. `dedupeHash` 算法不变
3. SP-4 的 `status='VISIBLE' && filterReason IS NOT NULL` count = 0
4. SP-4 的 `status='HIDDEN' && filterReason IS NULL` count = 0
5. SP-4.5 的 `RSS_INGEST_WINDOW_MS` / `PLATFORM_WINDOW_HOURS` / `DEFAULT_PLATFORMS` 行为不变
6. **新增**：`status='HIDDEN' && summary IS NOT NULL` count = 0（HIDDEN 行不入队，永远不该有 summary；wipe 后从 0 起）
7. **新增**：`aiTags != '{}' && EXISTS(unnest WHERE tag NOT LIKE '%:%')` count = 0（所有 tag 必须 prefix-encoded）
8. **新增**：`summary IS NOT NULL → length 5-400 字符`（parse.ts 截断保证）
9. `GET /hot-news` 默认仍只返 `status='VISIBLE'` 行
10. `apps/web` / `apps/api` DTO 零变化（summary/aiTags 暂不进 list response，等 SP-10 + SP-11 wire）
11. SP-4.7（如已 ship）的 `extractStatus` 状态机不被 SP-5 影响

---

## 8. 完成定义（DoD）

- [ ] `packages/prompts/` 工作区包创建完成（package.json + src/ + test/），`pnpm --filter @ai-hot-news/prompts run lint typecheck test` 全绿
- [ ] `apps/worker/package.json` 加 `ai` + `@ai-sdk/openai` + `@ai-hot-news/prompts: workspace:*`，`pnpm install` 成功
- [ ] `apps/worker/src/summarize/` 完整模块 + 单测 + 集成测试，ingestion.service 改动不破坏现有 integration spec
- [ ] `pnpm turbo run lint typecheck build test` 全绿（含新增 ~33 case）
- [ ] `.env.example` 加 OPENROUTER_API_KEY / SUMMARY_MODEL / LLM_BASE_URL 占位
- [ ] PR review 通过，merge 到 main，CI/Deploy 全绿
- [ ] AI 阶段开机：OPENROUTER_API_KEY 写到 `/srv/ai-hot-news/.env`、（如尚未 wipe）执行 wipe、worker restart
- [ ] 部署 ~30 分钟内：`/api/hot-news?pageSize=10` 返的 items 在 DB 里都有 summary（人工查 5-10 条质量合理）
- [ ] OpenRouter dashboard 24h 后查实际成本 ≤ $0.10/天
- [ ] decomposition design doc 加 SP-5 状态行 + 部署凭据
