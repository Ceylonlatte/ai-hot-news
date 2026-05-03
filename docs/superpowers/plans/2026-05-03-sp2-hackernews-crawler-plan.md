# SP-2 HackerNews Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add HackerNews data source (top/ask/show) on top of the SP-1 RSS pipeline by generalizing the crawler abstraction (factory + scheduler + queue rename `rss-crawl`→`crawl`) and extending `RawCrawledItem` with `interactionData`. End state: `/news` page shows mixed RSS + HN listings with HN platform badges.

**Architecture:** A single `CrawlScheduler` filters `SourceConfig` rows by `platform IN (RSS, HACKERNEWS)` and registers BullMQ repeatable + boot jobs against a unified `crawl` queue. On boot it idempotently obliterates the legacy `rss-crawl` queue. `CrawlProcessor` now consults a `CrawlerFactory` that switches on `source.platform` to instantiate either `RssCrawler` or `HackerNewsCrawler`. The HN crawler hits Firebase API endpoints (`{topic}stories.json` + per-item `item/{id}.json` with `p-limit(10)` concurrency), filters non-story / deleted items, and maps results into `RawCrawledItem` with platform-specific data passed via the new `interactionData?: Record<string, unknown> | null` field. `IngestionService` is generalized: `SourceLike.platform: Platform`, `sourcePlatform` is read from the source row, and `interactionData` is transparently forwarded into `HotNews.interactionData`.

**Tech Stack:** pnpm 9 + Turborepo 2 monorepo · NestJS 11 (worker standalone) · Prisma 6 + PostgreSQL 16 (no schema changes) · BullMQ 5 + ioredis 5 · global `fetch` (Node 22) + `p-limit` 6 · Vitest 2 · Tailwind 4 (web badge tweak only).

**Reference spec:** `docs/superpowers/specs/2026-05-03-sp2-hackernews-crawler-design.md`

---

## File Map

### Created

| Path | Responsibility |
|---|---|
| `packages/utils/src/strip-html.ts` | `stripHtml(input: string): string` extracted from `apps/worker/src/crawl/crawlers/rss.crawler.ts` for reuse |
| `packages/utils/src/strip-html.spec.ts` | Unit tests for `stripHtml` |
| `apps/worker/src/crawl/crawlers/hackernews.types.ts` | `HnStory` Firebase API type |
| `apps/worker/src/crawl/crawlers/hackernews.crawler.ts` | `HackerNewsCrawler implements Crawler` |
| `apps/worker/src/crawl/crawlers/hackernews.crawler.spec.ts` | Unit tests with mocked global `fetch` |
| `apps/worker/src/crawl/crawler.factory.ts` | `CrawlerFactory` switch on `Platform` |
| `apps/worker/src/crawl/crawler.factory.spec.ts` | Unit tests for the factory |
| `apps/worker/src/crawl/crawl.scheduler.spec.ts` | Unit tests for queue rename + obliterate + platform filter |
| `apps/worker/src/crawl/fixtures/hn-topstories-ids.json` | 5-element ID array fixture |
| `apps/worker/src/crawl/fixtures/hn-story-link-post.json` | Type=story, has `url` |
| `apps/worker/src/crawl/fixtures/hn-story-self-post.json` | Type=story, no `url`, has `text` |
| `apps/worker/src/crawl/fixtures/hn-story-comment.json` | Type=comment (must be filtered) |
| `apps/worker/src/crawl/fixtures/hn-story-deleted.json` | `deleted=true` (must be filtered) |

### Modified

| Path | What changes |
|---|---|
| `apps/worker/package.json` | Add `p-limit` dependency |
| `apps/worker/.env.example` | Add `HN_FETCH_TIMEOUT_MS` and `HN_CONCURRENCY` |
| `packages/utils/src/index.ts` | Add `export { stripHtml } from './strip-html.js';` |
| `packages/types/src/dtos.ts` | Extend `RawCrawledItem` with `interactionData?: Record<string, unknown> \| null` |
| `apps/worker/src/crawl/crawlers/rss.crawler.ts` | Drop local `stripHtml`, import from `@ai-hot-news/utils` |
| `apps/worker/src/crawl/queue.provider.ts` | `CRAWL_QUEUE_NAME` literal `'rss-crawl'` → `'crawl'` |
| `apps/worker/src/crawl/crawl.scheduler.ts` | Inject `REDIS_CONNECTION`; obliterate legacy queue; generalize `platform: { in: [...] }`; rename `jobId` patterns |
| `apps/worker/src/crawl/crawl.module.ts` | Register `CrawlerFactory` provider + inject into `CRAWL_WORKER` factory |
| `apps/worker/src/crawl/crawl.processor.ts` | Use `CrawlerFactory`; remove `if (platform !== 'RSS') skip`; pass full source to ingestion |
| `apps/worker/src/crawl/ingestion.service.ts` | Generalize `SourceLike.platform: Platform`; read `sourcePlatform` from source; transparently forward `interactionData` |
| `apps/worker/src/crawl/ingestion.service.integration.spec.ts` | Append HN-platform integration test cases |
| `packages/db/prisma/seed.ts` | Append 3 HACKERNEWS candidates with `findFirst` + `update`/`create` idempotent pattern |
| `apps/web/app/news/_components/news-item.tsx` | Add `PLATFORM_LABEL` and `PLATFORM_BADGE_CLASS` maps |

### Out-of-scope (deferred to future SPs)

- ArticleExtractor (link-post external URL HTML fetch + readability extraction) → SP-4
- AI keyword pre-filtering at ingest time → SP-16
- `/news` filtering by platform → SP-10
- Refreshing `interactionData.score`/`comments` on subsequent re-fetches → SP-6 (heat scoring)

---

## Conventions for every Task

- **Branch:** all work on `main` (single-developer project).
- **TDD:** write the failing test → run it (must fail with the stated reason) → minimal implementation → re-run (must pass) → commit. For non-TDD tasks (config files, fixtures, dependency adds), the convention is "modify → run any existing tests / typecheck → commit".
- **Commit message style:** Conventional Commits, scoped (`feat(worker): ...`, `feat(utils): ...`, `chore(types): ...`, `chore(db): ...`, `docs: ...`).
- **Run tests for an individual file** with: `pnpm --filter <pkg> exec vitest run <relative path> --reporter=verbose`.
- **Run all tests:** `pnpm turbo run test`.
- **Lint/typecheck before each commit:** `pnpm turbo run lint typecheck` (or scoped to the package being changed for speed).
- **Never run `pnpm db:migrate:reset`** — there is no schema migration in SP-2 and reset wipes all data.
- **Mocking global `fetch` in Vitest:** use `vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })))` and `vi.unstubAllGlobals()` in `afterEach`. Node 22 / Vitest 2 supports `Response` natively.
- **Integration tests** (`*.integration.spec.ts`) hit a real local Postgres started via `pnpm docker:dev`. They run automatically in CI under the existing `services: postgres + redis` block.

---

## Task 1: Add `p-limit` dependency and HN env vars

**Files:**
- Modify: `apps/worker/package.json`
- Modify: `apps/worker/.env.example`

- [ ] **Step 1: Add `p-limit` to `apps/worker/package.json`**

Run:

```bash
pnpm --filter @ai-hot-news/worker add p-limit@^6.2.0
```

Expected: `pnpm-lock.yaml` updates, `apps/worker/package.json#dependencies` gets a new `"p-limit": "^6.2.0"` entry.

- [ ] **Step 2: Append HN env vars to `apps/worker/.env.example`**

Open `apps/worker/.env.example` and append at the end (after the existing `RSS_*` block):

```
# HackerNews Firebase API
HN_FETCH_TIMEOUT_MS=15000
HN_CONCURRENCY=10
```

- [ ] **Step 3: Verify nothing else broke**

Run: `pnpm --filter @ai-hot-news/worker typecheck`
Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/package.json apps/worker/.env.example pnpm-lock.yaml
git commit -m "chore(worker): add p-limit dep and HN env vars"
```

---

## Task 2: Extract `stripHtml` to `@ai-hot-news/utils` (TDD)

**Files:**
- Create: `packages/utils/src/strip-html.ts`
- Create: `packages/utils/src/strip-html.spec.ts`
- Modify: `packages/utils/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/utils/src/strip-html.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { stripHtml } from './strip-html';

describe('stripHtml', () => {
  it('removes simple HTML tags and trims whitespace', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('removes <script> blocks entirely (with content)', () => {
    expect(stripHtml('before<script>alert(1)</script>after')).toBe('beforeafter');
  });

  it('removes <style> blocks entirely (with content)', () => {
    expect(stripHtml('a<style>.x{color:red}</style>b')).toBe('ab');
  });

  it('collapses runs of whitespace into a single space', () => {
    expect(stripHtml('  hello   \n   world  ')).toBe('hello world');
  });

  it('returns an empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });

  it('handles input without any tags unchanged (modulo whitespace)', () => {
    expect(stripHtml('plain text')).toBe('plain text');
  });

  it('strips nested and self-closing tags', () => {
    expect(stripHtml('<div><img src="x"/><span>y</span></div>')).toBe('y');
  });

  it('does NOT decode HTML entities (left as-is by design)', () => {
    expect(stripHtml('a &amp; b')).toBe('a &amp; b');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ai-hot-news/utils exec vitest run src/strip-html.spec.ts --reporter=verbose`
Expected: fails with `Cannot find module './strip-html'` (or similar resolution error).

- [ ] **Step 3: Implement `stripHtml`**

Create `packages/utils/src/strip-html.ts`:

```ts
export function stripHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ai-hot-news/utils exec vitest run src/strip-html.spec.ts --reporter=verbose`
Expected: all 8 tests pass, exit code 0.

- [ ] **Step 5: Export from the package barrel**

Open `packages/utils/src/index.ts`. The current contents are:

```ts
export { normalizeUrl } from './url.js';
export { computeDedupeHash } from './dedupe.js';
```

Append:

```ts
export { stripHtml } from './strip-html.js';
```

- [ ] **Step 6: Rebuild the package CJS dist**

Run: `pnpm --filter @ai-hot-news/utils build`
Expected: `packages/utils/dist/index.js` is regenerated and includes the `stripHtml` symbol.

Verify by:

```bash
node -e "console.log(typeof require('./packages/utils/dist/index.js').stripHtml)"
```

Expected output: `function`.

- [ ] **Step 7: Commit**

```bash
git add packages/utils/src/strip-html.ts packages/utils/src/strip-html.spec.ts packages/utils/src/index.ts packages/utils/dist/index.js
git commit -m "feat(utils): extract stripHtml for cross-crawler reuse"
```

---

## Task 3: Refactor `RssCrawler` to use `@ai-hot-news/utils#stripHtml`

**Files:**
- Modify: `apps/worker/src/crawl/crawlers/rss.crawler.ts`

- [ ] **Step 1: Open the existing file and confirm the local `stripHtml` location**

Run: `pnpm --filter @ai-hot-news/worker exec rg -n "function stripHtml" src/`
Expected output:
```
src/crawl/crawlers/rss.crawler.ts:57:function stripHtml(input: string): string {
```

- [ ] **Step 2: Replace the local `stripHtml` with an import from `@ai-hot-news/utils`**

In `apps/worker/src/crawl/crawlers/rss.crawler.ts`:

- Add a new import line at the top alongside the other `@ai-hot-news/*` imports (currently the file imports `RawCrawledItem` from `@ai-hot-news/types`):

```ts
import { stripHtml } from '@ai-hot-news/utils';
```

- Delete the local `function stripHtml(...) { ... }` block at the bottom of the file (lines 57-64 in the SP-1 baseline).

The final file should contain the existing class and a single named import for `stripHtml`. No call sites change because they already use `stripHtml(...)` at the bare-name level.

- [ ] **Step 3: Run the existing RSS unit tests to verify behavior is unchanged**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawlers/rss.crawler.spec.ts --reporter=verbose`
Expected: same number of tests pass as before, exit code 0.

- [ ] **Step 4: Run the worker typecheck**

Run: `pnpm --filter @ai-hot-news/worker typecheck`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/crawl/crawlers/rss.crawler.ts
git commit -m "refactor(worker): use @ai-hot-news/utils stripHtml in RssCrawler"
```

---

## Task 4: Extend `RawCrawledItem` with `interactionData`

**Files:**
- Modify: `packages/types/src/dtos.ts`

- [ ] **Step 1: Add the optional field to `RawCrawledItem`**

Open `packages/types/src/dtos.ts`. The current `RawCrawledItem` block (lines 3-10) reads:

```ts
export interface RawCrawledItem {
  title: string;
  contentText: string;
  rawHtml: string | null;
  sourceUrl: string;
  author: string | null;
  publishedAt: Date | null;
}
```

Replace it with (note the trailing field + comment block):

```ts
export interface RawCrawledItem {
  title: string;
  contentText: string;
  rawHtml: string | null;
  sourceUrl: string;
  author: string | null;
  publishedAt: Date | null;
  /**
   * Platform-specific interaction data (likes, comments, score, external URL, etc.).
   * Forwarded by IngestionService into `HotNews.interactionData` (Json column).
   *
   * Cross-platform field name conventions (see SP-2 spec §4.2):
   * - Common (any platform): `score`, `comments`, `externalUrl`
   * - HN-specific: `hnId`
   * - Reddit-specific (SP-3): `redditId`, `redditSubreddit`
   * - Twitter-specific (SP-22): `twTweetId`, `twReposts`
   *
   * Use `null` (not `undefined`) when a platform produces no interaction data; omit
   * when the crawler hasn't been updated to populate it.
   */
  interactionData?: Record<string, unknown> | null;
}
```

- [ ] **Step 2: Run the types package typecheck**

Run: `pnpm --filter @ai-hot-news/types typecheck`
Expected: no output, exit code 0.

- [ ] **Step 3: Run all consumers (worker, api) to verify backwards compatibility**

Run: `pnpm turbo run typecheck --filter=@ai-hot-news/worker --filter=@ai-hot-news/api`
Expected: both pass; the optional new field doesn't break existing call sites.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/dtos.ts
git commit -m "feat(types): add optional interactionData to RawCrawledItem"
```

---

## Task 5: Add HN type definition and 5 fixture JSON files

**Files:**
- Create: `apps/worker/src/crawl/crawlers/hackernews.types.ts`
- Create: `apps/worker/src/crawl/fixtures/hn-topstories-ids.json`
- Create: `apps/worker/src/crawl/fixtures/hn-story-link-post.json`
- Create: `apps/worker/src/crawl/fixtures/hn-story-self-post.json`
- Create: `apps/worker/src/crawl/fixtures/hn-story-comment.json`
- Create: `apps/worker/src/crawl/fixtures/hn-story-deleted.json`

- [ ] **Step 1: Create `hackernews.types.ts`**

Create `apps/worker/src/crawl/crawlers/hackernews.types.ts`:

```ts
// HN Firebase API item schema (subset used by SP-2).
// Reference: https://github.com/HackerNews/API#items
export interface HnStory {
  id: number;
  type?: 'story' | 'comment' | 'job' | 'poll' | 'pollopt';
  by?: string;
  time?: number; // Unix seconds
  title?: string;
  url?: string; // present for link-posts
  text?: string; // present for self-posts (HTML)
  score?: number;
  descendants?: number; // top-level comment count
  deleted?: boolean;
  dead?: boolean;
}
```

- [ ] **Step 2: Create the 5-element ID list fixture**

Create `apps/worker/src/crawl/fixtures/hn-topstories-ids.json`:

```json
[44000001, 44000002, 44000003, 44000004, 44000005]
```

- [ ] **Step 3: Create the link-post fixture (id=44000001)**

Create `apps/worker/src/crawl/fixtures/hn-story-link-post.json`:

```json
{
  "id": 44000001,
  "type": "story",
  "by": "alice",
  "time": 1746230400,
  "title": "GPT-5 announced",
  "url": "https://openai.com/news/gpt-5",
  "score": 234,
  "descendants": 45
}
```

- [ ] **Step 4: Create the self-post fixture (id=44000002)**

Create `apps/worker/src/crawl/fixtures/hn-story-self-post.json`:

```json
{
  "id": 44000002,
  "type": "story",
  "by": "bob",
  "time": 1746230500,
  "title": "Show HN: My side project",
  "text": "<p>I built this in <b>2 weekends</b>.</p>",
  "score": 12,
  "descendants": 3
}
```

- [ ] **Step 5: Create the comment fixture (id=44000003) — must be filtered out**

Create `apps/worker/src/crawl/fixtures/hn-story-comment.json`:

```json
{
  "id": 44000003,
  "type": "comment",
  "by": "carol",
  "time": 1746230600,
  "text": "Great post!"
}
```

- [ ] **Step 6: Create the deleted-story fixture (id=44000004) — must be filtered out**

Create `apps/worker/src/crawl/fixtures/hn-story-deleted.json`:

```json
{
  "id": 44000004,
  "type": "story",
  "deleted": true
}
```

> **Note**: Fixture id=44000005 has no fixture file. The test will configure the mocked `fetch` to return `null` for that id, exercising the "single item GET returned null" code path (which `HackerNewsCrawler.fetchStory` must swallow without breaking the batch).

- [ ] **Step 7: Verify the JSON files parse**

Run:

```bash
for f in apps/worker/src/crawl/fixtures/hn-*.json; do node -e "require('./$f'); console.log('OK $f')"; done
```

Expected output: 5 lines starting with `OK`.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/crawl/crawlers/hackernews.types.ts apps/worker/src/crawl/fixtures/hn-*.json
git commit -m "chore(worker): add HnStory type and HN test fixtures"
```

---

## Task 6: Implement `HackerNewsCrawler` (TDD)

**Files:**
- Create: `apps/worker/src/crawl/crawlers/hackernews.crawler.ts`
- Create: `apps/worker/src/crawl/crawlers/hackernews.crawler.spec.ts`

This is the largest task in the plan. The crawler is implemented incrementally with the test file growing alongside it. We commit once at the end of the task to keep the unit cohesive.

- [ ] **Step 1: Write the spec scaffolding with the first failing test (constructor + invalid identifier guard)**

Create `apps/worker/src/crawl/crawlers/hackernews.crawler.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HackerNewsCrawler } from './hackernews.crawler';
import topIdsFixture from '../fixtures/hn-topstories-ids.json';
import linkPostFixture from '../fixtures/hn-story-link-post.json';
import selfPostFixture from '../fixtures/hn-story-self-post.json';
import commentFixture from '../fixtures/hn-story-comment.json';
import deletedFixture from '../fixtures/hn-story-deleted.json';

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('HackerNewsCrawler', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  describe('constructor / identifier validation', () => {
    it('throws when identifier is null', async () => {
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: null });
      await expect(crawler.fetch()).rejects.toThrow(/invalid identifier=null/);
    });

    it('throws when identifier is an unknown topic', async () => {
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'best' });
      await expect(crawler.fetch()).rejects.toThrow(/invalid identifier=best/);
    });
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails (module not found)**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawlers/hackernews.crawler.spec.ts --reporter=verbose`
Expected: fails with `Cannot find module './hackernews.crawler'`.

- [ ] **Step 3: Create the crawler skeleton**

Create `apps/worker/src/crawl/crawlers/hackernews.crawler.ts`:

```ts
import pLimit from 'p-limit';
import { stripHtml } from '@ai-hot-news/utils';
import type { RawCrawledItem } from '@ai-hot-news/types';
import type { Crawler } from './crawler.interface';
import type { HnStory } from './hackernews.types';

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';
const TOPIC_ENDPOINT = {
  top: 'topstories',
  ask: 'askstories',
  show: 'showstories',
} as const;

export type HnTopic = keyof typeof TOPIC_ENDPOINT;

interface HnSource {
  id: string;
  identifier: string | null;
}

export class HackerNewsCrawler implements Crawler {
  constructor(private readonly source: HnSource) {}

  async fetch(): Promise<RawCrawledItem[]> {
    const topic = this.source.identifier as HnTopic | null;
    if (!topic || !(topic in TOPIC_ENDPOINT)) {
      throw new Error(
        `HN SourceConfig ${this.source.id} invalid identifier=${topic}; ` +
          `expected one of: ${Object.keys(TOPIC_ENDPOINT).join(', ')}`,
      );
    }
    // Empty for now; fetchIds is wired in step 7 below, fetchStory + toRaw in step 11.
    return [];
  }
}
```

- [ ] **Step 4: Run the spec to verify the 2 identifier-guard tests pass**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawlers/hackernews.crawler.spec.ts --reporter=verbose`
Expected: 2 tests pass.

- [ ] **Step 5: Add tests for `fetchIds` (top topic happy path + non-200 + non-array)**

In `hackernews.crawler.spec.ts`, append a new `describe` block before the closing `});`:

```ts
  describe('fetchIds (topic → IDs list)', () => {
    it('hits the correct endpoint for top/ask/show', async () => {
      // Returns IDs but no item GETs (we'll let item GETs return null so they're filtered out;
      // here we just want to verify the IDs URL was called)
      fetchMock.mockImplementation(async (url: string) => {
        if (url === `${HN_BASE}/topstories.json`) return jsonResponse(topIdsFixture);
        return jsonResponse(null); // any item GET → null story → filtered
      });
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      await crawler.fetch();
      expect(fetchMock).toHaveBeenCalledWith(
        `${HN_BASE}/topstories.json`,
        expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': expect.any(String) }) }),
      );
    });

    it('throws when the IDs endpoint returns non-200', async () => {
      fetchMock.mockResolvedValue(new Response('Internal Error', { status: 500 }));
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      await expect(crawler.fetch()).rejects.toThrow(/HN ids fetch 500/);
    });

    it('throws when the IDs response body is not an array', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 'oops' }));
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      await expect(crawler.fetch()).rejects.toThrow(/HN ids response not array/);
    });
  });
```

- [ ] **Step 6: Run the new tests to verify they fail**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawlers/hackernews.crawler.spec.ts --reporter=verbose`
Expected: the 3 new tests fail (current `fetch()` returns `[]` without calling the IDs endpoint).

- [ ] **Step 7: Implement `fetchIds`**

In `hackernews.crawler.ts`, replace the `fetch` body and add the helper:

```ts
  async fetch(): Promise<RawCrawledItem[]> {
    const topic = this.source.identifier as HnTopic | null;
    if (!topic || !(topic in TOPIC_ENDPOINT)) {
      throw new Error(
        `HN SourceConfig ${this.source.id} invalid identifier=${topic}; ` +
          `expected one of: ${Object.keys(TOPIC_ENDPOINT).join(', ')}`,
      );
    }
    const ids = await this.fetchIds(topic);
    // Returning empty here just to keep the function signature; story fetching + mapping
    // is wired in step 11 below. The `void ids` silences the unused-var lint.
    void ids;
    return [];
  }

  private async fetchIds(topic: HnTopic): Promise<number[]> {
    const url = `${HN_BASE}/${TOPIC_ENDPOINT[topic]}.json`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(this.timeoutMs()),
      headers: { 'User-Agent': this.userAgent() },
    });
    if (!res.ok) {
      throw new Error(`HN ids fetch ${res.status} ${res.statusText} for ${topic}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error(
        `HN ids response not array for ${topic}: ${JSON.stringify(data).slice(0, 100)}`,
      );
    }
    return data as number[];
  }

  private timeoutMs(): number {
    const raw = parseInt(process.env.HN_FETCH_TIMEOUT_MS ?? '15000', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 15000;
  }

  private userAgent(): string {
    return process.env.RSS_USER_AGENT ?? 'ai-hot-news-bot/0.1';
  }
```

- [ ] **Step 8: Run the spec to verify all 5 tests pass**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawlers/hackernews.crawler.spec.ts --reporter=verbose`
Expected: 5 tests pass.

- [ ] **Step 9: Add tests for `fetchStory` (single GET path) + filtering**

Append to `hackernews.crawler.spec.ts`:

```ts
  describe('fetchStory + filtering + toRaw', () => {
    it('returns RawCrawledItem for a link-post, filling externalUrl in interactionData', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse([linkPostFixture.id]);
        if (url.endsWith(`/item/${linkPostFixture.id}.json`)) return jsonResponse(linkPostFixture);
        return jsonResponse(null);
      });
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        title: 'GPT-5 announced',
        contentText: 'GPT-5 announced',
        rawHtml: null,
        sourceUrl: `https://news.ycombinator.com/item?id=${linkPostFixture.id}`,
        author: 'alice',
        interactionData: {
          score: 234,
          comments: 45,
          externalUrl: 'https://openai.com/news/gpt-5',
          hnId: linkPostFixture.id,
        },
      });
      expect(items[0].publishedAt).toBeInstanceOf(Date);
      expect(items[0].publishedAt!.getTime()).toBe(linkPostFixture.time * 1000);
    });

    it('returns RawCrawledItem for a self-post, with stripped text and rawHtml', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse([selfPostFixture.id]);
        if (url.endsWith(`/item/${selfPostFixture.id}.json`)) return jsonResponse(selfPostFixture);
        return jsonResponse(null);
      });
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        title: 'Show HN: My side project',
        contentText: 'I built this in 2 weekends.',
        rawHtml: '<p>I built this in <b>2 weekends</b>.</p>',
        author: 'bob',
        interactionData: {
          score: 12,
          comments: 3,
          externalUrl: null,
          hnId: selfPostFixture.id,
        },
      });
    });

    it('filters out comment-type items', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse([commentFixture.id]);
        if (url.endsWith(`/item/${commentFixture.id}.json`)) return jsonResponse(commentFixture);
        return jsonResponse(null);
      });
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();
      expect(items).toHaveLength(0);
    });

    it('filters out deleted items', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse([deletedFixture.id]);
        if (url.endsWith(`/item/${deletedFixture.id}.json`)) return jsonResponse(deletedFixture);
        return jsonResponse(null);
      });
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();
      expect(items).toHaveLength(0);
    });

    it('filters out null story responses (single-item GET fail)', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse([linkPostFixture.id, 99999999]);
        if (url.endsWith(`/item/${linkPostFixture.id}.json`)) return jsonResponse(linkPostFixture);
        if (url.endsWith('/item/99999999.json')) return new Response('not found', { status: 404 });
        return jsonResponse(null);
      });
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();
      expect(items).toHaveLength(1);
      expect(items[0].interactionData).toMatchObject({ hnId: linkPostFixture.id });
    });

    it('survives a thrown fetch error for a single item without aborting the batch', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/topstories.json')) return jsonResponse([linkPostFixture.id, 88888888]);
        if (url.endsWith(`/item/${linkPostFixture.id}.json`)) return jsonResponse(linkPostFixture);
        if (url.endsWith('/item/88888888.json')) throw new Error('ECONNRESET');
        return jsonResponse(null);
      });
      const crawler = new HackerNewsCrawler({ id: 'src1', identifier: 'top' });
      const items = await crawler.fetch();
      expect(items).toHaveLength(1);
    });
  });
```

- [ ] **Step 10: Run the spec to verify the 6 new tests fail**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawlers/hackernews.crawler.spec.ts --reporter=verbose`
Expected: 6 tests fail (current `fetch()` returns `[]`).

- [ ] **Step 11: Implement `fetchStory`, `isValidStory`, `toRaw`, and the final `fetch()` body**

Replace the `fetch()` placeholder + everything after `userAgent()` in `hackernews.crawler.ts`:

```ts
  async fetch(): Promise<RawCrawledItem[]> {
    const topic = this.source.identifier as HnTopic | null;
    if (!topic || !(topic in TOPIC_ENDPOINT)) {
      throw new Error(
        `HN SourceConfig ${this.source.id} invalid identifier=${topic}; ` +
          `expected one of: ${Object.keys(TOPIC_ENDPOINT).join(', ')}`,
      );
    }
    const ids = await this.fetchIds(topic);
    const limit = pLimit(this.concurrency());
    const stories = await Promise.all(ids.map((id) => limit(() => this.fetchStory(id))));
    return stories.filter(this.isValidStory).map((s) => this.toRaw(s));
  }

  private async fetchStory(id: number): Promise<HnStory | null> {
    try {
      const res = await fetch(`${HN_BASE}/item/${id}.json`, {
        signal: AbortSignal.timeout(this.timeoutMs()),
        headers: { 'User-Agent': this.userAgent() },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as HnStory | null;
      return data;
    } catch {
      // single-item failures (timeout / JSON parse / network) are silenced; the batch continues
      return null;
    }
  }

  private isValidStory = (s: HnStory | null): s is HnStory => {
    if (!s) return false;
    if (s.type !== 'story') return false;
    if (s.deleted || s.dead) return false;
    if (!s.title) return false;
    return true;
  };

  private toRaw(s: HnStory): RawCrawledItem {
    const isSelfPost = !s.url && !!s.text;
    const title = s.title ?? '(untitled)';
    return {
      title,
      // link-post: contentText = title (placeholder; SP-4 ArticleExtractor detection sentinel:
      //   rawHtml IS NULL AND interactionData.externalUrl IS NOT NULL)
      // self-post: contentText = stripHtml(text)
      contentText: isSelfPost ? stripHtml(s.text!) : title,
      rawHtml: isSelfPost ? s.text! : null,
      sourceUrl: `https://news.ycombinator.com/item?id=${s.id}`,
      author: s.by ?? null,
      publishedAt: s.time ? new Date(s.time * 1000) : null,
      interactionData: {
        score: s.score ?? 0,
        comments: s.descendants ?? 0,
        externalUrl: s.url ?? null,
        hnId: s.id,
      },
    };
  }

  private concurrency(): number {
    const raw = parseInt(process.env.HN_CONCURRENCY ?? '10', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 10;
  }
```

- [ ] **Step 12: Run the full spec — all 11 tests must pass**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawlers/hackernews.crawler.spec.ts --reporter=verbose`
Expected: 11 tests pass (`2 + 3 + 6`).

- [ ] **Step 13: Run worker typecheck and lint**

Run: `pnpm --filter @ai-hot-news/worker typecheck && pnpm --filter @ai-hot-news/worker lint`
Expected: both pass with no output.

- [ ] **Step 14: Commit**

```bash
git add apps/worker/src/crawl/crawlers/hackernews.crawler.ts apps/worker/src/crawl/crawlers/hackernews.crawler.spec.ts
git commit -m "feat(worker): add HackerNewsCrawler for top/ask/show topics"
```

---

## Task 7: Implement `CrawlerFactory` (TDD)

**Files:**
- Create: `apps/worker/src/crawl/crawler.factory.ts`
- Create: `apps/worker/src/crawl/crawler.factory.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/crawl/crawler.factory.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Platform } from '@ai-hot-news/db';
import { CrawlerFactory } from './crawler.factory';
import { RssCrawler } from './crawlers/rss.crawler';
import { HackerNewsCrawler } from './crawlers/hackernews.crawler';

describe('CrawlerFactory', () => {
  const factory = new CrawlerFactory();

  it('returns an RssCrawler instance for RSS sources', () => {
    const crawler = factory.create({
      id: 'src1',
      platform: Platform.RSS,
      url: 'https://example.com/feed.xml',
      identifier: null,
    });
    expect(crawler).toBeInstanceOf(RssCrawler);
  });

  it('returns a HackerNewsCrawler instance for HACKERNEWS sources', () => {
    const crawler = factory.create({
      id: 'src1',
      platform: Platform.HACKERNEWS,
      url: null,
      identifier: 'top',
    });
    expect(crawler).toBeInstanceOf(HackerNewsCrawler);
  });

  it('throws for unsupported platforms', () => {
    expect(() =>
      factory.create({
        id: 'src1',
        platform: Platform.TWITTER,
        url: null,
        identifier: null,
      }),
    ).toThrow(/Unsupported crawler platform: TWITTER/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawler.factory.spec.ts --reporter=verbose`
Expected: fails with `Cannot find module './crawler.factory'`.

- [ ] **Step 3: Implement the factory**

Create `apps/worker/src/crawl/crawler.factory.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Platform } from '@ai-hot-news/db';
import type { Crawler } from './crawlers/crawler.interface';
import { RssCrawler } from './crawlers/rss.crawler';
import { HackerNewsCrawler } from './crawlers/hackernews.crawler';

export interface CrawlerSource {
  id: string;
  platform: Platform;
  url: string | null;
  identifier: string | null;
}

@Injectable()
export class CrawlerFactory {
  create(source: CrawlerSource): Crawler {
    switch (source.platform) {
      case Platform.RSS:
        return new RssCrawler({ id: source.id, url: source.url });
      case Platform.HACKERNEWS:
        return new HackerNewsCrawler({ id: source.id, identifier: source.identifier });
      // case Platform.REDDIT: → SP-3
      // case Platform.TWITTER: → SP-22
      default:
        throw new Error(`Unsupported crawler platform: ${source.platform}`);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify all 3 pass**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawler.factory.spec.ts --reporter=verbose`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/crawl/crawler.factory.ts apps/worker/src/crawl/crawler.factory.spec.ts
git commit -m "feat(worker): add CrawlerFactory for platform → Crawler routing"
```

---

## Task 8: Rename queue `'rss-crawl'` → `'crawl'` (constants only)

**Files:**
- Modify: `apps/worker/src/crawl/queue.provider.ts`
- Modify: `apps/worker/src/crawl/crawl.scheduler.ts` (jobId pattern strings only)

This task changes the BullMQ queue name and `jobId` patterns; it does NOT add the obliterate logic (Task 9) or change the platform filter (Task 10). Splitting the change into focused tasks keeps each commit reviewable.

- [ ] **Step 1: Update `CRAWL_QUEUE_NAME` constant**

In `apps/worker/src/crawl/queue.provider.ts`, change line 5:

```ts
// before
export const CRAWL_QUEUE_NAME = 'rss-crawl';

// after
export const CRAWL_QUEUE_NAME = 'crawl';
```

No other change in this file — `Queue`, `Worker`, and helpers all reference the constant.

- [ ] **Step 2: Update `jobId` patterns in `CrawlScheduler`**

In `apps/worker/src/crawl/crawl.scheduler.ts`, find the two `jobId:` lines and change the prefix from `rss-crawl-` to `crawl-`:

```ts
// before
jobId: `rss-crawl-repeat-${source.id}`,
// after
jobId: `crawl-repeat-${source.id}`,
```

```ts
// before
jobId: `rss-crawl-boot-${source.id}-${Date.now()}`,
// after
jobId: `crawl-boot-${source.id}-${Date.now()}`,
```

- [ ] **Step 3: Run worker typecheck**

Run: `pnpm --filter @ai-hot-news/worker typecheck`
Expected: no output, exit code 0.

- [ ] **Step 4: Run worker tests (existing tests should still pass — none reference the literal queue name)**

Run: `pnpm --filter @ai-hot-news/worker test`
Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/crawl/queue.provider.ts apps/worker/src/crawl/crawl.scheduler.ts
git commit -m "refactor(worker): rename BullMQ queue rss-crawl → crawl"
```

---

## Task 9: Generalize `CrawlScheduler` (obliterate legacy queue + platform IN filter) (TDD)

**Files:**
- Create: `apps/worker/src/crawl/crawl.scheduler.spec.ts`
- Modify: `apps/worker/src/crawl/crawl.scheduler.ts`

This task does two things together (both touch the same file): (1) inject `REDIS_CONNECTION` so we can construct a temporary BullMQ queue and obliterate the legacy `rss-crawl` queue; (2) generalize the prisma `findMany` to accept `platform IN (RSS, HACKERNEWS)`. We use a unit test that mocks BullMQ's `Queue` constructor and `getPrisma()` to verify behavior without spinning up Redis/Postgres.

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/crawl/crawl.scheduler.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { Platform, getPrisma } from '@ai-hot-news/db';
import { CrawlScheduler } from './crawl.scheduler';

vi.mock('@ai-hot-news/db', async () => {
  const actual = await vi.importActual<typeof import('@ai-hot-news/db')>('@ai-hot-news/db');
  return { ...actual, getPrisma: vi.fn() };
});

vi.mock('bullmq', async () => {
  const actual = await vi.importActual<typeof import('bullmq')>('bullmq');
  return { ...actual, Queue: vi.fn() };
});

describe('CrawlScheduler', () => {
  let mainQueueAdd: ReturnType<typeof vi.fn>;
  let mainQueue: Queue;
  let oldQueueObliterate: ReturnType<typeof vi.fn>;
  let oldQueueClose: ReturnType<typeof vi.fn>;
  let connection: IORedis;
  let prismaFindMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mainQueueAdd = vi.fn().mockResolvedValue(undefined);
    mainQueue = { add: mainQueueAdd } as unknown as Queue;
    oldQueueObliterate = vi.fn().mockResolvedValue(undefined);
    oldQueueClose = vi.fn().mockResolvedValue(undefined);
    vi.mocked(Queue).mockImplementation((name: unknown) => {
      if (name === 'rss-crawl') {
        return {
          obliterate: oldQueueObliterate,
          close: oldQueueClose,
        } as unknown as Queue;
      }
      // any other Queue construction shouldn't happen in this test
      throw new Error(`Unexpected Queue construction with name=${String(name)}`);
    });
    connection = {} as IORedis;
    prismaFindMany = vi.fn();
    vi.mocked(getPrisma).mockReturnValue({
      sourceConfig: { findMany: prismaFindMany },
    } as unknown as ReturnType<typeof getPrisma>);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("obliterates the legacy 'rss-crawl' queue at startup", async () => {
    prismaFindMany.mockResolvedValue([]);
    const scheduler = new CrawlScheduler(mainQueue, connection);
    await scheduler.onModuleInit();
    expect(oldQueueObliterate).toHaveBeenCalledWith({ force: true });
    expect(oldQueueClose).toHaveBeenCalled();
  });

  it('survives obliterate failure (logs warning, still proceeds)', async () => {
    prismaFindMany.mockResolvedValue([]);
    oldQueueObliterate.mockRejectedValueOnce(new Error('boom'));
    const scheduler = new CrawlScheduler(mainQueue, connection);
    await expect(scheduler.onModuleInit()).resolves.toBeUndefined();
    expect(oldQueueClose).toHaveBeenCalled();
    // mainQueue.add should still be called for any sources (here: 0 sources, so 0 calls)
    expect(mainQueueAdd).not.toHaveBeenCalled();
  });

  it('queries enabled sources where platform IN (RSS, HACKERNEWS)', async () => {
    prismaFindMany.mockResolvedValue([]);
    const scheduler = new CrawlScheduler(mainQueue, connection);
    await scheduler.onModuleInit();
    expect(prismaFindMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        platform: { in: [Platform.RSS, Platform.HACKERNEWS] },
      },
    });
  });

  it('registers each source with crawl-repeat-* and crawl-boot-* job IDs', async () => {
    prismaFindMany.mockResolvedValue([
      { id: 'rss1', platform: Platform.RSS, crawlInterval: 1800 },
      { id: 'hn1', platform: Platform.HACKERNEWS, crawlInterval: 900 },
    ]);
    const scheduler = new CrawlScheduler(mainQueue, connection);
    await scheduler.onModuleInit();
    // 2 sources × 2 job adds (repeat + boot) = 4 calls
    expect(mainQueueAdd).toHaveBeenCalledTimes(4);
    expect(mainQueueAdd).toHaveBeenNthCalledWith(
      1,
      'crawl',
      { sourceConfigId: 'rss1' },
      expect.objectContaining({
        jobId: 'crawl-repeat-rss1',
        repeat: { every: 1_800_000 },
      }),
    );
    expect(mainQueueAdd).toHaveBeenNthCalledWith(
      2,
      'crawl',
      { sourceConfigId: 'rss1' },
      expect.objectContaining({
        jobId: expect.stringMatching(/^crawl-boot-rss1-\d+$/),
      }),
    );
    expect(mainQueueAdd).toHaveBeenNthCalledWith(
      3,
      'crawl',
      { sourceConfigId: 'hn1' },
      expect.objectContaining({
        jobId: 'crawl-repeat-hn1',
        repeat: { every: 900_000 },
      }),
    );
    expect(mainQueueAdd).toHaveBeenNthCalledWith(
      4,
      'crawl',
      { sourceConfigId: 'hn1' },
      expect.objectContaining({
        jobId: expect.stringMatching(/^crawl-boot-hn1-\d+$/),
      }),
    );
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawl.scheduler.spec.ts --reporter=verbose`
Expected: at minimum the "queries enabled sources where platform IN (RSS, HACKERNEWS)" test fails because the current `crawl.scheduler.ts` filters with `platform: Platform.RSS` (literal) — not `{ in: [...] }`. The obliterate-related tests will fail because the constructor takes only one arg today.

- [ ] **Step 3: Modify `crawl.scheduler.ts`**

Replace the entire current contents of `apps/worker/src/crawl/crawl.scheduler.ts` with:

```ts
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { getPrisma, Platform } from '@ai-hot-news/db';
import { CRAWL_QUEUE, CRAWL_QUEUE_NAME, REDIS_CONNECTION } from './queue.provider';

@Injectable()
export class CrawlScheduler implements OnModuleInit {
  private readonly logger = new Logger(CrawlScheduler.name);

  constructor(
    @Inject(CRAWL_QUEUE) private readonly queue: Queue,
    @Inject(REDIS_CONNECTION) private readonly connection: IORedis,
  ) {}

  async onModuleInit(): Promise<void> {
    // One-time migration: clean up the SP-1 era 'rss-crawl' queue.
    // Idempotent: if the legacy queue's Redis keys don't exist, obliterate is a no-op.
    const oldQueue = new Queue('rss-crawl', {
      connection: this.connection as unknown as ConnectionOptions,
    });
    try {
      await oldQueue.obliterate({ force: true });
      this.logger.log("Old queue 'rss-crawl' obliterated");
    } catch (err) {
      this.logger.warn(`Old queue obliterate skipped: ${(err as Error).message}`);
    } finally {
      await oldQueue.close();
    }

    // Generalized source loading: RSS + HACKERNEWS.
    const sources = await getPrisma().sourceConfig.findMany({
      where: {
        enabled: true,
        platform: { in: [Platform.RSS, Platform.HACKERNEWS] },
      },
    });

    for (const source of sources) {
      await this.queue.add(
        CRAWL_QUEUE_NAME,
        { sourceConfigId: source.id },
        {
          repeat: { every: source.crawlInterval * 1000 },
          jobId: `crawl-repeat-${source.id}`,
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
        },
      );
      await this.queue.add(
        CRAWL_QUEUE_NAME,
        { sourceConfigId: source.id },
        {
          jobId: `crawl-boot-${source.id}-${Date.now()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: { count: 50 },
        },
      );
    }

    const counts = sources.reduce<Record<string, number>>((acc, s) => {
      acc[s.platform] = (acc[s.platform] ?? 0) + 1;
      return acc;
    }, {});
    this.logger.log(
      `Registered ${sources.length} enabled sources: ` +
        Object.entries(counts)
          .map(([p, n]) => `${n} ${p}`)
          .join(', '),
    );
  }
}
```

- [ ] **Step 4: Run the spec to verify all 4 tests pass**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawl.scheduler.spec.ts --reporter=verbose`
Expected: all 4 tests pass.

- [ ] **Step 5: Run worker typecheck**

Run: `pnpm --filter @ai-hot-news/worker typecheck`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/crawl/crawl.scheduler.ts apps/worker/src/crawl/crawl.scheduler.spec.ts
git commit -m "feat(worker): generalize CrawlScheduler for multi-platform + obliterate legacy queue"
```

---

## Task 10: Wire `CrawlerFactory` into `CrawlModule`

**Files:**
- Modify: `apps/worker/src/crawl/crawl.module.ts`

- [ ] **Step 1: Inspect current `CrawlModule`**

Run: `pnpm --filter @ai-hot-news/worker exec rg -n "providers:" src/crawl/crawl.module.ts -A 20`
Verify the current `providers` array contains `IngestionService` and `CrawlScheduler` plus the `CRAWL_WORKER` factory provider.

- [ ] **Step 2: Add `CrawlerFactory` import and provider, inject it into the worker factory**

Edit `apps/worker/src/crawl/crawl.module.ts` to look exactly like this:

```ts
import { Module, OnModuleDestroy, OnApplicationBootstrap, Inject, Logger } from '@nestjs/common';
import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { IngestionService } from './ingestion.service';
import { CrawlScheduler } from './crawl.scheduler';
import { CrawlerFactory } from './crawler.factory';
import {
  CRAWL_WORKER,
  REDIS_CONNECTION,
  createCrawlWorker,
  queueProvider,
  redisProvider,
} from './queue.provider';
import { processCrawlJob, type CrawlJobData } from './crawl.processor';

@Module({
  providers: [
    redisProvider,
    queueProvider,
    {
      provide: CRAWL_WORKER,
      useFactory: (
        connection: IORedis,
        ingestion: IngestionService,
        factory: CrawlerFactory,
      ): Worker => {
        const worker = createCrawlWorker(
          async (_jobName, jobData) =>
            processCrawlJob(jobData as CrawlJobData, ingestion, factory),
          connection,
        );
        worker.on('failed', (job, err) => {
          new Logger('CrawlWorker').error(
            `Job ${job?.id ?? '<no-id>'} failed: ${err.message}`,
          );
        });
        return worker;
      },
      inject: [REDIS_CONNECTION, IngestionService, CrawlerFactory],
    },
    IngestionService,
    CrawlerFactory,
    CrawlScheduler,
  ],
  exports: [IngestionService],
})
export class CrawlModule implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(
    @Inject(CRAWL_WORKER) private readonly worker: Worker,
    @Inject(REDIS_CONNECTION) private readonly redis: IORedis,
  ) {}

  onApplicationBootstrap(): void {
    // Worker auto-starts on construction; this hook documents intent.
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    await this.redis.quit();
  }
}
```

(Will not typecheck yet because `processCrawlJob` only takes 2 args; Task 11 fixes that.)

- [ ] **Step 3: Verify it does not typecheck (expected)**

Run: `pnpm --filter @ai-hot-news/worker typecheck`
Expected: error like `Expected 2 arguments, but got 3` referencing `processCrawlJob`. This is the intentional "red" state. Do NOT commit yet.

> Note: we deliberately set up `crawl.module.ts` and `crawl.processor.ts` together; committing only one half would leave the worker un-buildable. We commit at the end of Task 11.

- [ ] **Step 4: Continue to Task 11 without committing**

---

## Task 11: Refactor `CrawlProcessor` to use `CrawlerFactory` (multi-platform)

**Files:**
- Modify: `apps/worker/src/crawl/crawl.processor.ts`

- [ ] **Step 1: Replace the entire file contents**

Replace `apps/worker/src/crawl/crawl.processor.ts` with:

```ts
import { Logger } from '@nestjs/common';
import { getPrisma, SourceStatus } from '@ai-hot-news/db';
import type { CrawlerFactory } from './crawler.factory';
import type { IngestionService } from './ingestion.service';

const logger = new Logger('CrawlProcessor');

export interface CrawlJobData {
  sourceConfigId: string;
}

export async function processCrawlJob(
  data: CrawlJobData,
  ingestion: IngestionService,
  factory: CrawlerFactory,
): Promise<void> {
  const prisma = getPrisma();
  const source = await prisma.sourceConfig.findUnique({ where: { id: data.sourceConfigId } });
  if (!source) {
    logger.warn(`SourceConfig ${data.sourceConfigId} not found, skipping`);
    return;
  }
  if (!source.enabled) {
    logger.debug(`SourceConfig ${source.id} disabled, skipping`);
    return;
  }

  let crawler;
  try {
    crawler = factory.create({
      id: source.id,
      platform: source.platform,
      url: source.url,
      identifier: source.identifier,
    });
  } catch (err) {
    // Unsupported platform → don't retry; mark FAILED so the job exits cleanly.
    logger.error(`Unsupported platform: ${(err as Error).message}`);
    await prisma.sourceConfig.update({
      where: { id: source.id },
      data: {
        status: SourceStatus.FAILED,
        errorMessage: (err as Error).message.slice(0, 500),
      },
    });
    return;
  }

  try {
    const items = await crawler.fetch();
    const result = await ingestion.ingest(items, {
      id: source.id,
      platform: source.platform,
      url: source.url,
      identifier: source.identifier,
      name: source.name,
    });
    logger.log(
      `${source.platform} crawled: source=${source.name} ` +
        `fetched=${result.fetched} inserted=${result.inserted} ` +
        `skipped=${result.skipped} failed=${result.failed}`,
    );
    await prisma.sourceConfig.update({
      where: { id: source.id },
      data: {
        lastCrawledAt: new Date(),
        status: SourceStatus.NORMAL,
        errorMessage: null,
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    logger.error(`${source.platform} crawl failed: source=${source.name} error=${msg}`);
    await prisma.sourceConfig.update({
      where: { id: source.id },
      data: {
        status: SourceStatus.FAILED,
        errorMessage: msg.slice(0, 500),
      },
    });
    throw err; // BullMQ will retry per attempts/backoff
  }
}
```

(Will not typecheck yet because `IngestionService.ingest` accepts the SP-1 `SourceLike` with `platform: 'RSS'` literal; Task 12 fixes that.)

- [ ] **Step 2: Verify it does not typecheck yet**

Run: `pnpm --filter @ai-hot-news/worker typecheck`
Expected: TypeScript error like `Type 'Platform' is not assignable to type '"RSS"'` on the `ingestion.ingest(...)` call (because `SourceLike.platform: 'RSS'` literal in current `ingestion.service.ts`). Do NOT commit yet.

- [ ] **Step 3: Continue to Task 12 without committing**

---

## Task 12: Generalize `IngestionService` (`SourceLike` + `interactionData` forwarding) (TDD)

**Files:**
- Modify: `apps/worker/src/crawl/ingestion.service.ts`

This task closes the type holes from Tasks 10-11 and adds `interactionData` forwarding. It does NOT add new test cases (those land in Task 13's integration spec) — instead it relies on the existing RSS integration test continuing to pass.

- [ ] **Step 1: Replace the entire file contents**

Replace `apps/worker/src/crawl/ingestion.service.ts` with:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { getPrisma, type Platform } from '@ai-hot-news/db';
import { computeDedupeHash, normalizeUrl } from '@ai-hot-news/utils';
import type { RawCrawledItem } from '@ai-hot-news/types';

export interface IngestResult {
  fetched: number;
  inserted: number;
  skipped: number;
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
      failed: 0,
    };

    for (const raw of items) {
      try {
        if (!raw.sourceUrl) {
          result.skipped += 1;
          continue;
        }
        const sourceUrl = normalizeUrl(raw.sourceUrl);
        const dedupeHash = computeDedupeHash(sourceUrl, raw.title);
        try {
          await prisma.hotNews.create({
            data: {
              title: raw.title,
              content: raw.contentText,
              rawHtml: raw.rawHtml,
              sourcePlatform: source.platform,
              sourceUrl,
              author: raw.author,
              publishedAt: raw.publishedAt ?? new Date(),
              dedupeHash,
              ...(raw.interactionData != null
                ? { interactionData: raw.interactionData }
                : {}),
            },
          });
          result.inserted += 1;
        } catch (createErr) {
          // P2002 = unique constraint violation → duplicate, skip
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

- [ ] **Step 2: Run worker typecheck — should now be clean (Tasks 10-11-12 form one consistent change)**

Run: `pnpm --filter @ai-hot-news/worker typecheck`
Expected: no output, exit code 0.

- [ ] **Step 3: Run all worker unit tests**

Run: `pnpm --filter @ai-hot-news/worker test`
Expected: all tests pass (including existing `liveness.service.spec.ts`, `rss.crawler.spec.ts`, the new `hackernews.crawler.spec.ts`, `crawler.factory.spec.ts`, `crawl.scheduler.spec.ts`).

- [ ] **Step 4: Commit (Tasks 10 + 11 + 12 together)**

```bash
git add apps/worker/src/crawl/crawl.module.ts apps/worker/src/crawl/crawl.processor.ts apps/worker/src/crawl/ingestion.service.ts
git commit -m "feat(worker): generalize ingestion + processor for multi-platform routing"
```

---

## Task 13: Add HN cases to `IngestionService` integration spec

**Files:**
- Modify: `apps/worker/src/crawl/ingestion.service.integration.spec.ts`

This task verifies against a real Postgres that:
1. RSS-platform ingestion still works after generalization (regression check).
2. HN-platform items insert with the correct `sourcePlatform` and `interactionData` JSON.
3. Duplicate-hashing behavior (P2002 → skip) treats existing rows as `skipped` and does NOT overwrite their `interactionData`.

- [ ] **Step 1: Pre-flight — Postgres must be running locally**

Run: `pnpm docker:dev && sleep 3`
Expected: `postgres` and `redis` containers up. Verify with `docker ps | grep postgres`.

- [ ] **Step 2: Pre-flight — schema applied**

Run: `pnpm db:migrate:deploy`
Expected: `All migrations have been successfully applied.` or `Database schema is up to date.`

- [ ] **Step 3: Open the existing spec to find where SP-1 RSS cases end**

Run: `pnpm --filter @ai-hot-news/worker exec rg -n "describe\\b" src/crawl/ingestion.service.integration.spec.ts`
Note the test structure (single `describe('IngestionService (integration)', ...)` block in SP-1).

- [ ] **Step 4: Update the `SOURCE` constant to use generic Platform typing**

The current SP-1 `SOURCE` declares `platform: 'RSS' as const` which is incompatible with the new generic `SourceLike` (whose `platform: Platform` is the wider enum). Open `apps/worker/src/crawl/ingestion.service.integration.spec.ts` and find the existing block (lines 8-15):

```ts
const SOURCE = {
  id: 'test-src',
  platform: 'RSS' as const,
  url: 'https://lab.example.com/feed.xml',
  name: 'Test Source',
  enabled: true,
  crawlInterval: 1800,
};
```

Replace with:

```ts
import { Platform } from '@ai-hot-news/db';

const RSS_SOURCE = {
  id: 'test-src',
  platform: Platform.RSS,
  url: 'https://lab.example.com/feed.xml',
  identifier: null,
  name: 'Test Source',
};

const HN_SOURCE = {
  id: 'test-hn-src',
  platform: Platform.HACKERNEWS,
  url: null,
  identifier: 'top',
  name: 'Test HN Source',
};

const HN_URL_PREFIX = 'https://news.ycombinator.com/item?id=';
```

Then in the existing 3 SP-1 tests, rename `SOURCE` references to `RSS_SOURCE` (3 occurrences in the file: lines 44, 49, 56-58, 67 of the SP-1 baseline — `pnpm --filter @ai-hot-news/worker exec rg -n 'SOURCE' src/crawl/ingestion.service.integration.spec.ts` will list them).

- [ ] **Step 5: Extend cleanup hooks to also wipe HN URL prefix**

Replace the `beforeEach` and `afterAll` blocks (currently both wipe only `lab.example.com/post/*`):

```ts
async function cleanup() {
  await prisma.hotNews.deleteMany({
    where: {
      OR: [
        { sourceUrl: { startsWith: 'https://lab.example.com/post/' } },
        { sourceUrl: { startsWith: HN_URL_PREFIX } },
      ],
    },
  });
}

describe('IngestionService (integration)', () => {
  beforeEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  // ... existing 3 RSS tests follow with SOURCE → RSS_SOURCE ...
```

- [ ] **Step 6: Append the 3 new HN cases inside the same `describe` block, before its closing `});`**

```ts
  describe('HACKERNEWS platform', () => {
    it('inserts HN items with sourcePlatform=HACKERNEWS and interactionData', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'GPT-5 announced',
          contentText: 'GPT-5 announced',
          rawHtml: null,
          sourceUrl: `${HN_URL_PREFIX}44000001`,
          author: 'alice',
          publishedAt: new Date('2026-05-03T00:00:00Z'),
          interactionData: {
            score: 234,
            comments: 45,
            externalUrl: 'https://openai.com/news/gpt-5',
            hnId: 44000001,
          },
        },
      ];

      const result = await ingestion.ingest(items, HN_SOURCE);

      expect(result).toEqual({ fetched: 1, inserted: 1, skipped: 0, failed: 0 });

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: `${HN_URL_PREFIX}44000001` },
      });
      expect(row.sourcePlatform).toBe(Platform.HACKERNEWS);
      expect(row.title).toBe('GPT-5 announced');
      expect(row.rawHtml).toBeNull();
      expect(row.interactionData).toMatchObject({
        score: 234,
        comments: 45,
        externalUrl: 'https://openai.com/news/gpt-5',
        hnId: 44000001,
      });
    });

    it('does NOT overwrite interactionData on duplicate sourceUrl', async () => {
      const sourceUrl = `${HN_URL_PREFIX}44000002`;

      await ingestion.ingest(
        [
          {
            title: 'First insert',
            contentText: 'First insert',
            rawHtml: null,
            sourceUrl,
            author: 'bob',
            publishedAt: new Date('2026-05-03T01:00:00Z'),
            interactionData: { score: 10, comments: 1, externalUrl: null, hnId: 44000002 },
          },
        ],
        HN_SOURCE,
      );

      // Second ingest with higher score — must skip without updating
      const result2 = await ingestion.ingest(
        [
          {
            title: 'First insert', // unchanged so dedupeHash matches
            contentText: 'First insert',
            rawHtml: null,
            sourceUrl,
            author: 'bob',
            publishedAt: new Date('2026-05-03T01:00:00Z'),
            interactionData: { score: 999, comments: 99, externalUrl: null, hnId: 44000002 },
          },
        ],
        HN_SOURCE,
      );

      expect(result2).toEqual({ fetched: 1, inserted: 0, skipped: 1, failed: 0 });

      const row = await prisma.hotNews.findFirstOrThrow({ where: { sourceUrl } });
      expect(row.interactionData).toMatchObject({ score: 10, comments: 1 }); // first-write-wins
    });

    it('handles items missing interactionData (omitted, not null)', async () => {
      const sourceUrl = `${HN_URL_PREFIX}44000003`;

      await ingestion.ingest(
        [
          {
            title: 'No interaction data',
            contentText: 'No interaction data',
            rawHtml: null,
            sourceUrl,
            author: 'carol',
            publishedAt: new Date('2026-05-03T02:00:00Z'),
            // interactionData omitted
          },
        ],
        HN_SOURCE,
      );

      const row = await prisma.hotNews.findFirstOrThrow({ where: { sourceUrl } });
      // Prisma stores Json as null when the field was not set on insert
      expect(row.interactionData).toBeNull();
    });
  });
```

- [ ] **Step 7: Run the integration spec**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/ingestion.service.integration.spec.ts --reporter=verbose`
Expected: all 3 existing RSS tests (using renamed `RSS_SOURCE`) + 3 new HN tests pass. Total time should be < 10s.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/crawl/ingestion.service.integration.spec.ts
git commit -m "test(worker): add HN integration cases + rename SP-1 SOURCE to RSS_SOURCE"
```

---

## Task 14: Add HN candidates to Prisma seed

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Replace the entire `seed.ts` contents**

Replace `packages/db/prisma/seed.ts` with:

```ts
import { getPrisma } from '@ai-hot-news/db';

const prisma = getPrisma();

interface RssCandidate {
  name: string;
  url: string;
  enabled: boolean;
}

interface HnCandidate {
  name: string;
  identifier: 'top' | 'ask' | 'show';
  enabled: boolean;
  crawlInterval: number; // seconds
}

const rssCandidates: RssCandidate[] = [
  { name: 'OpenAI News',           url: 'https://openai.com/news/rss.xml',     enabled: true  },
  { name: 'Anthropic News',        url: 'https://www.anthropic.com/news/rss',  enabled: false },
  { name: 'Google Research Blog',  url: 'https://research.google/blog/rss/',   enabled: true  },
  { name: 'Google DeepMind Blog',  url: 'https://deepmind.google/blog/rss.xml', enabled: true  },
];

const hnCandidates: HnCandidate[] = [
  { name: 'HackerNews Top',  identifier: 'top',  enabled: true, crawlInterval: 900  },
  { name: 'HackerNews Ask',  identifier: 'ask',  enabled: true, crawlInterval: 1800 },
  { name: 'HackerNews Show', identifier: 'show', enabled: true, crawlInterval: 1800 },
];

async function seedRss() {
  for (const c of rssCandidates) {
    await prisma.sourceConfig.upsert({
      where: { platform_url: { platform: 'RSS', url: c.url } },
      create: {
        platform: 'RSS',
        name: c.name,
        url: c.url,
        enabled: c.enabled,
        crawlInterval: 1800,
      },
      update: { name: c.name },
    });
    console.log(`seeded RSS: ${c.name} (enabled=${c.enabled})`);
  }
}

async function seedHn() {
  // SourceConfig has @@unique([platform, url]) but HN's url is null, so we can't
  // use upsert by platform_url. Instead, look up by (platform, identifier) which
  // uniquely identifies an HN topic in practice, then update or create.
  for (const c of hnCandidates) {
    const existing = await prisma.sourceConfig.findFirst({
      where: { platform: 'HACKERNEWS', identifier: c.identifier },
    });
    if (existing) {
      await prisma.sourceConfig.update({
        where: { id: existing.id },
        data: {
          name: c.name,
          crawlInterval: c.crawlInterval,
          // Don't overwrite enabled/status — operator may have toggled them.
        },
      });
    } else {
      await prisma.sourceConfig.create({
        data: {
          platform: 'HACKERNEWS',
          name: c.name,
          url: null,
          identifier: c.identifier,
          enabled: c.enabled,
          crawlInterval: c.crawlInterval,
        },
      });
    }
    console.log(`seeded HN: ${c.name} (identifier=${c.identifier}, enabled=${c.enabled})`);
  }
}

async function main() {
  await seedRss();
  await seedHn();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
```

- [ ] **Step 2: Run the seed locally**

Run: `pnpm db:seed`
Expected output (order may vary slightly):
```
seeded RSS: OpenAI News (enabled=true)
seeded RSS: Anthropic News (enabled=false)
seeded RSS: Google Research Blog (enabled=true)
seeded RSS: Google DeepMind Blog (enabled=true)
seeded HN: HackerNews Top (identifier=top, enabled=true)
seeded HN: HackerNews Ask (identifier=ask, enabled=true)
seeded HN: HackerNews Show (identifier=show, enabled=true)
```

- [ ] **Step 3: Verify the rows are in the database**

Run:

```bash
docker compose -f docker/docker-compose.dev.yml exec postgres \
  psql -U $POSTGRES_USER -d $POSTGRES_DB \
  -c "SELECT name, platform, identifier, url, enabled, crawl_interval FROM source_configs ORDER BY platform, name;"
```

Expected output (7 rows total):
```
            name             |  platform   | identifier |                  url                  | enabled | crawl_interval
-----------------------------+-------------+------------+---------------------------------------+---------+----------------
 HackerNews Ask              | HACKERNEWS  | ask        |                                       | t       |           1800
 HackerNews Show             | HACKERNEWS  | show       |                                       | t       |           1800
 HackerNews Top              | HACKERNEWS  | top        |                                       | t       |            900
 Anthropic News              | RSS         |            | https://www.anthropic.com/news/rss    | f       |           1800
 Google DeepMind Blog        | RSS         |            | https://deepmind.google/blog/rss.xml  | t       |           1800
 Google Research Blog        | RSS         |            | https://research.google/blog/rss/     | t       |           1800
 OpenAI News                 | RSS         |            | https://openai.com/news/rss.xml       | t       |           1800
```

- [ ] **Step 4: Re-run the seed to verify idempotency**

Run: `pnpm db:seed`
Expected: same 7 rows, no duplicates.

Verify count:
```bash
docker compose -f docker/docker-compose.dev.yml exec postgres \
  psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT COUNT(*) FROM source_configs;"
```
Expected: `7`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "chore(db): seed HackerNews top/ask/show source configs"
```

---

## Task 15: Add platform badges to `news-item.tsx`

**Files:**
- Modify: `apps/web/app/news/_components/news-item.tsx`

- [ ] **Step 1: Replace the entire file contents**

Replace `apps/web/app/news/_components/news-item.tsx` with:

```tsx
import type { HotNewsListItemDto } from '@ai-hot-news/types';

const TIME_FMT = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const PLATFORM_LABEL: Record<string, string> = {
  RSS: 'RSS',
  HACKERNEWS: 'HN',
  REDDIT: 'Reddit',
  TWITTER: 'X',
};

const PLATFORM_BADGE_CLASS: Record<string, string> = {
  RSS:        'bg-blue-50 text-blue-700',
  HACKERNEWS: 'bg-orange-50 text-orange-700',
  REDDIT:     'bg-red-50 text-red-700',
  TWITTER:    'bg-gray-100 text-gray-700',
};

export function NewsItem({ item }: { item: HotNewsListItemDto }) {
  const label = PLATFORM_LABEL[item.sourcePlatform] ?? item.sourcePlatform;
  const badgeCls = PLATFORM_BADGE_CLASS[item.sourcePlatform] ?? 'bg-gray-100 text-gray-700';
  return (
    <li className="py-3">
      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-base font-medium text-gray-900 hover:underline"
      >
        {item.title}
      </a>
      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
        <span>{item.author ?? '匿名'}</span>
        <span>·</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badgeCls}`}>
          {label}
        </span>
        <span>·</span>
        <span>{TIME_FMT.format(new Date(item.publishedAt))}</span>
      </div>
    </li>
  );
}
```

- [ ] **Step 2: Run web typecheck and build**

Run: `pnpm --filter @ai-hot-news/web typecheck && pnpm --filter @ai-hot-news/web build`
Expected: both succeed. (The `build` step also catches Tailwind class typos in the new badge strings.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/news/_components/news-item.tsx
git commit -m "feat(web): add platform-specific badges in /news list items"
```

---

## Task 16: End-to-end smoke verification

**Files:**
- (no code changes; manual verification)

This task validates the full SP-2 flow against real services. The exit gate before deployment.

- [ ] **Step 1: Bring up dev infra (postgres + redis) if not already up**

Run: `pnpm docker:dev`
Expected: `postgres` and `redis` containers running.

- [ ] **Step 2: Apply schema and re-seed**

Run: `pnpm db:migrate:deploy && pnpm db:seed`
Expected: 7 source_configs rows confirmed (4 RSS + 3 HN, with 1 RSS disabled = 6 enabled).

- [ ] **Step 3: Wipe `hot_news` for a clean baseline (optional, for clean numbers)**

Run:

```bash
docker compose -f docker/docker-compose.dev.yml exec postgres \
  psql -U $POSTGRES_USER -d $POSTGRES_DB -c "TRUNCATE hot_news;"
```

- [ ] **Step 4: Start the dev stack**

Run: `pnpm dev` (in a separate terminal — leaves it running)

Watch worker logs. Within ~10s expect:

```
[Nest] ... [CrawlScheduler] Old queue 'rss-crawl' obliterated
[Nest] ... [CrawlScheduler] Registered 6 enabled sources: 3 RSS, 3 HACKERNEWS
```

(Number of RSS sources is 3 because Anthropic is `enabled=false`.)

- [ ] **Step 5: Wait ~3 minutes for boot backfill to complete**

Watch the logs for one `* crawled: source=*` line per source (6 total). Approximate timing:
- Each RSS: ~3-15s
- Each HN: ~30-60s
- Worker concurrency=1, so serial total ≈ 2-4 minutes

Sample expected lines (order may interleave):
```
[Nest] ... [CrawlProcessor] RSS crawled: source=OpenAI News fetched=20 inserted=20 skipped=0 failed=0
[Nest] ... [CrawlProcessor] RSS crawled: source=Google Research Blog fetched=24 inserted=24 skipped=0 failed=0
[Nest] ... [CrawlProcessor] HACKERNEWS crawled: source=HackerNews Top fetched=487 inserted=350 skipped=0 failed=137
[Nest] ... [CrawlProcessor] HACKERNEWS crawled: source=HackerNews Ask fetched=200 inserted=180 skipped=0 failed=20
```

> `failed=N` for HN reflects items where `fetchStory` returned null (404 / network blip / non-story types) — these are normal and the batch continues.

- [ ] **Step 6: Verify the API returns mixed RSS + HN**

Run:

```bash
curl -s 'http://localhost:3001/hot-news?pageSize=100' \
  | jq '.items | group_by(.sourcePlatform) | map({plat: .[0].sourcePlatform, n: length})'
```

Expected output (counts vary):
```json
[
  {"plat":"HACKERNEWS","n":<some number ≥ 50>},
  {"plat":"RSS","n":<some number ≥ 10>}
]
```

- [ ] **Step 7: Verify HN row carries `interactionData`**

Run:

```bash
docker compose -f docker/docker-compose.dev.yml exec postgres \
  psql -U $POSTGRES_USER -d $POSTGRES_DB \
  -c "SELECT title, source_platform, interaction_data FROM hot_news WHERE source_platform='HACKERNEWS' LIMIT 3;"
```

Expected: 3 rows with `interaction_data` JSON containing `{"score": ..., "comments": ..., "externalUrl": ..., "hnId": ...}`.

- [ ] **Step 8: Open `/news` in the browser**

Run: `open http://localhost:3000/news`

Visual verification:
- ✅ Page renders without error
- ✅ List shows mixed RSS items (blue "RSS" badge) and HN items (orange "HN" badge)
- ✅ HN link items, when clicked, go to `https://news.ycombinator.com/item?id=...`
- ✅ Pagination works on page 2

- [ ] **Step 9: Restart worker to verify idempotency**

In the `pnpm dev` terminal, Ctrl+C and re-run `pnpm dev`. Worker logs should show:
```
[Nest] ... [CrawlScheduler] Old queue 'rss-crawl' obliterated
[Nest] ... [CrawlScheduler] Registered 6 enabled sources: 3 RSS, 3 HACKERNEWS
```

(Even though the legacy queue is already gone, obliterate is idempotent — no error.)

Verify no duplicate rows were inserted by re-running the API:
```bash
curl -s 'http://localhost:3001/hot-news?pageSize=1' | jq '.total'
```
Expected: same number as before the restart (or slightly higher only if a repeatable triggered while restarting).

- [ ] **Step 10: All clear — proceed to merge / push**

(No commit in this task itself; the prior 15 tasks form the SP-2 commit chain.)

---

## Post-merge / Deployment

After all 16 tasks ship to `main` and the deploy pipeline runs:

- [ ] **A. SSH to VPS and re-seed**

```bash
ssh deploy@<vps-ip>
cd /srv/ai-hot-news
docker compose --env-file .env -f docker/docker-compose.prod.yml \
  run --rm --entrypoint sh api -c "cd packages/db && npx prisma db seed"
```

Expected: 7 `seeded:` log lines (4 RSS + 3 HN). Idempotent — safe to re-run.

- [ ] **B. Verify SourceConfig rows in prod**

```bash
docker compose --env-file .env -f docker/docker-compose.prod.yml exec postgres \
  psql -U $POSTGRES_USER -d $POSTGRES_DB \
  -c "SELECT name, platform, identifier, enabled, crawl_interval FROM source_configs ORDER BY platform, name;"
```

Expected: 7 rows (3 HACKERNEWS + 4 RSS).

- [ ] **C. Restart worker container to trigger boot backfill**

```bash
docker compose --env-file .env -f docker/docker-compose.prod.yml restart worker
docker compose --env-file .env -f docker/docker-compose.prod.yml logs -f worker
```

Watch for:
```
Old queue 'rss-crawl' obliterated
Registered 6 enabled sources: 3 RSS, 3 HACKERNEWS
```

Then within ~3-5 min:
```
HACKERNEWS crawled: source=HackerNews Top fetched=... inserted=...
```

- [ ] **D. Hit the prod API**

```bash
curl -s 'https://<your-domain>/api/hot-news?pageSize=100' \
  | jq '.items | map(.sourcePlatform) | unique'
```

Expected: `["HACKERNEWS", "RSS"]`.

- [ ] **E. Open the web UI**

`https://<your-domain>/news` should show mixed list with HN badges.

---

## Update decomposition spec (post-implementation chore)

After all of SP-2 is shipped and verified, update `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md` §6 to:

1. Mark **SP-2 complete** in the status column / decision log.
2. Expand **SP-4 scope** to include ArticleExtractor: edit the SP-4 row in §6 Phase 3 to read:

> | **SP-4** | 内容清洗 + 多层去重 + 外链正文抽取 (ArticleExtractor) | URL 规范化 / 内容哈希 / 标题相似度 (PG fts) / link-post 外链同步抓取 + 正文提取 (readability) — 处理 HN/Reddit link-post 留下的 `rawHtml IS NULL AND interactionData.externalUrl IS NOT NULL` 条目 |

3. Commit:

```bash
git add docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md
git commit -m "docs(decomp): mark SP-2 complete + expand SP-4 with ArticleExtractor"
```

---

## Final Checklist (mirrors spec §9)

```text
[ ] Task 1: p-limit dep + HN env vars
[ ] Task 2: stripHtml extracted to @ai-hot-news/utils + tests
[ ] Task 3: RssCrawler refactored to consume utils stripHtml
[ ] Task 4: RawCrawledItem extended with interactionData
[ ] Task 5: HnStory type + 5 fixture JSON files
[ ] Task 6: HackerNewsCrawler + spec (11 tests passing)
[ ] Task 7: CrawlerFactory + spec (3 tests passing)
[ ] Task 8: queue.provider + scheduler jobId renamed to 'crawl' / 'crawl-*'
[ ] Task 9: CrawlScheduler injects REDIS_CONNECTION + obliterates legacy + IN filter (4 tests passing)
[ ] Task 10-12: CrawlModule + Processor + Ingestion atomically refactored (single commit)
[ ] Task 13: Integration spec gains HN cases (3 tests passing)
[ ] Task 14: Prisma seed has 3 HN candidates with idempotent findFirst+upsert
[ ] Task 15: NewsItem renders platform badges
[ ] Task 16: Local end-to-end verified — `/news` shows mixed RSS + HN
[ ] Post-merge: VPS re-seeded, worker restarted, prod `/api/hot-news` returns mixed platforms
[ ] Decomposition spec §6 updated (SP-2 complete + SP-4 expanded with ArticleExtractor)
```

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-03-sp2-hackernews-crawler-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
