# SP-5 增强 — AI 主题过滤 + 基础低频抓取（Phase 1）

- **状态**：spec v3.1 final，待用户审核
- **类型**：SP-5 主体的 in-PR 增强（不是独立 SP）
- **依赖**：
  - SP-5 主体已实现（`feat/sp5-summary-tags` 分支前 13 个 commit）
  - SP-4.7 已合并（ArticleExtractor / jina chain）
  - `RedditCrawler.resolveUrl()` 已支持 `source.url` 透传（SP-3 预留）
- **不依赖**：SP-4.5（互不影响）
- **本文件**：`docs/superpowers/specs/2026-05-05-sp5-ai-topic-filtering-design.md`
- **预计工作量**：~2 小时（keywords.md parser + AI strategy + IngestionService 加 1 行 + Reddit seed + 频率调整迁移脚本 + 测试）

## Phase 1 / Phase 2 架构定位

本 SP 仅做 Phase 1（基础低频抓 + AI 主题过滤）。Phase 2 留给未来 SP：

| 阶段 | 范围 | 抓取频率 | 关键词来源 |
|---|---|---|---|
| **Phase 1（本 SP）** | 基础低频全貌抓取 + L3 双层 keywords 过滤 | HN Top 60min / Ask&Show 4h / Reddit 2h | 仓库根 `keywords.md`（17 词，开发者维护）|
| **Phase 2（未来 SP-7+）** | 用户订阅词 + 热点驱动高频源 | 临时高频 source（10min interval, 48h 自动 disable）| `KeywordMonitor` 表 + 自动检测（24h 内某词出现>10 次自动开启）|

Phase 2 的实现路径（已在当前架构内预留）：
- `source_configs` 表是 DB 驱动的，加/减/调频不需要改代码
- 未来 KeywordMonitor 上线时，可用同样架构动态加 high-frequency source
- 用户订阅词可聚合为 `subscribed-keywords.md`，prompts 包做 union（零架构改动）

---

## 0. 背景与动机

### 0.1 SMOKE 实测数字

SP-5 主体本地 SMOKE 跑通后，发现两个独立但相关的痛点：

| 平台 | 抓取量/天 | AI 主题占比（估算） | jina extract 调用 | LLM 调用 |
|---|---|---|---|---|
| HN | ~225 visible | ~30% | ~217（96.4% link-post）| ~225 |
| Reddit | ~155 visible | ~95% | ~84（53.7% link-post）| ~155 |
| RSS | ~10 visible | ~100% | 0 | ~10 |
| **合计** | **~390** | – | **~301** | **~390** |

加上 SP-4.7 jina extract 完成后会 reset summary=NULL 重入摘要队列：
- 实际 LLM 调用 ≈ 390 + ~250 (jina 完成 re-summary) ≈ **~640/天**

### 0.2 三个独立的成本问题

| 成本类型 | 当前/天 | 痛点级别 | Phase 1 解法 |
|---|---|---|---|
| jina API 调用 | ~301 | 🔴 高（jina 限流 + 成本压力）| L3a 过滤 |
| LLM 调用（OpenRouter / DeepSeek-V3.2）| ~640 | 🟡 中（~$0.45/月，可承受但浪费 65%）| L3b 过滤 |
| Reddit HTTP 请求 | 192 | 🟢 低（无成本，但效率低）| 8 sub→1 bundle + 1h→3h |
| HN HTTP 请求（Firebase）| ~50,000 | 🟢 零（HN 官方免费 + 无限流）| 频率降低（Top 15min→60min, Ask&Show 30min→4h）|

> 注：Phase 1 频率调整对 hot_news 入库行数影响较小（dedupe 已工作），主要是减 HTTP 流量和减 worker 自身负载。

### 0.3 关键洞察：jina 痛点不是 "HN 抓多" 而是 "extract 不分主题"

`IngestionService` 当前逻辑（SP-4.7 实现）：
```
所有 VISIBLE 的 link-post → 触发 jina extract
```

不论是 AI 主题还是非 AI 主题，只要是 link-post 就调 jina。HN 96.4% 是 link-post + 70% 非 AI = **大量 jina 调用花在抓非 AI 内容的正文**。

### 0.4 KeywordMonitor 未来需求

PRD 设计了 `KeywordMonitor` 表（已 schema），用户可订阅**任意关键字**（不限本 spec 的 keywords.md）。这要求 hot_news 表保留**全量 VISIBLE 数据基础**，否则用户订阅"Sam Altman"但抓取层已经过滤掉非 keywords.md 词，永远命中不了。

### 0.5 解决方案：双层 keywords 过滤 + 基础抓取低频化（保留全量数据）

```
┌────────────────────────────────────────────────────────────┐
│ HN Firebase 全量 (~215/天 visible, Top 60min/Ask&Show 4h)   │
│   → KeywordMonitor 数据基础                                 │
│ Reddit 13 sub bundle (~145/天 visible, 2h interval)         │
│   → KeywordMonitor 同样                                     │
│ RSS 7 厂商 (~10/天, 24h)                                    │
└────────────────────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────────────┐
│ IngestionService.ingest()                                   │
│  ├─ insert hot_news (status=VISIBLE) ← 全量数据保留          │
│  ├─ SummaryQueue.add() (无条件 enqueue)                      │
│  └─ if isLinkPost AND matchesAiTopic(title+content) ← L3a   │
│       └─ ExtractQueue.add() (jina extract)                  │
│         非 AI link-post 直接跳过 extract，jina 减压 73%       │
└────────────────────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────────────┐
│ SummarizeService.run()                                      │
│  ├─ strategy.shouldSummarize(row)                           │
│  │    ├─ status != VISIBLE → skip                          │
│  │    ├─ matchesAiTopic(title) → allow                     │
│  │    ├─ matchesAiTopic(content[:500]) → allow             │
│  │    └─ else → skip:not_ai_topic ← L3b                    │
│  └─ if allow → callLlm + write summary                      │
└────────────────────────────────────────────────────────────┘

L3a (extract 前过滤)：解决 jina 痛点（~55% 减压）
L3b (summary 前过滤)：解决 LLM 痛点（~62% 减压）
两层用同一份 keywords.md，逻辑一致
基础低频抓取：减 HTTP 流量 ~75%（HN）+ ~50%（Reddit），不影响入库总量
```

---

## 1. 范围决策

| 优化点 | 本 PR | 后续 SP | 理由 |
|---|---|---|---|
| L3a：extract enqueue 前用 keywords 过滤 | ✅ | – | 解决 jina 痛点（用户主诉求）|
| L3b：summary 调 LLM 前用 keywords 过滤 | ✅ | – | 减 LLM 成本 ~60% |
| Reddit 13 sub bundle（`seed.ts` 改）| ✅ | – | 零代码改动（SP-3 已预留 `source.url` 透传），HTTP 减 87.5% |
| `keywords.md` AI 词表 | ✅ | – | L3a/L3b 共同依赖 |
| **基础抓取频率降低（HN Top 15min→60min, Ask&Show 30min→4h, Reddit 1h→2h）** | ✅ | – | HTTP 减 75%，对入库节奏影响极小（dedupe 已工作 + 几乎零错过率）|
| HN Algolia crawler 替换 Firebase | ❌ | 暂不需要 | KeywordMonitor 需全量数据，且 Firebase 无成本无限流 |
| LLM 自判断（兜底捕获 keywords 漏网）| ❌ | 视上线后实测决定 | 当前成本已足够低，先观察 keywords 命中率 |
| KeywordMonitor + 按需高频源 | ❌ | Phase 2（未来 SP-7+）| 等用户订阅功能上线后做；当前架构已支持动态加 source |

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

**改造后**：
```
HN Firebase (500/60min, 频率降低) ─┐
Reddit 13 sub bundle (100/2h) ─────┼─→ IngestionService → 所有 VISIBLE 行：
RSS 7 feed (24h, 不变) ─────────────┘    ├─→ SummaryQueue (无条件入队)
                                       └─→ if isLinkPost AND matchesAiTopic():
                                           └─→ ExtractQueue (仅 AI link-post 调 jina)
                                               ↑ L3a 过滤点（jina 减压）

SummaryQueue → SummarizeService:
  ├─ strategy.shouldSummarize() (检查 keywords)
  ├─ skip:not_ai_topic → 不调 LLM, summary=NULL
  └─ allow → callLlm
                ↑ L3b 过滤点（LLM 减压）
```

### 2.2 文件改动清单

```
新增（仓库根）：
  keywords.md                                            (人工编辑词表，用户已创建)

新增（packages/prompts）：
  packages/prompts/build.mjs                             (build 时 copy keywords.md + esbuild)
  packages/prompts/src/keywords.ts                       (parser + matcher)
  packages/prompts/src/keywords.spec.ts                  (单测：parser + matcher)
  packages/prompts/.gitignore                            (忽略 src/keywords.md auto-copy)

新增（worker）：
  apps/worker/src/summarize/strategies/summarize-ai-only.strategy.ts
  apps/worker/src/summarize/strategies/summarize-ai-only.strategy.spec.ts

新增（db）：
  packages/db/scripts/consolidate-sp5-sources.ts         (一次性 prod 迁移：Reddit bundle + HN 频率)
  packages/db/scripts/consolidate-sp5-sources.spec.ts    (幂等性测试)

修改：
  packages/prompts/package.json                          (build 改为 node build.mjs)
  packages/prompts/src/index.ts                          (+exports keywords / matchesAiTopic)
  apps/worker/src/crawl/ingestion.service.ts             (extract enqueue 前加 matchesAiTopic 检查)
  apps/worker/src/crawl/ingestion.service.spec.ts        (+L3a 测试 case)
  apps/worker/src/summarize/strategies/strategy.interface.ts  (StrategyRowInput +title +content)
  apps/worker/src/summarize/summarize.service.ts         (传 title/content 给 strategy)
  apps/worker/src/summarize/summarize.service.spec.ts    (+1 case: skip:not_ai_topic)
  apps/worker/src/summarize/summarize.module.ts          (替换 strategy)
  packages/db/prisma/seed.ts                             (Reddit bundle source + HN 频率调整)
```

文件改动总计：**8 新增 + 8 修改 = 16 个文件**（vs HN Algolia 方案需要 22 个文件）。

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

## 4. L3a：IngestionService extract enqueue 前过滤

### 4.1 当前代码

`apps/worker/src/crawl/ingestion.service.ts` 现状（SP-4.7 实现）：

```typescript
if (status === ContentStatus.HIDDEN) {
  result.hidden += 1;
} else {
  result.inserted += 1;
  await this.summaryQueue.add('summarize', { hotNewsId: created.id }, ...);
  
  const extUrl = (raw.interactionData as { externalUrl?: string } | null)?.externalUrl;
  const isLinkPost = typeof extUrl === 'string' &&
    /^https?:/.test(extUrl) &&
    cleanContent === cleanTitle;
  
  if (isLinkPost) {
    await prisma.hotNews.update({
      where: { id: created.id },
      data: { extractStatus: 'PENDING' },
    });
    await this.extractQueue.add('extract', { hotNewsId: created.id }, ...);
  }
}
```

### 4.2 改造（加 1 个条件）

```typescript
import { matchesAiTopic } from '@ai-hot-news/prompts';

// ... 同上 isLinkPost 计算 ...

// L3a: 仅 AI 主题的 link-post 才触发 jina extract
const isAiTopic = matchesAiTopic(`${cleanTitle}\n${cleanContent.slice(0, 500)}`);

if (isLinkPost && isAiTopic) {
  await prisma.hotNews.update({
    where: { id: created.id },
    data: { extractStatus: 'PENDING' },
  });
  await this.extractQueue.add('extract', { hotNewsId: created.id }, ...);
}
// 非 AI link-post：extractStatus 保持 null，不调 jina
```

### 4.3 副作用

| 场景 | 当前行为 | 改造后 |
|---|---|---|
| AI 主题 link-post | extract → reset summary=NULL → re-summarize | ✅ 不变 |
| 非 AI link-post | extract → reset summary=NULL → re-summarize → L3b skip | ⏩ 跳过 extract，跳过 re-summary（节省 jina + 节省 LLM） |
| Self-post (HN Ask/Show, Reddit) | summary 直接走 LLM 或被 L3b 过滤 | ✅ 不变 |
| Reddit AI sub 全是 self-post 占多数 | 影响小 | ✅ 不变 |

### 4.4 数字推演

#### 4.4.1 频率调整后的入库估算（dedupe 后）

频率调整对入库行数影响小（dedupe 已工作），主要影响 HTTP 流量。

| 源 | 当前 interval | Phase 1 interval | 当前入库/天 | Phase 1 入库/天 |
|---|---|---|---|---|
| HN Top | 15min | **60min** | ~180 | ~175 (-3%, 几乎零错过) |
| HN Ask | 30min | **4h** | ~25 | ~22 (-12%) |
| HN Show | 30min | **4h** | ~20 | ~18 (-10%) |
| Reddit bundle (13 sub) | 1h | **2h** | ~150 | ~145 (-3%) |
| RSS 7 厂商 | 24h | 24h | ~10 | ~10 |
| **合计** | – | – | **~385** | **~370** (-4%) |

#### 4.4.2 L3a + L3b 过滤后

```
HN Firebase 入库：       ~215 visible/天 (175 top + 22 ask + 18 show)
  ├─ link-post: ~206 (96%)
  │    ├─ 命中 keywords (~30%): ~62 → extract → re-summary
  │    └─ 未命中 (~70%): ~144 → 跳过 extract，跳过 re-summary
  └─ self-post: ~9
       └─ 走 SummaryQueue → L3b 检查 → 部分命中走 LLM

Reddit bundle 入库：     ~145 visible/天
  ├─ link-post: ~78 (54%)
  │    ├─ 命中 keywords (~95%): ~74 → extract → re-summary
  │    └─ 未命中 (~5%): ~4 → 跳过 extract
  └─ self-post: ~67
       └─ L3b 检查 → 大部分命中走 LLM

RSS：~10 visible/天 (100% AI, 0 link-post)

合计：
  jina extract：~62 + 74 ≈ 136/天  （vs 当前 ~301，减 ~55%）
  LLM 调用：    ~245/天             （vs 当前 ~640，减 ~62%）
  HTTP/天：     ~12,379             （vs 当前 ~50,224，减 ~75%）
```

#### 4.4.3 综合对比（当前 vs Phase 1）

| 指标 | 当前/天 | Phase 1/天 | 减压 |
|---|---|---|---|
| HN HTTP 请求 | ~50,000 | ~12,360 | **-75%** |
| Reddit HTTP 请求 | ~24 | ~12 | **-50%** |
| hot_news 入库行数 | ~385 | ~370 | -4% |
| jina extract 调用 | ~301 | ~136 | **-55%** |
| LLM 调用 | ~640 | ~245 | **-62%** |
| 月 LLM 成本（OpenRouter DS-v3.2）| ~$0.45 | ~$0.17 | **-62%** |

---

## 5. L3b：SummarizeAiOnlyStrategy

### 5.1 接口扩展

`apps/worker/src/summarize/strategies/strategy.interface.ts`：

```typescript
export interface StrategyRowInput {
  id: string;
  sourcePlatform: 'TWITTER' | 'RSS' | 'HACKERNEWS' | 'REDDIT';
  publishedAt: Date;
  status: 'VISIBLE' | 'HIDDEN' | 'PENDING';
  interactionData: Record<string, unknown> | null;
  heatScore: number;
  title: string;        // ← 新增
  content: string;      // ← 新增
}
```

### 5.2 新策略实现

```typescript
// apps/worker/src/summarize/strategies/summarize-ai-only.strategy.ts

import { matchesAiTopic } from '@ai-hot-news/prompts';
import type { SummarizationStrategy, StrategyVerdict, StrategyRowInput } from './strategy.interface';

const CONTENT_PROBE_CHARS = 500;

export class SummarizeAiOnlyStrategy implements SummarizationStrategy {
  shouldSummarize(row: StrategyRowInput): StrategyVerdict {
    if (row.status !== 'VISIBLE') return `skip:status_${row.status}`;
    
    if (matchesAiTopic(row.title)) return 'allow';
    
    const contentSnippet = (row.content ?? '').slice(0, CONTENT_PROBE_CHARS);
    if (matchesAiTopic(contentSnippet)) return 'allow';
    
    return 'skip:not_ai_topic';
  }
}
```

### 5.3 SummarizeService 适配

`summarize.service.ts` 的 `findUnique` 已 select `title` + `content`（用于 LLM input），无需新增 column。把它们传给 strategy：

```typescript
const verdict = this.strategy.shouldSummarize({
  id: row.id,
  sourcePlatform: row.sourcePlatform as ...,
  publishedAt: row.publishedAt,
  status: row.status as ...,
  interactionData: row.interactionData as ...,
  heatScore: row.heatScore,
  title: row.title,        // ← 新增
  content: row.content,    // ← 新增
});
```

### 5.4 Module 切换

`summarize.module.ts` 的 `STRATEGY_TOKEN` 工厂改为新策略：

```typescript
useFactory: (): SummarizationStrategy => new SummarizeAiOnlyStrategy(),
```

`SummarizeAllVisibleStrategy` 文件保留，便于一行回滚。

---

## 6. Reddit 13 sub Bundle

### 6.1 Bundle URL

```
https://www.reddit.com/r/ChatGPT+OpenAI+singularity+ArtificialInteligence+artificial+ClaudeAI+PromptEngineering+AI_Agents+vibecoding+LLMDevs+cursor+agi+LangChain/hot.json?limit=100&raw_json=1
```

13 个 sub（用户在 brainstorming 阶段选定）：
| Sub | 订阅 | 内容偏向 |
|---|---|---|
| ChatGPT | 11.5M | ChatGPT 用户场景 |
| OpenAI | 2.74M | OpenAI 产品讨论 |
| singularity | 3.89M | AGI / 未来主义 |
| ArtificialInteligence | 1.79M | 通用 AI 综合（注意拼错）|
| artificial | 1.26M | 通用 AI 新闻 |
| ClaudeAI | 821K | Claude 产品讨论 |
| PromptEngineering | 371K | Prompt 工程实践 |
| AI_Agents | 356K | Agentic 系统专项 |
| vibecoding | 246K | AI 辅助编程文化 |
| LLMDevs | 146K | LLM 开发者 |
| cursor | 135K | Cursor IDE / AI 编程 |
| agi | 111K | AGI 讨论 |
| LangChain | 97K | LangChain 开发 |

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

| 平台 | Source | 当前 crawlInterval | Phase 1 crawlInterval | 处理方式 |
|---|---|---|---|---|
| HACKERNEWS | HackerNews Top | 900 (15min) | **3600 (60min)** | UPDATE 现有 source |
| HACKERNEWS | HackerNews Ask | 1800 (30min) | **14400 (4h)** | UPDATE 现有 source |
| HACKERNEWS | HackerNews Show | 1800 (30min) | **14400 (4h)** | UPDATE 现有 source |
| REDDIT | r/LocalLLaMA + 7 个旧 sub | 3600 (1h) | – | DISABLE（保留行）|
| REDDIT | AI Subreddit Bundle (13 sub) | – | **7200 (2h)** | INSERT 新 source |
| RSS | 7 个厂商 feed | 86400 (24h) | 86400 (24h) | 不变 |

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

### 7.3 调用方式

参照 SP-4.5 `wipe-hot-news-pre-ai.ts` 的 dual-mode entrypoint：

```bash
# Prod 运行：
docker exec ai-hot-news-worker node /app/packages/db/scripts/consolidate-sp5-sources.js
```

### 7.4 SCHEDULER 配合

`CrawlScheduler` 在每次 schedule 时读取 `source_configs.crawlInterval`，所以**改频率立即生效**，无需重启 worker。

但如果 BullMQ 已经基于旧 interval 排好了 repeatable job，需要 obliterate + 重新创建。SP-4.7 已实现 `Old queue obliterated` 自动清理（启动时）。所以 prod 部署流程：
1. 跑 `consolidate-sp5-sources.ts` 改 DB
2. 重启 worker（docker restart）→ 触发 obliterate → 按新 interval 重新排队

---

## 8. 部署与回滚

### 8.1 部署顺序

1. 合并 PR 到 `main` → CI 触发 docker build + push
2. AI-stage 自动部署 → 等待 worker 健康
3. SSH 进 prod 跑一次性脚本：`docker exec ai-hot-news-worker node /app/packages/db/scripts/consolidate-sp5-sources.js`
4. 手动确认 prod source_configs：
   - 旧 Reddit 8 sub `enabled=false`
   - 新 bundle `id='reddit-ai-bundle-v1'` 存在且 `crawlInterval=7200`
   - HN Top `crawlInterval=3600` / HN Ask&Show `crawlInterval=14400`
5. Worker 重启自动 pickup 新 source 与新 interval（启动日志可见 `Old queue obliterated`）

### 8.2 SMOKE 验证

部署后 30min 观察：

| 验证项 | 期望日志 |
|---|---|
| L3a 工作 | IngestionService 不再为非 AI link-post enqueue extract（计数对比） |
| L3b 工作 | `hotNewsId=... → skip:not_ai_topic` 与 `→ done` 共存 |
| Reddit bundle | `[CrawlProcessor] REDDIT crawl ok: source=AI Subreddit Bundle (13 subs hot) items=80-100` |
| HN Top 频率新 | 启动后 `[CrawlScheduler] schedule HACKERNEWS top interval=3600` 日志（vs 当前 900）|
| HN Ask&Show 频率新 | 启动后 `[CrawlScheduler] schedule HACKERNEWS ask|show interval=14400` 日志（vs 当前 1800）|
| jina 调用减少 | 部署后 24h 内 ExtractService 调用数比之前减 ~55% |
| LLM 调用减少 | 部署后 24h 内 SummarizeService `→ done` 数比之前减 ~62% |
| HN HTTP 减少 | 看 worker 出口 HTTP 计数（如有 metrics）减 ~75% |

### 8.3 回滚预案

| 回滚情形 | 操作 | 预估时间 |
|---|---|---|
| L3a/L3b 误杀真 AI 内容 | 编辑 `keywords.md` 加词 → `pnpm --filter @ai-hot-news/prompts build` → docker rebuild → redeploy；或临时回退到 `SummarizeAllVisibleStrategy`（1 行改 + 重启）+ 注释 IngestionService 的 `&& isAiTopic` | 5-10min |
| 频率太低导致错过重要内容 | `UPDATE source_configs SET crawlInterval=900 WHERE platform='HACKERNEWS' AND identifier='top';`（其他源同理）→ 重启 worker | 1min |
| Reddit bundle 限流（429） | `UPDATE source_configs SET enabled=true WHERE identifier IN (8 旧 sub) AND platform='REDDIT'; UPDATE source_configs SET enabled=false WHERE id='reddit-ai-bundle-v1';` | 1min |
| 整体回滚 | `git revert <merge-commit>` → CI 重新 deploy | 30min |

DB 中已 SKIP 的行不会自动重摘要。如需重新摘要，手工 `UPDATE hot_news SET summary=NULL, "extractStatus"=NULL WHERE summary IS NULL AND <过滤条件>` 触发 boot backstop。

---

## 9. 测试策略

| 测试文件 | 覆盖场景 |
|---|---|
| `packages/prompts/src/keywords.spec.ts` | parseKeywords 兼容三种格式 / 注释 / 空行 / 列表前缀 / 内联逗号 / dedupe 大小写不敏感 / buildMatcher word-boundary / 转义字符（`GPT-4o`）/ matchesAiTopic 命中 / 不命中 / 空字符串 |
| `apps/worker/src/summarize/strategies/summarize-ai-only.strategy.spec.ts` | 6 类 verdict：VISIBLE+title 命中 / VISIBLE+content 命中 / VISIBLE 无命中 → skip:not_ai_topic / HIDDEN → skip:status_HIDDEN / PENDING → skip:status_PENDING / 空 content 不崩 / content 超 500 时只检查前 500 |
| `apps/worker/src/summarize/summarize.service.spec.ts`（已有，扩展）| +1 case：strategy 返回 not_ai_topic → 不调用 LLM、不写 summary、不写 aiTags |
| `apps/worker/src/crawl/ingestion.service.spec.ts`（已有，扩展）| +case：AI link-post → enqueue extract / 非 AI link-post → 不 enqueue extract / Self-post 不受影响 / Reddit AI sub link-post（命中）/ HN 非 AI link-post（不命中）|
| `packages/db/scripts/consolidate-sp5-sources.spec.ts` | 幂等性（运行两次结果一致）/ 8 旧 sub 全部 enabled=false / 新 bundle 创建（crawlInterval=7200）/ HN Top crawlInterval=3600 / HN Ask&Show crawlInterval=14400 |

---

## 10. 验收标准

- [ ] 仓库根 `keywords.md` 存在；`pnpm --filter @ai-hot-news/prompts build` 自动 copy 到 `src/keywords.md` 并打包到 `dist/index.js`
- [ ] `parseKeywords()` 同时支持单行逗号分隔 / 每行一词 / markdown 列表三种格式
- [ ] `matchesAiTopic("Show HN: I built an AI Agent")` → `true`
- [ ] `matchesAiTopic("Cricket India vs Pakistan score")` → `false`
- [ ] `matchesAiTopic("Spain on the map")` → `false`（word boundary 防止 "AI" 嵌入误匹配 "Spain"）
- [ ] `SummarizeAiOnlyStrategy` 6 类 verdict 测试全过
- [ ] `IngestionService` 测试覆盖 AI / 非 AI link-post 分支
- [ ] `consolidate-sp5-sources.ts` 幂等性测试通过（含 Reddit + HN 频率调整）
- [ ] HN `crawlInterval` 调整后 BullMQ obliterate 重排成功（启动日志可见 `Old queue obliterated`）
- [ ] CI 全绿
- [ ] 本地 dev SMOKE：跑 30min 后能看到 Reddit bundle 抓取成功，日志中有 `→ skip:not_ai_topic` 与 `→ done` 共存，extractQueue 入队数明显少于 inserted 数
- [ ] Prod SMOKE：部署 24h 后
  - HN HTTP 请求数下降 ~75%（频率调整效果）
  - Reddit HTTP 请求数下降 ~50%
  - jina 调用量比当前实测下降 ~55%
  - LLM 调用量比当前实测下降 ~62%
  - hot_news 表新增行数比当前略降 ~4%（KeywordMonitor 数据基础保持完整，HN/Reddit 抓全量不变）

---

## 11. 与 SP-5 主体的协同

本 PR 在 SP-5 主体的 13 个 commit 之上新增 commits：

```
13 主体 commit (已存在)
  ↓
+ docs(sp5): AI topic filtering + Phase 1 frequency design spec v3.1 + keywords.md
+ feat(sp5): keywords.md parser + matcher + build.mjs
+ feat(sp5): SummarizeAiOnlyStrategy + tests + module wire
+ feat(sp5): IngestionService extract enqueue 前过滤 (L3a)
+ feat(sp5): Reddit bundle source + HN frequency调整 + consolidate-sp5-sources script
+ docs(sp5): update SP-5 plan with topic filtering & frequency tasks
```

合并到 `main` 后 SP-5 整体上线，prod 第一天即享：
- HN HTTP 减压 ~75%（频率调整：Top 15min→60min, Ask&Show 30min→4h）
- Reddit HTTP 减压 ~50%（频率调整：1h→2h；同时 8 sub → 1 个 13-sub bundle）
- jina 调用减压 ~55%（解决用户主诉求）
- LLM 调用减压 ~62%
- KeywordMonitor 数据基础保持完整（HN 全量抓不变）
- 几乎零错过率（Phase 1 入库仅减 4%，主要是 Ask&Show 的低活跃帖）

未来 Phase 2（SP-7+）即可接入：用户订阅词 + 热点检测 + 按需高频源（基于当前 source_configs 动态架构，零成本扩展）
