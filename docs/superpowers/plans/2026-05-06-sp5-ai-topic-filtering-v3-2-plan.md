# SP-5 AI Topic Filtering v3.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 SP-5 增强从 L3a/L3b 过滤落地为 v3.2：在 `IngestionService` 入口做 L0-skip（低质量或非 AI 主题不入库）、提升 HN quality 阈值、合并 Reddit source、降低抓取频率，并提供 prod 清空 `hot_news` 的一次性脚本。

**Architecture:** 过滤集中在 ingest 入口：先做 RSS 7d window/sourceUrl/quality，再用仓库根 `keywords.md` 打包进 `@ai-hot-news/prompts` 的 `matchesAiTopic()` 判断 AI 主题；不通过则 `result.skipped++` 并按 reason 计数，不写 `HIDDEN` 行。通过的行一律 `status=VISIBLE`，沿用 SP-5 主体已有 `SummarizeAllVisibleStrategy`，不改 summarize 模块。

**Tech Stack:** pnpm workspace · NestJS worker · Prisma · BullMQ · Vitest · esbuild `.md` text loader · PostgreSQL integration specs.

**Spec:** `docs/superpowers/specs/2026-05-05-sp5-ai-topic-filtering-design.md`（v3.2, commit `e5f82ce`）

---

## Current Branch State

Already implemented on `feat/sp5-summary-tags` before this plan:

- `packages/prompts/` package exists with taxonomy, prompt builder, parser, tests, and esbuild build script.
- `apps/worker/src/summarize/` SP-5主体 exists and should remain unchanged for v3.2.
- `keywords.md` exists at repo root and is committed.
- `docs/superpowers/specs/2026-05-05-sp5-ai-topic-filtering-design.md` is v3.2 and committed.
- Existing wipe script `packages/db/scripts/wipe-hot-news-pre-ai.ts` can be copied for SP-5-specific wipe semantics.

Do not implement `SummarizeAiOnlyStrategy`. v3.2 explicitly does not need it.

---

## File Structure

### Create

- `packages/prompts/build.mjs` — copies repo-root `keywords.md` to `packages/prompts/src/keywords.md`, then runs esbuild with `.md` text loader.
- `packages/prompts/src/keywords.ts` — parser, regex matcher, `KEYWORDS`, `matchesAiTopic()`.
- `packages/prompts/src/keywords.spec.ts` — parser/matcher tests.
- `packages/db/scripts/consolidate-sp5-sources.ts` — idempotently disables old Reddit sources, creates/updates Reddit bundle, updates HN intervals.
- `packages/db/scripts/consolidate-sp5-sources.spec.ts` — integration tests for source consolidation.
- `packages/db/scripts/wipe-hot-news-pre-sp5.ts` — one-shot wipe script for prod clean start.
- `packages/db/scripts/wipe-hot-news-pre-sp5.spec.ts` — integration tests for wipe script.

### Modify

- `packages/prompts/package.json` — build script becomes `node build.mjs`.
- `packages/prompts/.gitignore` — ignore auto-copied `src/keywords.md`.
- `packages/prompts/src/index.ts` — export keyword helpers.
- `packages/utils/src/quality.ts` — HN thresholds `5/2` → `20/5`.
- `packages/utils/src/quality.spec.ts` — update HN boundary tests.
- `apps/worker/src/crawl/ingestion.service.ts` — L0-skip + by-reason counters + no `HIDDEN` inserts.
- `apps/worker/src/crawl/ingestion.service.spec.ts` — unit tests for L0-skip.
- `apps/worker/src/crawl/ingestion.service.integration.spec.ts` — update existing expectations and add real DB L0 coverage.
- `packages/db/prisma/seed.ts` — HN intervals + Reddit bundle seed.

### Do Not Modify

- `apps/worker/src/summarize/**` — v3.2 relies on existing `SummarizeAllVisibleStrategy`.
- Prisma schema — no schema change required.

---

## Task 1: Add keywords parser and build pipeline in `packages/prompts`

**Files:**
- Create: `packages/prompts/build.mjs`
- Create: `packages/prompts/src/keywords.ts`
- Create: `packages/prompts/src/keywords.spec.ts`
- Modify: `packages/prompts/package.json`
- Modify: `packages/prompts/.gitignore`
- Modify: `packages/prompts/src/index.ts`

- [ ] **Step 1.1: Write failing keyword tests**

Create `packages/prompts/src/keywords.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildMatcher, matchesAiTopic, parseKeywords } from './keywords';

describe('parseKeywords', () => {
  it('parses comma-separated keywords and dedupes case-insensitively', () => {
    expect(parseKeywords('LLM, llm, AGI, Vibe Coding')).toEqual([
      'LLM',
      'AGI',
      'Vibe Coding',
    ]);
  });

  it('parses newline and markdown-list formats', () => {
    const raw = `
# AI keywords
- OpenAI
* Anthropic

RAG
<!-- ignored -->
`;
    expect(parseKeywords(raw)).toEqual(['OpenAI', 'Anthropic', 'RAG']);
  });

  it('supports inline commas inside markdown list lines', () => {
    expect(parseKeywords('- LLM, RAG\n- AI Agent')).toEqual([
      'LLM',
      'RAG',
      'AI Agent',
    ]);
  });
});

describe('buildMatcher', () => {
  it('matches case-insensitively with word boundaries', () => {
    const re = buildMatcher(['AI', 'AI Agent', 'GPT-4o']);
    expect(re.test('Show HN: I built an AI Agent')).toBe(true);
    expect(re.test('new gpt-4o demo')).toBe(true);
    expect(re.test('Spain on the map')).toBe(false);
  });

  it('returns a never-matching regex for empty keyword lists', () => {
    const re = buildMatcher([]);
    expect(re.test('AI Agent')).toBe(false);
  });
});

describe('matchesAiTopic', () => {
  it('uses the repository keywords bundle', () => {
    expect(matchesAiTopic('Claude Code improves AI coding workflows')).toBe(true);
    expect(matchesAiTopic('Cricket India vs Pakistan score')).toBe(false);
    expect(matchesAiTopic(null)).toBe(false);
    expect(matchesAiTopic(undefined)).toBe(false);
    expect(matchesAiTopic('')).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run failing test**

Run:

```bash
pnpm --filter @ai-hot-news/prompts test -- src/keywords.spec.ts
```

Expected: FAIL because `./keywords` does not exist.

- [ ] **Step 1.3: Add markdown module declaration**

Create `packages/prompts/src/keywords.ts` with the full implementation:

```typescript
import keywordsRaw from './keywords.md';

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

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(token);
    }
  }
  return unique;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildMatcher(keywords: readonly string[]): RegExp {
  if (keywords.length === 0) return /^(?!)$/;
  const escaped = [...keywords]
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

export const KEYWORDS = parseKeywords(keywordsRaw);
const AI_TOPIC_REGEX = buildMatcher(KEYWORDS);

export function matchesAiTopic(text: string | null | undefined): boolean {
  if (!text) return false;
  return AI_TOPIC_REGEX.test(text);
}
```

Also create `packages/prompts/src/keywords-md.d.ts`:

```typescript
declare module '*.md' {
  const content: string;
  export default content;
}
```

If TypeScript already accepts Vite raw/text imports without this declaration, keep the declaration anyway because worker `tsc` depends on package source types.

- [ ] **Step 1.4: Add build script that copies root `keywords.md`**

Create `packages/prompts/build.mjs`:

```javascript
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const packageRoot = process.cwd();
const repoRoot = resolve(packageRoot, '../..');
const srcKeywords = resolve(repoRoot, 'keywords.md');
const dstKeywords = resolve(packageRoot, 'src/keywords.md');

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
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/index.js',
  loader: { '.md': 'text' },
});

console.log('Build OK');
```

- [ ] **Step 1.5: Modify package exports and ignore copied file**

Change `packages/prompts/package.json` script:

```json
{
  "scripts": {
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit",
    "build": "node build.mjs",
    "test": "node build.mjs --copy-only && vitest run"
  }
}
```

The test script intentionally runs the build script in `--copy-only` mode first so `src/keywords.md` exists when `pnpm --filter @ai-hot-news/prompts test -- src/keywords.spec.ts` is executed from a clean checkout.

Append to `packages/prompts/.gitignore`:

```gitignore
src/keywords.md
```

Modify `packages/prompts/src/index.ts`:

```typescript
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
export { KEYWORDS, buildMatcher, matchesAiTopic, parseKeywords } from './keywords';
```

- [ ] **Step 1.6: Run tests and build**

Run:

```bash
pnpm --filter @ai-hot-news/prompts test -- src/keywords.spec.ts
pnpm --filter @ai-hot-news/prompts typecheck
pnpm --filter @ai-hot-news/prompts build
```

Expected: all PASS; build output includes `Copied .../keywords.md → .../packages/prompts/src/keywords.md` and `Build OK`.

- [ ] **Step 1.7: Commit**

```bash
git add packages/prompts/package.json packages/prompts/.gitignore packages/prompts/build.mjs packages/prompts/src/index.ts packages/prompts/src/keywords.ts packages/prompts/src/keywords.spec.ts packages/prompts/src/keywords-md.d.ts
git commit -m "feat(sp5): add keywords parser and bundled matcher"
```

---

## Task 2: Raise HN quality thresholds

**Files:**
- Modify: `packages/utils/src/quality.ts`
- Modify: `packages/utils/src/quality.spec.ts`

- [ ] **Step 2.1: Update failing HN threshold tests**

Replace the `describe('checkHnQuality', ...)` block in `packages/utils/src/quality.spec.ts` with:

```typescript
describe('checkHnQuality', () => {
  it('returns HN_LOW_ENGAGEMENT when score<20 AND descendants<5', () => {
    expect(checkHnQuality({ score: 19, descendants: 4 })).toBe('hn_low_engagement');
  });

  it('returns null when score>=20', () => {
    expect(checkHnQuality({ score: 20, descendants: 0 })).toBeNull();
    expect(checkHnQuality({ score: 100, descendants: 0 })).toBeNull();
  });

  it('returns null when descendants>=5 (discussion saves it)', () => {
    expect(checkHnQuality({ score: 3, descendants: 5 })).toBeNull();
  });

  it('treats null score / descendants as 0 (returns HN_LOW_ENGAGEMENT)', () => {
    expect(checkHnQuality({ score: null, descendants: null })).toBe('hn_low_engagement');
  });

  it('returns null at the exact engagement boundaries (score=20 OR descendants=5)', () => {
    expect(checkHnQuality({ score: 20, descendants: 0 })).toBeNull();
    expect(checkHnQuality({ score: 19, descendants: 5 })).toBeNull();
  });
});
```

- [ ] **Step 2.2: Run failing utils test**

Run:

```bash
pnpm --filter @ai-hot-news/utils test -- src/quality.spec.ts
```

Expected: FAIL because `score=10` still passes under old threshold and new cases expect stricter behavior.

- [ ] **Step 2.3: Update thresholds**

Modify `packages/utils/src/quality.ts`:

```typescript
const REDDIT_LOW_RATIO_THRESHOLD = 0.5;
const REDDIT_LOW_SCORE = 5;
const REDDIT_LOW_COMMENTS = 2;
const HN_LOW_SCORE = 20;
const HN_LOW_DESCENDANTS = 5;
const TITLE_MIN_LENGTH = 5;
```

Do not change Reddit or universal thresholds.

- [ ] **Step 2.4: Run tests**

Run:

```bash
pnpm --filter @ai-hot-news/utils test -- src/quality.spec.ts
pnpm --filter @ai-hot-news/utils typecheck
```

Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add packages/utils/src/quality.ts packages/utils/src/quality.spec.ts
git commit -m "feat(sp5): raise HackerNews quality threshold"
```

---

## Task 3: Implement L0-skip in `IngestionService`

**Files:**
- Modify: `apps/worker/src/crawl/ingestion.service.ts`
- Modify: `apps/worker/src/crawl/ingestion.service.spec.ts`

- [ ] **Step 3.1: Write unit tests for L0-skip and counters**

Append this block to `apps/worker/src/crawl/ingestion.service.spec.ts` inside the top-level `describe('IngestionService', ...)`:

```typescript
  describe('SP-5 v3.2 L0-skip AI topic filter', () => {
    it('inserts AI topic items as VISIBLE and enqueues summary', async () => {
      const summaryQueue = { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
      const extractQueue = { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
      service = new IngestionService(summaryQueue, extractQueue);

      const result = await service.ingest(
        [
          {
            title: 'Show HN: AI Agent for code review',
            contentText: 'AI Agent for code review',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=50000001',
            author: 'alice',
            publishedAt: new Date('2026-05-06T00:00:00Z'),
            filterReason: null,
          },
        ],
        { id: 's2', platform: Platform.HACKERNEWS, url: null, identifier: 'top', name: 'HN' },
      );

      expect(result).toEqual({
        fetched: 1,
        inserted: 1,
        skipped: 0,
        skippedQuality: 0,
        skippedNonAi: 0,
        skippedDedupe: 0,
        hidden: 0,
        failed: 0,
      });
      expect(prismaMock.hotNews.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'VISIBLE',
            filterReason: null,
          }),
        }),
      );
      expect((summaryQueue as { add: ReturnType<typeof vi.fn> }).add).toHaveBeenCalledTimes(1);
    });

    it('skips quality-failed items without inserting HIDDEN rows', async () => {
      const result = await service.ingest(
        [
          {
            title: 'AI',
            contentText: 'AI',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=50000002',
            author: null,
            publishedAt: new Date('2026-05-06T00:00:00Z'),
            filterReason: 'title_too_short',
          },
        ],
        { id: 's2', platform: Platform.HACKERNEWS, url: null, identifier: 'top', name: 'HN' },
      );

      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.skippedQuality).toBe(1);
      expect(result.skippedNonAi).toBe(0);
      expect(prismaMock.hotNews.create).not.toHaveBeenCalled();
    });

    it('skips non-AI items without inserting HIDDEN rows', async () => {
      const result = await service.ingest(
        [
          {
            title: 'Cricket India vs Pakistan score',
            contentText: 'Cricket India vs Pakistan score',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=50000003',
            author: null,
            publishedAt: new Date('2026-05-06T00:00:00Z'),
            filterReason: null,
          },
        ],
        { id: 's2', platform: Platform.HACKERNEWS, url: null, identifier: 'top', name: 'HN' },
      );

      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.skippedQuality).toBe(0);
      expect(result.skippedNonAi).toBe(1);
      expect(prismaMock.hotNews.create).not.toHaveBeenCalled();
    });

    it('increments skippedDedupe on P2002 after passing L0 checks', async () => {
      prismaMock.hotNews.create.mockRejectedValueOnce({ code: 'P2002' });

      const result = await service.ingest(
        [
          {
            title: 'OpenAI releases a new LLM',
            contentText: 'OpenAI releases a new LLM',
            rawHtml: null,
            sourceUrl: 'https://news.ycombinator.com/item?id=50000004',
            author: null,
            publishedAt: new Date('2026-05-06T00:00:00Z'),
            filterReason: null,
          },
        ],
        { id: 's2', platform: Platform.HACKERNEWS, url: null, identifier: 'top', name: 'HN' },
      );

      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.skippedDedupe).toBe(1);
      expect(result.failed).toBe(0);
    });
  });
```

Important: existing RSS tests use titles like `Edge case at the boundary` and content `body`; after L0-skip, those must be changed to AI titles/content so they still pass:

```typescript
title: 'OpenAI releases a new LLM',
contentText: 'OpenAI releases a new LLM',
```

- [ ] **Step 3.2: Run failing worker unit test**

Run:

```bash
pnpm --filter @ai-hot-news/worker test -- src/crawl/ingestion.service.spec.ts
```

Expected: FAIL because `IngestResult` lacks new fields and non-AI items are still inserted/hidden.

- [ ] **Step 3.3: Modify `IngestResult` and imports**

In `apps/worker/src/crawl/ingestion.service.ts`, update imports:

```typescript
import { matchesAiTopic } from '@ai-hot-news/prompts';
```

Update `IngestResult`:

```typescript
export interface IngestResult {
  fetched: number;
  inserted: number;
  skipped: number;
  skippedQuality: number;
  skippedNonAi: number;
  skippedDedupe: number;
  hidden: number;
  failed: number;
}
```

Initialize result:

```typescript
const result: IngestResult = {
  fetched: items.length,
  inserted: 0,
  skipped: 0,
  skippedQuality: 0,
  skippedNonAi: 0,
  skippedDedupe: 0,
  hidden: 0,
  failed: 0,
};
```

- [ ] **Step 3.4: Implement quality/non-AI skip before `create()`**

Replace the current `finalReason/status` block:

```typescript
const finalReason =
  raw.filterReason ?? checkUniversalQuality({ title: cleanTitle });

const status: ContentStatus = finalReason
  ? ContentStatus.HIDDEN
  : ContentStatus.VISIBLE;
```

with:

```typescript
const qualityReason =
  raw.filterReason ?? checkUniversalQuality({ title: cleanTitle });
if (qualityReason) {
  result.skipped += 1;
  result.skippedQuality += 1;
  continue;
}

const aiTopicProbe = `${cleanTitle}\n${cleanContent.slice(0, 500)}`;
if (!matchesAiTopic(aiTopicProbe)) {
  result.skipped += 1;
  result.skippedNonAi += 1;
  continue;
}
```

Then simplify create data:

```typescript
status: ContentStatus.VISIBLE,
filterReason: null,
```

Remove the `if (status === ContentStatus.HIDDEN) { ... } else { ... }` branch. The code after create should always:

```typescript
result.inserted += 1;
await this.summaryQueue.add(...);
// link-post extract logic unchanged
```

In the P2002 catch block, increment dedupe:

```typescript
if ((createErr as { code?: string }).code === 'P2002') {
  result.skipped += 1;
  result.skippedDedupe += 1;
} else {
  throw createErr;
}
```

At the end of `ingest()`, before `return result`, add one log line:

```typescript
this.logger.log(
  `[Ingest] ${source.platform} ${source.name}: ` +
    `fetched=${result.fetched} inserted=${result.inserted} ` +
    `skipped=${result.skipped} (quality=${result.skippedQuality} ` +
    `nonAi=${result.skippedNonAi} dedupe=${result.skippedDedupe}) ` +
    `failed=${result.failed}`,
);
```

- [ ] **Step 3.5: Run unit tests**

Run:

```bash
pnpm --filter @ai-hot-news/worker test -- src/crawl/ingestion.service.spec.ts
pnpm --filter @ai-hot-news/worker typecheck
```

Expected: PASS. If typecheck fails because `@ai-hot-news/prompts` is missing from worker dependencies, add it to `apps/worker/package.json` only if it is not already present:

```json
"@ai-hot-news/prompts": "workspace:*"
```

- [ ] **Step 3.6: Commit**

```bash
git add apps/worker/src/crawl/ingestion.service.ts apps/worker/src/crawl/ingestion.service.spec.ts apps/worker/package.json
git commit -m "feat(sp5): filter non-AI and low-quality items before insert"
```

---

## Task 4: Update IngestionService integration tests for v3.2

**Files:**
- Modify: `apps/worker/src/crawl/ingestion.service.integration.spec.ts`

- [ ] **Step 4.1: Update existing result expectations**

Where tests currently expect:

```typescript
expect(result).toEqual({
  fetched: 1,
  inserted: 1,
  skipped: 0,
  hidden: 0,
  failed: 0,
});
```

update to:

```typescript
expect(result).toEqual({
  fetched: 1,
  inserted: 1,
  skipped: 0,
  skippedQuality: 0,
  skippedNonAi: 0,
  skippedDedupe: 0,
  hidden: 0,
  failed: 0,
});
```

Where tests expect duplicate skip:

```typescript
expect(result2).toEqual({
  fetched: 1,
  inserted: 0,
  skipped: 1,
  hidden: 0,
  failed: 0,
});
```

update to:

```typescript
expect(result2).toEqual({
  fetched: 1,
  inserted: 0,
  skipped: 1,
  skippedQuality: 0,
  skippedNonAi: 0,
  skippedDedupe: 1,
  hidden: 0,
  failed: 0,
});
```

Change non-AI test fixture titles/content to AI-themed strings where the test is about storage mechanics rather than filtering:

```typescript
title: 'OpenAI launches GPT-5',
contentText: 'OpenAI launches GPT-5',
```

- [ ] **Step 4.2: Add real DB L0-skip tests**

Add tests under the existing `describe('HACKERNEWS platform', ...)`:

```typescript
    it('skips non-AI HN rows before insert', async () => {
      const sourceUrl = `${HN_URL_PREFIX}44000901`;

      const result = await ingestion.ingest(
        [
          {
            title: 'Cricket India vs Pakistan score',
            contentText: 'Cricket India vs Pakistan score',
            rawHtml: null,
            sourceUrl,
            author: 'sports',
            publishedAt: new Date('2026-05-03T00:00:00Z'),
            interactionData: { score: 100, comments: 40, externalUrl: null, hnId: 44000901 },
          },
        ],
        HN_SOURCE,
      );

      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.skippedNonAi).toBe(1);
      expect(await prisma.hotNews.findUnique({ where: { sourceUrl } })).toBeNull();
    });

    it('skips low-quality HN rows before insert even when AI-related', async () => {
      const sourceUrl = `${HN_URL_PREFIX}44000902`;

      const result = await ingestion.ingest(
        [
          {
            title: 'OpenAI releases a small LLM update',
            contentText: 'OpenAI releases a small LLM update',
            rawHtml: null,
            sourceUrl,
            author: 'alice',
            publishedAt: new Date('2026-05-03T00:00:00Z'),
            filterReason: 'hn_low_engagement',
            interactionData: { score: 2, comments: 0, externalUrl: null, hnId: 44000902 },
          },
        ],
        HN_SOURCE,
      );

      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.skippedQuality).toBe(1);
      expect(await prisma.hotNews.findUnique({ where: { sourceUrl } })).toBeNull();
    });
```

- [ ] **Step 4.3: Run integration test**

Run:

```bash
pnpm --filter @ai-hot-news/worker test -- src/crawl/ingestion.service.integration.spec.ts
```

Expected: PASS. If tests fail because an existing fixture is non-AI and now skipped, change only that fixture title/content to include one keyword from `keywords.md` such as `OpenAI`, `LLM`, or `AI Agent`.

- [ ] **Step 4.4: Commit**

```bash
git add apps/worker/src/crawl/ingestion.service.integration.spec.ts
git commit -m "test(sp5): cover L0-skip ingestion behavior with database"
```

---

## Task 5: Add SP-5 wipe script

**Files:**
- Create: `packages/db/scripts/wipe-hot-news-pre-sp5.ts`
- Create: `packages/db/scripts/wipe-hot-news-pre-sp5.spec.ts`

- [ ] **Step 5.1: Create tests by copying SP-4.5 wipe spec**

Create `packages/db/scripts/wipe-hot-news-pre-sp5.spec.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Platform, getPrisma } from '@ai-hot-news/db';
import { runWipe } from './wipe-hot-news-pre-sp5';

const prisma = getPrisma();

describe('wipe-hot-news-pre-sp5', () => {
  beforeEach(async () => {
    await prisma.keywordHit.deleteMany({});
    await prisma.hotNews.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('deletes all hot_news rows regardless of platform / status', async () => {
    await prisma.hotNews.createMany({
      data: [
        {
          sourcePlatform: Platform.HACKERNEWS,
          sourceUrl: 'https://news.ycombinator.com/item?id=sp5-wipe-1',
          title: 'OpenAI LLM row',
          content: 'OpenAI LLM row',
          rawHtml: null,
          publishedAt: new Date('2026-05-01'),
          dedupeHash: 'sp5wipe1',
          status: 'VISIBLE',
        },
        {
          sourcePlatform: Platform.RSS,
          sourceUrl: 'https://example.com/sp5-wipe-2',
          title: 'Hidden historical row',
          content: 'Hidden historical row',
          rawHtml: null,
          publishedAt: new Date('2026-05-02'),
          dedupeHash: 'sp5wipe2',
          status: 'HIDDEN',
        },
      ],
    });

    const result = await runWipe();

    expect(result.before).toBe(2);
    expect(result.deleted).toBe(2);
    expect(result.after).toBe(0);
  });

  it('does not touch source_configs', async () => {
    const sourcesBefore = await prisma.sourceConfig.count();
    await runWipe();
    const sourcesAfter = await prisma.sourceConfig.count();
    expect(sourcesAfter).toBe(sourcesBefore);
  });

  it('returns 0/0/0 when called against an empty table', async () => {
    const result = await runWipe();
    expect(result).toEqual({ before: 0, deleted: 0, after: 0 });
  });
});
```

- [ ] **Step 5.2: Run failing test**

Run:

```bash
pnpm --filter @ai-hot-news/db test -- scripts/wipe-hot-news-pre-sp5.spec.ts
```

Expected: FAIL because script does not exist.

- [ ] **Step 5.3: Implement wipe script**

Create `packages/db/scripts/wipe-hot-news-pre-sp5.ts`:

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

const isMainEntry =
  typeof require !== 'undefined' && require.main === module;
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

- [ ] **Step 5.4: Run tests**

Run:

```bash
pnpm --filter @ai-hot-news/db test -- scripts/wipe-hot-news-pre-sp5.spec.ts
pnpm --filter @ai-hot-news/db typecheck
```

Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add packages/db/scripts/wipe-hot-news-pre-sp5.ts packages/db/scripts/wipe-hot-news-pre-sp5.spec.ts
git commit -m "feat(sp5): add pre-SP5 hot_news wipe script"
```

---

## Task 6: Add source consolidation script

**Files:**
- Create: `packages/db/scripts/consolidate-sp5-sources.ts`
- Create: `packages/db/scripts/consolidate-sp5-sources.spec.ts`

- [ ] **Step 6.1: Write integration tests**

Create `packages/db/scripts/consolidate-sp5-sources.spec.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Platform, getPrisma } from '@ai-hot-news/db';
import { REDDIT_BUNDLE_ID, consolidateSp5Sources } from './consolidate-sp5-sources';

const prisma = getPrisma();

const OLD_REDDIT_SUBS = [
  'LocalLLaMA',
  'MachineLearning',
  'artificial',
  'OpenAI',
  'ChatGPT',
  'ClaudeAI',
  'singularity',
  'StableDiffusion',
];

async function resetSources() {
  await prisma.sourceConfig.deleteMany({
    where: {
      OR: [
        { id: REDDIT_BUNDLE_ID },
        { platform: Platform.REDDIT, identifier: { in: OLD_REDDIT_SUBS } },
        { platform: Platform.HACKERNEWS, identifier: { in: ['top', 'ask', 'show'] } },
      ],
    },
  });

  for (const identifier of OLD_REDDIT_SUBS) {
    await prisma.sourceConfig.create({
      data: {
        platform: Platform.REDDIT,
        name: `r/${identifier}`,
        identifier,
        url: null,
        enabled: true,
        crawlInterval: 3600,
      },
    });
  }

  for (const [identifier, interval] of [
    ['top', 900],
    ['ask', 1800],
    ['show', 1800],
  ] as const) {
    await prisma.sourceConfig.create({
      data: {
        platform: Platform.HACKERNEWS,
        name: `HackerNews ${identifier}`,
        identifier,
        url: null,
        enabled: true,
        crawlInterval: interval,
      },
    });
  }
}

describe('consolidate-sp5-sources', () => {
  beforeEach(resetSources);

  afterAll(async () => {
    await prisma.sourceConfig.deleteMany({ where: { id: REDDIT_BUNDLE_ID } });
    await prisma.$disconnect();
  });

  it('disables old Reddit sources, creates bundle, and updates HN intervals', async () => {
    const result = await consolidateSp5Sources();

    expect(result.reddit.disabled).toBe(8);
    expect(result.reddit.inserted).toBe(true);
    expect(result.hackernewsIntervalsUpdated).toBe(3);

    const oldSources = await prisma.sourceConfig.findMany({
      where: { platform: Platform.REDDIT, identifier: { in: OLD_REDDIT_SUBS } },
      select: { enabled: true },
    });
    expect(oldSources.every((s) => s.enabled === false)).toBe(true);

    const bundle = await prisma.sourceConfig.findUniqueOrThrow({
      where: { id: REDDIT_BUNDLE_ID },
    });
    expect(bundle.enabled).toBe(true);
    expect(bundle.crawlInterval).toBe(7200);
    expect(bundle.url).toContain('/r/ChatGPT+OpenAI+singularity+');

    const hn = await prisma.sourceConfig.findMany({
      where: { platform: Platform.HACKERNEWS },
      select: { identifier: true, crawlInterval: true },
    });
    expect(Object.fromEntries(hn.map((s) => [s.identifier, s.crawlInterval]))).toMatchObject({
      top: 3600,
      ask: 14400,
      show: 14400,
    });
  });

  it('is idempotent on repeated runs', async () => {
    await consolidateSp5Sources();
    const second = await consolidateSp5Sources();

    expect(second.reddit.disabled).toBe(0);
    expect(second.reddit.inserted).toBe(false);

    const bundles = await prisma.sourceConfig.count({ where: { id: REDDIT_BUNDLE_ID } });
    expect(bundles).toBe(1);
  });
});
```

- [ ] **Step 6.2: Run failing test**

Run:

```bash
pnpm --filter @ai-hot-news/db test -- scripts/consolidate-sp5-sources.spec.ts
```

Expected: FAIL because script does not exist.

- [ ] **Step 6.3: Implement consolidation script**

Create `packages/db/scripts/consolidate-sp5-sources.ts`:

```typescript
import { Platform, getPrisma } from '@ai-hot-news/db';

const prisma = getPrisma();

const REDDIT_OLD_SUBS = [
  'LocalLLaMA',
  'MachineLearning',
  'artificial',
  'OpenAI',
  'ChatGPT',
  'ClaudeAI',
  'singularity',
  'StableDiffusion',
];

export const REDDIT_BUNDLE_ID = 'reddit-ai-bundle-v1';
const REDDIT_BUNDLE_URL =
  'https://www.reddit.com/r/ChatGPT+OpenAI+singularity+ArtificialInteligence+artificial+ClaudeAI+PromptEngineering+AI_Agents+vibecoding+LLMDevs+cursor+agi+LangChain/hot.json?limit=100&raw_json=1';

const HN_INTERVAL_TOP = 3600;
const HN_INTERVAL_ASK_SHOW = 14400;
const REDDIT_INTERVAL_BUNDLE = 7200;

export interface ConsolidateResult {
  reddit: { disabled: number; inserted: boolean };
  hackernewsIntervalsUpdated: number;
}

export async function consolidateSp5Sources(): Promise<ConsolidateResult> {
  const redditDisabled = await prisma.sourceConfig.updateMany({
    where: { platform: Platform.REDDIT, identifier: { in: REDDIT_OLD_SUBS }, enabled: true },
    data: { enabled: false },
  });

  const existing = await prisma.sourceConfig.findUnique({
    where: { id: REDDIT_BUNDLE_ID },
  });

  let redditInserted = false;
  if (!existing) {
    await prisma.sourceConfig.create({
      data: {
        id: REDDIT_BUNDLE_ID,
        platform: Platform.REDDIT,
        name: 'AI Subreddit Bundle (13 subs hot)',
        identifier: null,
        url: REDDIT_BUNDLE_URL,
        enabled: true,
        crawlInterval: REDDIT_INTERVAL_BUNDLE,
        status: 'NORMAL',
      },
    });
    redditInserted = true;
  } else {
    await prisma.sourceConfig.update({
      where: { id: REDDIT_BUNDLE_ID },
      data: {
        name: 'AI Subreddit Bundle (13 subs hot)',
        identifier: null,
        url: REDDIT_BUNDLE_URL,
        enabled: true,
        crawlInterval: REDDIT_INTERVAL_BUNDLE,
        status: 'NORMAL',
      },
    });
  }

  const hnTop = await prisma.sourceConfig.updateMany({
    where: { platform: Platform.HACKERNEWS, identifier: 'top' },
    data: { crawlInterval: HN_INTERVAL_TOP },
  });
  const hnAskShow = await prisma.sourceConfig.updateMany({
    where: { platform: Platform.HACKERNEWS, identifier: { in: ['ask', 'show'] } },
    data: { crawlInterval: HN_INTERVAL_ASK_SHOW },
  });

  return {
    reddit: { disabled: redditDisabled.count, inserted: redditInserted },
    hackernewsIntervalsUpdated: hnTop.count + hnAskShow.count,
  };
}

async function main(): Promise<void> {
  const result = await consolidateSp5Sources();
  console.log(JSON.stringify(result, null, 2));
}

const isMainEntry =
  typeof require !== 'undefined' && require.main === module;
const isTsxEntry = process.argv[1]?.endsWith('consolidate-sp5-sources.ts');

if (isMainEntry || isTsxEntry) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] **Step 6.4: Run tests**

Run:

```bash
pnpm --filter @ai-hot-news/db test -- scripts/consolidate-sp5-sources.spec.ts
pnpm --filter @ai-hot-news/db typecheck
```

Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add packages/db/scripts/consolidate-sp5-sources.ts packages/db/scripts/consolidate-sp5-sources.spec.ts
git commit -m "feat(sp5): consolidate Reddit bundle and HN crawl intervals"
```

---

## Task 7: Update seed data for new default sources

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 7.1: Update HN intervals and Reddit candidates**

In `packages/db/prisma/seed.ts`, change `hnCandidates`:

```typescript
const hnCandidates: HnCandidate[] = [
  { name: 'HackerNews Top',  identifier: 'top',  enabled: true, crawlInterval: 3600  },
  { name: 'HackerNews Ask',  identifier: 'ask',  enabled: true, crawlInterval: 14400 },
  { name: 'HackerNews Show', identifier: 'show', enabled: true, crawlInterval: 14400 },
];
```

Update `RedditCandidate` to allow nullable identifier:

```typescript
interface RedditCandidate {
  name: string;
  identifier: string | null;
  url: string | null;
  enabled: boolean;
  crawlInterval: number;
}
```

Replace `redditCandidates` with old sources disabled plus new bundle:

```typescript
const REDDIT_BUNDLE_URL =
  'https://www.reddit.com/r/ChatGPT+OpenAI+singularity+ArtificialInteligence+artificial+ClaudeAI+PromptEngineering+AI_Agents+vibecoding+LLMDevs+cursor+agi+LangChain/hot.json?limit=100&raw_json=1';

const redditCandidates: RedditCandidate[] = [
  { name: 'r/LocalLLaMA',       identifier: 'LocalLLaMA',       url: null, enabled: false, crawlInterval: 3600 },
  { name: 'r/MachineLearning',  identifier: 'MachineLearning',  url: null, enabled: false, crawlInterval: 3600 },
  { name: 'r/artificial',       identifier: 'artificial',       url: null, enabled: false, crawlInterval: 3600 },
  { name: 'r/OpenAI',           identifier: 'OpenAI',           url: null, enabled: false, crawlInterval: 3600 },
  { name: 'r/ChatGPT',          identifier: 'ChatGPT',          url: null, enabled: false, crawlInterval: 3600 },
  { name: 'r/singularity',      identifier: 'singularity',      url: null, enabled: false, crawlInterval: 3600 },
  { name: 'r/StableDiffusion',  identifier: 'StableDiffusion',  url: null, enabled: false, crawlInterval: 3600 },
  { name: 'r/ClaudeAI',         identifier: 'ClaudeAI',         url: null, enabled: false, crawlInterval: 3600 },
  {
    name: 'AI Subreddit Bundle (13 subs hot)',
    identifier: null,
    url: REDDIT_BUNDLE_URL,
    enabled: true,
    crawlInterval: 7200,
  },
];
```

- [ ] **Step 7.2: Make `seedReddit()` handle identifier null**

Replace the lookup in `seedReddit()`:

```typescript
const existing = c.identifier
  ? await prisma.sourceConfig.findFirst({
      where: { platform: 'REDDIT', identifier: c.identifier },
    })
  : await prisma.sourceConfig.findFirst({
      where: { platform: 'REDDIT', name: c.name },
    });
```

Ensure both update and create set `enabled`:

```typescript
data: {
  name: c.name,
  url: c.url,
  enabled: c.enabled,
  crawlInterval: c.crawlInterval,
}
```

and create uses:

```typescript
identifier: c.identifier,
```

- [ ] **Step 7.3: Run db typecheck**

Run:

```bash
pnpm --filter @ai-hot-news/db typecheck
```

Expected: PASS.

- [ ] **Step 7.4: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "feat(sp5): update default crawl sources for AI topic filtering"
```

---

## Task 8: Full verification

**Files:**
- No new source files unless failures reveal required fixes.

- [ ] **Step 8.1: Run focused package verification**

Run:

```bash
pnpm --filter @ai-hot-news/prompts test
pnpm --filter @ai-hot-news/prompts typecheck
pnpm --filter @ai-hot-news/prompts build
pnpm --filter @ai-hot-news/utils test -- src/quality.spec.ts
pnpm --filter @ai-hot-news/worker test -- src/crawl/ingestion.service.spec.ts
pnpm --filter @ai-hot-news/worker test -- src/crawl/ingestion.service.integration.spec.ts
pnpm --filter @ai-hot-news/db test -- scripts/wipe-hot-news-pre-sp5.spec.ts
pnpm --filter @ai-hot-news/db test -- scripts/consolidate-sp5-sources.spec.ts
```

Expected: all PASS.

- [ ] **Step 8.2: Run workspace checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all PASS.

- [ ] **Step 8.3: Inspect git diff**

Run:

```bash
git status
git diff --stat HEAD~8..HEAD
```

Expected:
- no uncommitted files except intentionally generated ignored files (`packages/prompts/src/keywords.md` should not appear)
- commits include prompts keywords, quality threshold, ingestion L0-skip, db scripts, seed update

- [ ] **Step 8.4: Commit plan document**

```bash
git add docs/superpowers/plans/2026-05-06-sp5-ai-topic-filtering-v3-2-plan.md
git commit -m "docs(sp5): add AI topic filtering v3.2 implementation plan"
```

---

## Task 9: Local smoke after implementation

**Files:**
- No source changes expected.

- [ ] **Step 9.1: Prepare local DB/Redis stack**

Run:

```bash
docker compose -f docker/docker-compose.dev.yml up -d postgres redis
set -a && . ./.env && set +a && pnpm --filter @ai-hot-news/db db:migrate:deploy
set -a && . ./.env && set +a && pnpm --filter @ai-hot-news/db prisma db seed
```

Expected:
- postgres/redis healthy
- migrations deployed
- source configs include HN intervals 3600/14400 and Reddit bundle 7200

- [ ] **Step 9.2: Run wipe and source consolidation locally**

Run:

```bash
set -a && . ./.env && set +a && pnpm --filter @ai-hot-news/db exec tsx scripts/wipe-hot-news-pre-sp5.ts
set -a && . ./.env && set +a && pnpm --filter @ai-hot-news/db exec tsx scripts/consolidate-sp5-sources.ts
```

Expected:
- wipe prints `{ "after": 0 }`
- consolidate prints Reddit disabled/inserted stats and HN update count

- [ ] **Step 9.3: Run worker briefly**

Run:

```bash
set -a && . ./.env && set +a && pnpm --filter @ai-hot-news/worker start:dev
```

Expected logs:

```text
[CrawlScheduler] schedule HACKERNEWS top interval=3600
[CrawlScheduler] schedule HACKERNEWS ask interval=14400
[CrawlScheduler] schedule HACKERNEWS show interval=14400
[Ingest] HACKERNEWS HackerNews Top: fetched=... inserted=... skipped=... (quality=... nonAi=... dedupe=...) failed=0
```

Stop worker after confirming logs.

- [ ] **Step 9.4: Verify DB purity**

Run:

```bash
set -a && . ./.env && set +a && pnpm --filter @ai-hot-news/db exec prisma studio
```

or psql:

```bash
set -a && . ./.env && set +a && psql "$DATABASE_URL" -c "SELECT status, COUNT(*) FROM hot_news GROUP BY status;"
```

Expected: only `VISIBLE` rows; no `HIDDEN`.

---

## Deployment Runbook Notes

Before prod wipe:

```bash
pg_dump --table=hot_news "$DATABASE_URL" > /backups/hot_news_pre_sp5_$(date +%Y%m%d).sql
```

Prod command order:

```bash
docker exec ai-hot-news-worker node /app/packages/db/scripts/wipe-hot-news-pre-sp5.js
docker exec ai-hot-news-worker node /app/packages/db/scripts/consolidate-sp5-sources.js
docker restart ai-hot-news-worker
```

24h acceptance:

```sql
SELECT status, COUNT(*) FROM hot_news GROUP BY status;
SELECT COUNT(*) FROM hot_news WHERE "crawledAt" >= NOW() - INTERVAL '24 hours';
```

Expected:
- no `HIDDEN` rows
- about 190 new rows/day after first full day

---

## Self-Review

### Spec coverage

- `keywords.md` parser/build/export: Task 1.
- L0-skip and by-reason counters: Tasks 3 and 4.
- HN quality threshold `20/5`: Task 2.
- No `SummarizeAiOnlyStrategy`: documented in Do Not Modify and architecture.
- Reddit bundle and HN frequency: Tasks 6 and 7.
- Wipe script: Task 5.
- Verification and deployment smoke: Tasks 8 and 9.

### Placeholder scan

Placeholder scan passed. Every code-changing task includes exact file paths, code snippets, commands, and expected outcomes.

### Type consistency

- `IngestResult` fields are consistent across unit/integration tests: `fetched`, `inserted`, `skipped`, `skippedQuality`, `skippedNonAi`, `skippedDedupe`, `hidden`, `failed`.
- `consolidateSp5Sources()` result type matches tests: `reddit.disabled`, `reddit.inserted`, `hackernewsIntervalsUpdated`.
- `matchesAiTopic()` export path is `@ai-hot-news/prompts`.

