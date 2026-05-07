# SP-5 AI Summary + aiTags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给每行 `status='VISIBLE' AND summary IS NULL` 的 HotNews 行通过 LLM（Vercel AI SDK + OpenRouter / DeepSeek-v3.2）生成中文摘要 + 4 维 prefix-encoded `aiTags`，不阻塞 ingest 主链路、月成本 ≤ $2、不破坏 SP-2/3/4/4.5/4.7 已交付契约。

**Architecture:** 在 SP-4.7 留下的 `summarize/` stub 之上做扩展：
1. `packages/prompts/` 新 workspace 包 — taxonomy 受控词表 + system/user prompt builder + 鲁棒 JSON parser（runtime esbuild bundle 同 `@ai-hot-news/utils` pattern）
2. `apps/worker/src/summarize/` 扩展为完整模块 — `SummarizeService` × `SummarizationStrategy` interface（V1 实现 `SummarizeAllVisibleStrategy`） × `llm-client`（Vercel AI SDK） × BullMQ `summary` queue worker（concurrency=3） + `OnApplicationBootstrap` boot backstop（扫 `summary IS NULL` 重新入队）
3. **不动** `IngestionService` / `CrawlModule` / `WorkerModule` — SP-4.7 已经 wire 好 SUMMARY_QUEUE token 与 ingest push 逻辑，本 SP 仅消费方上线

**Tech Stack:** NestJS · BullMQ · Prisma · `ai` (Vercel AI SDK) · `@ai-sdk/openai` (OpenRouter compat) · vitest · `vi.stubGlobal('fetch')` mock 套路。

**Spec:** `docs/superpowers/specs/2026-05-05-sp5-ai-summary-tags-design.md`

---

## Pre-flight: codebase state on origin/main (VERIFIED 2026-05-05)

SP-4.7 已合并 origin/main（PRs #1-4，HEAD `52cf4e3`）并部署到 prod 2026-05-05 18:21 UTC+8。本 SP 在此基础上仅做"消费方"扩展。

**已存在（不要重复创建）：**

- `apps/worker/src/redis/redis.module.ts` — 共享 `RedisModule` 导出 `REDIS_CONNECTION`（PR #2 hot fix 引入；多个 module 注入 REDIS_CONNECTION 时必须 `imports: [RedisModule]`）
- `apps/worker/src/redis/redis.module.spec.ts` — 防回归：测试 `Test.createTestingModule({ imports: [SummarizeModule] })` 能 resolve `SUMMARY_QUEUE`。本 SP **改动 SummarizeModule 后必须保持此 spec 绿**
- `apps/worker/src/summarize/summarize.queue.ts` — stub：仅 `SUMMARY_QUEUE_NAME` / `SUMMARY_QUEUE` Symbol / `summaryQueueProvider`，**无** `SUMMARY_WORKER` / `createSummaryWorker`
- `apps/worker/src/summarize/summarize.module.ts` — stub：`@Module({ imports: [RedisModule], providers: [summaryQueueProvider], exports: [SUMMARY_QUEUE] })`，**无** worker / service / strategy / boot backstop
- `apps/worker/src/extract/` — SP-4.7 完整模块（chain / firecrawl / jina / service / module）
- `apps/worker/src/crawl/ingestion.service.ts` — 已 constructor 注入 `SUMMARY_QUEUE` + `EXTRACT_QUEUE`，已 push `summarize:<id>` job on VISIBLE
- `apps/worker/src/crawl/ingestion.service.integration.spec.ts` — 已含 SP-4.7 enqueue 契约 case（`summaryQueueAdd` 期望被调用 / 不被调用）
- `apps/worker/src/crawl/crawl.module.ts` — 已 `imports: [RedisModule, SummarizeModule, ExtractModule]` + `IngestionService` useFactory 注入两 queue
- `apps/worker/src/worker.module.ts` — 已 `imports: [SummarizeModule, ExtractModule, CrawlModule]`
- `packages/db/scripts/wipe-hot-news-pre-ai.ts` + spec — 已存在；2026-05-05 17:53 UTC+8 prod 已删 1650 → 0 rows
- `.env.example` — 已含 SP-4.7 段（`FIRECRAWL_API_KEY` / `JINA_API_KEY` / `EXTRACT_CONCURRENCY`）；**无** OPENROUTER 段
- `docker/docker-compose.prod.yml` worker 服务 `environment:` — 已显式透传 `FIRECRAWL_API_KEY` / `JINA_API_KEY` / `EXTRACT_CONCURRENCY`（PR #3 hot fix 强约束：compose 只透传显式声明的变量，仅写到 `.env` 不够）；**无** OPENROUTER / SUMMARY_MODEL / LLM_BASE_URL / SUMMARY_CONCURRENCY 透传
- `apps/worker/Dockerfile` — 已 COPY `db / types / utils` 三个 workspace 包；**无** `prompts` 包

**还没有（本 SP 创建/扩展）：**

- `packages/prompts/` — 整个 workspace 包不存在
- `apps/worker/src/summarize/llm-client.ts` / `summarize.service.ts` / `summarize.processor.ts` / `strategies/` — 都不存在
- `apps/worker/package.json` — 不含 `ai` / `@ai-sdk/openai` / `@ai-hot-news/prompts: workspace:*`
- prod `/srv/ai-hot-news/.env` — 未写入 `OPENROUTER_API_KEY`（按 SP-4.7 部署历史，prod env 仅有 SP-4.7 keys）

**契约信号（不要破坏）：**

- `apps/worker/src/redis/redis.module.spec.ts` 的 2 个 case — 任何 SummarizeModule 改动后必须仍绿
- `apps/worker/src/crawl/ingestion.service.integration.spec.ts` 的 `summaryQueueAdd.toHaveBeenCalledWith(...)` cases — IngestionService 行为不能改
- prod Redis `summary` 队列从 SP-4.7 上线起就在累积 pending jobs（SP-4.7 push 但无 consumer），SP-5 worker 上线后会消费这批 backlog；boot backstop jobId 幂等，重复 add 无害

---

## Task 1: Create `packages/prompts/` workspace package skeleton

**Goal:** 新建 `packages/prompts/` 目录，含 `package.json` + `tsconfig.json` + `vitest.config.ts` + `eslint.config.mjs` + 空 `src/index.ts`，能 `pnpm install` 通过；`build` 跑 esbuild bundle 同 `@ai-hot-news/utils` pattern。

**Files:**
- Create: `packages/prompts/package.json`
- Create: `packages/prompts/tsconfig.json`
- Create: `packages/prompts/vitest.config.ts`
- Create: `packages/prompts/eslint.config.mjs`
- Create: `packages/prompts/src/index.ts`
- Create: `packages/prompts/.gitignore`

- [ ] **Step 1.1: Verify pnpm workspace globs `packages/*`**

```bash
cat pnpm-workspace.yaml
```

期望输出含 `- 'packages/*'`。已存在 → 不需要改。

- [ ] **Step 1.2: Create `packages/prompts/package.json`**

```json
{
  "name": "@ai-hot-news/prompts",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit",
    "build": "esbuild src/index.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/index.js",
    "test": "vitest run"
  },
  "devDependencies": {
    "esbuild": "^0.28.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

注：跟随 `@ai-hot-news/utils` 形态 — runtime 通过 esbuild bundle 到 `dist/index.js`，`types` 字段直指 `src/index.ts` 让 worker tsc 编译时也能拿到 types。

- [ ] **Step 1.3: Create `packages/prompts/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

直接 copy `packages/utils/tsconfig.json` 内容。

- [ ] **Step 1.4: Create `packages/prompts/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
  },
});
```

- [ ] **Step 1.5: Create `packages/prompts/eslint.config.mjs`**

打开 `packages/utils/eslint.config.mjs` 看一眼，照抄到 prompts 目录（保持与 utils 完全一致，避免风格漂移）。

- [ ] **Step 1.6: Create `packages/prompts/.gitignore`**

```
dist/
node_modules/
*.tsbuildinfo
```

- [ ] **Step 1.7: Create `packages/prompts/src/index.ts` (empty placeholder)**

```ts
export {};
```

后续 Task 5 会替换为真实 re-exports。

- [ ] **Step 1.8: Run `pnpm install` to register the new workspace**

```bash
pnpm install
```

期望：`packages/prompts` 出现在 workspace 列表（`pnpm ls -r --depth=-1 | grep prompts` 应有输出）。

- [ ] **Step 1.9: Run typecheck + build to confirm scaffolding works**

```bash
pnpm --filter @ai-hot-news/prompts run typecheck
pnpm --filter @ai-hot-news/prompts run build
```

两个都期望 PASS（typecheck noop，build 产出空 `dist/index.js`）。

- [ ] **Step 1.10: Commit**

```bash
git add packages/prompts/ pnpm-lock.yaml
git commit -m "feat(sp5): scaffold @ai-hot-news/prompts workspace package"
```

---

## Task 2: TDD `packages/prompts/src/taxonomy.ts` — controlled vocabulary

**Goal:** 定义 `TAXONOMY = { companies, models, categories }` 作 readonly const tuple，导出 `Company` / `Model` / `Category` 类型；测试 4 case。

**Files:**
- Create: `packages/prompts/src/taxonomy.ts`
- Create: `packages/prompts/src/taxonomy.spec.ts`

- [ ] **Step 2.1: Write the failing tests**

新建 `packages/prompts/src/taxonomy.spec.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { TAXONOMY } from './taxonomy';

describe('TAXONOMY', () => {
  it('companies array is non-empty and unique', () => {
    expect(TAXONOMY.companies.length).toBeGreaterThan(0);
    const set = new Set(TAXONOMY.companies);
    expect(set.size).toBe(TAXONOMY.companies.length);
  });

  it('models array is non-empty and unique', () => {
    expect(TAXONOMY.models.length).toBeGreaterThan(0);
    const set = new Set(TAXONOMY.models);
    expect(set.size).toBe(TAXONOMY.models.length);
  });

  it('categories has exactly 8 entries (Release / Research / Tutorial / Opinion / Tooling / Benchmark / Incident / Product)', () => {
    expect(TAXONOMY.categories.length).toBe(8);
    expect([...TAXONOMY.categories].sort()).toEqual(
      [
        'Benchmark',
        'Incident',
        'Opinion',
        'Product',
        'Release',
        'Research',
        'Tooling',
        'Tutorial',
      ].sort(),
    );
  });

  it('contains key reference companies (OpenAI, Anthropic, Google, DeepSeek)', () => {
    expect(TAXONOMY.companies).toContain('OpenAI');
    expect(TAXONOMY.companies).toContain('Anthropic');
    expect(TAXONOMY.companies).toContain('Google');
    expect(TAXONOMY.companies).toContain('DeepSeek');
  });
});
```

- [ ] **Step 2.2: Run test to verify they fail**

```bash
pnpm --filter @ai-hot-news/prompts run test -- taxonomy
```

期望 FAIL：找不到 `./taxonomy` 模块。

- [ ] **Step 2.3: Implement `taxonomy.ts`**

新建 `packages/prompts/src/taxonomy.ts`：

```ts
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
    'Release',
    'Research',
    'Tutorial',
    'Opinion',
    'Tooling',
    'Benchmark',
    'Incident',
    'Product',
  ] as const,
} as const;

export type Company = (typeof TAXONOMY.companies)[number];
export type Model = (typeof TAXONOMY.models)[number];
export type Category = (typeof TAXONOMY.categories)[number];
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/prompts run test -- taxonomy
```

期望 PASS（4/4 绿）。

- [ ] **Step 2.5: Commit**

```bash
git add packages/prompts/src/taxonomy.ts packages/prompts/src/taxonomy.spec.ts
git commit -m "feat(sp5): controlled taxonomy (companies / models / categories) for aiTags"
```

---

## Task 3: TDD `packages/prompts/src/summarize.prompt.ts` — system + user prompt builders

**Goal:** 提供 `SUMMARIZE_PROMPT_VERSION` 常量、`buildSystemPrompt()` 和 `buildUserPrompt()` 两个纯函数；user prompt 截断到 6000 字符 + 添加截断 hint。

**Files:**
- Create: `packages/prompts/src/summarize.prompt.ts`
- Create: `packages/prompts/src/summarize.prompt.spec.ts`

- [ ] **Step 3.1: Write the failing tests**

新建 `packages/prompts/src/summarize.prompt.spec.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  SUMMARIZE_PROMPT_VERSION,
  buildSystemPrompt,
  buildUserPrompt,
} from './summarize.prompt';

describe('summarize.prompt', () => {
  it('SUMMARIZE_PROMPT_VERSION is a number ≥ 1', () => {
    expect(typeof SUMMARIZE_PROMPT_VERSION).toBe('number');
    expect(SUMMARIZE_PROMPT_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('system prompt embeds taxonomy companies (e.g. OpenAI) and categories (e.g. Release)', () => {
    const sys = buildSystemPrompt();
    expect(sys).toContain('OpenAI');
    expect(sys).toContain('Anthropic');
    expect(sys).toContain('Release');
    expect(sys).toContain('Research');
    expect(sys).toMatch(/JSON/);
    expect(sys).toMatch(/中文/);
  });

  it('system prompt instructs not to use marketing tone (no 小编 / 一起看看)', () => {
    const sys = buildSystemPrompt();
    expect(sys).toMatch(/小编|营销/);
  });

  it('user prompt embeds platform + title + body verbatim when content < 6000 chars', () => {
    const user = buildUserPrompt({
      title: 'GPT-5 announcement',
      content: 'OpenAI released GPT-5 today.',
      sourcePlatform: 'HACKERNEWS',
    });
    expect(user).toContain('HACKERNEWS');
    expect(user).toContain('GPT-5 announcement');
    expect(user).toContain('OpenAI released GPT-5 today.');
    expect(user).not.toContain('内容已截断');
  });

  it('user prompt truncates content to first 6000 chars and adds hint when exceeded', () => {
    const long = 'a'.repeat(6500);
    const user = buildUserPrompt({
      title: 'long',
      content: long,
      sourcePlatform: 'RSS',
    });
    expect(user).toContain('a'.repeat(6000));
    expect(user).not.toContain('a'.repeat(6001));
    expect(user).toMatch(/内容已截断/);
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
pnpm --filter @ai-hot-news/prompts run test -- summarize.prompt
```

期望 FAIL：找不到模块。

- [ ] **Step 3.3: Implement `summarize.prompt.ts`**

新建 `packages/prompts/src/summarize.prompt.ts`：

```ts
import { TAXONOMY } from './taxonomy';

/**
 * Prompt 版本。改 system / user prompt body 时 +1，并：
 *   1. ssh prod psql: UPDATE hot_news SET summary=NULL, "aiTags"='{}' WHERE summary IS NOT NULL;
 *   2. restart worker → boot backstop 扫 NULL 重摘
 * V1 = 1。
 */
export const SUMMARIZE_PROMPT_VERSION = 1;

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

- [ ] **Step 3.4: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/prompts run test -- summarize.prompt
```

期望 PASS（5/5 绿）。

- [ ] **Step 3.5: Commit**

```bash
git add packages/prompts/src/summarize.prompt.ts packages/prompts/src/summarize.prompt.spec.ts
git commit -m "feat(sp5): system + user prompt builders for summarize"
```

---

## Task 4: TDD `packages/prompts/src/parse.ts` — robust LLM JSON parser

**Goal:** 鲁棒解析 LLM 返回（含 markdown 包裹 / 前后噪音 / 字段缺失），输出 `SummarizeResult { summary, aiTags[] }`，aiTags 用 `prefix:value` 格式（`company:OpenAI` / `model:GPT-5` / `category:Release` / `tech:Agents`），bounded fallback 受控词表外丢弃。

**Files:**
- Create: `packages/prompts/src/parse.ts`
- Create: `packages/prompts/src/parse.spec.ts`

- [ ] **Step 4.1: Write the failing tests**

新建 `packages/prompts/src/parse.spec.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseSummarizeResponse } from './parse';

const goodJson = JSON.stringify({
  summary: 'OpenAI 今日发布 GPT-5，相比 GPT-4o 在数学推理上提升 30%。模型已开放给 API 用户使用。',
  companies: ['OpenAI'],
  models: ['GPT-5'],
  category: 'Release',
  tech: ['Reasoning'],
});

describe('parseSummarizeResponse', () => {
  it('parses a clean JSON response with all fields', () => {
    const r = parseSummarizeResponse(goodJson);
    expect(r).not.toBeNull();
    expect(r!.summary).toMatch(/OpenAI 今日发布 GPT-5/);
    expect(r!.aiTags).toEqual(
      expect.arrayContaining([
        'company:OpenAI',
        'model:GPT-5',
        'category:Release',
        'tech:Reasoning',
      ]),
    );
  });

  it('returns null when JSON is completely invalid', () => {
    expect(parseSummarizeResponse('not json at all')).toBeNull();
  });

  it('returns null when summary field is missing', () => {
    const r = parseSummarizeResponse(JSON.stringify({ companies: [], category: 'Release' }));
    expect(r).toBeNull();
  });

  it('returns null when summary is empty string', () => {
    const r = parseSummarizeResponse(JSON.stringify({ summary: '', companies: [] }));
    expect(r).toBeNull();
  });

  it('returns null when raw response is empty', () => {
    expect(parseSummarizeResponse('')).toBeNull();
  });

  it('extracts JSON from response with leading noise (e.g. "好的，根据要求...{...}")', () => {
    const noisy = `好的，根据要求生成如下结果：${goodJson}`;
    const r = parseSummarizeResponse(noisy);
    expect(r).not.toBeNull();
    expect(r!.summary).toMatch(/OpenAI/);
  });

  it('extracts JSON from markdown-wrapped response (```json {...} ```)', () => {
    const wrapped = '```json\n' + goodJson + '\n```';
    const r = parseSummarizeResponse(wrapped);
    expect(r).not.toBeNull();
  });

  it('drops companies not in the controlled taxonomy', () => {
    const json = JSON.stringify({
      summary: '某不知名公司发了新产品。',
      companies: ['UnknownCo', 'OpenAI'],
      models: [],
      category: 'Product',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.aiTags).toContain('company:OpenAI');
    expect(r.aiTags).not.toContain('company:UnknownCo');
  });

  it('drops invalid category (not in 8 enum values)', () => {
    const json = JSON.stringify({
      summary: '业内讨论了一些观点。',
      companies: [],
      models: [],
      category: 'NotARealCategory',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.aiTags.find((t) => t.startsWith('category:'))).toBeUndefined();
  });

  it('truncates each multi-value array dimension to ≤ 3', () => {
    const json = JSON.stringify({
      summary: 'AI 巨头联合发布。',
      companies: ['OpenAI', 'Anthropic', 'Google', 'Meta', 'Microsoft'],
      models: [],
      category: 'Release',
      tech: ['Agents', 'RAG', 'Multimodal', 'MoE', 'Long Context'],
    });
    const r = parseSummarizeResponse(json)!;
    const companyTags = r.aiTags.filter((t) => t.startsWith('company:'));
    const techTags = r.aiTags.filter((t) => t.startsWith('tech:'));
    expect(companyTags.length).toBeLessThanOrEqual(3);
    expect(techTags.length).toBeLessThanOrEqual(3);
  });

  it('truncates summary at 400 chars hard cap', () => {
    const longSummary = '中'.repeat(500);
    const json = JSON.stringify({ summary: longSummary, companies: [], models: [], category: 'Opinion', tech: [] });
    const r = parseSummarizeResponse(json)!;
    expect(r.summary.length).toBeLessThanOrEqual(400);
  });

  it('drops non-string array elements', () => {
    const json = JSON.stringify({
      summary: 'OpenAI did things.',
      companies: ['OpenAI', 123, null, { foo: 1 }],
      models: [],
      category: 'Release',
      tech: [],
    });
    const r = parseSummarizeResponse(json)!;
    expect(r.aiTags).toEqual(expect.arrayContaining(['company:OpenAI']));
    expect(r.aiTags.filter((t) => t.startsWith('company:'))).toHaveLength(1);
  });

  it('truncates tech tag value to 30 chars (free-form dimension)', () => {
    const json = JSON.stringify({
      summary: 'A very specific paper.',
      companies: [],
      models: [],
      category: 'Research',
      tech: ['x'.repeat(50)],
    });
    const r = parseSummarizeResponse(json)!;
    const techTag = r.aiTags.find((t) => t.startsWith('tech:'));
    expect(techTag).toBeDefined();
    expect(techTag!.length).toBeLessThanOrEqual(35);
  });
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

```bash
pnpm --filter @ai-hot-news/prompts run test -- parse
```

期望 FAIL：找不到 `./parse`。

- [ ] **Step 4.3: Implement `parse.ts`**

新建 `packages/prompts/src/parse.ts`：

```ts
import { TAXONOMY } from './taxonomy';

export interface SummarizeResult {
  /** 已 trim + 截断到 ≤400 字符 */
  summary: string;
  /** prefix-encoded: 'company:OpenAI' / 'model:GPT-5' / 'category:Release' / 'tech:Agents' */
  aiTags: string[];
}

const MAX_TAGS_PER_DIM = 3;
const MAX_SUMMARY_CHARS = 400;
const MAX_TECH_VALUE_CHARS = 30;

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

export function parseSummarizeResponse(raw: string): SummarizeResult | null {
  if (!raw) return null;
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
    const trimmed = t.trim().slice(0, MAX_TECH_VALUE_CHARS);
    if (trimmed) tags.push(`tech:${trimmed}`);
  }

  return { summary, aiTags: tags };
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/prompts run test -- parse
```

期望 PASS（13/13 绿）。

- [ ] **Step 4.5: Commit**

```bash
git add packages/prompts/src/parse.ts packages/prompts/src/parse.spec.ts
git commit -m "feat(sp5): robust JSON parser with bounded taxonomy fallback"
```

---

## Task 5: Wire `packages/prompts/src/index.ts` re-exports + final build

**Goal:** 让 `@ai-hot-news/prompts` 暴露 taxonomy / summarize.prompt / parse 三个模块，跑 build 输出 `dist/index.js` 不出错。

**Files:**
- Modify: `packages/prompts/src/index.ts`

- [ ] **Step 5.1: Replace placeholder index with real re-exports**

打开 `packages/prompts/src/index.ts`，把 `export {};` 替换为：

```ts
export { TAXONOMY } from './taxonomy';
export type { Company, Model, Category } from './taxonomy';
export {
  SUMMARIZE_PROMPT_VERSION,
  buildSystemPrompt,
  buildUserPrompt,
} from './summarize.prompt';
export type { UserPromptInput } from './summarize.prompt';
export { parseSummarizeResponse } from './parse';
export type { SummarizeResult } from './parse';
```

- [ ] **Step 5.2: Run lint + typecheck + build + test**

```bash
pnpm --filter @ai-hot-news/prompts run lint typecheck build test
```

期望全绿。`dist/index.js` 文件出现，里面应有 `TAXONOMY` / `parseSummarizeResponse` / `buildSystemPrompt` / `buildUserPrompt` / `SUMMARIZE_PROMPT_VERSION` 字样（CJS bundle）。

- [ ] **Step 5.3: Commit**

```bash
git add packages/prompts/src/index.ts
git commit -m "feat(sp5): wire prompts package public exports"
```

---

## Task 6: Add Vercel AI SDK + OpenRouter compat + workspace prompts dep to worker

**Goal:** `apps/worker/package.json` 加 `ai` + `@ai-sdk/openai` + `@ai-hot-news/prompts: workspace:*` 三个依赖；pnpm install 通过。

**Files:**
- Modify: `apps/worker/package.json`

- [ ] **Step 6.1: Modify `apps/worker/package.json` — add deps**

打开 `apps/worker/package.json`，在 `"dependencies"` 块内追加（保持字母序）：

```json
"dependencies": {
  "@ai-hot-news/db": "workspace:*",
  "@ai-hot-news/prompts": "workspace:*",
  "@ai-hot-news/types": "workspace:*",
  "@ai-hot-news/utils": "workspace:*",
  "@ai-sdk/openai": "^1.0.0",
  "@nestjs/common": "^11.0.0",
  "@nestjs/config": "^4.0.0",
  "@nestjs/core": "^11.0.0",
  "@nestjs/schedule": "^4.1.2",
  "ai": "^4.0.0",
  "bullmq": "^5.34.0",
  "ioredis": "^5.4.1",
  "p-limit": "^6.2.0",
  "reflect-metadata": "^0.2.2",
  "rss-parser": "^3.13.0",
  "rxjs": "^7.8.1"
}
```

注：`ai` v4+ 是 Vercel AI SDK 当前主版本（API 含 `generateText`）；`@ai-sdk/openai` v1+ 兼容 OpenRouter（透传 `baseURL`）。如 install 时报版本不存在，跑 `pnpm view ai versions` / `pnpm view @ai-sdk/openai versions` 选最新 v4 / v1 即可。

- [ ] **Step 6.2: Run `pnpm install` to fetch the deps**

```bash
pnpm install
```

期望：lock 更新，三个新包出现在 `pnpm-lock.yaml`。

- [ ] **Step 6.3: Verify import works from worker tsc**

```bash
pnpm --filter @ai-hot-news/worker run typecheck
```

期望 PASS（虽然新依赖还没被 import，typecheck 不会因 install 报错）。

- [ ] **Step 6.4: Commit**

```bash
git add apps/worker/package.json pnpm-lock.yaml
git commit -m "feat(sp5): add ai SDK + @ai-sdk/openai + @ai-hot-news/prompts deps to worker"
```

---

## Task 7: TDD `apps/worker/src/summarize/llm-client.ts`

**Goal:** 单一 `callLlm(systemPrompt, userPrompt) → { text, tokensIn, tokensOut, durationMs }`；缺 `OPENROUTER_API_KEY` 抛错；默认 `SUMMARY_MODEL=deepseek/deepseek-v3.2`；env override 工作。

**Files:**
- Create: `apps/worker/src/summarize/llm-client.ts`
- Create: `apps/worker/src/summarize/llm-client.spec.ts`

- [ ] **Step 7.1: Write the failing tests**

新建 `apps/worker/src/summarize/llm-client.spec.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateTextMock = vi.fn();
const createOpenAIMock = vi.fn();

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (...args: unknown[]) => createOpenAIMock(...args),
}));

import { callLlm } from './llm-client';

describe('callLlm', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    createOpenAIMock.mockReset();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.SUMMARY_MODEL;
    delete process.env.LLM_BASE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when OPENROUTER_API_KEY is not configured', async () => {
    await expect(callLlm('sys', 'user')).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('uses default model deepseek/deepseek-v3.2 and default OpenRouter baseURL', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const provider = vi.fn().mockReturnValue({ id: 'mocked-model' });
    createOpenAIMock.mockReturnValue(provider);
    generateTextMock.mockResolvedValue({
      text: '{"summary":"x"}',
      usage: { promptTokens: 100, completionTokens: 50 },
    });

    await callLlm('sys', 'user');

    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or-test',
      }),
    );
    expect(provider).toHaveBeenCalledWith('deepseek/deepseek-v3.2');
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'sys',
        prompt: 'user',
        temperature: 0.2,
        maxTokens: 500,
      }),
    );
  });

  it('honors SUMMARY_MODEL + LLM_BASE_URL env overrides', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.SUMMARY_MODEL = 'openai/gpt-4o-mini';
    process.env.LLM_BASE_URL = 'https://api.openai.com/v1';
    const provider = vi.fn().mockReturnValue({ id: 'gpt-4o-mini' });
    createOpenAIMock.mockReturnValue(provider);
    generateTextMock.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1 } });

    await callLlm('s', 'u');

    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.openai.com/v1' }),
    );
    expect(provider).toHaveBeenCalledWith('openai/gpt-4o-mini');
  });

  it('returns text + tokensIn / tokensOut / durationMs', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const provider = vi.fn().mockReturnValue({});
    createOpenAIMock.mockReturnValue(provider);
    generateTextMock.mockResolvedValue({
      text: 'hello',
      usage: { promptTokens: 200, completionTokens: 80 },
    });

    const r = await callLlm('s', 'u');
    expect(r.text).toBe('hello');
    expect(r.tokensIn).toBe(200);
    expect(r.tokensOut).toBe(80);
    expect(typeof r.durationMs).toBe('number');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 7.2: Run tests to verify they fail**

```bash
pnpm --filter @ai-hot-news/worker run test -- llm-client
```

期望 FAIL：找不到 `./llm-client`。

- [ ] **Step 7.3: Implement `llm-client.ts`**

新建 `apps/worker/src/summarize/llm-client.ts`：

```ts
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

export interface LlmCallResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export async function callLlm(
  systemPrompt: string,
  userPrompt: string,
): Promise<LlmCallResult> {
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

- [ ] **Step 7.4: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/worker run test -- llm-client
```

期望 PASS（4/4 绿）。

- [ ] **Step 7.5: Commit**

```bash
git add apps/worker/src/summarize/llm-client.ts apps/worker/src/summarize/llm-client.spec.ts
git commit -m "feat(sp5): llm-client wrapper for Vercel AI SDK + OpenRouter compat"
```

---

## Task 8: TDD Strategy interface + `SummarizeAllVisibleStrategy`

**Goal:** 定义 `SummarizationStrategy` interface（PRD §6 / decomposition spec §1.2 契约预留）；实现 V1 默认 `SummarizeAllVisibleStrategy`：`status='VISIBLE'` → `'allow'`，否则 `'skip:status_<X>'`。

**Files:**
- Create: `apps/worker/src/summarize/strategies/strategy.interface.ts`
- Create: `apps/worker/src/summarize/strategies/summarize-all-visible.strategy.ts`
- Create: `apps/worker/src/summarize/strategies/summarize-all-visible.strategy.spec.ts`

- [ ] **Step 8.1: Implement `strategy.interface.ts` (interface only, no test)**

新建 `apps/worker/src/summarize/strategies/strategy.interface.ts`：

```ts
export type StrategyVerdict = 'allow' | `skip:${string}`;

export interface StrategyRowInput {
  id: string;
  sourcePlatform: 'TWITTER' | 'RSS' | 'HACKERNEWS' | 'REDDIT';
  publishedAt: Date;
  status: 'VISIBLE' | 'HIDDEN' | 'PENDING';
  interactionData: Record<string, unknown> | null;
  heatScore: number;
}

export interface SummarizationStrategy {
  /**
   * 根据 row 元数据决定是否调 LLM。
   * 'allow' → 走 LLM；'skip:<reason>' → 跳过（不算失败、不入计数器）。
   */
  shouldSummarize(row: StrategyRowInput): StrategyVerdict;
}
```

- [ ] **Step 8.2: Write the failing tests for SummarizeAllVisibleStrategy**

新建 `apps/worker/src/summarize/strategies/summarize-all-visible.strategy.spec.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { SummarizeAllVisibleStrategy } from './summarize-all-visible.strategy';
import type { StrategyRowInput } from './strategy.interface';

const baseRow: StrategyRowInput = {
  id: 'r1',
  sourcePlatform: 'HACKERNEWS',
  publishedAt: new Date('2026-05-05T00:00:00Z'),
  status: 'VISIBLE',
  interactionData: null,
  heatScore: 100,
};

describe('SummarizeAllVisibleStrategy', () => {
  const strategy = new SummarizeAllVisibleStrategy();

  it('allows VISIBLE rows', () => {
    expect(strategy.shouldSummarize({ ...baseRow, status: 'VISIBLE' })).toBe('allow');
  });

  it('skips HIDDEN rows with skip:status_HIDDEN reason', () => {
    expect(strategy.shouldSummarize({ ...baseRow, status: 'HIDDEN' })).toBe('skip:status_HIDDEN');
  });

  it('skips PENDING rows with skip:status_PENDING reason', () => {
    expect(strategy.shouldSummarize({ ...baseRow, status: 'PENDING' })).toBe('skip:status_PENDING');
  });
});
```

- [ ] **Step 8.3: Run tests to verify they fail**

```bash
pnpm --filter @ai-hot-news/worker run test -- summarize-all-visible
```

期望 FAIL：找不到 `./summarize-all-visible.strategy`。

- [ ] **Step 8.4: Implement `summarize-all-visible.strategy.ts`**

新建 `apps/worker/src/summarize/strategies/summarize-all-visible.strategy.ts`：

```ts
import {
  SummarizationStrategy,
  StrategyRowInput,
  StrategyVerdict,
} from './strategy.interface';

export class SummarizeAllVisibleStrategy implements SummarizationStrategy {
  shouldSummarize(row: StrategyRowInput): StrategyVerdict {
    if (row.status !== 'VISIBLE') {
      return `skip:status_${row.status}` as StrategyVerdict;
    }
    return 'allow';
  }
}
```

- [ ] **Step 8.5: Run tests to verify they pass**

```bash
pnpm --filter @ai-hot-news/worker run test -- summarize-all-visible
```

期望 PASS（3/3 绿）。

- [ ] **Step 8.6: Commit**

```bash
git add apps/worker/src/summarize/strategies/
git commit -m "feat(sp5): SummarizationStrategy interface + V1 SummarizeAllVisibleStrategy"
```

---

## Task 9: Extend `summarize.queue.ts` — add SUMMARY_WORKER token + createSummaryWorker

**Goal:** 在 SP-4.7 已有的 `summarize.queue.ts` stub（仅 `SUMMARY_QUEUE_NAME` / `SUMMARY_QUEUE` / `summaryQueueProvider`）之上**追加** `SUMMARY_WORKER` Symbol token + `createSummaryWorker(processor, connection)` 工厂函数（concurrency=3，可被 `SUMMARY_CONCURRENCY` env override）。**不删除任何现有导出**。

**Files:**
- Modify: `apps/worker/src/summarize/summarize.queue.ts`

- [ ] **Step 9.1: Read current `summarize.queue.ts` to confirm baseline**

```bash
cat apps/worker/src/summarize/summarize.queue.ts
```

期望含且仅含：`SUMMARY_QUEUE_NAME` / `SUMMARY_QUEUE` Symbol / `summaryQueueProvider`，imports `Queue, ConnectionOptions` from `bullmq`、`IORedis` from `ioredis`、`REDIS_CONNECTION` from `'../crawl/queue.provider'`。

- [ ] **Step 9.2: Modify `summarize.queue.ts` — append worker exports**

打开 `apps/worker/src/summarize/summarize.queue.ts`，做以下修改：

a) imports 行的 `import { Queue, ConnectionOptions } from 'bullmq';` 改为：

```ts
import { Queue, Worker, ConnectionOptions } from 'bullmq';
```

b) 在文件末尾（`summaryQueueProvider` 块之后）追加：

```ts

export const SUMMARY_WORKER = Symbol('SUMMARY_WORKER');

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
```

最终文件应有 5 个 named exports：`SUMMARY_QUEUE_NAME` / `SUMMARY_QUEUE` / `summaryQueueProvider` / `SUMMARY_WORKER` / `createSummaryWorker`。

- [ ] **Step 9.3: Confirm typecheck**

```bash
pnpm --filter @ai-hot-news/worker run typecheck
```

期望 PASS。

- [ ] **Step 9.4: Confirm regression spec still green**

```bash
pnpm --filter @ai-hot-news/worker run test -- redis.module
```

期望 PASS（PR #2 引入的 2 个 case 仍绿 — 该 spec 仅验证 `SUMMARY_QUEUE` 能 resolve，不依赖新增的 worker 导出）。

- [ ] **Step 9.5: Commit**

```bash
git add apps/worker/src/summarize/summarize.queue.ts
git commit -m "feat(sp5): extend summarize.queue with SUMMARY_WORKER + createSummaryWorker (concurrency=3)"
```

---

## Task 10: TDD `summarize.processor.ts`

**Goal:** 极简 processor 转发到 service。`processSummaryJob({ hotNewsId }, service) → service.run(hotNewsId)`，错误透传给 BullMQ retry。

**Files:**
- Create: `apps/worker/src/summarize/summarize.processor.ts`
- Create: `apps/worker/src/summarize/summarize.processor.spec.ts`

- [ ] **Step 10.1: Write the failing tests**

新建 `apps/worker/src/summarize/summarize.processor.spec.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { processSummaryJob } from './summarize.processor';
import type { SummarizeService } from './summarize.service';

describe('processSummaryJob', () => {
  it('forwards hotNewsId to service.run', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const service = { run } as unknown as SummarizeService;

    await processSummaryJob({ hotNewsId: 'cm123' }, service);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('cm123');
  });

  it('rethrows when service.run throws (so BullMQ retries)', async () => {
    const run = vi.fn().mockRejectedValue(new Error('llm down'));
    const service = { run } as unknown as SummarizeService;

    await expect(processSummaryJob({ hotNewsId: 'cm456' }, service)).rejects.toThrow(/llm down/);
  });
});
```

- [ ] **Step 10.2: Run test (will fail because SummarizeService doesn't exist yet)**

```bash
pnpm --filter @ai-hot-news/worker run test -- summarize.processor
```

期望 FAIL：找不到 `./summarize.service`（Task 11 才落地）。先把测试代码 commit，Task 11 后才会跑通。

- [ ] **Step 10.3: Implement `summarize.processor.ts`**

新建 `apps/worker/src/summarize/summarize.processor.ts`：

```ts
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

注：`SummarizeService` 在 Task 11 落地，typecheck 在 Task 11 完成前会失败。先把骨架文件落盘 + spec 写好。

- [ ] **Step 10.4: Commit**

```bash
git add apps/worker/src/summarize/summarize.processor.ts apps/worker/src/summarize/summarize.processor.spec.ts
git commit -m "feat(sp5): summarize processor scaffolding + forwarding spec"
```

---

## Task 11: TDD `SummarizeService` — core flow

**Goal:** `service.run(id)` 的状态机：
1. `findUnique(id)` → 不存在 → log + 返回（不抛错）
2. `strategy.shouldSummarize(row)` → `'skip:reason'` → log + 返回（不抛错，不调 LLM）
3. `callLlm(system, user)` → 异常 → 抛错让 BullMQ retry
4. `parseSummarizeResponse(text)` → null → log + 返回（不抛错；不重试同 prompt 大概率仍非法）
5. `prisma.update({ summary, aiTags })` → 成功 → log
6. update P2025（row 已删）→ 静默跳过

**Files:**
- Create: `apps/worker/src/summarize/summarize.service.ts`
- Create: `apps/worker/src/summarize/summarize.service.spec.ts`

- [ ] **Step 11.1: Write the failing tests**

新建 `apps/worker/src/summarize/summarize.service.spec.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  hotNews: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};
vi.mock('@ai-hot-news/db', () => ({
  getPrisma: () => mockPrisma,
  ContentStatus: { VISIBLE: 'VISIBLE', HIDDEN: 'HIDDEN', PENDING: 'PENDING' },
}));

const callLlmMock = vi.fn();
vi.mock('./llm-client', () => ({
  callLlm: (...args: unknown[]) => callLlmMock(...args),
}));

import { SummarizeService } from './summarize.service';
import { SummarizeAllVisibleStrategy } from './strategies/summarize-all-visible.strategy';

const goodLlmResponse = JSON.stringify({
  summary: 'OpenAI 今日发布 GPT-5，相比 GPT-4o 在数学推理上提升 30%。模型已开放给 API 用户使用。',
  companies: ['OpenAI'],
  models: ['GPT-5'],
  category: 'Release',
  tech: ['Reasoning'],
});

const baseRow = {
  id: 'cm-1',
  title: 'GPT-5 announced',
  content: 'OpenAI released GPT-5 today.',
  sourcePlatform: 'HACKERNEWS',
  publishedAt: new Date('2026-05-05T00:00:00Z'),
  status: 'VISIBLE',
  interactionData: null,
  heatScore: 100,
};

describe('SummarizeService.run', () => {
  let service: SummarizeService;

  beforeEach(() => {
    service = new SummarizeService(new SummarizeAllVisibleStrategy());
    mockPrisma.hotNews.findUnique.mockReset();
    mockPrisma.hotNews.update.mockReset();
    callLlmMock.mockReset();
  });

  afterEach(() => vi.resetAllMocks());

  it('UPDATEs summary + aiTags when LLM returns valid JSON for VISIBLE row', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    callLlmMock.mockResolvedValue({
      text: goodLlmResponse,
      tokensIn: 200,
      tokensOut: 80,
      durationMs: 1500,
    });
    mockPrisma.hotNews.update.mockResolvedValue({});

    await service.run('cm-1');

    expect(callLlmMock).toHaveBeenCalledTimes(1);
    expect(mockPrisma.hotNews.update).toHaveBeenCalledWith({
      where: { id: 'cm-1' },
      data: expect.objectContaining({
        summary: expect.stringMatching(/OpenAI/),
        aiTags: expect.arrayContaining(['company:OpenAI', 'model:GPT-5', 'category:Release']),
      }),
    });
  });

  it('skips HIDDEN rows without calling LLM or UPDATE', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({ ...baseRow, status: 'HIDDEN' });

    await service.run('cm-1');

    expect(callLlmMock).not.toHaveBeenCalled();
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
  });

  it('returns silently when row not found', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(null);

    await expect(service.run('missing')).resolves.toBeUndefined();
    expect(callLlmMock).not.toHaveBeenCalled();
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
  });

  it('does NOT update DB when LLM returns invalid JSON (silent skip, no rethrow)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    callLlmMock.mockResolvedValue({
      text: 'sorry I cannot help',
      tokensIn: 50,
      tokensOut: 5,
      durationMs: 500,
    });

    await expect(service.run('cm-1')).resolves.toBeUndefined();
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
  });

  it('rethrows when LLM call itself throws (BullMQ will retry)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    callLlmMock.mockRejectedValue(new Error('OpenRouter 503'));

    await expect(service.run('cm-1')).rejects.toThrow(/OpenRouter 503/);
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
  });

  it('silently skips when prisma.update throws P2025 (row already deleted)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    callLlmMock.mockResolvedValue({
      text: goodLlmResponse,
      tokensIn: 200,
      tokensOut: 80,
      durationMs: 1500,
    });
    const p2025 = Object.assign(new Error('not found'), { code: 'P2025' });
    mockPrisma.hotNews.update.mockRejectedValue(p2025);

    await expect(service.run('cm-1')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 11.2: Run tests to verify they fail**

```bash
pnpm --filter @ai-hot-news/worker run test -- summarize.service
```

期望 FAIL：找不到 `./summarize.service`。

- [ ] **Step 11.3: Implement `summarize.service.ts`**

新建 `apps/worker/src/summarize/summarize.service.ts`：

```ts
import { Injectable, Logger } from '@nestjs/common';
import { getPrisma } from '@ai-hot-news/db';
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseSummarizeResponse,
} from '@ai-hot-news/prompts';
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
      sourcePlatform: row.sourcePlatform as 'TWITTER' | 'RSS' | 'HACKERNEWS' | 'REDDIT',
      publishedAt: row.publishedAt,
      status: row.status as 'VISIBLE' | 'HIDDEN' | 'PENDING',
      interactionData: row.interactionData as Record<string, unknown> | null,
      heatScore: row.heatScore,
    });
    if (verdict !== 'allow') {
      this.logger.log(`hotNewsId=${hotNewsId} → ${verdict}`);
      return;
    }

    const result = await callLlm(
      buildSystemPrompt(),
      buildUserPrompt({
        title: row.title,
        content: row.content,
        sourcePlatform: row.sourcePlatform,
      }),
    );

    const parsed = parseSummarizeResponse(result.text);
    if (!parsed) {
      this.logger.warn(
        `Failed to parse LLM response for ${hotNewsId} (${result.durationMs}ms, in=${result.tokensIn} out=${result.tokensOut}), raw text first 200 chars: ${result.text.slice(0, 200)}`,
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
      if ((err as { code?: string }).code === 'P2025') return;
      throw err;
    }

    this.logger.log(
      `hotNewsId=${hotNewsId} → done (${result.durationMs}ms, in=${result.tokensIn}, out=${result.tokensOut}, summary=${parsed.summary.length}c, tags=${parsed.aiTags.length})`,
    );
  }
}
```

- [ ] **Step 11.4: Run all summarize tests to confirm green**

```bash
pnpm --filter @ai-hot-news/worker run test -- summarize.service
pnpm --filter @ai-hot-news/worker run test -- summarize.processor
```

两批都期望 PASS（service: 6/6 绿；processor: 2/2 绿，因为 service 现在存在了）。

- [ ] **Step 11.5: Commit**

```bash
git add apps/worker/src/summarize/summarize.service.ts apps/worker/src/summarize/summarize.service.spec.ts
git commit -m "feat(sp5): SummarizeService — core flow with skip / parse-fail / P2025 handling"
```

---

## Task 12: Replace `SummarizeModule` stub with full version + verify regression spec

**Goal:** 替换 SP-4.7 留下的 stub `SummarizeModule`（仅 SUMMARY_QUEUE 透传）为完整版本：
- `imports: [RedisModule]`（**必须保留**，redis.module.spec.ts 强约束）
- providers: `summaryQueueProvider` + `STRATEGY_TOKEN` (factory: `SummarizeAllVisibleStrategy`) + `SummarizeService` (factory injects strategy) + `SUMMARY_WORKER` (factory wires processor → service)
- `OnApplicationBootstrap`: 扫 `WHERE status='VISIBLE' AND summary IS NULL` 入队（jobId 自然幂等）
- `OnModuleDestroy`: 关 worker

**Files:**
- Modify: `apps/worker/src/summarize/summarize.module.ts`
- Create: `apps/worker/src/summarize/summarize.module.spec.ts`

- [ ] **Step 12.1: Write the failing tests**

新建 `apps/worker/src/summarize/summarize.module.spec.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue, Worker } from 'bullmq';

const mockPrisma = {
  hotNews: { findMany: vi.fn() },
};
vi.mock('@ai-hot-news/db', () => ({
  getPrisma: () => mockPrisma,
  ContentStatus: { VISIBLE: 'VISIBLE', HIDDEN: 'HIDDEN', PENDING: 'PENDING' },
}));

import { SummarizeModule } from './summarize.module';

describe('SummarizeModule.onApplicationBootstrap (boot backstop)', () => {
  let queue: { add: ReturnType<typeof vi.fn> };
  let worker: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    queue = { add: vi.fn().mockResolvedValue(undefined) };
    worker = { close: vi.fn().mockResolvedValue(undefined) };
    mockPrisma.hotNews.findMany.mockReset();
  });

  afterEach(() => vi.resetAllMocks());

  it('queries WHERE status=VISIBLE AND summary IS NULL', async () => {
    mockPrisma.hotNews.findMany.mockResolvedValue([]);
    const m = new SummarizeModule(queue as unknown as Queue, worker as unknown as Worker);

    await m.onApplicationBootstrap();

    expect(mockPrisma.hotNews.findMany).toHaveBeenCalledWith({
      where: { status: 'VISIBLE', summary: null },
      select: { id: true },
    });
  });

  it('re-queues every orphan row with jobId="summarize-<id>"', async () => {
    mockPrisma.hotNews.findMany.mockResolvedValue([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);
    const m = new SummarizeModule(queue as unknown as Queue, worker as unknown as Worker);

    await m.onApplicationBootstrap();

    expect(queue.add).toHaveBeenCalledTimes(3);
    expect(queue.add).toHaveBeenCalledWith(
      'summarize',
      { hotNewsId: 'a' },
      expect.objectContaining({
        jobId: 'summarize-a',
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'summarize',
      { hotNewsId: 'c' },
      expect.objectContaining({ jobId: 'summarize-c' }),
    );
  });

  it('closes worker on module destroy', async () => {
    const m = new SummarizeModule(queue as unknown as Queue, worker as unknown as Worker);
    await m.onModuleDestroy();
    expect(worker.close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 12.2: Run tests to verify they fail**

```bash
pnpm --filter @ai-hot-news/worker run test -- summarize.module
```

期望 FAIL：现有 stub `SummarizeModule` 没有 constructor / `onApplicationBootstrap` / `onModuleDestroy`，import 后实例化时 TypeError 或断言不通过。

- [ ] **Step 12.3: Replace `summarize.module.ts` with full version**

打开 `apps/worker/src/summarize/summarize.module.ts`，**整体替换**为：

```ts
import {
  Module,
  OnModuleDestroy,
  OnApplicationBootstrap,
  Inject,
  Logger,
} from '@nestjs/common';
import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { getPrisma } from '@ai-hot-news/db';
import { REDIS_CONNECTION } from '../crawl/queue.provider';
import { RedisModule } from '../redis/redis.module';
import { SummarizeService } from './summarize.service';
import {
  SUMMARY_QUEUE,
  SUMMARY_WORKER,
  createSummaryWorker,
  summaryQueueProvider,
} from './summarize.queue';
import { processSummaryJob, type SummaryJobData } from './summarize.processor';
import type { SummarizationStrategy } from './strategies/strategy.interface';
import { SummarizeAllVisibleStrategy } from './strategies/summarize-all-visible.strategy';

const STRATEGY_TOKEN = Symbol('SUMMARIZATION_STRATEGY');

@Module({
  imports: [RedisModule],
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
  exports: [SUMMARY_QUEUE],
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

注 — 关键不变量保留：`imports: [RedisModule]` 与 stub 一致，`exports: [SUMMARY_QUEUE]` 与 stub 一致。SP-4.7 的 ExtractModule / IngestionService 通过 `imports: [SummarizeModule]` 间接拿到 SUMMARY_QUEUE，本步零破坏。

- [ ] **Step 12.4: Run module spec to verify pass**

```bash
pnpm --filter @ai-hot-news/worker run test -- summarize.module
```

期望 PASS（3/3 绿）。

- [ ] **Step 12.5: Run RedisModule regression spec to verify still green**

```bash
pnpm --filter @ai-hot-news/worker run test -- redis.module
```

期望 PASS（PR #2 引入的 2 个 case 仍绿 — 验证 SummarizeModule 仍通过 RedisModule 解析 SUMMARY_QUEUE）。

- [ ] **Step 12.6: Run all worker tests to confirm zero regression**

```bash
pnpm --filter @ai-hot-news/worker run test
```

期望全绿（含 SP-2/3/4/4.5/4.7 现有 spec + Task 7-12 新增 case）。

- [ ] **Step 12.7: Commit**

```bash
git add apps/worker/src/summarize/summarize.module.ts apps/worker/src/summarize/summarize.module.spec.ts
git commit -m "feat(sp5): SummarizeModule full version with worker + boot backstop, preserves RedisModule wiring"
```

---

## Task 13: Verify SP-4.7 enqueue + DI contracts not broken

**Goal:** 跑全仓 lint/typecheck/build/test，确认 Task 9-12 的改动没意外破坏 SP-4.7 的 enqueue 契约（`ingestion.service.integration.spec` 仍绿）或 DI graph（`redis.module.spec.ts` + worker boot 仍绿）。这是一个 verification-only task，不写新代码。

- [ ] **Step 13.1: Full monorepo pipeline**

```bash
pnpm turbo run lint typecheck build test
```

期望全绿。如有 fail：

| 失败 | 可能原因 | 修法 |
|---|---|---|
| `redis.module.spec` red | `SummarizeModule` 漏了 `imports: [RedisModule]` | 补回 imports，参 Task 12.3 |
| `ingestion.service.integration.spec` red | 改了 IngestionService 行为（不该）| 回滚 IngestionService 改动 |
| `summarize.module.spec` red | constructor 签名 / boot backstop 行为偏离 | 对照 Task 12.3 比对 |
| Worker `pnpm build` red | `@ai-hot-news/prompts` build 没跑（dist 缺）或 worker 没装 ai/openai 依赖 | 确认 Task 1.9 + Task 6 已 commit |
| Lint `unused` | 新加 import 没用上 | 删之 |

- [ ] **Step 13.2: Spot-check the SP-4.7 enqueue path is intact**

```bash
grep -n "summaryQueue.add" apps/worker/src/crawl/ingestion.service.ts
```

期望输出 1 行（VISIBLE 行 push）。**不**期望任何新增 / 删除（这一处代码 SP-4.7 已经写好，本 SP 不动）。

```bash
grep -nE "imports.*\[RedisModule" apps/worker/src/summarize/summarize.module.ts
```

期望输出 1 行。

- [ ] **Step 13.3: Commit (verify-only — no code change expected; skip if no diff)**

```bash
git status
```

如果 `git status` 干净 → 跳过 commit，进 Task 14。如果有改动（typecheck cleanup 等小修），commit：

```bash
git add -A
git commit -m "chore(sp5): post-Task 12 lint/typecheck cleanup"
```

---

## Task 14: Wire prompts package into Dockerfile + add OPENROUTER env to .env.example + docker-compose.prod.yml

**Goal:** SP-4.7 已 wire ExtractModule / SummarizeModule stub / FIRECRAWL+JINA env 到 Dockerfile + docker-compose.prod.yml + .env.example。SP-5 仅做增量：

a) Dockerfile 三 stage 各加 `prompts` 包的 COPY/RUN（5 处改动）
b) `.env.example` 末尾加 SP-5 段（OPENROUTER_API_KEY / SUMMARY_MODEL / LLM_BASE_URL / SUMMARY_CONCURRENCY）
c) `docker/docker-compose.prod.yml` worker 服务 `environment:` 块显式透传 4 个 SP-5 env vars（**PR #3 lesson**：compose 只透传显式声明的变量，仅写到 `.env` 不够）

**不**改 `apps/worker/src/worker.module.ts`（SP-4.7 已 import SummarizeModule + ExtractModule + CrawlModule，零增量）。

**Files:**
- Modify: `apps/worker/Dockerfile`
- Modify: `.env.example`
- Modify: `docker/docker-compose.prod.yml`

- [ ] **Step 14.1: Modify `apps/worker/Dockerfile` — register prompts package**

打开 `apps/worker/Dockerfile`：

**(a)** `deps` stage 中的 `COPY packages/utils/package.json packages/utils/` 行**之后**追加：

```dockerfile
COPY packages/prompts/package.json packages/prompts/
```

**(b)** `builder` stage 中的 `COPY --from=deps /app/packages/utils/node_modules ./packages/utils/node_modules` 行**之后**追加：

```dockerfile
COPY --from=deps /app/packages/prompts/node_modules ./packages/prompts/node_modules
```

**(c)** `builder` stage 中的 `RUN pnpm --filter @ai-hot-news/utils build` 行**之后**追加：

```dockerfile
RUN pnpm --filter @ai-hot-news/prompts build
```

**(d)** `runner` stage 中的 `COPY --from=builder /app/packages/utils/package.json packages/utils/package.json` 行**之后**追加：

```dockerfile
COPY --from=builder /app/packages/prompts/package.json packages/prompts/package.json
```

**(e)** `runner` stage 中的 `COPY --from=builder /app/packages/utils/dist packages/utils/dist` 行**之后**追加：

```dockerfile
COPY --from=builder /app/packages/prompts/dist packages/prompts/dist
```

最终 Dockerfile 应在 deps/builder/runner 三 stage 各自有 prompts 的引用，与 `utils` 完全对称。

- [ ] **Step 14.2: Modify `.env.example`**

打开 `.env.example`，**在文件末尾**追加：

```bash

# === SP-5 AI Summary + Tags ===
OPENROUTER_API_KEY=                  # required, get from https://openrouter.ai/settings/keys
SUMMARY_MODEL=deepseek/deepseek-v3.2 # optional, default
LLM_BASE_URL=https://openrouter.ai/api/v1  # optional, default (set https://api.openai.com/v1 + SUMMARY_MODEL=gpt-4o-mini for direct OpenAI)
SUMMARY_CONCURRENCY=3                # optional, default 3
```

- [ ] **Step 14.3: Modify `docker/docker-compose.prod.yml` — worker env passthrough (PR #3 lesson)**

打开 `docker/docker-compose.prod.yml`，找 `worker:` 服务的 `environment:` 块（约 line 53-62）。

替换前（SP-4.7 状态）：

```yaml
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      NODE_ENV: production
      # SP-4.7 ArticleExtractor: passed via .env. Compose only substitutes
      # variables that are explicitly declared here, otherwise they end up
      # blank inside the container even if .env has them.
      FIRECRAWL_API_KEY: ${FIRECRAWL_API_KEY}
      JINA_API_KEY: ${JINA_API_KEY}
      EXTRACT_CONCURRENCY: ${EXTRACT_CONCURRENCY:-2}
```

替换为（追加 4 行 SP-5 env，注释合并）：

```yaml
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      NODE_ENV: production
      # SP-4.7 ArticleExtractor + SP-5 Summarize: passed via .env. Compose only
      # substitutes variables that are explicitly declared here, otherwise they
      # end up blank inside the container even if .env has them.
      FIRECRAWL_API_KEY: ${FIRECRAWL_API_KEY}
      JINA_API_KEY: ${JINA_API_KEY}
      EXTRACT_CONCURRENCY: ${EXTRACT_CONCURRENCY:-2}
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY}
      SUMMARY_MODEL: ${SUMMARY_MODEL:-deepseek/deepseek-v3.2}
      LLM_BASE_URL: ${LLM_BASE_URL:-https://openrouter.ai/api/v1}
      SUMMARY_CONCURRENCY: ${SUMMARY_CONCURRENCY:-3}
```

注：`OPENROUTER_API_KEY` 不给默认值（必须显式，否则 `llm-client.ts` 抛错 `OPENROUTER_API_KEY not configured`）；其他 3 个给 SP-5 spec 默认值。

- [ ] **Step 14.4: Verify worker boots clean (typecheck + nest build)**

```bash
pnpm --filter @ai-hot-news/worker run typecheck
pnpm --filter @ai-hot-news/worker run build
```

两个都期望 PASS。

- [ ] **Step 14.5: Verify Dockerfile builds locally (smoke)**

```bash
DOCKER_BUILDKIT=1 docker build -t ai-hot-news-worker:sp5-test -f apps/worker/Dockerfile .
```

期望：build 成功，最后输出 `Successfully tagged ai-hot-news-worker:sp5-test` 或 `naming to docker.io/.../sp5-test`。如果 fail：找到第一处 `ERROR` 行，常见原因 — packages/prompts 在 deps 阶段忘加 / pnpm-lock.yaml 没更新到。

- [ ] **Step 14.6: Commit**

```bash
git add apps/worker/Dockerfile .env.example docker/docker-compose.prod.yml
git commit -m "feat(sp5): wire prompts package into Dockerfile + OPENROUTER env passthrough"
```

---

## Task 15: Local end-to-end verify — full pipeline + dev smoke + invariant probes

**Goal:** 全仓门槛全绿；本地 dev 跑 5-10 分钟实测 LLM 调用可达 + summary 写入 DB + 不变量成立。

- [ ] **Step 15.1: Run full pipeline**

```bash
pnpm turbo run lint typecheck build test
```

期望全绿（含 prompts 包 ~22 case + worker summarize ~14 case + 已有 SP-4.7 / SP-2/3/4 全部）。

- [ ] **Step 15.2: Local dev smoke test**

a) 拷贝 OpenRouter key 到本地 `.env`（先去 https://openrouter.ai/settings/keys 注册免费试用）：

```bash
echo "OPENROUTER_API_KEY=sk-or-v1-<your-test-key>" >> .env
```

b) 确认 dev DB 已经被 SP-4.7 wipe 过（如果之前没跑 dev，跳到 c）：

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c "SELECT COUNT(*) FROM hot_news"
```

如果 count 较大且 summary 字段 NULL 比例高 → 本 SP 启动后 boot backstop 会扫到入队（正是设计意图）。如果想要干净起点：

```bash
pnpm --filter @ai-hot-news/db run prisma migrate reset --force --skip-seed --skip-generate
pnpm --filter @ai-hot-news/db run db:seed
```

c) 启动 stack：

```bash
pnpm dev
```

d) 等 ~3-5 分钟（boot scan + crawler 一轮）后看 worker 日志，应有：

```
[SummarizeModule] Boot backstop: re-queued <N> pending summarize jobs
[SummarizeService] hotNewsId=cm... → done (2143ms, in=580, out=180, summary=87c, tags=4)
```

如果 LLM 一直 fail，常见原因：
- `OPENROUTER_API_KEY` 拼写错（看日志含 `OPENROUTER_API_KEY not configured`）
- DeepSeek 服务暂时下线（OpenRouter status 看；可临时换 `SUMMARY_MODEL=openai/gpt-4o-mini`）

e) DB 验证：

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT COUNT(*) FILTER (WHERE summary IS NOT NULL) AS done, COUNT(*) FILTER (WHERE summary IS NULL) AS pending FROM hot_news WHERE status='VISIBLE'"
```

期望：稳态后 `done > 0` 且趋向 `pending` 减小到 0。

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT unnest(\"aiTags\") AS tag, COUNT(*) FROM hot_news WHERE summary IS NOT NULL GROUP BY tag ORDER BY 2 DESC LIMIT 30"
```

期望：tag 形如 `company:OpenAI` / `model:GPT-5` / `category:Release` / `tech:Agents`，**所有 tag 都带 `:` prefix**。

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT id, LEFT(title, 50), LEFT(summary, 100) FROM hot_news WHERE summary IS NOT NULL ORDER BY publishedAt DESC LIMIT 5"
```

人工 spot-check：摘要中文 / 80-150 字 / 与标题主题相符。

- [ ] **Step 15.3: Invariant probes**

```bash
# Inv 6: HIDDEN 行不该有 summary
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT COUNT(*) FROM hot_news WHERE status='HIDDEN' AND summary IS NOT NULL"
# 期望: 0
```

```bash
# Inv 7: aiTags prefix 约定
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT COUNT(*) FROM hot_news WHERE \"aiTags\" != '{}' AND EXISTS (SELECT 1 FROM unnest(\"aiTags\") t WHERE t NOT LIKE '%:%')"
# 期望: 0
```

```bash
# SP-4 已交付契约不被破坏：VISIBLE 行不该有 filterReason
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT COUNT(*) FROM hot_news WHERE status='VISIBLE' AND \"filterReason\" IS NOT NULL"
# 期望: 0
```

```bash
# SP-4.7 已交付契约不被破坏：EXTRACTED 行 content != title
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT COUNT(*) FROM hot_news WHERE \"extractStatus\"='EXTRACTED' AND content = title"
# 期望: 0
```

如有任一不为 0：grep service 日志找 root cause。

- [ ] **Step 15.4: Strategy skip behavior probe (optional)**

手工把一行 status 改 HIDDEN + summary NULL，再用 redis-cli LPUSH 触发，观察 service 日志：

```bash
ID=$(docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -tA -c \
  "UPDATE hot_news SET status='HIDDEN', summary=NULL WHERE id=(SELECT id FROM hot_news WHERE status='VISIBLE' LIMIT 1) RETURNING id")
echo "ID=$ID"
docker exec ai-hot-news-redis redis-cli -n 0 LPUSH "bull:summary:wait" "{\"name\":\"summarize\",\"data\":{\"hotNewsId\":\"$ID\"}}"
# 等 5s 看 worker 日志：[SummarizeService] hotNewsId=<id> → skip:status_HIDDEN
```

跑完恢复：

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "UPDATE hot_news SET status='VISIBLE' WHERE id='$ID'"
```

- [ ] **Step 15.5: Commit any cleanups (if needed)**

```bash
git status
```

如果有改动：

```bash
git add -A
git commit -m "chore(sp5): post-implementation lint/typecheck cleanup"
```

如无改动，跳过。

---

## Task 16: PR + CI + Production deployment + AI-stage env passthrough + smoke

**Goal:** 推 PR 走 CI；CI 绿后 merge 到 main 触发自动 deploy；ssh prod 写 OPENROUTER_API_KEY；deploy 后 30 分钟内确认 prod summary 已生成。**不需要再跑 wipe**（SP-4.7 已经在 2026-05-05 17:53 跑过，prod hot_news 当前是 SP-4.7 上线后陆续 ingest 的真实数据，summary 字段 NULL 等待 SP-5 worker 消费 — 这正是预期）。

- [ ] **Step 16.1: Push + Open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(sp5): AI Summary + aiTags via Vercel AI SDK + DeepSeek-v3.2" --body "$(cat <<'EOF'
## Summary

落地 SP-5 AI Summary + aiTags（在 SP-4.7 留下的 stub 之上扩展）：

- 新 `@ai-hot-news/prompts` workspace 包：受控词表（companies/models/categories）+ system/user prompt builder + 鲁棒 JSON parser
- Vercel AI SDK + OpenRouter 接入 `deepseek/deepseek-v3.2`，单次 LLM 调用出 summary + 4 维 prefix-encoded aiTags（`company:` / `model:` / `category:` / `tech:`）
- 扩展 `summarize.queue.ts` 加 `SUMMARY_WORKER` token + `createSummaryWorker` 工厂（concurrency=3）
- 替换 stub `SummarizeModule` 为完整版本：providers 链 strategy → service → worker；`OnApplicationBootstrap` boot backstop 扫 `summary IS NULL` 重新入队
- `SummarizationStrategy` interface（PRD §6 契约）+ V1 实现 `SummarizeAllVisibleStrategy`
- LLM 失败 → BullMQ retry；JSON 解析失败 → silent skip；row 已删 (P2025) → silent skip
- `Dockerfile` 加 `packages/prompts` 三 stage COPY/RUN
- `.env.example` + `docker-compose.prod.yml` worker 服务加 4 个 SP-5 env vars 显式透传（PR #3 lesson）

**不动的部分（SP-4.7 已交付）：** IngestionService 入队、CrawlModule wire、WorkerModule imports、wipe 脚本。

## Test plan

- [x] 全仓 `pnpm turbo run lint typecheck build test` 全绿（新增 ~33 case）
- [x] `redis.module.spec` + `ingestion.service.integration.spec` 仍绿（SP-4.7 契约不破）
- [x] 本地 dev 端到端烟测（OPENROUTER_API_KEY 配齐后 LLM 链路通 + summary 写入 DB）
- [ ] 部署后 30 分钟 prod psql 查 summary done >> pending + aiTags 全 prefix-encoded
- [ ] OpenRouter dashboard 24h 后查实际成本 ≤ \$0.10/天

Spec: docs/superpowers/specs/2026-05-05-sp5-ai-summary-tags-design.md
Plan: docs/superpowers/plans/2026-05-05-sp5-ai-summary-tags-plan.md
EOF
)"
```

记下 PR URL。

- [ ] **Step 16.2: Wait for CI green**

```bash
gh pr checks --watch
```

期望 ci 全绿（lint + typecheck + build + test）。如失败：本地复现 → 修 → push **新 commit**（不 amend）。

- [ ] **Step 16.3: Pre-flight ssh prod — write `OPENROUTER_API_KEY` to /srv/ai-hot-news/.env**

```bash
ssh deploy@<vps>
cd /srv/ai-hot-news

# 备份现有 .env
cp .env .env.bak.$(date +%Y%m%d-%H%M%S)

# 追加 SP-5 env
cat >> .env <<'EOF'

# === SP-5 AI Summary + Tags ===
OPENROUTER_API_KEY=sk-or-v1-<actual-key-from-openrouter-dashboard>
SUMMARY_MODEL=deepseek/deepseek-v3.2
LLM_BASE_URL=https://openrouter.ai/api/v1
SUMMARY_CONCURRENCY=3
EOF

# 验证写入成功
grep OPENROUTER_API_KEY .env
```

期望最后 `grep` 输出含 `OPENROUTER_API_KEY=sk-or-v1-...`。

> **关键提醒**（PR #3 lesson）：仅写 `.env` 不够。本 SP Task 14.3 已经在 `docker-compose.prod.yml` 加了显式透传，所以 deploy 后会自动生效。但**先**写 `.env` 再 merge PR，不然 deploy 后第一波 LLM 调用全是 `OPENROUTER_API_KEY not configured`。

- [ ] **Step 16.4: Merge PR + 自动 deploy**

```bash
# 本地（merge 后 deploy.yml workflow 自动触发，应用 noop migration + 重启 worker）
gh pr merge --squash --delete-branch
gh run watch  # 看 deploy.yml workflow 完成
```

期望 deploy.sh 输出含：
- `Applied migration: <none new>`（SP-5 零 migration）
- `Smoke /api/health: ok`
- `Smoke /api/hot-news?pageSize=1: ok`

- [ ] **Step 16.5: Watch worker boot**

```bash
ssh deploy@<vps>
docker logs -f ai-hot-news-worker --tail 200
```

worker 日志期望（重启后 ~30s 内）：
- `[SummarizeModule] Boot backstop: re-queued <N> pending summarize jobs`（**N 应大于 0** — SP-4.7 上线以来累积的 summary IS NULL 行 + Redis 队列 backlog 都会被处理）
- 5-10 分钟内开始密集出现 `[SummarizeService] hotNewsId=cm... → done (...)`

如果 worker 启动后 crash-loop（`UnknownDependenciesException` 之类）：立即看错误信息 — 应该不会发生（Task 12 + Task 13 已 verify DI graph），但万一发生 → 回滚 PR、补 imports、重发 PR。

- [ ] **Step 16.6: 30 分钟后 smoke prod**

```bash
ssh deploy@<vps>
```

a) summary 分布：

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT COUNT(*) FILTER (WHERE summary IS NOT NULL) AS done, COUNT(*) FILTER (WHERE summary IS NULL) AS pending FROM hot_news WHERE status='VISIBLE'"
```

期望：30 分钟后 `done` 远 > `pending`（pending 是 in-flight in queue + 部分 LLM JSON 失败）。如果 done == 0 且 pending 大：grep worker 日志看 LLM 是不是一直 fail（key / OpenRouter 状态）。

b) aiTags prefix 不变量：

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT COUNT(*) AS bad FROM hot_news WHERE \"aiTags\" != '{}' AND EXISTS (SELECT 1 FROM unnest(\"aiTags\") t WHERE t NOT LIKE '%:%')"
# 期望: 0
```

c) HIDDEN 行不该有 summary：

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT COUNT(*) AS bad FROM hot_news WHERE status='HIDDEN' AND summary IS NOT NULL"
# 期望: 0
```

d) SP-4 + SP-4.7 契约未破：

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT COUNT(*) AS bad FROM hot_news WHERE status='VISIBLE' AND \"filterReason\" IS NOT NULL"
# 期望: 0

docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT COUNT(*) AS bad FROM hot_news WHERE \"extractStatus\"='EXTRACTED' AND content = title"
# 期望: 0
```

e) summary 长度合理：

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT MIN(LENGTH(summary)) AS min_len, MAX(LENGTH(summary)) AS max_len, AVG(LENGTH(summary))::int AS avg_len FROM hot_news WHERE summary IS NOT NULL"
```

期望：`min_len ≥ 5`、`max_len ≤ 400`、`avg_len ∈ [80, 200]`。

f) tag 分布合理：

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  "SELECT unnest(\"aiTags\") AS tag, COUNT(*) FROM hot_news WHERE summary IS NOT NULL GROUP BY tag ORDER BY 2 DESC LIMIT 20"
```

期望：top tag 含 `company:OpenAI` / `category:Release` / `category:Research` / `tech:Agents` 等高频项。

g) UI 烟测（API DTO 不变，但 DB 已写）：

```bash
# 注：本 SP 不动 /api/hot-news DTO 暴露 summary/aiTags（SP-10 时再 wire）
curl -s 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=1' | jq '.items[0]' | head -20
# 期望：DTO 与 SP-4.5 / SP-4.7 时保持一致，无 summary 字段（这是 expected）
```

- [ ] **Step 16.7: 24h 后查 OpenRouter spend**

浏览器开 https://openrouter.ai/activity 看 24h 消耗。

期望：< $0.10/天 / token 量级 input ~130K / output ~25K。

如果超出预算 30%：考虑换 `SUMMARY_MODEL=openai/gpt-4o-mini`（更便宜），或加 strategy 限制（SP-5.1 future）。

- [ ] **Step 16.8: Update decomposition design doc**

打开 `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md`，找 SP-5 行/段落，把状态更新为 `COMPLETED <YYYY-MM-DD>`，并在它的备注里追加：

```text
- spec: docs/superpowers/specs/2026-05-05-sp5-ai-summary-tags-design.md
- plan: docs/superpowers/plans/2026-05-05-sp5-ai-summary-tags-plan.md
- main 落地 PR: [#<n> feat(sp5): AI Summary + aiTags ...](url)（squash <sha>）
- prod deploy: <YYYY-MM-DD HH:MM UTC+8>, deploy sha: <commit-sha>
- prod env: OPENROUTER_API_KEY 已写入 /srv/ai-hot-news/.env，docker-compose.prod.yml 显式透传
- 24h cost: $<actual> via OpenRouter dashboard
- smoke: summary 分布 done >> pending / 0 不变量违反 / aiTags 全 prefix-encoded
```

提交：

```bash
git add docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md
git commit -m "docs(sp5): mark complete + record prod deploy + 24h cost evidence"
git push
```

---

## Self-review checklist

After all 16 tasks done, run this self-review against the spec:

- [ ] Spec §1.4 硬验收 全部勾选：
  - [ ] `pnpm turbo run lint typecheck build test` 全绿（含 ~33 case）
  - [ ] dev / prod worker 日志含 `[Summarize] hotNewsId=cm... → done (...)`
  - [ ] DB 验证 `done > 0`、`pending` 趋向 0
  - [ ] aiTags 全 prefix-encoded（`company:` / `model:` / `category:` / `tech:`）
  - [ ] Strategy 行为：手工把行改 HIDDEN 触发后日志含 `skip:status_HIDDEN`
  - [ ] 24h cost ≤ $0.10/天
  - [ ] 不变量 1：`status='VISIBLE' AND filterReason IS NOT NULL` count=0
  - [ ] 不变量 2：`status='HIDDEN' AND summary IS NOT NULL` count=0
  - [ ] 不变量 3：aiTags 不含裸标签 count=0
  - [ ] 不变量 4：SP-4.7 `extractStatus='EXTRACTED' AND content=title` count=0
  - [ ] CI / Deploy 全绿

- [ ] **SP-4.7 契约不破**：
  - [ ] `apps/worker/src/redis/redis.module.spec.ts` 仍绿（DI graph regression）
  - [ ] `apps/worker/src/crawl/ingestion.service.integration.spec.ts` 中 `summaryQueueAdd.toHaveBeenCalledWith(...)` cases 仍绿（IngestionService push 行为不变）

- [ ] Spec §1.3 Out-of-scope 一项也没误改：
  - 详情页 4 维分析 / AI 日报 / 分享文案 / 摘要 cache / Strategy V1 之外实现 / Prompt 自动 re-summarize / summaryGeneratedAt 列 / aiTags DTO 暴露 / taxonomy 动态化 / summary 多语言 / degraded 标记 / Streaming — 都没碰

- [ ] Spec §7 不变量 1-11 全部成立

- [ ] 测试矩阵 ~33 case 全部对应到 plan task：
  - taxonomy.spec (4) → Task 2
  - summarize.prompt.spec (5) → Task 3
  - parse.spec (13) → Task 4
  - llm-client.spec (4) → Task 7
  - summarize-all-visible.spec (3) → Task 8
  - summarize.service.spec (6) → Task 11
  - summarize.processor.spec (2) → Task 10
  - summarize.module.spec (3) → Task 12

- [ ] **未做但已 verified 不需要做的（SP-4.7 完成）**：
  - `apps/worker/src/crawl/ingestion.service.ts` 加 constructor + push summary（SP-4.7 已做）
  - `apps/worker/src/crawl/crawl.module.ts` wire SUMMARY_QUEUE（SP-4.7 已做）
  - `apps/worker/src/worker.module.ts` import SummarizeModule（SP-4.7 已做）
  - `packages/db/scripts/wipe-hot-news-pre-ai.ts`（SP-4.7 已创建 + 已在 prod 跑过）
