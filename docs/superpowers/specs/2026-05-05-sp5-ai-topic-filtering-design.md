# SP-5 增强 — AI 主题过滤 + Quality 阈值提升 + 基础低频抓取（Phase 1, v3.2）

- **状态**：spec v3.2 final，待用户审核
- **类型**：SP-5 主体的 in-PR 增强（不是独立 SP）
- **依赖**：
  - SP-5 主体已实现（`feat/sp5-summary-tags` 分支前 13 个 commit + spec v3.1 commit）
  - SP-4.7 已合并（ArticleExtractor / jina chain）
  - `RedditCrawler.resolveUrl()` 已支持 `source.url` 透传（SP-3 预留）
- **不依赖**：SP-4.5（互不影响）
- **本文件**：`docs/superpowers/specs/2026-05-05-sp5-ai-topic-filtering-design.md`
- **预计工作量**：~3 小时（keywords.md parser + L0-skip 1 处改动 + quality 阈值提升 + Reddit seed + 频率调整迁移脚本 + wipe 脚本 + 测试）

## v3.2 关键变更（vs v3.1）


| 项                       | v3.1                           | **v3.2**                                   | 理由                                                             |
| ----------------------- | ------------------------------ | ------------------------------------------ | -------------------------------------------------------------- |
| 过滤层                     | L3a（extract 前）+ L3b（summary 前） | **L0-skip（ingest 入口）**                     | 更早过滤；不入库 vs 入 HIDDEN                                           |
| 不通过的处理                  | INSERT status=HIDDEN           | `**result.skipped++` 不入库**                 | HIDDEN 是死数据（无 score-update + API 不查 + KeywordMonitor 限定 AI 主题） |
| HN quality 阈值           | score>=5 OR desc>=2            | **score>=20 OR desc>=5**                   | 减 HN VISIBLE -50%                                              |
| SummarizeAiOnlyStrategy | 新建                             | **不需要**（保留 V1 SummarizeAllVisibleStrategy） | L0 已确保 hot_news 全是 AI                                          |
| Prod 部署                 | 跑 consolidate 脚本               | **+ 跑 wipe-hot-news-pre-sp5 脚本**           | 干净状态启动新逻辑                                                      |


## Phase 1 / Phase 2 架构定位

本 SP 仅做 Phase 1（基础低频抓 + L0 AI 主题过滤）。Phase 2 留给未来 SP：


| 阶段                    | 范围                                                  | 抓取频率                                        | 关键词来源                                         |
| --------------------- | --------------------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| **Phase 1（本 SP）**     | 基础低频全貌抓取 + L0 keywords 过滤（不入库非 AI）+ HN quality 阈值提升 | HN Top 60min / Ask&Show 4h / Reddit 2h      | 仓库根 `keywords.md`（17 词，开发者维护）                 |
| **Phase 2（未来 SP-7+）** | 用户订阅词 + 热点驱动高频源                                     | 临时高频 source（10min interval, 48h 自动 disable） | `KeywordMonitor` 表 + 自动检测（24h 内某词出现>10 次自动开启） |


Phase 2 的实现路径（已在当前架构内预留）：

- `source_configs` 表是 DB 驱动的，加/减/调频不需要改代码
- 未来 KeywordMonitor 上线时，可用同样架构动态加 high-frequency source
- 用户订阅词可聚合为 `subscribed-keywords.md`，prompts 包做 union（零架构改动）
- Phase 2 KeywordMonitor 的关键词限定在"出现在 AI 主题语境中的词"（如 "GPT-6" / "Sam Altman" / "Sora 2"），不支持脱离 AI 语境的关键词（如 "Cricket"），与产品定位一致

---

## 0. 背景与动机

### 0.1 SMOKE 实测数字

SP-5 主体本地 SMOKE 跑通后，发现两个独立但相关的痛点：


| 平台     | 抓取量/天        | AI 主题占比（估算） | jina extract 调用       | LLM 调用   |
| ------ | ------------ | ----------- | --------------------- | -------- |
| HN     | ~225 visible | ~30%        | ~217（96.4% link-post） | ~225     |
| Reddit | ~155 visible | ~95%        | ~84（53.7% link-post）  | ~155     |
| RSS    | ~10 visible  | ~100%       | 0                     | ~10      |
| **合计** | **~390**     | –           | **~301**              | **~390** |


加上 SP-4.7 jina extract 完成后会 reset summary=NULL 重入摘要队列：

- 实际 LLM 调用 ≈ 390 + ~~250 (jina 完成 re-summary) ≈ **~~640/天**

### 0.2 四个独立的成本问题


| 成本类型                               | 当前/天                              | 痛点级别                      | v3.2 解法                                               |
| ---------------------------------- | --------------------------------- | ------------------------- | ----------------------------------------------------- |
| **hot_news 表行数**                   | ~385 visible + ~325 hidden ≈ ~710 | 🟡 中（DB 占用 + UI 展示太多）     | **L0-skip + quality 阈值提升**（VISIBLE 减 51%，HIDDEN 减至 0） |
| jina API 调用                        | ~301                              | 🔴 高（jina 限流 + 成本压力）      | L0 已过滤入库，jina 自然 -62%                                 |
| LLM 调用（OpenRouter / DeepSeek-V3.2） | ~640                              | 🟡 中（~$0.45/月，可承受但浪费 65%） | L0 已过滤入库，LLM 自然 -53%                                  |
| Reddit HTTP 请求                     | 24                                | 🟢 低（无成本，但效率低）            | 8 sub→1 bundle + 1h→2h                                |
| HN HTTP 请求（Firebase）               | ~50,000                           | 🟢 零（HN 官方免费 + 无限流）       | 频率降低（Top 15min→60min, Ask&Show 30min→4h）              |


> 注：v3.2 把所有过滤集中到 L0（ingest 入口），下游 jina/LLM/UI 自然减压。

### 0.3 关键洞察 1：HIDDEN 是死数据

调研当前代码（`apps/worker/src/crawl/ingestion.service.ts:151`）：

- dedupe 冲突（P2002）只 `result.skipped += 1`，**不 update 已存在行**
- `apps/api/src/hot-news/hot-news.service.ts:34` 硬编码 `status: ContentStatus.VISIBLE`，**HIDDEN 永远不到前端**
- 没有定时任务扫 HIDDEN 重评估、没有手动 re-promote

意味着：HN 帖子第一次抓到 score=2 → HIDDEN，5 小时后冲到 score=50 → P2002 skip → **永远是 HIDDEN**，UI 永远看不到。HIDDEN = 占空间的死数据。

### 0.4 关键洞察 2：jina 痛点不是 "HN 抓多" 而是 "extract 不分主题"

`IngestionService` 当前逻辑（SP-4.7 实现）：所有 VISIBLE link-post → 触发 jina extract，不分主题。HN 96.4% 是 link-post + 70% 非 AI = **大量 jina 调用花在抓非 AI 内容的正文**。

### 0.5 KeywordMonitor 未来需求（限定 AI 主题）

PRD 设计了 `KeywordMonitor` 表（已 schema），用户可订阅关键字。**v3.2 决策：限定 AI 主题范围**。

理由：用户在 AI 资讯产品订阅的关键词 99% 落在 keywords.md 命中范围内：

- "GPT-6" / "Sora 2" → 出现在 OpenAI/LLM 语境，命中
- "Sam Altman" / "Dario Amodei" → 出现在 OpenAI/Anthropic 语境，命中
- "Claude 4.5" / "Cursor 1.0" → 已在 keywords.md
- "Cricket" → 不命中（也不是 AI 资讯产品的用例）

### 0.6 解决方案：L0-skip + Quality 阈值提升 + 基础抓取低频化

```
┌────────────────────────────────────────────────────────────┐
│ HN Firebase ~250 候选/天 (Top 60min/Ask&Show 4h)            │
│ Reddit 13 sub bundle ~145 候选/天 (2h interval)             │
│ RSS 7 厂商 ~10 候选/天 (24h, 不变)                          │
└────────────────────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────────────┐
│ IngestionService.ingest() — L0-skip 入口过滤                │
│  ├─ time window check                                       │
│  ├─ sourceUrl check                                         │
│  ├─ Quality check (HN score>=20 OR desc>=5)                 │
│  │    └─ fail: result.skippedQuality++, 不入库              │
│  ├─ L0: matchesAiTopic(title + content[:500])               │
│  │    └─ fail: result.skippedNonAi++, 不入库                │
│  └─ pass:                                                   │
│       ├─ INSERT hot_news (status=VISIBLE)                   │
│       ├─ SummaryQueue.add()                                 │
│       └─ if isLinkPost: ExtractQueue.add()                  │
└────────────────────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────────────┐
│ SummarizeService.run() — 沿用 V1 SummarizeAllVisibleStrategy │
│  ├─ status != VISIBLE → skip                                │
│  └─ status == VISIBLE → callLlm + write summary             │
│   (hot_news 表已全是 AI 主题 + 通过 quality, 无需再过滤)    │
└────────────────────────────────────────────────────────────┘

L0-skip：一处过滤，下游 jina/LLM/DB/UI 全部受益
Quality 阈值提升：HN VISIBLE 减 50%（保留高热度内容）
基础低频抓取：减 HTTP 流量 ~75%（HN）+ ~50%（Reddit）
```

---

## 1. 范围决策


| 优化点                                                                             | 本 PR | 后续 SP             | 理由                                                         |
| ------------------------------------------------------------------------------- | ---- | ----------------- | ---------------------------------------------------------- |
| **L0-skip：ingest 入口用 keywords 过滤，非 AI 不入库**                                     | ✅    | –                 | 一处过滤，下游 jina/LLM/DB/UI 全部受益                                |
| **HN quality 阈值提升（score>=20 OR desc>=5）**                                       | ✅    | –                 | 减 HN VISIBLE 50%，过滤低热度噪音                                   |
| **IngestResult 扩展 by-reason 计数（skippedQuality / skippedNonAi / skippedDedupe）** | ✅    | –                 | 替代 HIDDEN 表的调试用途                                           |
| **wipe-hot-news-pre-sp5.ts 一次性脚本**                                              | ✅    | –                 | 干净状态启动新逻辑，避免新旧数据混杂                                         |
| Reddit 13 sub bundle（`seed.ts` 改）                                               | ✅    | –                 | 零代码改动（SP-3 已预留 `source.url` 透传），HTTP 减 50% + sub 多样性提升     |
| `keywords.md` AI 词表                                                             | ✅    | –                 | L0 唯一依赖                                                    |
| 基础抓取频率降低（HN Top 15min→60min, Ask&Show 30min→4h, Reddit 1h→2h）                   | ✅    | –                 | HTTP 减 75%，几乎零错过率                                          |
| L3a / L3b（extract / summary 前过滤）                                                | ❌    | –                 | 被 L0-skip 取代（L0 过滤入库，下游自然不需要再过滤）                           |
| `SummarizeAiOnlyStrategy`                                                       | ❌    | –                 | 同上，保留 V1 `SummarizeAllVisibleStrategy`                     |
| HN Algolia crawler 替换 Firebase                                                  | ❌    | 暂不需要              | KeywordMonitor 限定 AI 主题，Firebase 已够用                       |
| LLM 自判断（兜底捕获 keywords 漏网）                                                       | ❌    | 视上线后实测决定          | 当前成本已足够低，先观察 keywords 命中率                                  |
| score-update 复活机制（HN 第二次抓到 score 涨了，能升级状态）                                      | ❌    | 独立优化 SP           | 当前 PR scope 控制；策略 C 兼容（被 skip 的帖子第二次抓到分数已高，自然以 VISIBLE 入库） |
| KeywordMonitor + 按需高频源                                                          | ❌    | Phase 2（未来 SP-7+） | 等用户订阅功能上线后做；当前架构已支持动态加 source                              |


---

## 2. 架构总览

### 2.1 数据流变化

**当前（SP-5 主体 + SP-4.7）**：

```
HN Firebase (500/15min) ─┐
Reddit 8 sub (各 25/h) ──┼─→ IngestionService → 所有 VISIBLE 行：
RSS 7 feed ────────────────┘    ├─→ SummaryQueue (全部调 LLM)
                                └─→ if isLinkPost: ExtractQueue (全部调 jina)
```

**改造后 v3.2**：

```
HN Firebase (500/60min, 频率降低) ─┐
Reddit 13 sub bundle (100/2h) ─────┼─→ IngestionService.ingest():
RSS 7 feed (24h, 不变) ─────────────┘    ├─ time window check
                                          ├─ sourceUrl check
                                          ├─ Quality check (HN score>=20 OR desc>=5)
                                          │   └─ fail → result.skippedQuality++, 不入库
                                          ├─ L0: matchesAiTopic(title + content[:500])
                                          │   └─ fail → result.skippedNonAi++, 不入库
                                          └─ pass:
                                              ├─ INSERT hot_news (status=VISIBLE)
                                              ├─ SummaryQueue.add()
                                              └─ if isLinkPost: ExtractQueue.add()
                                                  ↑ 下游全部是 AI + 高质量内容

SummaryQueue → SummarizeService（沿用 V1 SummarizeAllVisibleStrategy）:
  ├─ status != VISIBLE → skip
  └─ status == VISIBLE → callLlm + write summary
                ↑ 不需要再过滤 keywords，hot_news 表已全是 AI 主题
```

### 2.2 文件改动清单

```
新增（仓库根）：
  keywords.md                                            ✓ 已 commit (73797ed)

新增（packages/prompts）：
  packages/prompts/build.mjs                             (build 时 copy keywords.md + esbuild)
  packages/prompts/src/keywords.ts                       (parser + matcher)
  packages/prompts/src/keywords.spec.ts                  (单测：parser + matcher)
  packages/prompts/.gitignore                            (忽略 src/keywords.md auto-copy)

新增（db）：
  packages/db/scripts/consolidate-sp5-sources.ts         (一次性 prod 迁移：Reddit bundle + HN 频率)
  packages/db/scripts/consolidate-sp5-sources.spec.ts    (幂等性测试)
  packages/db/scripts/wipe-hot-news-pre-sp5.ts           ⭐ v3.2：清空 hot_news 表
  packages/db/scripts/wipe-hot-news-pre-sp5.spec.ts      ⭐ v3.2：测试

修改：
  packages/utils/src/quality.ts                          ⭐ HN_LOW_SCORE 5→20, HN_LOW_DESCENDANTS 2→5
  packages/utils/src/quality.spec.ts                     ⭐ 更新 HN cases
  packages/prompts/package.json                          (build 改为 node build.mjs)
  packages/prompts/src/index.ts                          (+exports keywords / matchesAiTopic)
  apps/worker/src/crawl/ingestion.service.ts             ⭐ L0-skip 过滤 + IngestResult by-reason 计数
  apps/worker/src/crawl/ingestion.service.spec.ts        ⭐ +L0 + quality 阈值 cases
  packages/db/prisma/seed.ts                             (Reddit bundle source + HN 频率调整)

不再需要（vs v3.1 计划）：
  ❌ apps/worker/src/summarize/strategies/summarize-ai-only.strategy.ts（保留 V1 strategy 即可）
  ❌ apps/worker/src/summarize/strategies/summarize-ai-only.strategy.spec.ts
  ❌ apps/worker/src/summarize/strategies/strategy.interface.ts 的 +title +content 扩展
  ❌ apps/worker/src/summarize/summarize.service.ts 的 strategy 输入改动
  ❌ apps/worker/src/summarize/summarize.service.spec.ts 的 skip:not_ai_topic case
  ❌ apps/worker/src/summarize/summarize.module.ts 的 strategy 替换
```

文件改动总计：**9 新增 + 7 修改 = 16 个文件**（数量同 v3.1，但实现路径更简单：summarize 模块零改动）。

---

## 3. `keywords.md` 词表

### 3.1 文件位置

`<repo-root>/keywords.md`（仓库根目录），便于人工编辑，无需深入子目录。

`packages/prompts` 在 build 时自动从仓库根 copy 到 `packages/prompts/src/keywords.md`，再由 esbuild 打包进 `dist/index.js`（详见 §3.5）。这保证：

- ✅ 单一事实源：仓库根 `keywords.md` 是唯一可编辑的版本
- ✅ Build 输出自包含：`packages/prompts/dist/` 包含编译后的 keywords，docker 镜像不需要单独 ship `keywords.md`
- ✅ Test 环境一致：vitest 测试也基于 build 后的 dist

### 3.2 格式约定（兼容三种）

Parser 兼容以下任一格式（可混合使用）：

**格式 A：单行逗号分隔**（紧凑，当前用户使用）：

```
LLM, LLMs, AGI, RAG, Vibe Coding, AI, Agent, Vibe Design, AI Agent, ...
```

**格式 B：每行一个词**：

```
LLM
LLMs
AGI
RAG
```

**格式 C：Markdown 列表（带分组）**：

```markdown
# AI Topic Keywords

## Tech Terms
- LLM
- LLMs

## Companies
- OpenAI
- Anthropic
```

通用规则：

- 大小写不敏感
- Word boundary（`\b...\b`）：不会被嵌入其它单词中误匹配（`"Spain"` 不会被 `AI` 命中）
- 多词短语用空格分隔（`"AI Agent"` 整体匹配）
- 行首 `#`、`<!--` 被忽略（注释行）
- 空行 / 仅 whitespace 行 被忽略
- 列表前缀（`-` / `*`）被自动剥离
- 内联逗号被作为分隔符切分

### 3.3 初始词表（17 词）

用户已提供（仓库根 `keywords.md`）：

```
LLM, LLMs, AGI, RAG, Vibe Coding, AI, Agent, Vibe Design, AI Agent, 
Context Engineering, AI Coding, Claude Code, OpenAI, Anthropic, 
Codex, Multi-agent, Harness
```

**词表特点**：

- 强信号词（13）：LLM, LLMs, AGI, RAG, Vibe Coding, Vibe Design, AI Agent, Context Engineering, AI Coding, Claude Code, OpenAI, Anthropic, Multi-agent
- 中等假阳性词（4）：AI / Agent / Codex / Harness
- **接受的策略**：HN/Reddit 上下文中假阳性概率低；上线后若发现误判可手工删词
- **演进路径**：未来 KeywordMonitor 上线时，可聚合用户订阅词写入 `subscribed-keywords.md`，prompts 包同时 import 两个文件做 union（零架构改动）

### 3.4 加载与匹配逻辑

```typescript
// packages/prompts/src/keywords.ts

import keywordsRaw from './keywords.md';  // build 时从仓库根 copy

export const KEYWORDS = parseKeywords(keywordsRaw);
const AI_TOPIC_REGEX = buildMatcher(KEYWORDS);

export function parseKeywords(raw: string): string[] {
  const tokens: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('<!--')) continue;
    
    const stripped = line.replace(/^[-*]\s+/, '');
    
    for (const piece of stripped.split(',')) {
      const word = piece.trim();
      if (word) tokens.push(word);
    }
  }
  // dedupe (case-insensitive)
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const t of tokens) {
    const k = t.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(t);
    }
  }
  return uniq;
}

function buildMatcher(keywords: string[]): RegExp {
  if (keywords.length === 0) return /^(?!)$/;
  const escaped = keywords
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);  // longer first → prefer multi-word matches
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

export function matchesAiTopic(text: string | null | undefined): boolean {
  if (!text) return false;
  return AI_TOPIC_REGEX.test(text);
}
```

### 3.5 Build 流程：从仓库根 copy + esbuild

`packages/prompts/build.mjs`：

```javascript
import { copyFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { build } from 'esbuild';

const repoRoot = resolve(process.cwd(), '../..');
const srcKeywords = resolve(repoRoot, 'keywords.md');
const dstKeywords = resolve(process.cwd(), 'src/keywords.md');

if (!existsSync(srcKeywords)) {
  console.error(`ERROR: ${srcKeywords} not found. Create it before building.`);
  process.exit(1);
}

copyFileSync(srcKeywords, dstKeywords);
console.log(`Copied ${srcKeywords} → ${dstKeywords}`);

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist/index.js',
  external: ['*'],
  loader: { '.md': 'text' },
});
console.log('Build OK');
```

`packages/prompts/package.json` 的 build 脚本：

```json
{ "scripts": { "build": "node build.mjs" } }
```

`packages/prompts/.gitignore`：

```
src/keywords.md  # auto-copied from repo root at build time
```

测试环境（Vitest）通过 `vite-plugin-string` 或在 `vitest.config.ts` 中对 `.md` 配 raw transformer。

---

## 4. L0-skip：IngestionService 入口过滤

### 4.1 当前代码

`apps/worker/src/crawl/ingestion.service.ts` 现状（SP-4 + SP-4.7 实现）：

```typescript
const cleanTitle = stripTitleBoilerplate(raw.title);
const cleanContent = stripContentBoilerplate(raw.contentText);
const dedupeHash = computeDedupeHash(sourceUrl, cleanTitle);

const finalReason = raw.filterReason ?? checkUniversalQuality({ title: cleanTitle });
const status: ContentStatus = finalReason ? ContentStatus.HIDDEN : ContentStatus.VISIBLE;

try {
  const created = await prisma.hotNews.create({ data: { ..., status, filterReason: finalReason ?? null } });
  if (status === ContentStatus.HIDDEN) {
    result.hidden += 1;
  } else {
    result.inserted += 1;
    await this.summaryQueue.add('summarize', { hotNewsId: created.id }, ...);
    if (isLinkPost) {
      await this.extractQueue.add('extract', { hotNewsId: created.id }, ...);
    }
  }
} catch (createErr) {
  if ((createErr as { code?: string }).code === 'P2002') result.skipped += 1;
}
```

### 4.2 改造（L0-skip + by-reason 计数）

**关键：改 `IngestResult` 接口加 by-reason 计数；改 ingest() 把 quality fail / non-AI 都改为 `skipped++` 不入库（不再 INSERT HIDDEN 行）**。

```typescript
// 1. 接口扩展
export interface IngestResult {
  fetched: number;
  inserted: number;
  skipped: number;            // 总 skip（向后兼容）
  skippedQuality: number;     // ⭐ 新增
  skippedNonAi: number;       // ⭐ 新增
  skippedDedupe: number;      // ⭐ 新增（P2002）
  hidden: number;             // 保留字段（v3.2 始终为 0，方便逐步淘汰）
  failed: number;
}

// 2. ingest() 主循环改造
import { matchesAiTopic } from '@ai-hot-news/prompts';
import { FILTER_REASONS } from '@ai-hot-news/utils';

for (const raw of items) {
  try {
    if (!isWithinIngestWindow(raw, source, new Date())) {
      result.skipped += 1;
      continue;
    }
    if (!raw.sourceUrl) {
      result.skipped += 1;
      continue;
    }
    const sourceUrl = normalizeUrl(raw.sourceUrl);
    const cleanTitle = stripTitleBoilerplate(raw.title);
    const cleanContent = stripContentBoilerplate(raw.contentText);
    const dedupeHash = computeDedupeHash(sourceUrl, cleanTitle);

    // Quality check
    const qualityReason = raw.filterReason ?? checkUniversalQuality({ title: cleanTitle });
    if (qualityReason) {
      result.skipped += 1;
      result.skippedQuality += 1;
      continue;  // ⭐ v3.2: 不入库（v3.1 是 INSERT status=HIDDEN）
    }

    // L0: AI topic check (matches title or content[:500])
    const probe = `${cleanTitle}\n${cleanContent.slice(0, 500)}`;
    if (!matchesAiTopic(probe)) {
      result.skipped += 1;
      result.skippedNonAi += 1;
      continue;  // ⭐ v3.2: 不入库
    }

    // 走到这里都是 AI + 通过 quality, 必然 VISIBLE
    try {
      const created = await prisma.hotNews.create({
        data: {
          title: cleanTitle,
          content: cleanContent,
          rawHtml: raw.rawHtml,
          sourcePlatform: source.platform,
          sourceUrl,
          author: raw.author,
          publishedAt: raw.publishedAt ?? new Date(),
          dedupeHash,
          status: ContentStatus.VISIBLE,  // ⭐ 总是 VISIBLE
          filterReason: null,              // ⭐ 总是 null
          ...(raw.interactionData != null
            ? { interactionData: raw.interactionData as Prisma.InputJsonValue }
            : {}),
        },
      });
      result.inserted += 1;
      await this.summaryQueue.add('summarize', { hotNewsId: created.id }, { ... });

      const extUrl = (raw.interactionData as { externalUrl?: string } | null)?.externalUrl;
      const isLinkPost = typeof extUrl === 'string' &&
        /^https?:/.test(extUrl) &&
        cleanContent === cleanTitle;
      if (isLinkPost) {
        await prisma.hotNews.update({ where: { id: created.id }, data: { extractStatus: 'PENDING' } });
        await this.extractQueue.add('extract', { hotNewsId: created.id }, { ... });
      }
    } catch (createErr) {
      if ((createErr as { code?: string }).code === 'P2002') {
        result.skipped += 1;
        result.skippedDedupe += 1;
      } else {
        throw createErr;
      }
    }
  } catch (err) {
    this.logger.warn(`Ingest item failed: ${raw.sourceUrl} → ${(err as Error).message}`);
    result.failed += 1;
  }
}

// 3. ingest() 末尾的日志（每个 source 一行）
this.logger.log(
  `[Ingest] ${source.platform} ${source.name}: ` +
  `fetched=${result.fetched} inserted=${result.inserted} ` +
  `skipped=${result.skipped} (quality=${result.skippedQuality} ` +
  `nonAi=${result.skippedNonAi} dedupe=${result.skippedDedupe}) ` +
  `failed=${result.failed}`
);
```

### 4.3 quality.ts 阈值提升

`packages/utils/src/quality.ts`：

```typescript
const HN_LOW_SCORE = 20;       // 5 → 20
const HN_LOW_DESCENDANTS = 5;  // 2 → 5
// Reddit/RSS/Universal 阈值不变
```

> 选择 `score>=20 OR desc>=5`（OR 关系）：保留高分热门帖，但也允许评论热但分数不高的讨论帖（Ask HN 常见）。

### 4.4 副作用


| 场景                          | 当前行为 (v3.1)                                  | v3.2 改造后                                 |
| --------------------------- | -------------------------------------------- | ---------------------------------------- |
| AI + quality OK             | INSERT VISIBLE → SummaryQueue + ExtractQueue | ✅ 不变                                     |
| 非 AI（任何 quality）            | INSERT HIDDEN（占空间）                           | ⏩ skipped++, **不入库**                     |
| AI + quality fail           | INSERT HIDDEN（占空间）                           | ⏩ skipped++, **不入库**                     |
| dedupe 冲突 (P2002)           | result.skipped++                             | result.skipped+++ result.skippedDedupe++ |
| RSS（100% AI + 无 quality 检查） | INSERT VISIBLE                               | ✅ 不变                                     |


### 4.5 数字推演

#### 4.5.1 频率调整后的"候选数"（dedupe 后未过滤前）


| 源                      | 当前 interval | Phase 1 interval | 候选数/天             |
| ---------------------- | ----------- | ---------------- | ----------------- |
| HN Top                 | 15min       | **60min**        | ~210 (-5%, 几乎零错过) |
| HN Ask                 | 30min       | **4h**           | ~25 (略减)          |
| HN Show                | 30min       | **4h**           | ~18 (略减)          |
| Reddit bundle (13 sub) | 1h          | **2h**           | ~145              |
| RSS 7 厂商               | 24h         | 24h              | ~10               |
| **合计候选**               | –           | –                | **~408**          |


#### 4.5.2 L0-skip + 新 quality 阈值后的最终入库

每条候选两个独立属性：是否 AI 主题、是否通过 quality。

```
HN Top 候选 ~210/天:
  ├─ AI (~30%) + quality OK (~50%): ~32 → INSERT VISIBLE ⭐
  ├─ AI + quality fail: ~32 → skippedQuality
  ├─ non-AI + quality OK: ~73 → skippedNonAi
  └─ non-AI + quality fail: ~73 → skippedQuality (qualityReason 优先)

HN Ask 候选 ~25/天: 通过率约 ~40% (AI + quality)
  → ~10 → INSERT VISIBLE

HN Show 候选 ~18/天: 通过率约 ~40%
  → ~7 → INSERT VISIBLE

Reddit bundle 候选 ~145/天:
  ├─ AI (~95%) + quality OK (~95%): ~131 → INSERT VISIBLE
  └─ rest: ~14 → skipped

RSS 候选 ~10/天: 100% AI + 100% pass quality
  → ~10 → INSERT VISIBLE

合计 INSERT (=DB 行数 = VISIBLE):
  ~32 + 10 + 7 + 131 + 10 = ~190/天

合计 skipped:
  ~408 - 190 = ~218/天
  ├─ skippedQuality: ~178 (主要是 HN 低热度)
  ├─ skippedNonAi:    ~73 (主要是 HN 高热度但非 AI)
  └─ skippedDedupe:   动态（视抓取重复率）
```

#### 4.5.3 下游影响

```
INSERT/天: ~190 → 全部 enqueue SummaryQueue
  └─ SummarizeAllVisibleStrategy → 全部 callLlm
       → LLM 调用 (initial) = ~190

ExtractQueue 触发 = link-post 子集:
  HN VISIBLE link-post: ~32 + 10 + 7 ≈ ~49 × 96% ≈ ~47
  Reddit VISIBLE link-post: ~131 × 54% ≈ ~71
  RSS link-post: 0
  → jina 调用 = ~47 + 71 = ~118

Extract 完成后 reset summary=NULL → re-summarize:
  → LLM 调用 (re-summary) = ~118

合计:
  jina extract: ~118/天 (vs 当前 ~301，减 ~61%)
  LLM 调用: ~190 + 118 = ~308/天 (vs 当前 ~640，减 ~52%)
```

#### 4.5.4 综合对比（当前 vs v3.2）


| 指标                           | 当前/天                      | **v3.2/天** | 减压         |
| ---------------------------- | ------------------------- | ---------- | ---------- |
| HN HTTP 请求                   | ~50,000                   | ~12,360    | **-75%**   |
| Reddit HTTP 请求               | ~24                       | ~12        | **-50%**   |
| **hot_news 表入库行数（=VISIBLE）** | ~385 + ~325 hidden ≈ ~710 | **~190**   | **-73%** ⭐ |
| jina extract 调用              | ~301                      | ~118       | **-61%**   |
| LLM 调用                       | ~640                      | ~308       | **-52%**   |
| 月 LLM 成本（OpenRouter DS-v3.2） | ~$0.45                    | ~$0.21     | **-53%**   |


---

## 5. SummarizeService（保持 V1，不需要 strategy 切换）

v3.2 不再需要 `SummarizeAiOnlyStrategy`，因为 L0-skip 已确保 hot_news 表全是 AI 主题。

直接保留 SP-5 主体的 V1 strategy：

```typescript
// apps/worker/src/summarize/summarize.module.ts
useFactory: (): SummarizationStrategy => new SummarizeAllVisibleStrategy(),
```

`SummarizeAllVisibleStrategy.shouldSummarize(row)`：

- `row.status === 'VISIBLE'` → `'allow'`
- 其他 → `skip:status_*`

由于 v3.2 中所有 hot_news 行都是 VISIBLE，strategy 实际就是 100% allow，正确反映了"已在 ingest 阶段过滤"的事实。

**好处**：

- 零 summarize 模块改动 → PR diff 更小
- 一行 useFactory 回滚（如果未来切回 hidden 模式）
- 单一过滤层，逻辑简单

---

## 6. Reddit 13 sub Bundle

### 6.1 Bundle URL

```
https://www.reddit.com/r/ChatGPT+OpenAI+singularity+ArtificialInteligence+artificial+ClaudeAI+PromptEngineering+AI_Agents+vibecoding+LLMDevs+cursor+agi+LangChain/hot.json?limit=100&raw_json=1
```

13 个 sub（用户在 brainstorming 阶段选定）：


| Sub                   | 订阅    | 内容偏向               |
| --------------------- | ----- | ------------------ |
| ChatGPT               | 11.5M | ChatGPT 用户场景       |
| OpenAI                | 2.74M | OpenAI 产品讨论        |
| singularity           | 3.89M | AGI / 未来主义         |
| ArtificialInteligence | 1.79M | 通用 AI 综合（注意拼错）     |
| artificial            | 1.26M | 通用 AI 新闻           |
| ClaudeAI              | 821K  | Claude 产品讨论        |
| PromptEngineering     | 371K  | Prompt 工程实践        |
| AI_Agents             | 356K  | Agentic 系统专项       |
| vibecoding            | 246K  | AI 辅助编程文化          |
| LLMDevs               | 146K  | LLM 开发者            |
| cursor                | 135K  | Cursor IDE / AI 编程 |
| agi                   | 111K  | AGI 讨论             |
| LangChain             | 97K   | LangChain 开发       |


### 6.2 Source 配置

```typescript
{
  id: 'reddit-ai-bundle-v1',
  platform: 'REDDIT',
  name: 'AI Subreddit Bundle (13 subs hot)',
  identifier: null,
  url: '<上方 URL>',
  enabled: true,
  crawlInterval: 7200,   // 2h（Phase 1 低频）
  status: 'NORMAL',
}
```

### 6.3 实测数据（验证）

实测 1h × limit=100 的 sub 分布：

```
按 sub 分布（实测）：
  r/ArtificialInteligence  15
  r/agi                    12
  r/ChatGPT                11
  r/PromptEngineering      11
  r/LangChain              11
  r/AI_Agents               9
  r/LLMDevs                 8
  r/ClaudeAI                5
  r/singularity             5
  r/cursor                  4
  r/vibecoding              3
  r/OpenAI                  3
  r/artificial              3

时间分布: 最新 0.1h | 中位 6.4h | 最旧 29.0h
互动: top 3982up / 中位 15up / 末位 0up
```

### 6.4 兼容性（零代码改动）

`RedditCrawler.resolveUrl()` 已实现 `source.url` 透传（SP-3 line 605-606）：

```typescript
private resolveUrl(): string {
  if (this.source.url && this.source.url.trim().length > 0) {
    return this.source.url;
  }
  ...
}
```

`subredditHint` 处理（line 79）：

```typescript
const subreddit = subredditHint ?? p.subreddit ?? 'unknown';
```

`identifier=null` → `subredditHint=null` → fallback 到 `p.subreddit`（每条帖子自带的 sub 名称），`sourceUrl` 会正确生成为 `https://www.reddit.com/r/{真实sub}/comments/{id}`。

### 6.5 限流与回滚

- `limit=100` 是 Reddit 服务端硬上限（实测传 200/500 也只返回 100）
- 1h 间隔远低于 Reddit anonymous rate limit
- URL 长度 191 chars，远低于 2KB 限制
- 旧 8 sub 保留为 `enabled=false`，1 行 SQL 即可回滚

---

## 7. Prod 一次性迁移脚本

### 7.1 频率调整一览表（Phase 1）


| 平台         | Source                       | 当前 crawlInterval | Phase 1 crawlInterval | 处理方式             |
| ---------- | ---------------------------- | ---------------- | --------------------- | ---------------- |
| HACKERNEWS | HackerNews Top               | 900 (15min)      | **3600 (60min)**      | UPDATE 现有 source |
| HACKERNEWS | HackerNews Ask               | 1800 (30min)     | **14400 (4h)**        | UPDATE 现有 source |
| HACKERNEWS | HackerNews Show              | 1800 (30min)     | **14400 (4h)**        | UPDATE 现有 source |
| REDDIT     | r/LocalLLaMA + 7 个旧 sub      | 3600 (1h)        | –                     | DISABLE（保留行）     |
| REDDIT     | AI Subreddit Bundle (13 sub) | –                | **7200 (2h)**         | INSERT 新 source  |
| RSS        | 7 个厂商 feed                   | 86400 (24h)      | 86400 (24h)           | 不变               |


### 7.2 `consolidate-sp5-sources.ts`

位置：`packages/db/scripts/consolidate-sp5-sources.ts`。涵盖 Reddit + HN 频率调整。

```typescript
const REDDIT_OLD_SUBS = ['LocalLLaMA', 'MachineLearning', 'artificial', 'OpenAI',
                         'ChatGPT', 'ClaudeAI', 'singularity', 'StableDiffusion'];
const REDDIT_BUNDLE_ID = 'reddit-ai-bundle-v1';
const REDDIT_BUNDLE_URL = 'https://www.reddit.com/r/ChatGPT+OpenAI+singularity+ArtificialInteligence+artificial+ClaudeAI+PromptEngineering+AI_Agents+vibecoding+LLMDevs+cursor+agi+LangChain/hot.json?limit=100&raw_json=1';

const HN_INTERVAL_TOP = 3600;        // 60min
const HN_INTERVAL_ASK_SHOW = 14400;  // 4h
const REDDIT_INTERVAL_BUNDLE = 7200; // 2h

export interface ConsolidateResult {
  reddit: { disabled: number; inserted: boolean };
  hackernewsIntervalsUpdated: number;
}

export async function consolidateSp5Sources(): Promise<ConsolidateResult> {
  // 1. Reddit: 旧 8 sub disabled (幂等)
  const redditDisabled = await prisma.sourceConfig.updateMany({
    where: { platform: 'REDDIT', identifier: { in: REDDIT_OLD_SUBS }, enabled: true },
    data: { enabled: false },
  });

  // 2. Reddit: 新 bundle 插入 (幂等)
  const existing = await prisma.sourceConfig.findUnique({ where: { id: REDDIT_BUNDLE_ID } });
  let redditInserted = false;
  if (!existing) {
    await prisma.sourceConfig.create({
      data: {
        id: REDDIT_BUNDLE_ID, platform: 'REDDIT',
        name: 'AI Subreddit Bundle (13 subs hot)',
        identifier: null, url: REDDIT_BUNDLE_URL,
        enabled: true, crawlInterval: REDDIT_INTERVAL_BUNDLE, status: 'NORMAL',
      },
    });
    redditInserted = true;
  }

  // 3. HN: 调整频率（保留 source 不变，只改 crawlInterval）
  const hnTop = await prisma.sourceConfig.updateMany({
    where: { platform: 'HACKERNEWS', identifier: 'top' },
    data: { crawlInterval: HN_INTERVAL_TOP },
  });
  const hnAskShow = await prisma.sourceConfig.updateMany({
    where: { platform: 'HACKERNEWS', identifier: { in: ['ask', 'show'] } },
    data: { crawlInterval: HN_INTERVAL_ASK_SHOW },
  });

  return {
    reddit: { disabled: redditDisabled.count, inserted: redditInserted },
    hackernewsIntervalsUpdated: hnTop.count + hnAskShow.count,
  };
}
```

### 7.3 `wipe-hot-news-pre-sp5.ts` ⭐ v3.2 新增

位置：`packages/db/scripts/wipe-hot-news-pre-sp5.ts`。一次性清空 `hot_news` 表，让新 L0-skip + quality 阈值的逻辑从干净状态开始。

```typescript
import { getPrisma } from '@ai-hot-news/db';

export interface WipeResult {
  before: number;
  deleted: number;
  after: number;
}

export async function runWipe(): Promise<WipeResult> {
  const prisma = getPrisma();
  const before = await prisma.hotNews.count();
  console.log(`[wipe-pre-sp5] Before: ${before} rows`);

  const result = await prisma.hotNews.deleteMany({});
  const after = await prisma.hotNews.count();
  console.log(`[wipe-pre-sp5] Deleted ${result.count} rows, after: ${after}`);

  return { before, deleted: result.count, after };
}

async function main(): Promise<void> {
  const stats = await runWipe();
  console.log(JSON.stringify(stats, null, 2));
}

const isMainEntry = typeof require !== 'undefined' && require.main === module;
const isTsxEntry = process.argv[1]?.endsWith('wipe-hot-news-pre-sp5.ts');

if (isMainEntry || isTsxEntry) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

> 实现完全参照 SP-4.5 的 `wipe-hot-news-pre-ai.ts`。语义改为"在 SP-5 v3.2 上线前清空"。

### 7.4 调用方式

`packages/db/build` 仅编译 `src/index.ts`，**不会**把 `scripts/*.ts` 编进 `dist/`。Worker 镜像里 `packages/db/scripts/`* 仍是 TypeScript 源文件，必须通过 `npx tsx` 运行。Prod 用 SP-4.7 引入的统一 wrapper `scripts/run-prod-oneshot.sh` 调用：

```bash
# Prod 运行（顺序：停 worker → 先清空，再调整 source_configs → 重启 worker）：
cd /srv/ai-hot-news

# Backup before destructive wipe:
docker compose -f docker/docker-compose.prod.yml --env-file .env exec postgres \
  pg_dump --table=hot_news "$DATABASE_URL" > /backups/hot_news_pre_sp5_$(date +%Y%m%d).sql

# Stop worker before mutating hot_news (single-writer assumption):
docker compose -f docker/docker-compose.prod.yml --env-file .env stop worker

bash scripts/run-prod-oneshot.sh packages/db scripts/wipe-hot-news-pre-sp5.ts
bash scripts/run-prod-oneshot.sh packages/db scripts/consolidate-sp5-sources.ts

# Restart worker to obliterate stale BullMQ repeatable jobs and pick up new intervals:
docker compose -f docker/docker-compose.prod.yml --env-file .env start worker
```

### 7.5 SCHEDULER 配合

`CrawlScheduler` 在每次 schedule 时读取 `source_configs.crawlInterval`，所以**改频率立即生效**，无需重启 worker。

但如果 BullMQ 已经基于旧 interval 排好了 repeatable job，需要 obliterate + 重新创建。SP-4.7 已实现 `Old queue obliterated` 自动清理（启动时）。所以 prod 部署流程必须 docker restart worker。

---

## 8. 部署与回滚

### 8.1 部署顺序

1. 合并 PR 到 `main` → CI 触发 docker build + push
2. AI-stage 自动部署 → 等待 worker 健康；用 ai-stage 数据 SMOKE 验证 L0-skip 行为正确
3. SSH 进 prod，按 §7.4 顺序跑一次性脚本：先 `pg_dump` 备份 → `docker compose ... stop worker` → `bash scripts/run-prod-oneshot.sh packages/db scripts/wipe-hot-news-pre-sp5.ts` → `bash scripts/run-prod-oneshot.sh packages/db scripts/consolidate-sp5-sources.ts` → `docker compose ... start worker`。
4. 手动确认 prod 状态：
  - `SELECT COUNT(*) FROM hot_news` = 0（wipe 成功）
  - 旧 Reddit 8 sub `enabled=false`
  - 新 bundle `id='reddit-ai-bundle-v1'` 存在且 `crawlInterval=7200`
  - HN Top `crawlInterval=3600` / HN Ask&Show `crawlInterval=14400`（频率生效请通过 SQL 确认；`CrawlScheduler` 启动只输出聚合 `Registered N enabled sources` 日志，不打印逐源 interval）
5. Worker 重启日志可见 `[CrawlScheduler] Old queue 'rss-crawl' obliterated`（BullMQ 清旧 repeatable jobs）和 `[CrawlScheduler] Registered N enabled sources: ...`。

### 8.2 SMOKE 验证

部署后 30min 观察：


| 验证项               | 期望日志/数据                                                                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L0-skip 工作        | `[IngestionService] [Ingest] HACKERNEWS HackerNews Top: fetched=499 inserted=N skipped=M (quality=Q nonAi=A dedupe=D) failed=0`，且 `inserted ≪ fetched`（每次 ingest 一行聚合）                                                |
| Reddit bundle     | `[IngestionService] [Ingest] REDDIT AI Subreddit Bundle (13 subs hot): fetched=80-100 inserted=... skipped=... (quality=... nonAi=... dedupe=...) failed=0`                                                           |
| HN 频率生效           | 启动只打印聚合 `[CrawlScheduler] Registered N enabled sources: ...`；逐源 `crawlInterval` 用 SQL 校验：`SELECT identifier, "crawlInterval" FROM source_configs WHERE platform='HACKERNEWS';` 期望 `top=3600`、`ask=14400`、`show=14400` |
| `hot_news` 表纯净    | `SELECT COUNT(*) FROM hot_news WHERE status='HIDDEN'` 应该 = 0                                                                                                                                                          |
| `hot_news` 表全是 AI | `SELECT title FROM hot_news ORDER BY createdAt DESC LIMIT 20` 肉眼检查全是 AI 主题                                                                                                                                            |
| jina 调用减少         | 部署后 24h 内 ExtractService 调用数比之前减 ~61%                                                                                                                                                                                 |
| LLM 调用减少          | 部署后 24h 内 SummarizeService `→ done` 数比之前减 ~52%                                                                                                                                                                        |


### 8.3 回滚预案


| 回滚情形                      | 操作                                                                                                                                                                | 预估时间    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| L0 误杀真 AI 内容              | 编辑 `keywords.md` 加词 → `pnpm --filter @ai-hot-news/prompts build` → docker rebuild → redeploy                                                                      | 5-10min |
| Quality 阈值过严，错过中等热度 AI 内容 | `git revert` quality.ts 改动 OR 手工改回 HN_LOW_SCORE=5 → docker rebuild → redeploy                                                                                     | 5-10min |
| 频率太低导致错过重要内容              | `UPDATE source_configs SET crawlInterval=900 WHERE platform='HACKERNEWS' AND identifier='top';` → 重启 worker                                                       | 1min    |
| Reddit bundle 限流（429）     | `UPDATE source_configs SET enabled=true WHERE identifier IN (...) AND platform='REDDIT'; UPDATE source_configs SET enabled=false WHERE id='reddit-ai-bundle-v1';` | 1min    |
| wipe 后想恢复历史数据             | **不可逆**。wipe 前请先 `pg_dump --table=hot_news` 备份（部署 SOP 必须步骤）                                                                                                       | –       |
| 整体回滚（除 wipe 外）            | `git revert <merge-commit>` → CI 重新 deploy；wipe 后的数据无法找回                                                                                                          | 30min   |


> ⚠️ **wipe 前必须备份**：`pg_dump --table=hot_news ai_hot_news > /backups/hot_news_pre_sp5_$(date +%Y%m%d).sql`（建议放进部署 runbook）。

---

## 9. 测试策略


| 测试文件                                                                 | 覆盖场景                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/prompts/src/keywords.spec.ts`                              | parseKeywords 兼容三种格式（单行逗号 / 每行一词 / markdown 列表）/ 注释 / 空行 / 列表前缀 / 内联逗号 / dedupe 大小写不敏感 / buildMatcher word-boundary / 转义字符（`GPT-4o`）/ matchesAiTopic 命中 / 不命中 / 空字符串                 |
| `packages/utils/src/quality.spec.ts`（已有，扩展）                          | HN: score=20 通过 / score=19 + descendants=4 fail / descendants=5 通过 / score=100 通过                                                                                                    |
| `apps/worker/src/crawl/ingestion.service.spec.ts`（已有，扩展）             | L0-skip 行为：AI + quality OK → INSERT VISIBLE / quality fail → skipped+++ skippedQuality++ 不入库 / non-AI → skipped+++ skippedNonAi++ 不入库 / dedupe → skippedDedupe++ / IngestResult 字段正确 |
| `apps/worker/src/crawl/ingestion.service.integration.spec.ts`（已有，扩展） | 真 PG: AI 主题 HN 帖子（score>=20）入库 / non-AI HN 帖子不入库 / Reddit AI sub 帖子入库 / 已存在 dedupeHash 触发 P2002                                                                                      |
| `packages/db/scripts/wipe-hot-news-pre-sp5.spec.ts`                  | 真 PG: 插入 N 行 → 跑 runWipe → COUNT=0 / 空表跑 runWipe 不报错 / 返回 `{before, deleted, after}` 字段正确                                                                                            |
| `packages/db/scripts/consolidate-sp5-sources.spec.ts`                | 幂等性（运行两次结果一致）/ 8 旧 sub 全部 enabled=false / 新 bundle 创建（crawlInterval=7200）/ HN Top crawlInterval=3600 / HN Ask&Show crawlInterval=14400                                               |


---

## 10. 验收标准

- 仓库根 `keywords.md` 存在；`pnpm --filter @ai-hot-news/prompts build` 自动 copy 到 `src/keywords.md` 并打包到 `dist/index.js`
- `parseKeywords()` 同时支持单行逗号分隔 / 每行一词 / markdown 列表三种格式
- `matchesAiTopic("Show HN: I built an AI Agent")` → `true`
- `matchesAiTopic("Cricket India vs Pakistan score")` → `false`
- `matchesAiTopic("Spain on the map")` → `false`（word boundary 防止 "AI" 嵌入误匹配 "Spain"）
- HN quality 阈值变更后单测全过（`score>=20 OR descendants>=5`）
- `IngestionService` 测试覆盖 L0-skip 三种 skip 原因（quality / nonAi / dedupe），且 IngestResult 字段计数正确
- `wipe-hot-news-pre-sp5.spec.ts` 通过（删行 + 空表 + 返回值）
- `consolidate-sp5-sources.spec.ts` 幂等性测试通过（含 Reddit + HN 频率调整）
- HN `crawlInterval` 调整后 BullMQ obliterate 重排成功（启动日志可见 `Old queue obliterated`）
- CI 全绿
- 本地 dev SMOKE：跑 30min 后能看到 Reddit bundle 抓取成功，日志中有 `inserted=N skipped=M (quality=... nonAi=... dedupe=...)` 形式，且 `hot_news` 表 `SELECT COUNT(*) WHERE status='HIDDEN'` = 0
- Prod SMOKE：部署 24h 后
  - `hot_news` 表新增行数比当前减少 ~~73%（~~190/天 vs 当前 ~710/天，含历史 HIDDEN）
  - `hot_news` 表 `status` 全为 VISIBLE
  - HN HTTP 请求数下降 ~75%
  - Reddit HTTP 请求数下降 ~50%
  - jina 调用量下降 ~61%
  - LLM 调用量下降 ~52%
  - 月 LLM 成本从 ~$0.45 降到 ~$0.21

---

## 11. 与 SP-5 主体的协同

本 PR 在 SP-5 主体的 13 个 commit + 已 commit 的 spec v3.1 (73797ed) 之上新增 commits：

```
13 主体 commit (已存在)
  + 73797ed docs(sp5): spec v3.1 + keywords.md (✓ 已 commit, v3.2 升级中)
    ↓
+ docs(sp5): pivot to v3.2 — L0-skip + quality threshold + wipe + remove L3a/L3b
+ feat(sp5): keywords.md parser + matcher + build.mjs (packages/prompts)
+ feat(sp5): IngestionService L0-skip + IngestResult by-reason counters
+ feat(sp5): HN quality threshold bump (score>=20 OR desc>=5)
+ feat(sp5): wipe-hot-news-pre-sp5 + consolidate-sp5-sources scripts
+ feat(sp5): Reddit bundle seed + HN frequency seed update
+ docs(sp5): update SP-5 plan with v3.2 tasks
```

合并到 `main` 后 SP-5 整体上线，prod 第一天即享：

- **hot_news 表入库行数减压 ~73%**（~710 → ~190/天，UI 也跟着减）
- HN HTTP 减压 ~75%（频率调整：Top 15min→60min, Ask&Show 30min→4h）
- Reddit HTTP 减压 ~50%（频率调整：1h→2h；同时 8 sub → 1 个 13-sub bundle）
- jina 调用减压 ~61%（L0-skip 直接拦截非 AI link-post）
- LLM 调用减压 ~52%
- 月 LLM 成本：~$0.45 → ~$0.21
- `hot_news` 表语义干净（全 VISIBLE，全 AI 主题）

未来 Phase 2（SP-7+）即可接入：用户订阅词 + 热点检测 + 按需高频源；当前架构已支持 source_configs 动态加 source，零成本扩展。