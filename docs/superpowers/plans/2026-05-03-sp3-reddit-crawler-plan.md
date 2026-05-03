# SP-3 Reddit Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Reddit data source on top of the SP-2 mixed-platform pipeline by reaching the public `https://www.reddit.com/r/<sub>/hot.json` endpoint (no OAuth — see spec §0 for the v1→v2 pivot rationale). End state: `/news` shows mixed RSS + HN + Reddit listings (8 AI subreddits) with red `Reddit` badges, and the Reddit row of `hot_news.interactionData` is populated with `{ score, comments, externalUrl, redditId, redditSubreddit, redditUpvoteRatio }`.

**Architecture:** A new `RedditCrawler` implements the existing `Crawler` interface and is wired into `CrawlerFactory` via a new `case Platform.REDDIT`. The crawler does a single GET against either an explicit `source.url` (future-friendly: search / multi-sub cluster sources) or a `https://www.reddit.com/r/${identifier}/hot.json?limit=25&raw_json=1` derived URL, using a mandatory compliant User-Agent injected via DI (`REDDIT_USER_AGENT` token wired from `process.env.REDDIT_USER_AGENT`). Results are filtered for `stickied` / `over_18` / missing `title|id`, then mapped to `RawCrawledItem` (link-post vs self-post distinction mirrors SP-2 HN). `CrawlScheduler` is widened to include `Platform.REDDIT` in its `platform.in` filter. `IngestionService`, `apps/api`, `apps/web`, and Prisma schema are unchanged.

**Tech Stack:** pnpm 9 + Turborepo 2 monorepo · NestJS 11 (worker standalone) · Prisma 6 + PostgreSQL 16 (no schema changes) · BullMQ 5 + ioredis 5 · global `fetch` (Node 22) · Vitest 2 · zero new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-03-sp3-reddit-crawler-design.md` (v2)

---

## File Map

### Created

| Path | Responsibility |
|---|---|
| `apps/worker/src/crawl/crawlers/reddit.types.ts` | `RedditPost` / `RedditListingResponse` Reddit JSON API types + `REDDIT_USER_AGENT` DI token |
| `apps/worker/src/crawl/crawlers/reddit.crawler.ts` | `RedditCrawler implements Crawler` — public `.json` endpoint fetch + filtering + mapping |
| `apps/worker/src/crawl/crawlers/reddit.crawler.spec.ts` | Unit tests with mocked global `fetch` |
| `apps/worker/src/crawl/fixtures/reddit-link-post.json` | `is_self=false` post with external `url` |
| `apps/worker/src/crawl/fixtures/reddit-self-post.json` | `is_self=true` post with `selftext_html` |
| `apps/worker/src/crawl/fixtures/reddit-stickied-post.json` | `stickied=true` (must be filtered) |
| `apps/worker/src/crawl/fixtures/reddit-nsfw-post.json` | `over_18=true` (must be filtered) |
| `apps/worker/src/crawl/fixtures/reddit-hot-listing.json` | Wrapper `Listing` containing 5 mixed posts (link / self / stickied / nsfw / `[deleted]` author) |

### Modified

| Path | What changes |
|---|---|
| `apps/worker/.env.example` | Add `REDDIT_USER_AGENT` and `REDDIT_FETCH_TIMEOUT_MS` |
| `apps/worker/src/crawl/crawler.factory.ts` | Inject `REDDIT_USER_AGENT` via `@Inject` token; add `case Platform.REDDIT` |
| `apps/worker/src/crawl/crawler.factory.spec.ts` | Pass UA into ctor; add `Platform.REDDIT → RedditCrawler` test |
| `apps/worker/src/crawl/crawl.scheduler.ts` | Append `Platform.REDDIT` to the `platform: { in: [...] }` filter |
| `apps/worker/src/crawl/crawl.scheduler.spec.ts` | Update `platform.in` assertion + add a Reddit row to the registration test |
| `apps/worker/src/crawl/crawl.module.ts` | Register `REDDIT_USER_AGENT` value provider with `process.env` factory |
| `apps/worker/src/crawl/ingestion.service.integration.spec.ts` | Append `REDDIT platform` block (transparent forward of all 6 `interactionData` fields, including `redditUpvoteRatio: null`) |
| `packages/db/prisma/seed.ts` | Add `RedditCandidate` interface, 8-element `redditCandidates` array, `seedReddit()`, call from `main()` |

### Out-of-scope (deferred to future SPs)

- Comment fetching → SP-5 (AI summary worker `enrich-reddit-comments`)
- ArticleExtractor for Reddit link-post external URLs → SP-4 (shares HN sentinel SQL)
- Re-crawling to update `score`/`comments`/`upvote_ratio` → SP-6 (heat scoring `refresh-interaction-data` worker)
- Keyword-search source / multi-sub cluster source seed entries → architecture is ready (see Task 4 `resolveUrl()`); no seed entries this SP
- IP rotation / proxy pool → not needed (8 req/h ≪ ~60 req/min/IP)
- Web `/news` Reddit badge styling → SP-2 already added `bg-red-50 text-red-700` to `PLATFORM_BADGE_CLASS`

---

## Conventions for every Task

- **Branch:** all work on `main` (single-developer project).
- **TDD:** write the failing test → run it (must fail with the stated reason) → minimal implementation → re-run (must pass) → commit. For non-TDD tasks (config files, fixtures, env), the convention is "modify → run any existing tests / typecheck → commit".
- **Commit message style:** Conventional Commits, scoped (`feat(worker): ...`, `chore(worker): ...`, `chore(db): ...`, `docs: ...`).
- **Run tests for an individual file** with: `pnpm --filter <pkg> exec vitest run <relative path> --reporter=verbose`.
- **Run all tests:** `pnpm turbo run test`.
- **Lint/typecheck before each commit:** `pnpm turbo run lint typecheck` (or scoped to the package being changed for speed).
- **Never run `pnpm db:migrate:reset`** — there is no schema migration in SP-3 and reset wipes all data.
- **Mocking global `fetch` in Vitest:** use `vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })))` and `vi.unstubAllGlobals()` in `afterEach`. Node 22 / Vitest 2 supports `Response` natively.
- **Integration tests** (`*.integration.spec.ts`) hit a real local Postgres started via `pnpm docker:dev`. They run automatically in CI under the existing `services: postgres + redis` block.
- **`REDDIT_USER_AGENT` for local dev:** before running `pnpm dev` after Task 11, append `REDDIT_USER_AGENT=ai-hot-news-bot/0.1 (by /u/<your-reddit-username>)` to `apps/worker/.env`. Without it the default falls back to `(by /u/anonymous)` which is not Reddit-policy-compliant for production but works for local smoke testing.

---

## Task 1: Add Reddit env vars to worker `.env.example`

**Files:**
- Modify: `apps/worker/.env.example`

- [ ] **Step 1: Open `apps/worker/.env.example` and append at the end**

Append after the existing `HN_*` block:

```
# Reddit (public .json endpoint, no OAuth)
# Required: must include "(by /u/<owner-reddit-username>)" per Reddit UA policy.
REDDIT_USER_AGENT=ai-hot-news-bot/0.1 (by /u/anonymous)
REDDIT_FETCH_TIMEOUT_MS=15000
```

- [ ] **Step 2: Verify nothing else broke**

Run: `pnpm --filter @ai-hot-news/worker typecheck`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/.env.example
git commit -m "chore(worker): add Reddit env vars (REDDIT_USER_AGENT, REDDIT_FETCH_TIMEOUT_MS)"
```

---

## Task 2: Create Reddit fixture JSON files

**Files:**
- Create: `apps/worker/src/crawl/fixtures/reddit-link-post.json`
- Create: `apps/worker/src/crawl/fixtures/reddit-self-post.json`
- Create: `apps/worker/src/crawl/fixtures/reddit-stickied-post.json`
- Create: `apps/worker/src/crawl/fixtures/reddit-nsfw-post.json`
- Create: `apps/worker/src/crawl/fixtures/reddit-hot-listing.json`

- [ ] **Step 1: Create the link-post fixture**

Create `apps/worker/src/crawl/fixtures/reddit-link-post.json`:

```json
{
  "id": "1k4xz9p",
  "title": "GPT-5 announced",
  "author": "user_alice",
  "subreddit": "OpenAI",
  "url": "https://openai.com/news/gpt-5",
  "permalink": "/r/OpenAI/comments/1k4xz9p/gpt5_announced/",
  "is_self": false,
  "selftext": "",
  "selftext_html": null,
  "created_utc": 1746230400,
  "score": 1234,
  "ups": 1234,
  "downs": 0,
  "num_comments": 56,
  "upvote_ratio": 0.95,
  "stickied": false,
  "over_18": false
}
```

- [ ] **Step 2: Create the self-post fixture**

Create `apps/worker/src/crawl/fixtures/reddit-self-post.json`:

```json
{
  "id": "1k4xz9q",
  "title": "Show: my local LLM benchmark",
  "author": "user_bob",
  "subreddit": "LocalLLaMA",
  "url": "https://www.reddit.com/r/LocalLLaMA/comments/1k4xz9q/show_my_local_llm_benchmark/",
  "permalink": "/r/LocalLLaMA/comments/1k4xz9q/show_my_local_llm_benchmark/",
  "is_self": true,
  "selftext": "Hi everyone, I built a benchmark...",
  "selftext_html": "<!-- SC_OFF --><div class=\"md\"><p>Hi everyone, I built a <strong>benchmark</strong>...</p></div><!-- SC_ON -->",
  "created_utc": 1746230500,
  "score": 89,
  "ups": 89,
  "downs": 0,
  "num_comments": 12,
  "upvote_ratio": 0.88,
  "stickied": false,
  "over_18": false
}
```

- [ ] **Step 3: Create the stickied (mod-pinned) fixture**

Create `apps/worker/src/crawl/fixtures/reddit-stickied-post.json`:

```json
{
  "id": "1k4xz9r",
  "title": "[META] Subreddit rules update",
  "author": "AutoModerator",
  "subreddit": "OpenAI",
  "url": "https://www.reddit.com/r/OpenAI/comments/1k4xz9r/meta_subreddit_rules_update/",
  "permalink": "/r/OpenAI/comments/1k4xz9r/meta_subreddit_rules_update/",
  "is_self": true,
  "selftext": "Rules...",
  "selftext_html": "<p>Rules...</p>",
  "created_utc": 1746000000,
  "score": 5,
  "ups": 5,
  "downs": 0,
  "num_comments": 0,
  "upvote_ratio": 1.0,
  "stickied": true,
  "over_18": false
}
```

- [ ] **Step 4: Create the NSFW fixture**

Create `apps/worker/src/crawl/fixtures/reddit-nsfw-post.json`:

```json
{
  "id": "1k4xz9s",
  "title": "NSFW topic",
  "author": "user_carol",
  "subreddit": "OpenAI",
  "url": "https://example.com/nsfw",
  "permalink": "/r/OpenAI/comments/1k4xz9s/nsfw_topic/",
  "is_self": false,
  "selftext": "",
  "selftext_html": null,
  "created_utc": 1746230600,
  "score": 1,
  "ups": 1,
  "downs": 0,
  "num_comments": 0,
  "upvote_ratio": 0.5,
  "stickied": false,
  "over_18": true
}
```

- [ ] **Step 5: Create the hot-listing wrapper fixture**

Create `apps/worker/src/crawl/fixtures/reddit-hot-listing.json` — note the inline `[deleted]` author entry as the 5th child to exercise author normalization:

```json
{
  "kind": "Listing",
  "data": {
    "after": "t3_1k4xz9p",
    "before": null,
    "children": [
      {
        "kind": "t3",
        "data": {
          "id": "1k4xz9p",
          "title": "GPT-5 announced",
          "author": "user_alice",
          "subreddit": "OpenAI",
          "url": "https://openai.com/news/gpt-5",
          "permalink": "/r/OpenAI/comments/1k4xz9p/gpt5_announced/",
          "is_self": false,
          "selftext": "",
          "selftext_html": null,
          "created_utc": 1746230400,
          "score": 1234,
          "ups": 1234,
          "downs": 0,
          "num_comments": 56,
          "upvote_ratio": 0.95,
          "stickied": false,
          "over_18": false
        }
      },
      {
        "kind": "t3",
        "data": {
          "id": "1k4xz9q",
          "title": "Show: my local LLM benchmark",
          "author": "user_bob",
          "subreddit": "OpenAI",
          "url": "https://www.reddit.com/r/OpenAI/comments/1k4xz9q/show_my_local_llm_benchmark/",
          "permalink": "/r/OpenAI/comments/1k4xz9q/show_my_local_llm_benchmark/",
          "is_self": true,
          "selftext": "Hi everyone...",
          "selftext_html": "<!-- SC_OFF --><div class=\"md\"><p>Hi everyone...</p></div><!-- SC_ON -->",
          "created_utc": 1746230500,
          "score": 89,
          "ups": 89,
          "downs": 0,
          "num_comments": 12,
          "upvote_ratio": 0.88,
          "stickied": false,
          "over_18": false
        }
      },
      {
        "kind": "t3",
        "data": {
          "id": "1k4xz9r",
          "title": "[META] Subreddit rules update",
          "author": "AutoModerator",
          "subreddit": "OpenAI",
          "url": "https://www.reddit.com/r/OpenAI/comments/1k4xz9r/meta_subreddit_rules_update/",
          "permalink": "/r/OpenAI/comments/1k4xz9r/meta_subreddit_rules_update/",
          "is_self": true,
          "selftext": "Rules...",
          "selftext_html": "<p>Rules...</p>",
          "created_utc": 1746000000,
          "score": 5,
          "ups": 5,
          "downs": 0,
          "num_comments": 0,
          "upvote_ratio": 1.0,
          "stickied": true,
          "over_18": false
        }
      },
      {
        "kind": "t3",
        "data": {
          "id": "1k4xz9s",
          "title": "NSFW topic",
          "author": "user_carol",
          "subreddit": "OpenAI",
          "url": "https://example.com/nsfw",
          "permalink": "/r/OpenAI/comments/1k4xz9s/nsfw_topic/",
          "is_self": false,
          "selftext": "",
          "selftext_html": null,
          "created_utc": 1746230600,
          "score": 1,
          "ups": 1,
          "downs": 0,
          "num_comments": 0,
          "upvote_ratio": 0.5,
          "stickied": false,
          "over_18": true
        }
      },
      {
        "kind": "t3",
        "data": {
          "id": "1k4xz9t",
          "title": "Deleted-author self-post",
          "author": "[deleted]",
          "subreddit": "OpenAI",
          "url": "https://www.reddit.com/r/OpenAI/comments/1k4xz9t/deletedauthor_selfpost/",
          "permalink": "/r/OpenAI/comments/1k4xz9t/deletedauthor_selfpost/",
          "is_self": true,
          "selftext": "an orphan post",
          "selftext_html": "<p>an orphan post</p>",
          "created_utc": 1746230700,
          "score": 7,
          "ups": 7,
          "downs": 0,
          "num_comments": 1,
          "upvote_ratio": null,
          "stickied": false,
          "over_18": false
        }
      }
    ]
  }
}
```

- [ ] **Step 6: Verify fixtures parse as valid JSON**

Run:

```bash
node -e "['link-post','self-post','stickied-post','nsfw-post','hot-listing'].forEach(n => { JSON.parse(require('fs').readFileSync('apps/worker/src/crawl/fixtures/reddit-' + n + '.json','utf8')); console.log(n + ' OK'); })"
```

Expected output: 5 lines, each `<name> OK`, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/crawl/fixtures/reddit-link-post.json \
        apps/worker/src/crawl/fixtures/reddit-self-post.json \
        apps/worker/src/crawl/fixtures/reddit-stickied-post.json \
        apps/worker/src/crawl/fixtures/reddit-nsfw-post.json \
        apps/worker/src/crawl/fixtures/reddit-hot-listing.json
git commit -m "test(worker): add Reddit JSON fixtures for crawler unit tests"
```

---

## Task 3: Create `reddit.types.ts` (DI token + API types)

**Files:**
- Create: `apps/worker/src/crawl/crawlers/reddit.types.ts`

This task is non-TDD: it only declares interfaces and a `Symbol` token. We verify via typecheck.

- [ ] **Step 1: Create `apps/worker/src/crawl/crawlers/reddit.types.ts`**

```ts
export const REDDIT_USER_AGENT = Symbol('REDDIT_USER_AGENT');

export interface RedditListingResponse {
  kind: 'Listing';
  data: {
    after: string | null;
    before: string | null;
    children: Array<{ kind: 't3'; data: RedditPost }>;
  };
}

export interface RedditPost {
  id: string;
  title: string;
  author: string | null;
  subreddit: string;
  url: string | null;
  permalink: string;
  is_self: boolean;
  selftext: string | null;
  selftext_html: string | null;
  created_utc: number;
  score: number;
  ups: number;
  downs: number;
  num_comments: number;
  upvote_ratio: number | null;
  stickied: boolean;
  over_18: boolean;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @ai-hot-news/worker typecheck`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/crawl/crawlers/reddit.types.ts
git commit -m "feat(worker): add Reddit API types and REDDIT_USER_AGENT DI token"
```

---

## Task 4: Implement `RedditCrawler` (TDD)

**Files:**
- Create: `apps/worker/src/crawl/crawlers/reddit.crawler.ts`
- Create: `apps/worker/src/crawl/crawlers/reddit.crawler.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/crawl/crawlers/reddit.crawler.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RedditCrawler } from './reddit.crawler';

const FIXTURE_DIR = join(__dirname, '..', 'fixtures');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}

const UA = 'ai-hot-news-bot/0.1 (by /u/test_owner)';

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('RedditCrawler.fetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('builds the standard subreddit URL when only identifier is given', async () => {
    fetchMock.mockResolvedValue(jsonResponse(loadFixture('reddit-hot-listing.json')));
    const crawler = new RedditCrawler(
      { id: 'src-redd-1', url: null, identifier: 'OpenAI' },
      UA,
    );
    await crawler.fetch();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.reddit.com/r/OpenAI/hot.json?limit=25&raw_json=1');
  });

  it('uses source.url verbatim when provided (extension form)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(loadFixture('reddit-hot-listing.json')));
    const crawler = new RedditCrawler(
      {
        id: 'src-redd-search',
        url: 'https://www.reddit.com/search.json?q=AI+agent&sort=new&limit=25',
        identifier: null,
      },
      UA,
    );
    await crawler.fetch();
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://www.reddit.com/search.json?q=AI+agent&sort=new&limit=25',
    );
  });

  it('throws when both url and identifier are missing', async () => {
    const crawler = new RedditCrawler(
      { id: 'src-redd-bad', url: null, identifier: null },
      UA,
    );
    await expect(crawler.fetch()).rejects.toThrow(
      /Reddit SourceConfig src-redd-bad missing both url and identifier/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the configured User-Agent header', async () => {
    fetchMock.mockResolvedValue(jsonResponse(loadFixture('reddit-hot-listing.json')));
    const crawler = new RedditCrawler(
      { id: 'src-redd-2', url: null, identifier: 'OpenAI' },
      UA,
    );
    await crawler.fetch();
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers['User-Agent']).toBe(UA);
    expect(init.headers['Accept']).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws on 429 with Retry-After hint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 429, { 'retry-after': '7' }));
    const crawler = new RedditCrawler(
      { id: 'src-redd-3', url: null, identifier: 'OpenAI' },
      UA,
    );
    await expect(crawler.fetch()).rejects.toThrow(
      /Reddit rate-limited \(429\) for .+, Retry-After=7/,
    );
  });

  it('throws on non-200 with status text', async () => {
    fetchMock.mockResolvedValue(new Response('forbidden', { status: 403 }));
    const crawler = new RedditCrawler(
      { id: 'src-redd-4', url: null, identifier: 'OpenAI' },
      UA,
    );
    await expect(crawler.fetch()).rejects.toThrow(/Reddit fetch 403/);
  });

  it('throws when payload is not a Listing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'whoops' }));
    const crawler = new RedditCrawler(
      { id: 'src-redd-5', url: null, identifier: 'OpenAI' },
      UA,
    );
    await expect(crawler.fetch()).rejects.toThrow(/response not a Listing/);
  });

  it('filters stickied and NSFW posts and produces 3 items from the 5-child fixture', async () => {
    fetchMock.mockResolvedValue(jsonResponse(loadFixture('reddit-hot-listing.json')));
    const crawler = new RedditCrawler(
      { id: 'src-redd-6', url: null, identifier: 'OpenAI' },
      UA,
    );
    const items = await crawler.fetch();
    expect(items).toHaveLength(3);
    const ids = items.map((it) => it.interactionData?.redditId);
    expect(ids).toEqual(['1k4xz9p', '1k4xz9q', '1k4xz9t']);
  });

  it('maps a link-post correctly (externalUrl set, rawHtml null, contentText=title)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      kind: 'Listing',
      data: {
        after: null,
        before: null,
        children: [{ kind: 't3', data: loadFixture('reddit-link-post.json') }],
      },
    }));
    const crawler = new RedditCrawler(
      { id: 'src-redd-7', url: null, identifier: 'OpenAI' },
      UA,
    );
    const [item] = await crawler.fetch();
    expect(item.title).toBe('GPT-5 announced');
    expect(item.contentText).toBe('GPT-5 announced');
    expect(item.rawHtml).toBeNull();
    expect(item.sourceUrl).toBe('https://www.reddit.com/r/OpenAI/comments/1k4xz9p/');
    expect(item.author).toBe('user_alice');
    expect(item.publishedAt).toEqual(new Date(1746230400 * 1000));
    expect(item.interactionData).toEqual({
      score: 1234,
      comments: 56,
      externalUrl: 'https://openai.com/news/gpt-5',
      redditId: '1k4xz9p',
      redditSubreddit: 'OpenAI',
      redditUpvoteRatio: 0.95,
    });
  });

  it('maps a self-post correctly (externalUrl null, rawHtml=selftext_html, contentText=stripHtml)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      kind: 'Listing',
      data: {
        after: null,
        before: null,
        children: [{ kind: 't3', data: loadFixture('reddit-self-post.json') }],
      },
    }));
    const crawler = new RedditCrawler(
      { id: 'src-redd-8', url: null, identifier: 'LocalLLaMA' },
      UA,
    );
    const [item] = await crawler.fetch();
    expect(item.contentText).toContain('Hi everyone, I built a benchmark');
    expect(item.contentText).not.toContain('<');
    expect(item.rawHtml).toContain('<strong>benchmark</strong>');
    expect(item.interactionData?.externalUrl).toBeNull();
    expect(item.interactionData?.redditSubreddit).toBe('LocalLLaMA');
  });

  it('normalizes "[deleted]" author to null', async () => {
    fetchMock.mockResolvedValue(jsonResponse(loadFixture('reddit-hot-listing.json')));
    const crawler = new RedditCrawler(
      { id: 'src-redd-9', url: null, identifier: 'OpenAI' },
      UA,
    );
    const items = await crawler.fetch();
    const deleted = items.find((it) => it.interactionData?.redditId === '1k4xz9t');
    expect(deleted).toBeDefined();
    expect(deleted!.author).toBeNull();
    expect(deleted!.interactionData?.redditUpvoteRatio).toBeNull();
  });

  it('falls back to post.subreddit when identifier is null and url is given (cluster-source mode)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      kind: 'Listing',
      data: {
        after: null,
        before: null,
        children: [{ kind: 't3', data: loadFixture('reddit-self-post.json') }],
      },
    }));
    const crawler = new RedditCrawler(
      {
        id: 'src-redd-cluster',
        url: 'https://www.reddit.com/r/MachineLearning+LocalLLaMA+OpenAI/hot.json?limit=50',
        identifier: null,
      },
      UA,
    );
    const [item] = await crawler.fetch();
    expect(item.interactionData?.redditSubreddit).toBe('LocalLLaMA');
    expect(item.sourceUrl).toBe(
      'https://www.reddit.com/r/LocalLLaMA/comments/1k4xz9q/',
    );
  });

  it('handles a self-post with selftext_html=null gracefully (rawHtml=null, contentText=title)', async () => {
    const noHtml = { ...(loadFixture('reddit-self-post.json') as Record<string, unknown>), selftext_html: null };
    fetchMock.mockResolvedValue(jsonResponse({
      kind: 'Listing',
      data: { after: null, before: null, children: [{ kind: 't3', data: noHtml }] },
    }));
    const crawler = new RedditCrawler(
      { id: 'src-redd-10', url: null, identifier: 'LocalLLaMA' },
      UA,
    );
    const [item] = await crawler.fetch();
    expect(item.rawHtml).toBeNull();
    expect(item.contentText).toBe('Show: my local LLM benchmark');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawlers/reddit.crawler.spec.ts --reporter=verbose`
Expected: fails with `Cannot find module './reddit.crawler'` (or similar resolution error).

- [ ] **Step 3: Implement `RedditCrawler`**

Create `apps/worker/src/crawl/crawlers/reddit.crawler.ts`:

```ts
import { stripHtml } from '@ai-hot-news/utils';
import type { RawCrawledItem } from '@ai-hot-news/types';
import type { Crawler } from './crawler.interface';
import type { RedditListingResponse, RedditPost } from './reddit.types';

const HOT_LIMIT = 25;

export interface RedditSource {
  id: string;
  url: string | null;
  identifier: string | null;
}

export class RedditCrawler implements Crawler {
  constructor(
    private readonly source: RedditSource,
    private readonly userAgent: string,
  ) {}

  async fetch(): Promise<RawCrawledItem[]> {
    const url = this.resolveUrl();
    const subredditHint = this.source.identifier;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(this.timeoutMs()),
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'application/json',
      },
    });

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after') ?? 'unknown';
      throw new Error(
        `Reddit rate-limited (429) for ${url}, Retry-After=${retryAfter}`,
      );
    }
    if (!res.ok) {
      throw new Error(`Reddit fetch ${res.status} ${res.statusText} for ${url}`);
    }

    const data = (await res.json()) as RedditListingResponse;
    if (data?.kind !== 'Listing' || !Array.isArray(data?.data?.children)) {
      throw new Error(
        `Reddit ${url} response not a Listing: ${JSON.stringify(data).slice(0, 100)}`,
      );
    }

    return data.data.children
      .map((c) => c.data)
      .filter(this.isValidPost)
      .map((p) => this.toRaw(p, subredditHint));
  }

  private resolveUrl(): string {
    if (this.source.url && this.source.url.trim().length > 0) {
      return this.source.url;
    }
    if (!this.source.identifier) {
      throw new Error(
        `Reddit SourceConfig ${this.source.id} missing both url and identifier`,
      );
    }
    return `https://www.reddit.com/r/${this.source.identifier}/hot.json?limit=${HOT_LIMIT}&raw_json=1`;
  }

  private isValidPost = (p: RedditPost): boolean => {
    if (!p) return false;
    if (p.stickied) return false;
    if (p.over_18) return false;
    if (!p.title) return false;
    if (!p.id) return false;
    return true;
  };

  private toRaw(p: RedditPost, subredditHint: string | null): RawCrawledItem {
    const isSelfPost = !!p.is_self;
    const selftextHtml = (p.selftext_html ?? '').trim();
    const subreddit = subredditHint ?? p.subreddit ?? 'unknown';
    return {
      title: p.title,
      contentText: isSelfPost ? stripHtml(selftextHtml || p.title) : p.title,
      rawHtml: isSelfPost && selftextHtml ? selftextHtml : null,
      sourceUrl: `https://www.reddit.com/r/${subreddit}/comments/${p.id}/`,
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
    };
  }

  private timeoutMs(): number {
    const raw = parseInt(process.env.REDDIT_FETCH_TIMEOUT_MS ?? '15000', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 15000;
  }
}
```

- [ ] **Step 4: Run the test to verify all cases pass**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawlers/reddit.crawler.spec.ts --reporter=verbose`
Expected: 12 tests pass, exit code 0.

- [ ] **Step 5: Run worker typecheck**

Run: `pnpm --filter @ai-hot-news/worker typecheck`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/crawl/crawlers/reddit.crawler.ts \
        apps/worker/src/crawl/crawlers/reddit.crawler.spec.ts
git commit -m "feat(worker): add RedditCrawler against public .json endpoint"
```

---

## Task 5: Wire `Platform.REDDIT` into `CrawlerFactory` (TDD)

**Files:**
- Modify: `apps/worker/src/crawl/crawler.factory.ts`
- Modify: `apps/worker/src/crawl/crawler.factory.spec.ts`

- [ ] **Step 1: Update the failing test first**

Open `apps/worker/src/crawl/crawler.factory.spec.ts`. Replace the existing file with:

```ts
import { describe, expect, it } from 'vitest';
import { Platform } from '@ai-hot-news/db';
import { CrawlerFactory } from './crawler.factory';
import { RssCrawler } from './crawlers/rss.crawler';
import { HackerNewsCrawler } from './crawlers/hackernews.crawler';
import { RedditCrawler } from './crawlers/reddit.crawler';

const TEST_UA = 'ai-hot-news-bot/0.1 (by /u/test)';

describe('CrawlerFactory', () => {
  const factory = new CrawlerFactory(TEST_UA);

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

  it('returns a RedditCrawler instance for REDDIT sources', () => {
    const crawler = factory.create({
      id: 'src1',
      platform: Platform.REDDIT,
      url: null,
      identifier: 'OpenAI',
    });
    expect(crawler).toBeInstanceOf(RedditCrawler);
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
Expected: fails on the new `RedditCrawler` test (no `case Platform.REDDIT` in factory yet) — error message will match `/Unsupported crawler platform: REDDIT/`. The `CrawlerFactory(TEST_UA)` ctor call may also fail typecheck because the existing ctor is parameterless; that is expected.

- [ ] **Step 3: Update `CrawlerFactory` to accept the UA and route REDDIT**

Replace `apps/worker/src/crawl/crawler.factory.ts` with:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Platform } from '@ai-hot-news/db';
import type { Crawler } from './crawlers/crawler.interface';
import { RssCrawler } from './crawlers/rss.crawler';
import { HackerNewsCrawler } from './crawlers/hackernews.crawler';
import { RedditCrawler } from './crawlers/reddit.crawler';
import { REDDIT_USER_AGENT } from './crawlers/reddit.types';

export interface CrawlerSource {
  id: string;
  platform: Platform;
  url: string | null;
  identifier: string | null;
}

@Injectable()
export class CrawlerFactory {
  constructor(
    @Inject(REDDIT_USER_AGENT) private readonly redditUserAgent: string,
  ) {}

  create(source: CrawlerSource): Crawler {
    switch (source.platform) {
      case Platform.RSS:
        return new RssCrawler({ id: source.id, url: source.url });
      case Platform.HACKERNEWS:
        return new HackerNewsCrawler({ id: source.id, identifier: source.identifier });
      case Platform.REDDIT:
        return new RedditCrawler(
          { id: source.id, url: source.url, identifier: source.identifier },
          this.redditUserAgent,
        );
      default:
        throw new Error(`Unsupported crawler platform: ${source.platform}`);
    }
  }
}
```

- [ ] **Step 4: Run the factory tests to verify they pass**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawler.factory.spec.ts --reporter=verbose`
Expected: 4 tests pass, exit code 0.

- [ ] **Step 5: Run worker typecheck**

Run: `pnpm --filter @ai-hot-news/worker typecheck`
Expected: no output, exit code 0. (The DI module wiring change in Task 6 is what NestJS needs at runtime; typecheck passes already because the ctor parameter is just a string with `@Inject`.)

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/crawl/crawler.factory.ts \
        apps/worker/src/crawl/crawler.factory.spec.ts
git commit -m "feat(worker): route Platform.REDDIT through CrawlerFactory with injected UA"
```

---

## Task 6: Register `REDDIT_USER_AGENT` value provider in `CrawlModule`

**Files:**
- Modify: `apps/worker/src/crawl/crawl.module.ts`

This task is non-TDD: it adds a NestJS DI value provider; correctness is verified at app boot.

- [ ] **Step 1: Add the value provider to `CrawlModule`**

Open `apps/worker/src/crawl/crawl.module.ts`. The current `providers` array (lines 17-44) ends with `CrawlScheduler,`. Add an import and a new provider entry.

Add to the imports at the top (after the existing import from `./crawler.factory`):

```ts
import { REDDIT_USER_AGENT } from './crawlers/reddit.types';
```

Then update the `providers` array — append after `CrawlScheduler,`:

```ts
    {
      provide: REDDIT_USER_AGENT,
      useFactory: () =>
        process.env.REDDIT_USER_AGENT ?? 'ai-hot-news-bot/0.1 (by /u/anonymous)',
    },
```

The full updated `providers` array should now look like:

```ts
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
    {
      provide: REDDIT_USER_AGENT,
      useFactory: () =>
        process.env.REDDIT_USER_AGENT ?? 'ai-hot-news-bot/0.1 (by /u/anonymous)',
    },
  ],
```

- [ ] **Step 2: Run worker typecheck and unit tests**

Run: `pnpm --filter @ai-hot-news/worker typecheck`
Expected: no output, exit code 0.

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl --reporter=verbose`
Expected: all existing crawl/* tests still pass (this includes the new factory + reddit tests from Tasks 4 & 5).

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/crawl/crawl.module.ts
git commit -m "feat(worker): register REDDIT_USER_AGENT value provider in CrawlModule"
```

---

## Task 7: Widen `CrawlScheduler` platform filter to include `REDDIT` (TDD)

**Files:**
- Modify: `apps/worker/src/crawl/crawl.scheduler.spec.ts`
- Modify: `apps/worker/src/crawl/crawl.scheduler.ts`

- [ ] **Step 1: Update the failing tests first**

Open `apps/worker/src/crawl/crawl.scheduler.spec.ts`. Make two changes:

(a) In the test `'queries enabled sources where platform IN (RSS, HACKERNEWS)'`, rename it and update its expected `platform.in` array to include `Platform.REDDIT`. Replace the entire `it(...)` block (lines 67-77) with:

```ts
  it('queries enabled sources where platform IN (RSS, HACKERNEWS, REDDIT)', async () => {
    prismaFindMany.mockResolvedValue([]);
    const scheduler = new CrawlScheduler(mainQueue, connection);
    await scheduler.onModuleInit();
    expect(prismaFindMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        platform: { in: [Platform.RSS, Platform.HACKERNEWS, Platform.REDDIT] },
      },
    });
  });
```

(b) In the test `'registers each source with crawl-repeat-* and crawl-boot-* job IDs'`, append a Reddit row to the `prismaFindMany.mockResolvedValue([...])` array and add two more `expect(mainQueueAdd).toHaveBeenNthCalledWith(...)` assertions for it. Replace the entire `it(...)` block (lines 79-121) with:

```ts
  it('registers each source with crawl-repeat-* and crawl-boot-* job IDs', async () => {
    prismaFindMany.mockResolvedValue([
      { id: 'rss1', platform: Platform.RSS, crawlInterval: 1800 },
      { id: 'hn1', platform: Platform.HACKERNEWS, crawlInterval: 900 },
      { id: 'redd1', platform: Platform.REDDIT, crawlInterval: 3600 },
    ]);
    const scheduler = new CrawlScheduler(mainQueue, connection);
    await scheduler.onModuleInit();
    expect(mainQueueAdd).toHaveBeenCalledTimes(6);
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
    expect(mainQueueAdd).toHaveBeenNthCalledWith(
      5,
      'crawl',
      { sourceConfigId: 'redd1' },
      expect.objectContaining({
        jobId: 'crawl-repeat-redd1',
        repeat: { every: 3_600_000 },
      }),
    );
    expect(mainQueueAdd).toHaveBeenNthCalledWith(
      6,
      'crawl',
      { sourceConfigId: 'redd1' },
      expect.objectContaining({
        jobId: expect.stringMatching(/^crawl-boot-redd1-\d+$/),
      }),
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawl.scheduler.spec.ts --reporter=verbose`
Expected: 2 failures —
- `'queries enabled sources where platform IN (RSS, HACKERNEWS, REDDIT)'` fails because actual `platform.in` is still `[RSS, HACKERNEWS]`.
- `'registers each source with crawl-repeat-* and crawl-boot-* job IDs'` fails because the unmocked `Platform.REDDIT` row is returned but only 4 calls happen (`mainQueueAdd` invoked 6 times now? actually scheduler iterates whatever `findMany` returns — so the call count assertion `6` may pass; but `crawl-repeat-redd1` will be added with `every: 3_600_000` correctly, so the failure here is on the FIRST test only). Run and confirm; if only test (a) fails, that is fine.

- [ ] **Step 3: Update `CrawlScheduler` to include `REDDIT`**

Open `apps/worker/src/crawl/crawl.scheduler.ts`. Find the `platform: { in: [...] }` line (line 32):

```ts
        platform: { in: [Platform.RSS, Platform.HACKERNEWS] },
```

Change it to:

```ts
        platform: { in: [Platform.RSS, Platform.HACKERNEWS, Platform.REDDIT] },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawl.scheduler.spec.ts --reporter=verbose`
Expected: all 4 tests pass, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/crawl/crawl.scheduler.ts \
        apps/worker/src/crawl/crawl.scheduler.spec.ts
git commit -m "feat(worker): include Platform.REDDIT in CrawlScheduler source filter"
```

---

## Task 8: Extend `IngestionService` integration tests with REDDIT cases

**Files:**
- Modify: `apps/worker/src/crawl/ingestion.service.integration.spec.ts`

This task verifies that `IngestionService` (already platform-agnostic since SP-2) transparently writes Reddit `interactionData` (including `redditUpvoteRatio: null`) to the JSONB column without any code change to the service itself.

- [ ] **Step 1: Add Reddit constants and a Reddit `describe` block at the end of the file**

Open `apps/worker/src/crawl/ingestion.service.integration.spec.ts`. Find the existing `HN_URL_PREFIX` constant (line 25) and append immediately after:

```ts
const REDDIT_URL_PREFIX = 'https://www.reddit.com/r/';

const REDDIT_SOURCE = {
  id: 'test-redd-src',
  platform: Platform.REDDIT,
  url: null,
  identifier: 'OpenAI',
  name: 'r/OpenAI Test',
};
```

Then update the `cleanup()` function to also delete Reddit test rows. Replace the existing `cleanup()` (lines 38-47) with:

```ts
async function cleanup() {
  await prisma.hotNews.deleteMany({
    where: {
      OR: [
        { sourceUrl: { startsWith: 'https://lab.example.com/post/' } },
        { sourceUrl: { startsWith: HN_URL_PREFIX } },
        { sourceUrl: { startsWith: REDDIT_URL_PREFIX } },
      ],
    },
  });
}
```

Then append a new `describe` block at the very end of the file (inside the outer `describe('IngestionService (integration)', ...)`, just after the closing `}` of the existing `describe('HACKERNEWS platform', ...)` block on line 186 — i.e., right before the outer `});`):

```ts
  describe('REDDIT platform', () => {
    it('inserts a REDDIT item with full interactionData (6 fields)', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'GPT-5 announced',
          contentText: 'GPT-5 announced',
          rawHtml: null,
          sourceUrl: `${REDDIT_URL_PREFIX}OpenAI/comments/1k4xz9p/`,
          author: 'user_alice',
          publishedAt: new Date('2026-05-03T00:00:00Z'),
          interactionData: {
            score: 1234,
            comments: 56,
            externalUrl: 'https://openai.com/news/gpt-5',
            redditId: '1k4xz9p',
            redditSubreddit: 'OpenAI',
            redditUpvoteRatio: 0.95,
          },
        },
      ];

      const result = await ingestion.ingest(items, REDDIT_SOURCE);
      expect(result).toEqual({ fetched: 1, inserted: 1, skipped: 0, failed: 0 });

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: `${REDDIT_URL_PREFIX}OpenAI/comments/1k4xz9p/` },
      });
      expect(row.sourcePlatform).toBe(Platform.REDDIT);
      expect(row.title).toBe('GPT-5 announced');
      expect(row.author).toBe('user_alice');
      expect(row.interactionData).toMatchObject({
        score: 1234,
        comments: 56,
        externalUrl: 'https://openai.com/news/gpt-5',
        redditId: '1k4xz9p',
        redditSubreddit: 'OpenAI',
        redditUpvoteRatio: 0.95,
      });
    });

    it('persists redditUpvoteRatio: null verbatim (cold post)', async () => {
      const sourceUrl = `${REDDIT_URL_PREFIX}OpenAI/comments/1k4xz9t/`;
      await ingestion.ingest(
        [
          {
            title: 'Cold post',
            contentText: 'Cold post',
            rawHtml: null,
            sourceUrl,
            author: null,
            publishedAt: new Date('2026-05-03T00:30:00Z'),
            interactionData: {
              score: 2,
              comments: 0,
              externalUrl: null,
              redditId: '1k4xz9t',
              redditSubreddit: 'OpenAI',
              redditUpvoteRatio: null,
            },
          },
        ],
        REDDIT_SOURCE,
      );

      const row = await prisma.hotNews.findFirstOrThrow({ where: { sourceUrl } });
      expect(row.interactionData).toMatchObject({
        redditUpvoteRatio: null,
        redditId: '1k4xz9t',
        redditSubreddit: 'OpenAI',
      });
    });

    it('does NOT overwrite interactionData on duplicate sourceUrl (first-write-wins)', async () => {
      const sourceUrl = `${REDDIT_URL_PREFIX}OpenAI/comments/1k4xz9z/`;

      await ingestion.ingest(
        [
          {
            title: 'First insert',
            contentText: 'First insert',
            rawHtml: null,
            sourceUrl,
            author: 'user_first',
            publishedAt: new Date('2026-05-03T01:00:00Z'),
            interactionData: {
              score: 10,
              comments: 1,
              externalUrl: null,
              redditId: '1k4xz9z',
              redditSubreddit: 'OpenAI',
              redditUpvoteRatio: 0.5,
            },
          },
        ],
        REDDIT_SOURCE,
      );

      const result2 = await ingestion.ingest(
        [
          {
            title: 'Second insert',
            contentText: 'Second insert',
            rawHtml: null,
            sourceUrl,
            author: 'user_second',
            publishedAt: new Date('2026-05-03T01:00:00Z'),
            interactionData: {
              score: 999,
              comments: 99,
              externalUrl: null,
              redditId: '1k4xz9z',
              redditSubreddit: 'OpenAI',
              redditUpvoteRatio: 0.99,
            },
          },
        ],
        REDDIT_SOURCE,
      );

      expect(result2).toEqual({ fetched: 1, inserted: 0, skipped: 1, failed: 0 });

      const row = await prisma.hotNews.findFirstOrThrow({ where: { sourceUrl } });
      expect(row.interactionData).toMatchObject({
        score: 10,
        comments: 1,
        redditUpvoteRatio: 0.5,
      });
    });
  });
```

- [ ] **Step 2: Start local Docker dev DB if not already up**

Run: `pnpm docker:dev`
Expected: `postgres` and `redis` containers are healthy. Skip if already running.

- [ ] **Step 3: Run the integration test**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/ingestion.service.integration.spec.ts --reporter=verbose`
Expected: all existing tests + the 3 new REDDIT cases pass, exit code 0.

- [ ] **Step 4: Run worker typecheck**

Run: `pnpm --filter @ai-hot-news/worker typecheck`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/crawl/ingestion.service.integration.spec.ts
git commit -m "test(worker): cover REDDIT platform in IngestionService integration suite"
```

---

## Task 9: Add 8 Reddit `SourceConfig` rows to `seed.ts`

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Add the `RedditCandidate` interface and array near the top**

Open `packages/db/prisma/seed.ts`. After the existing `HnCandidate` interface (line 16), add:

```ts
interface RedditCandidate {
  name: string;
  identifier: string;
  url: string | null;
  enabled: boolean;
  crawlInterval: number;
}
```

After the existing `hnCandidates` array (line 29), add:

```ts
const redditCandidates: RedditCandidate[] = [
  { name: 'r/LocalLLaMA',       identifier: 'LocalLLaMA',       url: null, enabled: true, crawlInterval: 3600 },
  { name: 'r/MachineLearning',  identifier: 'MachineLearning',  url: null, enabled: true, crawlInterval: 3600 },
  { name: 'r/artificial',       identifier: 'artificial',       url: null, enabled: true, crawlInterval: 3600 },
  { name: 'r/OpenAI',           identifier: 'OpenAI',           url: null, enabled: true, crawlInterval: 3600 },
  { name: 'r/ChatGPT',          identifier: 'ChatGPT',          url: null, enabled: true, crawlInterval: 3600 },
  { name: 'r/singularity',      identifier: 'singularity',      url: null, enabled: true, crawlInterval: 3600 },
  { name: 'r/StableDiffusion',  identifier: 'StableDiffusion',  url: null, enabled: true, crawlInterval: 3600 },
  { name: 'r/ClaudeAI',         identifier: 'ClaudeAI',         url: null, enabled: true, crawlInterval: 3600 },
];
```

- [ ] **Step 2: Add the `seedReddit()` function**

After the existing `seedHn()` function (line 75), add:

```ts
async function seedReddit() {
  for (const c of redditCandidates) {
    const existing = await prisma.sourceConfig.findFirst({
      where: { platform: 'REDDIT', identifier: c.identifier },
    });
    if (existing) {
      await prisma.sourceConfig.update({
        where: { id: existing.id },
        data: {
          name: c.name,
          url: c.url,
          crawlInterval: c.crawlInterval,
        },
      });
    } else {
      await prisma.sourceConfig.create({
        data: {
          platform: 'REDDIT',
          name: c.name,
          url: c.url,
          identifier: c.identifier,
          enabled: c.enabled,
          crawlInterval: c.crawlInterval,
        },
      });
    }
    console.log(`seeded Reddit: ${c.name} (identifier=${c.identifier}, enabled=${c.enabled})`);
  }
}
```

- [ ] **Step 3: Call `seedReddit()` from `main()`**

Find the existing `main()` function (line 77):

```ts
async function main() {
  await seedRss();
  await seedHn();
}
```

Change it to:

```ts
async function main() {
  await seedRss();
  await seedHn();
  await seedReddit();
}
```

- [ ] **Step 4: Run the seed against the local DB and verify**

Run: `pnpm --filter @ai-hot-news/db typecheck`
Expected: no output, exit code 0.

Run: `pnpm db:seed`
Expected: log includes 8 lines `seeded Reddit: r/<sub> (identifier=<sub>, enabled=true)` plus the existing RSS / HN lines, exit code 0.

Verify the row count:

```bash
docker compose -f docker-compose.dev.yml exec -T postgres \
  psql -U postgres -d ai_hot_news -c \
  "SELECT platform, COUNT(*) FROM source_configs GROUP BY platform ORDER BY platform;"
```

Expected output (the exact RSS count depends on prior runs; the new line is the REDDIT row):

```
  platform   | count
-------------+-------
 HACKERNEWS  |     3
 REDDIT      |     8
 RSS         |   3-4
```

- [ ] **Step 5: Re-run seed to confirm idempotency**

Run: `pnpm db:seed`
Expected: same 8 `seeded Reddit:` lines (update path, not create), no errors, no duplicate rows.

Verify (same SQL as above): the `REDDIT` row count is still `8`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "chore(db): seed 8 Reddit subreddits (60min crawl interval)"
```

---

## Task 10: Run full test + typecheck + lint suite

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full test matrix**

Run: `pnpm turbo run test`
Expected: all packages green, exit code 0. Specifically the new `reddit.crawler.spec.ts` (12 cases) and the extended `ingestion.service.integration.spec.ts` REDDIT block (3 cases) and `crawl.scheduler.spec.ts` (4 cases) and `crawler.factory.spec.ts` (4 cases) all pass.

- [ ] **Step 2: Run lint + typecheck across the monorepo**

Run: `pnpm turbo run lint typecheck`
Expected: 0 errors, exit code 0.

- [ ] **Step 3: Run the build to catch any TS/Next packaging issues**

Run: `pnpm turbo run build`
Expected: all packages build, exit code 0.

If anything fails, fix it before moving on. Do NOT commit anything in this task — it is verification only.

---

## Task 11: Local end-to-end smoke test

**Files:** none modified — manual verification.

This task validates the full local pipeline (worker boot → 8 Reddit boot jobs → ingest → API → web). Treat any unexpected behaviour as a bug to fix in a follow-up task.

- [ ] **Step 1: Add `REDDIT_USER_AGENT` to local worker `.env`**

Open `apps/worker/.env` (NOT `.env.example` — that one is just a template). Append:

```
REDDIT_USER_AGENT=ai-hot-news-bot/0.1 (by /u/<your-reddit-username>)
REDDIT_FETCH_TIMEOUT_MS=15000
```

Replace `<your-reddit-username>` with your actual Reddit handle (any account works — the UA is metadata, not auth). If you do not have one, the default `(by /u/anonymous)` will be used and local smoke will still work, but production ought to use a real handle.

- [ ] **Step 2: Start the dev stack**

Run: `pnpm setup` (only on first run after a fresh clone) then `pnpm start`
Expected: postgres + redis healthy; worker, api, and web start; turbo prints three streaming tabs.

- [ ] **Step 3: Verify the worker registered Reddit sources**

Within ~5 seconds after `pnpm start`, expect a worker log line:

```
Registered 14 enabled sources: 3 RSS, 3 HACKERNEWS, 8 REDDIT
```

If the RSS count differs (3 vs 4 depending on `Anthropic News` enabled flag), that is fine — the key is `8 REDDIT`.

- [ ] **Step 4: Wait 5-7 minutes for Reddit boot jobs to drain**

Watch worker logs. Expect 8 lines like:

```
REDDIT crawled: source=r/LocalLLaMA fetched=25 inserted=24 skipped=1 failed=0
REDDIT crawled: source=r/MachineLearning fetched=25 ...
... (8 total)
```

(Exact counts vary with the live hot list. `failed=0` is the bar; transient `failed=1` is acceptable on first run if a single 5xx occurs — BullMQ retries on the next interval.)

If you see any `OAuth` / `token` / `401` strings, that is a bug — Reddit OAuth is intentionally NOT used in v2; please report.

- [ ] **Step 5: Verify the API returns Reddit rows with full `interactionData`**

Run:

```bash
curl -s 'http://localhost:3001/hot-news?pageSize=200' \
  | jq '.items[] | select(.sourcePlatform == "REDDIT") | .interactionData' \
  | head -20
```

Expected: at least one Reddit `interactionData` object with all 6 fields:

```json
{
  "score": 1234,
  "comments": 56,
  "externalUrl": "https://github.com/some/repo",
  "redditId": "1k4xz9p",
  "redditSubreddit": "LocalLLaMA",
  "redditUpvoteRatio": 0.95
}
```

(`externalUrl` may be `null` for self-posts; `redditUpvoteRatio` may be `null` for cold posts. All other fields must be present.)

- [ ] **Step 6: Verify platform mix on the API**

Run:

```bash
curl -s 'http://localhost:3001/hot-news?pageSize=200' \
  | jq '.items | group_by(.sourcePlatform) | map({plat: .[0].sourcePlatform, n: length})'
```

Expected: array containing all three of `HACKERNEWS`, `REDDIT`, `RSS` with `n >= 10` each (Reddit ≥ 20 typical).

- [ ] **Step 7: Verify the web UI**

Open `http://localhost:3000/news` in a browser. Expect:

- Mixed list of items.
- Items from Reddit subreddits show a red `Reddit` badge (background `bg-red-50`, text `text-red-700`).
- HN items keep their orange badge; RSS items keep blue.

- [ ] **Step 8: Verify idempotency (P2002 dedup)**

Stop the dev stack: `Ctrl+C` in the `pnpm start` tab, then `pnpm stop`.

Restart: `pnpm start`.

Wait ~5 minutes for the second-boot Reddit jobs. Expect logs like:

```
REDDIT crawled: source=r/LocalLLaMA fetched=25 inserted=2 skipped=23 failed=0
```

i.e. `skipped` should be much higher than `inserted` (most posts are still on the hot list, hit P2002).

- [ ] **Step 9: Stop the dev stack**

`Ctrl+C`, then `pnpm stop`.

This task creates no commits. If anything fails, open a follow-up task to fix and commit there.

---

## Task 12: Update decomposition spec & decision log

**Files:**
- Modify: `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md`
- Modify: `docs/superpowers/specs/2026-05-03-sp2-hackernews-crawler-design.md`

- [ ] **Step 1: Mark SP-3 as completed in the decomposition spec**

Open `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md`. In `## 11. 已完成 SP 状态追踪` (or whichever heading tracks completion status), add an entry for SP-3 mirroring the SP-2 format. Example entry:

```markdown
### SP-3 Reddit 抓取器 ✅ 已完成（2026-05-XX）

- **plan / spec**：`docs/superpowers/plans/2026-05-03-sp3-reddit-crawler-plan.md` / `docs/superpowers/specs/2026-05-03-sp3-reddit-crawler-design.md`
- **关键交付**：`RedditCrawler` 走 Reddit 公开 `.json` 端点（无 OAuth）抓 8 个 AI subreddit 的 hot 列表；`interactionData` 含 `score / comments / externalUrl / redditId / redditSubreddit / redditUpvoteRatio`
- **架构留点**：`SourceConfig.url` 优先于 `identifier`，未来加关键词搜索源 / 多 sub 集群源零代码改动接入
```

Replace `2026-05-XX` with today's date.

In `## 6. 子项目完整清单`, change SP-3 status badge from whatever it currently is (likely `📋 spec ready` or similar) to `✅ done`.

- [ ] **Step 2: Add SP-3 decisions to the decomposition spec decision log**

In `## 10. 决策日志`, append:

```markdown
### SP-3 Reddit 抓取器（2026-05-XX）

1. **抓取通道改为 Reddit 公开 `.json` 端点（v1 OAuth 路线废弃）**：Reddit 2025 末上线 Responsible Builder Policy，self-service OAuth 关闭，必须人工审核且周期不确定。改走 `https://www.reddit.com/r/<sub>/hot.json`：~60 req/min/IP，本项目 8 req/h 远低于限制；零凭据管理；与 OAuth 返回字段一致。详见 SP-3 spec §0 / §5.1。
2. **8 个 sub 全开 + hot 25**：与 PRD §7.5.2 推荐对齐；`hot` 半小时变化 ≤10 条，25 覆盖率充分；运维可手工 SQL `UPDATE source_configs SET enabled=false WHERE identifier='X'` 关掉噪音 sub，下次 deploy seed 不覆盖手工改动。
3. **60 分钟 `crawlInterval`**：Reddit 帖半衰期 ≥6h；与 HN 30 分钟错开节奏；8 sub × 25 帖 × 0.3 新增比例 / h ≈ 60 行/h ≈ 1500 行/天，磁盘压力可控。
4. **不抓评论原文**：`interactionData.comments` 仅记计数；评论数据真实消费者是 SP-5 AI 摘要，到时候独立 worker 按"高热度帖"按需抓更经济。
5. **`SourceConfig.url` 优先 vs `identifier` 拼接**：标准 sub 模式 seed 极简（只填 identifier）；未来扩展形态（关键词搜索 / 多 sub 集群）零代码改动接入，crawler `resolveUrl()` 一处处理。

### clawfeed 学到的两个点（2026-05-03，brainstorming 阶段）

1. **URL auto-detect**（feed URL 自动识别 RSS / Atom / JSON / OPML）：→ 未来 SP-24 后台管理页 UX 参考，单用户场景目前 YAGNI。
2. **source_packs**（按主题分享 source 集合）：→ 未来 SP-24 / 多用户场景 UX 参考，单用户场景目前 YAGNI。
```

Replace `2026-05-XX` with today's date.

- [ ] **Step 3: Update SP-2 spec §4.2 to mark Reddit as "已落地"**

Open `docs/superpowers/specs/2026-05-03-sp2-hackernews-crawler-design.md`. Find §4.2 `interactionData 字段约定` table. Locate the row(s) labelled `**Reddit 预留（前缀 reddit，→ SP-3）**` (or similar). Update to `**Reddit（前缀 reddit，SP-3 已落地 2026-05-XX）**` and ensure the 3 fields listed are:

| 字段 | 类型 | 含义 |
|---|---|---|
| `redditId` | string | Reddit post id（不带 `t3_` 前缀，e.g. `"1k4xz9p"`）|
| `redditSubreddit` | string | subreddit 名（不带 `r/` 前缀，e.g. `"LocalLLaMA"`）|
| `redditUpvoteRatio` | number \| null | 0..1，社区情绪指标；冷帖 (<3 votes) 时 Reddit 不返回，记 `null` |

If the table currently shows `TBD` or only `redditId` + `redditSubreddit`, add the third row.

- [ ] **Step 4: Verify markdown lint / structure**

Run a quick visual scan: search for `2026-05-XX` placeholders and ensure all are replaced with the actual date.

```bash
rg "2026-05-XX" docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md docs/superpowers/specs/2026-05-03-sp2-hackernews-crawler-design.md
```

Expected: no matches (exit code 1 from `rg`, which is the desired result).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md \
        docs/superpowers/specs/2026-05-03-sp2-hackernews-crawler-design.md
git commit -m "docs(sp3): mark SP-3 done, log Reddit decisions, link clawfeed learnings"
```

---

## Task 13: Push to main, deploy to VPS, verify production

**Files:** none — operational task.

- [ ] **Step 1: Add `REDDIT_USER_AGENT` to VPS `.env` BEFORE pushing**

SSH to the VPS (`ssh deploy@64.64.240.84` or whatever is configured) and append:

```bash
ssh deploy@<vps-ip> bash -c "cat >> /srv/ai-hot-news/.env <<'EOF'
REDDIT_USER_AGENT=ai-hot-news-bot/0.1 (by /u/<your-reddit-username>)
REDDIT_FETCH_TIMEOUT_MS=15000
EOF"
```

Verify it landed:

```bash
ssh deploy@<vps-ip> "grep ^REDDIT_ /srv/ai-hot-news/.env"
```

Expected: 2 lines printed.

- [ ] **Step 2: Push commits to main**

```bash
git push origin main
```

Expected: GitHub Actions `ci.yml` triggers, then `deploy.yml` triggers on success.

- [ ] **Step 3: Watch CI and Deploy in GitHub Actions**

Open `https://github.com/<owner>/ai-hot-news/actions` in a browser. Wait for both `ci` and `deploy` jobs to complete green (~5-8 min total).

If `deploy` fails, SSH to the VPS and check `tail -100 /srv/ai-hot-news/logs/deploy.log` (or wherever deploy.sh writes). The most likely failure mode is missing env var — re-check Step 1.

- [ ] **Step 4: Verify production reads include Reddit**

Run:

```bash
curl -s 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=200' \
  | jq '.items | map(.sourcePlatform) | unique'
```

Expected: array contains all three of `"HACKERNEWS"`, `"REDDIT"`, `"RSS"`.

If `REDDIT` is missing, wait ~5-10 minutes for the next worker boot interval (deploy restarts worker but a single Reddit boot job can take a few seconds; if all 8 boot jobs failed silently, see Step 5).

- [ ] **Step 5: Verify production Reddit `interactionData` is complete**

Run:

```bash
curl -s 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=200' \
  | jq '.items[] | select(.sourcePlatform == "REDDIT") | .interactionData' \
  | head -20
```

Expected: same shape as Task 11 Step 5 — `score`, `comments`, `externalUrl`, `redditId`, `redditSubreddit`, `redditUpvoteRatio` all present.

- [ ] **Step 6: Verify production UI**

Open `https://hotnews.shinpeionline.top/news` in a browser. Confirm Reddit items appear with red badges.

- [ ] **Step 7: Mark plan checkboxes complete**

Open this plan file (`docs/superpowers/plans/2026-05-03-sp3-reddit-crawler-plan.md`) and ensure every checkbox above is `[x]`. If any are still `[ ]`, either complete them or document why they were skipped in a follow-up commit.

This task creates no code commits (deploy already pushed in Step 2). The work for SP-3 is now complete.

---

## Self-Review (run after writing the plan, before handing off)

This section is the planner's self-check, not a task — leave it visible in the file as a record.

**1. Spec coverage check (each spec section → task mapping):**

| Spec section | Tasks |
|---|---|
| §1.1 Goal / §1.2 In-scope | Task 1 (env), 3 (types), 4 (crawler), 5 (factory), 6 (module), 7 (scheduler), 9 (seed) |
| §1.3 Out-of-scope | None — explicitly excluded |
| §1.4 Hard acceptance criteria | Task 11 (local smoke), Task 13 (production smoke) |
| §1.5 What is NOT modified | None — verified by `pnpm turbo build` in Task 10 catching any unexpected schema/contract changes |
| §2 Architecture / data flow | Task 4 (crawler) implements the §2.1 sequence; Task 5 (factory) implements §2.3 signature; Task 7 (scheduler) implements §2.1 platform widening |
| §2.4 Env vars | Task 1 (`.env.example`), Task 6 (DI value provider), Task 11 (local `.env`), Task 13 (VPS `.env`) |
| §3.1 File structure | Tasks 2, 3, 4 create the new files; Tasks 5, 6, 7, 8, 9 modify the listed files |
| §3.2 RedditCrawler implementation | Task 4 |
| §3.3 CrawlerFactory | Task 5 |
| §3.4 CrawlScheduler | Task 7 |
| §3.5 CrawlModule | Task 6 |
| §3.6 url-vs-identifier semantics | Task 4 (`resolveUrl()`); Task 4 spec covers both modes |
| §4.1 HotNews mapping | Task 4 (`toRaw()`); Task 8 integration test covers persistence |
| §4.2 interactionData fields | Task 12 updates SP-2 §4.2 table; Task 8 test asserts the 6 fields |
| §4.3 Seed data | Task 9 |
| §5 Decisions | Task 12 (decision log) |
| §6.1 Web | None — SP-2 already covered |
| §6.2 API | None — SP-1/2 already covered |
| §6.3 Deployment | Task 13 |
| §7 Test matrix | Tasks 4 (unit), 5 (factory unit), 7 (scheduler unit), 8 (integration); Task 10 runs the full matrix |
| §8.1 Error handling | Task 4 spec asserts 429 / non-200 / non-Listing throws |
| §8.2 Upgrade hooks | Task 4 architecture (`resolveUrl()`); Task 12 logs Decision #5 |
| §9 Risks | Task 11 Step 1 / Task 13 Step 1 (UA setup); Task 11 Step 8 (idempotency under disk pressure) |
| §10 Completion checklist | Mirrored 1:1 across Tasks 1-13 |
| §11 Next steps | Implicit — handoff is via `subagent-driven-development` |

**No gaps found.**

**2. Placeholder scan:**

- No `TBD` / `TODO` in any code block.
- No "implement appropriate error handling" (errors specified explicitly).
- No "similar to Task N" (every task has full code).
- One date placeholder `2026-05-XX` in Task 12 — explicitly flagged in Step 4 as "must replace".
- One reddit-username placeholder `<your-reddit-username>` in Tasks 11 & 13 — explicitly flagged in Step 1 of each.
- One VPS hostname placeholder `<vps-ip>` in Task 13 — known and acceptable (operator picks from environment).

**3. Type / signature consistency check:**

| Symbol | Defined in Task | Used in Task | Consistent? |
|---|---|---|---|
| `REDDIT_USER_AGENT` (Symbol) | Task 3 | Tasks 5, 6 | ✅ |
| `RedditPost` interface | Task 3 | Task 4 | ✅ |
| `RedditListingResponse` interface | Task 3 | Task 4 | ✅ |
| `RedditSource` interface | Task 4 | Task 5 (factory wraps source into RedditSource) | ✅ — factory uses inline literal `{ id, url, identifier }` matching the interface |
| `interactionData` 6 fields | Task 4 (`toRaw`) | Task 8 (assert), Task 12 (decision log table) | ✅ |
| `crawlInterval=3600` for Reddit | Task 9 (seed) | Task 7 (test asserts `every: 3_600_000`) | ✅ |
| `Platform.REDDIT` already exists | — | Tasks 5, 7, 9 | ✅ (Prisma schema SP-0) |

**No inconsistencies found.**
