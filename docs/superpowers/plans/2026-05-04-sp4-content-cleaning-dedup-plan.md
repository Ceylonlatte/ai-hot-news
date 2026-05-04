# SP-4 Content Cleaning + Multi-Layer Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strengthen the SP-1/2/3 ingestion pipeline with a 6-rule URL canonicalization upgrade, pre-ingest title/content boilerplate cleaning, and platform-aware quality filtering that writes `status='HIDDEN' + filterReason` instead of dropping rows. Plus a one-shot backfill script that retro-applies the new rules to the ~1927 historical rows.

**Architecture:** Three new pure-function modules in `@ai-hot-news/utils` (`url` upgrade, `boilerplate`, `quality`) become the single source of truth for normalization and quality decisions. Each platform-specific crawler (Reddit, HN) calls the matching `quality.ts` function in `toRaw()` and stores the verdict in `RawCrawledItem.filterReason`; `IngestionService` consumes this field, runs universal fallback (`checkUniversalQuality`), cleans the title/content, and writes `status='HIDDEN'` + `filterReason` when set. `HotNewsService` adds `where: { status: 'VISIBLE' }` to its default query. A new TypeScript script `packages/db/scripts/migrate-sp4.ts` (run via `pnpm db:migrate-sp4`) backfills history in two layers: re-normalize URLs (with P2002 collapse keeping earliest `publishedAt`) and apply the quality rules retroactively.

**Tech Stack:** pnpm 9 + Turborepo 2 monorepo · NestJS 11 (api + worker) · Prisma 6 + PostgreSQL 16 (one new column `hot_news."filterReason"` — Prisma's default camelCase, quoted in raw SQL — no other schema changes) · Vitest 2 · zero new runtime dependencies (only `vitest` devDep added to `@ai-hot-news/db`).

**Reference spec:** `docs/superpowers/specs/2026-05-04-sp4-content-cleaning-dedup-design.md`

---

## File Map

### Created

| Path | Responsibility |
|---|---|
| `packages/utils/src/boilerplate.ts` | `stripTitleBoilerplate(title)` (whitelist-based site-suffix stripping) + `stripContentBoilerplate(text)` (Read more / WordPress / whitespace) |
| `packages/utils/src/boilerplate.spec.ts` | Unit tests for both stripping functions |
| `packages/utils/src/quality.ts` | `FILTER_REASONS` constants + `checkRedditQuality / checkHnQuality / checkUniversalQuality` |
| `packages/utils/src/quality.spec.ts` | Unit tests for the three quality check functions |
| `packages/db/scripts/migrate-sp4.ts` | One-shot backfill: Layer 1 normalize+rehash+collapse, Layer 2 quality-flag retroactive |
| `packages/db/scripts/migrate-sp4.spec.ts` | Integration test against real Postgres for the backfill script |
| `packages/db/prisma/migrations/<ts>_sp4_filter_reason/migration.sql` | `ALTER TABLE hot_news ADD COLUMN filter_reason TEXT NULL` |
| `packages/db/vitest.config.ts` | Minimal Vitest config so `pnpm --filter @ai-hot-news/db run test` works |
| `apps/api/src/hot-news/hot-news.service.spec.ts` | Unit test (mocked Prisma) verifying default `WHERE status='VISIBLE'` |

### Modified

| Path | What changes |
|---|---|
| `packages/utils/src/url.ts` | 6 new rules: http→https, host alias map (Reddit / Twitter), m./mobile. prefix strip, dedup query, empty `?` (test only) — see Task 1 for full code |
| `packages/utils/src/url.spec.ts` | Add ~10 new test cases covering the 6 rules |
| `packages/utils/src/index.ts` | Re-export `boilerplate` and `quality` modules |
| `packages/types/src/dtos.ts` | Add optional `filterReason?: string \| null` to `RawCrawledItem` (with JSDoc) |
| `packages/db/prisma/schema.prisma` | `HotNews` model: add `filterReason String?` after `status` |
| `packages/db/package.json` | Add `@ai-hot-news/utils: workspace:*` dep, `vitest` devDep, `migrate-sp4` + `test` scripts |
| `package.json` (root) | Add `db:migrate-sp4` script |
| `apps/worker/src/crawl/crawlers/reddit.crawler.ts` | `toRaw()` calls `checkRedditQuality(...)` and writes `raw.filterReason` |
| `apps/worker/src/crawl/crawlers/reddit.crawler.spec.ts` | Add 3 new test cases verifying filterReason behavior |
| `apps/worker/src/crawl/crawlers/hackernews.crawler.ts` | `toRaw()` calls `checkHnQuality(...)` and writes `raw.filterReason` |
| `apps/worker/src/crawl/crawlers/hackernews.crawler.spec.ts` | Add 3 new test cases |
| `apps/worker/src/crawl/ingestion.service.ts` | Title/content boilerplate strip + universal fallback + `status` + `filterReason` write + `IngestResult.hidden` |
| `apps/worker/src/crawl/ingestion.service.integration.spec.ts` | Update existing 6 tests to include `hidden: 0` in `IngestResult`; add 4 new HIDDEN-path tests |
| `apps/api/src/hot-news/hot-news.service.ts` | Add `where: { status: ContentStatus.VISIBLE }` to both `findMany` and `count` |

### Out-of-scope (explicit, don't sneak in)

- Topic relevance filtering (dimension 3) — deferred to SP-5 LLM-based aiTags
- ArticleExtractor for HN/Reddit link-post external URLs — deferred to SP-4.5 or SP-5 prerequisite
- rawHtml sanitization (DOMPurify) — deferred to SP-11 detail page
- `?includeHidden=true` API flag — YAGNI
- Per-source / per-subreddit threshold tuning — YAGNI, single global thresholds
- Cross-URL title similarity dedup — belongs in SP-7 (pgvector embedding cosine)
- Migrating filter_reason to an enum — current TEXT NULL is fine; if it ever needs query-side filtering, add an index later

---

## Conventions for every Task

- **Branch:** all work on `main` (single-developer project, matches SP-3 convention).
- **TDD:** write the failing test → run it (must fail with the stated reason) → minimal implementation → re-run (must pass) → commit. For purely structural tasks (config, migrations, env), the convention is "modify → run typecheck → commit".
- **Commit message style:** Conventional Commits, scoped (`feat(utils)`, `feat(worker)`, `feat(api)`, `chore(db)`, `chore(workspace)`, `docs`).
- **Run tests for an individual file:** `pnpm --filter <pkg> exec vitest run <relative path> --reporter=verbose`.
- **Run all tests across the monorepo:** `pnpm turbo run test`.
- **Lint/typecheck before each commit:** `pnpm turbo run lint typecheck` (scope to changed package for speed: `pnpm --filter <pkg> run lint typecheck`).
- **Never run `pnpm db:migrate:reset`** — wipes all data including the 1927 SP-3 backfill.
- **Integration tests** (`*.integration.spec.ts` and `migrate-sp4.spec.ts`) hit the local Postgres started by `pnpm docker:dev` — start it before running them locally.
- **Pure-function utilities first:** Task 1-4 (utils) ship completely standalone before any consumer (worker, api, backfill) imports them. Avoids the "implement consumer, find missing function in utils" rework.
- **Backfill script ordering rule:** the script must process rows in `orderBy: { publishedAt: 'asc' }`. This is the entire P2002 collapse strategy — keeping the earliest row when two rows normalize to the same canonical URL.

---

## Task 1: Upgrade `normalizeUrl()` with 6 new rules (TDD)

**Files:**
- Modify: `packages/utils/src/url.ts`
- Modify: `packages/utils/src/url.spec.ts`

- [ ] **Step 1: Append the new failing tests to `packages/utils/src/url.spec.ts`**

Append after the existing `it('returns the input unchanged when it is not a valid URL', ...)` block, inside the same `describe('normalizeUrl', ...)`:

```ts
  // === SP-4: 6 new rules ===

  it('folds http to https', () => {
    expect(normalizeUrl('http://example.com/post')).toBe('https://example.com/post');
  });

  it('preserves https unchanged for the protocol rule', () => {
    expect(normalizeUrl('https://example.com/post')).toBe('https://example.com/post');
  });

  it('maps Reddit legacy hosts (old/np/new) to www.reddit.com', () => {
    expect(normalizeUrl('https://old.reddit.com/r/OpenAI/comments/abc')).toBe(
      'https://www.reddit.com/r/OpenAI/comments/abc',
    );
    expect(normalizeUrl('https://np.reddit.com/r/OpenAI/comments/abc')).toBe(
      'https://www.reddit.com/r/OpenAI/comments/abc',
    );
    expect(normalizeUrl('https://new.reddit.com/r/OpenAI/comments/abc')).toBe(
      'https://www.reddit.com/r/OpenAI/comments/abc',
    );
  });

  it('maps Twitter / mobile.twitter.com / m.x.com to x.com', () => {
    expect(normalizeUrl('https://twitter.com/user/status/123')).toBe(
      'https://x.com/user/status/123',
    );
    expect(normalizeUrl('https://mobile.twitter.com/user/status/123')).toBe(
      'https://x.com/user/status/123',
    );
    expect(normalizeUrl('https://m.x.com/user/status/123')).toBe('https://x.com/user/status/123');
  });

  it('strips m. / mobile. prefix when no host alias matches', () => {
    expect(normalizeUrl('https://m.example.com/post')).toBe('https://example.com/post');
    expect(normalizeUrl('https://mobile.bbc.co.uk/news/123')).toBe('https://bbc.co.uk/news/123');
  });

  it('does NOT strip the m. prefix for hosts already in the alias map', () => {
    // m.x.com → alias map kicks in first → x.com (not "x.com" via prefix strip on "m.x.com")
    expect(normalizeUrl('https://m.x.com/a')).toBe('https://x.com/a');
  });

  it('keeps www unchanged (we do not unify www subdomains)', () => {
    expect(normalizeUrl('https://www.openai.com/blog/x')).toBe('https://www.openai.com/blog/x');
    expect(normalizeUrl('https://en.wikipedia.org/wiki/AI')).toBe(
      'https://en.wikipedia.org/wiki/AI',
    );
  });

  it('deduplicates repeated query parameters (last value wins)', () => {
    expect(normalizeUrl('https://example.com/?a=1&a=2&b=3')).toBe(
      'https://example.com/?a=2&b=3',
    );
  });

  it('drops a trailing empty query string', () => {
    expect(normalizeUrl('https://example.com/post?')).toBe('https://example.com/post');
  });

  it('drops the query string when only tracking params remain', () => {
    expect(normalizeUrl('https://example.com/post?utm_source=x')).toBe(
      'https://example.com/post',
    );
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @ai-hot-news/utils exec vitest run src/url.spec.ts --reporter=verbose`

Expected: ~10 of the new tests FAIL (the existing 8 still pass). Sample failure: `Expected 'https://example.com/post' but received 'http://example.com/post'`.

- [ ] **Step 3: Replace the body of `packages/utils/src/url.ts` with the upgraded implementation**

```ts
const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
]);

const TRACKING_PREFIXES = ['utm_'];

// SP-4: exact-host alias map (applied before prefix-strip below)
const HOST_ALIASES: Record<string, string> = {
  'old.reddit.com': 'www.reddit.com',
  'np.reddit.com': 'www.reddit.com',
  'new.reddit.com': 'www.reddit.com',
  'twitter.com': 'x.com',
  'mobile.twitter.com': 'x.com',
  'm.x.com': 'x.com',
};

// SP-4: mobile-prefix strip (after lower-case + after alias map miss)
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

  // SP-4 Rule 1: http → https
  if (parsed.protocol === 'http:') {
    parsed.protocol = 'https:';
  }

  // SP-1 (existing): host lower-case
  parsed.hostname = parsed.hostname.toLowerCase();

  // SP-4 Rule 2: exact host alias map (Reddit / Twitter)
  if (HOST_ALIASES[parsed.hostname]) {
    parsed.hostname = HOST_ALIASES[parsed.hostname];
  } else {
    // SP-4 Rule 3: mobile/m. prefix strip (only when no alias matched)
    for (const prefix of MOBILE_PREFIXES) {
      if (parsed.hostname.startsWith(prefix)) {
        parsed.hostname = parsed.hostname.slice(prefix.length);
        break;
      }
    }
  }

  // SP-1 (existing): drop fragment
  parsed.hash = '';

  // SP-4 Rule 4 + SP-1 (existing): strip tracking + dedup repeated keys + sort
  // Map auto-dedups (last value wins for repeated keys)
  const seen = new Map<string, string>();
  for (const [key, value] of parsed.searchParams.entries()) {
    if (isTrackingParam(key)) continue;
    seen.set(key, value);
  }
  parsed.search = '';
  const sortedKeys = Array.from(seen.keys()).sort();
  for (const k of sortedKeys) {
    parsed.searchParams.append(k, seen.get(k)!);
  }
  // SP-4 Rule 5: empty `?` is auto-dropped by URL.toString() when search is empty
  // (WHATWG URL standard) — covered by tests, no explicit code needed.

  // SP-1 (existing): strip trailing slash on non-root path
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }

  return parsed.toString();
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @ai-hot-news/utils exec vitest run src/url.spec.ts --reporter=verbose`

Expected: all ~18 tests PASS (8 existing + 10 new).

- [ ] **Step 5: Run lint + typecheck for the utils package**

Run: `pnpm --filter @ai-hot-news/utils run lint typecheck`

Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add packages/utils/src/url.ts packages/utils/src/url.spec.ts
git commit -m "feat(utils): upgrade normalizeUrl with 6 SP-4 rules (http→https, host aliases, mobile strip, dedup query)"
```

---

## Task 2: Add `boilerplate.ts` (TDD)

**Files:**
- Create: `packages/utils/src/boilerplate.ts`
- Create: `packages/utils/src/boilerplate.spec.ts`

- [ ] **Step 1: Write the failing tests in `packages/utils/src/boilerplate.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { stripTitleBoilerplate, stripContentBoilerplate } from './boilerplate';

describe('stripTitleBoilerplate', () => {
  it('strips " - <whitelisted site>" suffix', () => {
    expect(stripTitleBoilerplate('GPT-5 announced - OpenAI Blog')).toBe('GPT-5 announced');
  });

  it('strips " | <whitelisted site>" suffix', () => {
    expect(stripTitleBoilerplate('AI news | TechCrunch')).toBe('AI news');
  });

  it('strips " — <whitelisted site>" suffix (em-dash)', () => {
    expect(stripTitleBoilerplate('Claude 4 — Anthropic')).toBe('Claude 4');
  });

  it('strips " – <whitelisted site>" suffix (en-dash)', () => {
    expect(stripTitleBoilerplate('Gemini update – Google AI Blog')).toBe('Gemini update');
  });

  it('does NOT strip when the suffix is not in the whitelist', () => {
    expect(stripTitleBoilerplate('GPT-5 - The Next Generation')).toBe(
      'GPT-5 - The Next Generation',
    );
  });

  it('does NOT strip a separator that appears in the middle (only matches the tail)', () => {
    expect(stripTitleBoilerplate('Article - about - something')).toBe(
      'Article - about - something',
    );
  });

  it('returns the title trimmed when no boilerplate matches', () => {
    expect(stripTitleBoilerplate('  Trim test  ')).toBe('Trim test');
  });

  it('returns the empty string for an empty input', () => {
    expect(stripTitleBoilerplate('')).toBe('');
  });

  it('handles a title that IS the site name without a separator', () => {
    expect(stripTitleBoilerplate('OpenAI Blog')).toBe('OpenAI Blog');
  });

  it('strips OpenAI / Anthropic / Hugging Face / The Verge / YouTube / X', () => {
    expect(stripTitleBoilerplate('Sora demo - OpenAI')).toBe('Sora demo');
    expect(stripTitleBoilerplate('Constitutional AI - Anthropic')).toBe('Constitutional AI');
    expect(stripTitleBoilerplate('Llama-4 weights - Hugging Face')).toBe('Llama-4 weights');
    expect(stripTitleBoilerplate('AI scoop - The Verge')).toBe('AI scoop');
    expect(stripTitleBoilerplate('Demo video - YouTube')).toBe('Demo video');
    expect(stripTitleBoilerplate('Hot take - X')).toBe('Hot take');
  });
});

describe('stripContentBoilerplate', () => {
  it('strips a "Read more →" tail', () => {
    expect(stripContentBoilerplate('Body content here.\n\nRead more →')).toBe(
      'Body content here.',
    );
  });

  it('strips a "Continue reading" tail', () => {
    expect(stripContentBoilerplate('Body content here. Continue reading')).toBe(
      'Body content here.',
    );
  });

  it('strips "This article was first published at <site>"', () => {
    expect(
      stripContentBoilerplate(
        'Body content here. This article was first published at TechCrunch',
      ),
    ).toBe('Body content here.');
  });

  it('strips WordPress "The post X appeared first on Y"', () => {
    expect(
      stripContentBoilerplate(
        'Real content. The post My Title appeared first on Some Blog',
      ),
    ).toBe('Real content.');
  });

  it('collapses runs of spaces / tabs into a single space', () => {
    expect(stripContentBoilerplate('a    b\t\tc')).toBe('a b c');
  });

  it('collapses 3+ consecutive newlines into 2', () => {
    expect(stripContentBoilerplate('para1\n\n\n\npara2')).toBe('para1\n\npara2');
  });

  it('preserves a normal 2-newline paragraph break', () => {
    expect(stripContentBoilerplate('para1\n\npara2')).toBe('para1\n\npara2');
  });

  it('returns the empty string for empty input', () => {
    expect(stripContentBoilerplate('')).toBe('');
  });

  it('trims surrounding whitespace', () => {
    expect(stripContentBoilerplate('  hello  ')).toBe('hello');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @ai-hot-news/utils exec vitest run src/boilerplate.spec.ts --reporter=verbose`

Expected: all tests FAIL with `Failed to resolve import './boilerplate'` (the file doesn't exist yet).

- [ ] **Step 3: Create `packages/utils/src/boilerplate.ts` with the implementation**

```ts
const SITE_NAME_WHITELIST = new Set([
  // AI labs / vendors
  'OpenAI Blog',
  'OpenAI',
  'Anthropic',
  'Google AI Blog',
  'Google DeepMind',
  'Hugging Face',
  // Tech press
  'TechCrunch',
  'The Verge',
  'Wired',
  'Ars Technica',
  // Social / video
  'YouTube',
  'Twitter',
  'X',
]);

// Tail separator: " - X" / " | X" / " — X" (em-dash) / " – X" (en-dash)
// Match only at the END of the string, capture the trailing site name candidate.
const TITLE_SUFFIX_PATTERN = /\s+[\-\|—–]\s+([^\-\|—–]+)\s*$/;

export function stripTitleBoilerplate(title: string): string {
  if (!title) return title;
  const trimmed = title.trim();
  const match = trimmed.match(TITLE_SUFFIX_PATTERN);
  if (!match || match.index === undefined) return trimmed;
  const candidate = match[1].trim();
  if (SITE_NAME_WHITELIST.has(candidate)) {
    return trimmed.slice(0, match.index).trim();
  }
  return trimmed;
}

const CONTENT_TAIL_PATTERNS: RegExp[] = [
  /\s*Read\s+more\s*[→\-»]?\s*$/i,
  /\s*Continue\s+reading\s*[→\-»]?\.?\s*$/i,
  /\s*This\s+article\s+was\s+first\s+published\s+(at|on)\s+[^\n]+$/i,
  // WordPress feeds: "The post <Title> appeared first on <Site>"
  /\s*The\s+post\s+.+?\s+appeared\s+first\s+on\s+[^\n]+$/i,
];

const HORIZONTAL_WHITESPACE_RUN = /[ \t]+/g;
const NEWLINE_RUN_3_OR_MORE = /\n{3,}/g;

export function stripContentBoilerplate(text: string): string {
  if (!text) return text;
  let result = text;
  for (const pattern of CONTENT_TAIL_PATTERNS) {
    result = result.replace(pattern, '');
  }
  result = result.replace(HORIZONTAL_WHITESPACE_RUN, ' ');
  result = result.replace(NEWLINE_RUN_3_OR_MORE, '\n\n');
  return result.trim();
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @ai-hot-news/utils exec vitest run src/boilerplate.spec.ts --reporter=verbose`

Expected: all 19 tests PASS.

- [ ] **Step 5: Run lint + typecheck**

Run: `pnpm --filter @ai-hot-news/utils run lint typecheck`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/utils/src/boilerplate.ts packages/utils/src/boilerplate.spec.ts
git commit -m "feat(utils): add stripTitleBoilerplate + stripContentBoilerplate"
```

---

## Task 3: Add `quality.ts` (TDD)

**Files:**
- Create: `packages/utils/src/quality.ts`
- Create: `packages/utils/src/quality.spec.ts`

- [ ] **Step 1: Write the failing tests in `packages/utils/src/quality.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  FILTER_REASONS,
  checkRedditQuality,
  checkHnQuality,
  checkUniversalQuality,
} from './quality';

describe('FILTER_REASONS constants', () => {
  it('exposes the 4 known reason strings', () => {
    expect(FILTER_REASONS.REDDIT_LOW_RATIO).toBe('reddit_low_ratio');
    expect(FILTER_REASONS.REDDIT_LOW_ENGAGEMENT).toBe('reddit_low_engagement');
    expect(FILTER_REASONS.HN_LOW_ENGAGEMENT).toBe('hn_low_engagement');
    expect(FILTER_REASONS.TITLE_TOO_SHORT).toBe('title_too_short');
  });
});

describe('checkRedditQuality', () => {
  it('returns REDDIT_LOW_RATIO when upvote_ratio < 0.5', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.4, score: 100, num_comments: 50 }),
    ).toBe('reddit_low_ratio');
  });

  it('returns null when upvote_ratio is null (cold post < 3 votes)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: null, score: 100, num_comments: 50 }),
    ).toBeNull();
  });

  it('returns REDDIT_LOW_ENGAGEMENT when score<5 AND num_comments<2', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.95, score: 3, num_comments: 0 }),
    ).toBe('reddit_low_engagement');
  });

  it('returns null when score<5 BUT num_comments>=2 (high engagement saves it)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.95, score: 3, num_comments: 5 }),
    ).toBeNull();
  });

  it('returns null when score>=5 (above engagement threshold)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.95, score: 100, num_comments: 0 }),
    ).toBeNull();
  });

  it('checks ratio before engagement (low ratio + low engagement → ratio reason)', () => {
    expect(
      checkRedditQuality({ upvote_ratio: 0.3, score: 1, num_comments: 0 }),
    ).toBe('reddit_low_ratio');
  });
});

describe('checkHnQuality', () => {
  it('returns HN_LOW_ENGAGEMENT when score<5 AND descendants<2', () => {
    expect(checkHnQuality({ score: 3, descendants: 0 })).toBe('hn_low_engagement');
  });

  it('returns null when score>=5', () => {
    expect(checkHnQuality({ score: 10, descendants: 0 })).toBeNull();
  });

  it('returns null when descendants>=2 (high engagement saves it)', () => {
    expect(checkHnQuality({ score: 3, descendants: 5 })).toBeNull();
  });

  it('treats null score / descendants as 0 (returns HN_LOW_ENGAGEMENT)', () => {
    expect(checkHnQuality({ score: null, descendants: null })).toBe('hn_low_engagement');
  });
});

describe('checkUniversalQuality', () => {
  it('returns TITLE_TOO_SHORT when title is empty', () => {
    expect(checkUniversalQuality({ title: '' })).toBe('title_too_short');
  });

  it('returns TITLE_TOO_SHORT when trimmed title length < 5', () => {
    expect(checkUniversalQuality({ title: 'abc' })).toBe('title_too_short');
    expect(checkUniversalQuality({ title: '   ' })).toBe('title_too_short');
  });

  it('returns null when trimmed title length >= 5', () => {
    expect(checkUniversalQuality({ title: 'hello world' })).toBeNull();
    expect(checkUniversalQuality({ title: 'GPT-5' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @ai-hot-news/utils exec vitest run src/quality.spec.ts --reporter=verbose`

Expected: all tests FAIL with `Failed to resolve import './quality'`.

- [ ] **Step 3: Create `packages/utils/src/quality.ts`**

```ts
export const FILTER_REASONS = {
  REDDIT_LOW_RATIO: 'reddit_low_ratio',
  REDDIT_LOW_ENGAGEMENT: 'reddit_low_engagement',
  HN_LOW_ENGAGEMENT: 'hn_low_engagement',
  TITLE_TOO_SHORT: 'title_too_short',
} as const;
export type FilterReason = (typeof FILTER_REASONS)[keyof typeof FILTER_REASONS];

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
  // upvote_ratio is null for cold posts (<3 votes); skip the ratio rule in that case.
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

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @ai-hot-news/utils exec vitest run src/quality.spec.ts --reporter=verbose`

Expected: all 14 tests PASS.

- [ ] **Step 5: Run lint + typecheck**

Run: `pnpm --filter @ai-hot-news/utils run lint typecheck`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/utils/src/quality.ts packages/utils/src/quality.spec.ts
git commit -m "feat(utils): add quality check functions (Reddit/HN/universal)"
```

---

## Task 4: Re-export new modules from `@ai-hot-news/utils` index

**Files:**
- Modify: `packages/utils/src/index.ts`

- [ ] **Step 1: Read the current index to see existing exports**

Run: `cat packages/utils/src/index.ts` — confirm it currently re-exports `dedupe`, `strip-html`, `url`.

- [ ] **Step 2: Append the new re-exports**

Open `packages/utils/src/index.ts` and append at the end:

```ts
export * from './boilerplate.js';
export * from './quality.js';
```

(Use `.js` extension to match the existing `.js` extension on the existing exports — this is the ESM resolution convention used in this repo.)

- [ ] **Step 3: Run typecheck + tests for the package**

Run: `pnpm --filter @ai-hot-news/utils run typecheck test`

Expected: typecheck passes; all utils tests still green (the existing dedupe/url/strip-html plus the 19+14 new ones from Tasks 2-3).

- [ ] **Step 4: Verify the new exports are reachable from a downstream package**

Run: `pnpm --filter @ai-hot-news/worker exec tsc --noEmit -p tsconfig.json`

Expected: exit 0 (worker can still compile — we haven't imported the new functions there yet, but the workspace symlink resolves correctly).

- [ ] **Step 5: Commit**

```bash
git add packages/utils/src/index.ts
git commit -m "feat(utils): re-export boilerplate and quality from index"
```

---

## Task 5: Add `filterReason` to `RawCrawledItem` (types package)

**Files:**
- Modify: `packages/types/src/dtos.ts`

- [ ] **Step 1: Add the optional field with JSDoc to `RawCrawledItem`**

Open `packages/types/src/dtos.ts` and modify the `RawCrawledItem` interface — append the new field after `interactionData?`:

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
  /**
   * SP-4: Quality / boilerplate filter verdict. When set, IngestionService writes
   * `HotNews.status='HIDDEN'` and persists this string to `HotNews.filterReason`.
   *
   * Set by the platform-specific crawler in `toRaw()` via `checkRedditQuality` /
   * `checkHnQuality` from `@ai-hot-news/utils`. RSS crawler leaves it `undefined`
   * and IngestionService runs `checkUniversalQuality` as a fallback.
   *
   * Known values (extend `FILTER_REASONS` in `quality.ts` to add more):
   *   `reddit_low_ratio` | `reddit_low_engagement` | `hn_low_engagement` | `title_too_short`
   */
  filterReason?: string | null;
}
```

- [ ] **Step 2: Run typecheck for the types package**

Run: `pnpm --filter @ai-hot-news/types run typecheck`

Expected: exit 0.

- [ ] **Step 3: Run typecheck for downstream packages (worker + api)**

Run: `pnpm --filter @ai-hot-news/worker run typecheck && pnpm --filter @ai-hot-news/api run typecheck`

Expected: exit 0 (the new field is optional, so existing code still compiles).

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/dtos.ts
git commit -m "feat(types): add optional filterReason to RawCrawledItem (SP-4)"
```

---

## Task 6: Add `filterReason` column to `HotNews` schema + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_sp4_filter_reason/migration.sql` (auto-generated by prisma)

- [ ] **Step 1: Edit `packages/db/prisma/schema.prisma`**

Find the `HotNews` model and add `filterReason` immediately after the `status` field:

```prisma
model HotNews {
  id              String        @id @default(cuid())
  title           String
  summary         String?
  content         String        @db.Text
  rawHtml         String?       @db.Text
  sourcePlatform  Platform
  sourceUrl       String        @unique
  author          String?
  publishedAt     DateTime
  crawledAt       DateTime      @default(now())

  aiTags          String[]      @default([])
  matchedKeywords String[]      @default([])
  heatScore       Float         @default(0)
  heatLevel       HeatLevel     @default(LOW)
  embedding       Unsupported("vector(1536)")?

  dedupeHash      String        @unique
  groupId         String?

  status          ContentStatus @default(VISIBLE)
  filterReason    String?       // SP-4: when status=HIDDEN, names which rule fired (e.g. 'reddit_low_ratio')
  interactionData Json?

  hits            KeywordHit[]

  @@index([publishedAt(sort: Desc)])
  @@index([heatScore(sort: Desc)])
  @@index([groupId])
  @@index([sourcePlatform, publishedAt])
  @@map("hot_news")
}
```

- [ ] **Step 2: Generate the migration**

Make sure local Postgres is up: `pnpm docker:dev` (no-op if already running).

Run: `pnpm --filter @ai-hot-news/db exec prisma migrate dev --name sp4_filter_reason`

Expected output: prisma reports `Applied migration sp4_filter_reason`. A new file `packages/db/prisma/migrations/<timestamp>_sp4_filter_reason/migration.sql` is created with content roughly:

```sql
-- AlterTable
ALTER TABLE "hot_news" ADD COLUMN "filterReason" TEXT;
```

(Note: Prisma uses **camelCase column names by default** — same convention as the existing `"rawHtml"`, `"dedupeHash"`, `"interactionData"` columns in the init migration. If you ever need to query the column directly in psql, you must quote it: `"filterReason"`.)

- [ ] **Step 3: Verify the column exists in the local DB**

Run: `docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c "\d hot_news" | grep -i filter`

Expected: a line like `filterReason | text | | |` (column exists, nullable, camelCase).

- [ ] **Step 4: Run typecheck for the db package**

Run: `pnpm --filter @ai-hot-news/db run typecheck`

Expected: exit 0 (Prisma client is regenerated automatically by `migrate dev`).

- [ ] **Step 5: Verify downstream typecheck still passes**

Run: `pnpm turbo run typecheck`

Expected: all packages green. (api / worker code that does `prisma.hotNews.create({ data: { ... } })` without `filterReason` still compiles because `filterReason String?` is optional.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "chore(db): add HotNews.filterReason column (SP-4 migration)"
```

---

## Task 7: Wire `@ai-hot-news/utils` + Vitest into `@ai-hot-news/db`

**Files:**
- Modify: `packages/db/package.json`
- Create: `packages/db/vitest.config.ts`
- Create: `packages/db/scripts/.gitkeep` (empty placeholder so the directory exists for Tasks 12-13)

- [ ] **Step 1: Edit `packages/db/package.json`**

Update the file to:

```json
{
  "name": "@ai-hot-news/db",
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
    "db:generate": "prisma generate",
    "db:migrate:dev": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:studio": "prisma studio",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "migrate-sp4": "tsx scripts/migrate-sp4.ts",
    "build": "prisma generate && esbuild src/index.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/index.js --external:@prisma/client --external:./generated && mkdir -p dist/generated && cp -R src/generated/. dist/generated/"
  },
  "prisma": { "seed": "tsx prisma/seed.ts" },
  "dependencies": {
    "@ai-hot-news/utils": "workspace:*",
    "@prisma/client": "^6.1.0",
    "prisma": "^6.1.0",
    "tsx": "^4.19.2"
  },
  "devDependencies": {
    "esbuild": "^0.28.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

(Diff vs prior: added `@ai-hot-news/utils` dependency, `vitest` devDep, `test` and `migrate-sp4` scripts. Other entries unchanged.)

- [ ] **Step 2: Create a minimal `packages/db/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    passWithNoTests: true,
  },
});
```

(`passWithNoTests: true` lets `pnpm --filter @ai-hot-news/db run test` succeed before Task 12 creates the first `*.spec.ts`.)

- [ ] **Step 3: Create the empty scripts directory marker**

```bash
mkdir -p packages/db/scripts
touch packages/db/scripts/.gitkeep
```

- [ ] **Step 4: Install (links the new workspace dep)**

Run: `pnpm install`

Expected: pnpm reports `+ @ai-hot-news/utils` linked into `@ai-hot-news/db`, plus `vitest` installed.

- [ ] **Step 5: Verify `pnpm test` works in db package (no tests yet — `passWithNoTests` makes it green)**

Run: `pnpm --filter @ai-hot-news/db run test`

Expected: vitest reports `No test files found, exiting with code 0` and the process exits 0. Task 12 will add the first actual `*.spec.ts`.

- [ ] **Step 6: Verify typecheck still passes**

Run: `pnpm --filter @ai-hot-news/db run typecheck`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/db/package.json packages/db/vitest.config.ts packages/db/scripts/.gitkeep pnpm-lock.yaml
git commit -m "chore(db): add @ai-hot-news/utils dep + vitest devDep + migrate-sp4 script slot"
```

---

## Task 8: `RedditCrawler.toRaw()` writes `filterReason` (TDD)

**Files:**
- Modify: `apps/worker/src/crawl/crawlers/reddit.crawler.ts`
- Modify: `apps/worker/src/crawl/crawlers/reddit.crawler.spec.ts`

- [ ] **Step 1: Append failing tests to `reddit.crawler.spec.ts`**

Append at the END of the existing top-level `describe('RedditCrawler', () => { ... })` block (just before the closing `})`) — find a place where there's already a fixture-mocking pattern in use:

```ts
  // === SP-4: filterReason on toRaw ===

  it('SP-4: writes filterReason="reddit_low_ratio" when upvote_ratio < 0.5', async () => {
    const lowRatioPost = {
      kind: 'Listing',
      data: {
        after: null,
        before: null,
        children: [
          {
            kind: 't3',
            data: {
              id: 'abc',
              title: 'Some title',
              author: 'alice',
              subreddit: 'OpenAI',
              url: 'https://example.com/a',
              permalink: '/r/OpenAI/comments/abc',
              is_self: false,
              selftext: '',
              selftext_html: null,
              created_utc: 1746230400,
              score: 100,
              ups: 100,
              downs: 0,
              num_comments: 50,
              upvote_ratio: 0.4,
              stickied: false,
              over_18: false,
            },
          },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(lowRatioPost), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const crawler = new RedditCrawler(
      { id: 's1', url: null, identifier: 'OpenAI' },
      'ai-hot-news-bot/0.1 (by /u/test)',
    );
    const items = await crawler.fetch();

    expect(items).toHaveLength(1);
    expect(items[0]!.filterReason).toBe('reddit_low_ratio');
  });

  it('SP-4: writes filterReason=null for high-quality post (ratio>=0.5, score>=5)', async () => {
    const goodPost = {
      kind: 'Listing',
      data: {
        after: null,
        before: null,
        children: [
          {
            kind: 't3',
            data: {
              id: 'def',
              title: 'High quality',
              author: 'bob',
              subreddit: 'OpenAI',
              url: 'https://example.com/b',
              permalink: '/r/OpenAI/comments/def',
              is_self: false,
              selftext: '',
              selftext_html: null,
              created_utc: 1746230500,
              score: 200,
              ups: 200,
              downs: 0,
              num_comments: 30,
              upvote_ratio: 0.95,
              stickied: false,
              over_18: false,
            },
          },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(goodPost), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const crawler = new RedditCrawler(
      { id: 's2', url: null, identifier: 'OpenAI' },
      'ai-hot-news-bot/0.1 (by /u/test)',
    );
    const items = await crawler.fetch();

    expect(items).toHaveLength(1);
    expect(items[0]!.filterReason).toBeNull();
  });

  it('SP-4: writes filterReason="reddit_low_engagement" for cold post (score<5, comments<2)', async () => {
    const coldPost = {
      kind: 'Listing',
      data: {
        after: null,
        before: null,
        children: [
          {
            kind: 't3',
            data: {
              id: 'ghi',
              title: 'Cold post',
              author: 'carol',
              subreddit: 'OpenAI',
              url: 'https://example.com/c',
              permalink: '/r/OpenAI/comments/ghi',
              is_self: false,
              selftext: '',
              selftext_html: null,
              created_utc: 1746230600,
              score: 2,
              ups: 2,
              downs: 0,
              num_comments: 0,
              upvote_ratio: null,
              stickied: false,
              over_18: false,
            },
          },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(coldPost), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const crawler = new RedditCrawler(
      { id: 's3', url: null, identifier: 'OpenAI' },
      'ai-hot-news-bot/0.1 (by /u/test)',
    );
    const items = await crawler.fetch();

    expect(items).toHaveLength(1);
    expect(items[0]!.filterReason).toBe('reddit_low_engagement');
  });
```

(If the existing `reddit.crawler.spec.ts` already has a top-of-file `import { RedditCrawler } from './reddit.crawler';` and a `vi.unstubAllGlobals()` in afterEach, those are reused as-is.)

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawlers/reddit.crawler.spec.ts --reporter=verbose`

Expected: 3 new tests FAIL with `Expected 'reddit_low_ratio' but received undefined` (the field isn't being set yet). Existing tests still pass.

- [ ] **Step 3: Edit `reddit.crawler.ts` to import quality + populate filterReason**

Open `apps/worker/src/crawl/crawlers/reddit.crawler.ts`. Find the existing import line `import { stripHtml } from '@ai-hot-news/utils';` and change it to:

```ts
import { stripHtml, checkRedditQuality } from '@ai-hot-news/utils';
```

Then find the `toRaw()` private method and modify it to compute and include `filterReason`:

```ts
  private toRaw(p: RedditPost, subredditHint: string | null): RawCrawledItem {
    const isSelfPost = !!p.is_self;
    const selftextHtml = (p.selftext_html ?? '').trim();
    const subreddit = subredditHint ?? p.subreddit ?? 'unknown';

    // SP-4: dimension-2 quality verdict
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
      filterReason,
    };
  }
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawlers/reddit.crawler.spec.ts --reporter=verbose`

Expected: all tests PASS (existing + 3 new).

- [ ] **Step 5: Run lint + typecheck for the worker**

Run: `pnpm --filter @ai-hot-news/worker run lint typecheck`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/crawl/crawlers/reddit.crawler.ts apps/worker/src/crawl/crawlers/reddit.crawler.spec.ts
git commit -m "feat(worker): RedditCrawler writes filterReason via checkRedditQuality"
```

---

## Task 9: `HackerNewsCrawler.toRaw()` writes `filterReason` (TDD)

**Files:**
- Modify: `apps/worker/src/crawl/crawlers/hackernews.crawler.ts`
- Modify: `apps/worker/src/crawl/crawlers/hackernews.crawler.spec.ts`

- [ ] **Step 1: Inspect the existing `toRaw` to know where to plug in**

Run: `cat apps/worker/src/crawl/crawlers/hackernews.crawler.ts` — find the private `toRaw(item: HnItem): RawCrawledItem` method and the existing import block. (You'll modify the import + that method only.)

- [ ] **Step 2: Append failing tests to `hackernews.crawler.spec.ts`**

Append inside the top-level `describe('HackerNewsCrawler', () => { ... })`:

```ts
  // === SP-4: filterReason on toRaw ===

  it('SP-4: writes filterReason="hn_low_engagement" for low score + low comments', async () => {
    // Build a minimal Firebase API mock: 1 top story id → 1 cold item.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/topstories.json')) {
          return Promise.resolve(
            new Response(JSON.stringify([99999]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        if (url.includes('/item/99999')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 99999,
                title: 'Cold HN post',
                by: 'alice',
                time: 1746230400,
                score: 2,
                descendants: 0,
                url: 'https://example.com/x',
                type: 'story',
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    const crawler = new HackerNewsCrawler({ id: 'hn-top', identifier: 'top' });
    const items = await crawler.fetch();

    expect(items).toHaveLength(1);
    expect(items[0]!.filterReason).toBe('hn_low_engagement');
  });

  it('SP-4: writes filterReason=null for high-engagement HN post', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/topstories.json')) {
          return Promise.resolve(
            new Response(JSON.stringify([99998]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        if (url.includes('/item/99998')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 99998,
                title: 'Hot HN post',
                by: 'bob',
                time: 1746230500,
                score: 234,
                descendants: 56,
                url: 'https://openai.com/news',
                type: 'story',
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    const crawler = new HackerNewsCrawler({ id: 'hn-top', identifier: 'top' });
    const items = await crawler.fetch();

    expect(items).toHaveLength(1);
    expect(items[0]!.filterReason).toBeNull();
  });

  it('SP-4: treats null score / descendants as low engagement', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/topstories.json')) {
          return Promise.resolve(
            new Response(JSON.stringify([99997]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        if (url.includes('/item/99997')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 99997,
                title: 'No engagement data',
                by: 'carol',
                time: 1746230600,
                // score / descendants intentionally omitted
                type: 'story',
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    const crawler = new HackerNewsCrawler({ id: 'hn-top', identifier: 'top' });
    const items = await crawler.fetch();

    expect(items).toHaveLength(1);
    expect(items[0]!.filterReason).toBe('hn_low_engagement');
  });
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawlers/hackernews.crawler.spec.ts --reporter=verbose`

Expected: 3 new tests FAIL.

- [ ] **Step 4: Edit `hackernews.crawler.ts`**

Add `checkHnQuality` to the existing `@ai-hot-news/utils` import. If there's no existing `@ai-hot-news/utils` import, add:

```ts
import { checkHnQuality } from '@ai-hot-news/utils';
```

Find the `toRaw(item: HnItem): RawCrawledItem` method and modify it so the returned object includes `filterReason`:

```ts
  private toRaw(item: HnItem): RawCrawledItem {
    const filterReason = checkHnQuality({
      score: item.score ?? null,
      descendants: item.descendants ?? null,
    });

    return {
      // ... existing fields unchanged ...
      filterReason,
    };
  }
```

(Preserve all existing field assignments — only add the `const filterReason = ...` and the `filterReason,` line in the returned object literal.)

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/crawlers/hackernews.crawler.spec.ts --reporter=verbose`

Expected: all tests PASS.

- [ ] **Step 6: Run worker lint + typecheck**

Run: `pnpm --filter @ai-hot-news/worker run lint typecheck`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/crawl/crawlers/hackernews.crawler.ts apps/worker/src/crawl/crawlers/hackernews.crawler.spec.ts
git commit -m "feat(worker): HackerNewsCrawler writes filterReason via checkHnQuality"
```

---

## Task 10: `IngestionService` cleans + writes `status` / `filterReason` (TDD via integration spec)

**Files:**
- Modify: `apps/worker/src/crawl/ingestion.service.ts`
- Modify: `apps/worker/src/crawl/ingestion.service.integration.spec.ts`

- [ ] **Step 1: Update existing integration test assertions to include `hidden: 0` in `IngestResult`**

Open `apps/worker/src/crawl/ingestion.service.integration.spec.ts`. There are existing `expect(result).toEqual({ fetched: X, inserted: Y, skipped: Z, failed: W })` lines that will break once `IngestResult` gains a `hidden` field. Update each one:

Find every occurrence of `expect(result).toEqual({` (and `expect(result2).toEqual({`) and add `hidden: 0,` between `skipped` and `failed`. The 4 cases that need updating are:

```ts
// Test "inserts new items and dedupes repeated ingests" — both first and second:
expect(first.fetched).toBe(12);
expect(first.inserted).toBe(12);
expect(first.failed).toBe(0);  // (no need to add hidden here — uses individual property assertions)

// Same for "second":
expect(second.fetched).toBe(12);
expect(second.inserted).toBe(0);
expect(second.skipped).toBe(12);

// Test "skips items missing sourceUrl":
expect(result.fetched).toBe(2);
expect(result.inserted).toBe(1);
expect(result.skipped).toBe(1);
expect(result.failed).toBe(0);

// HN test "inserts HN items with sourcePlatform=HACKERNEWS and interactionData":
expect(result).toEqual({ fetched: 1, inserted: 1, skipped: 0, hidden: 0, failed: 0 });

// HN test "does NOT overwrite interactionData on duplicate sourceUrl":
expect(result2).toEqual({ fetched: 1, inserted: 0, skipped: 1, hidden: 0, failed: 0 });

// (Test "handles items missing interactionData (omitted, not null)" doesn't assert on result, leave alone.)

// Reddit test "inserts a REDDIT item with full interactionData (6 fields)":
expect(result).toEqual({ fetched: 1, inserted: 1, skipped: 0, hidden: 0, failed: 0 });

// Reddit test "does NOT overwrite interactionData on duplicate sourceUrl (first-write-wins)":
expect(result2).toEqual({ fetched: 1, inserted: 0, skipped: 1, hidden: 0, failed: 0 });
```

(Apply only the `toEqual` updates — the property-by-property assertions in the first two tests don't need changes.)

- [ ] **Step 2: Append SP-4 specific tests to the same file**

Append a new `describe('SP-4 quality + cleaning', ...)` block at the end of the file, before the closing `})` of the outer `describe('IngestionService (integration)', ...)`:

```ts
  describe('SP-4 quality + cleaning', () => {
    it('honors raw.filterReason from crawler → status=HIDDEN + filterReason persisted', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'Low ratio reddit post',
          contentText: 'Body',
          rawHtml: null,
          sourceUrl: `${REDDIT_URL_PREFIX}OpenAI/comments/sp4_lowratio`,
          author: 'alice',
          publishedAt: new Date('2026-05-04T00:00:00Z'),
          interactionData: {
            score: 100,
            comments: 50,
            externalUrl: null,
            redditId: 'sp4_lowratio',
            redditSubreddit: 'OpenAI',
            redditUpvoteRatio: 0.4,
          },
          filterReason: 'reddit_low_ratio',
        },
      ];

      const result = await ingestion.ingest(items, REDDIT_SOURCE);
      expect(result).toEqual({ fetched: 1, inserted: 0, skipped: 0, hidden: 1, failed: 0 });

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: `${REDDIT_URL_PREFIX}OpenAI/comments/sp4_lowratio` },
      });
      expect(row.status).toBe('HIDDEN');
      expect(row.filterReason).toBe('reddit_low_ratio');
    });

    it('falls back to checkUniversalQuality when crawler did not set filterReason (short title)', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'abc',  // shorter than TITLE_MIN_LENGTH=5
          contentText: 'body',
          rawHtml: null,
          sourceUrl: 'https://lab.example.com/post/sp4_short',
          author: null,
          publishedAt: new Date('2026-05-04T00:00:00Z'),
          // No filterReason — RSS path
        },
      ];

      const result = await ingestion.ingest(items, RSS_SOURCE);
      expect(result.hidden).toBe(1);
      expect(result.inserted).toBe(0);

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: 'https://lab.example.com/post/sp4_short' },
      });
      expect(row.status).toBe('HIDDEN');
      expect(row.filterReason).toBe('title_too_short');
    });

    it('cleans the title (strips boilerplate suffix) before storing', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'GPT-5 announced - OpenAI Blog',
          contentText: 'body',
          rawHtml: null,
          sourceUrl: 'https://lab.example.com/post/sp4_clean',
          author: null,
          publishedAt: new Date('2026-05-04T00:00:00Z'),
        },
      ];

      const result = await ingestion.ingest(items, RSS_SOURCE);
      expect(result.inserted).toBe(1);

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: 'https://lab.example.com/post/sp4_clean' },
      });
      expect(row.title).toBe('GPT-5 announced');
    });

    it('cleans the content (strips Read more tail + collapses whitespace)', async () => {
      const items: RawCrawledItem[] = [
        {
          title: 'A reasonable title',
          contentText: 'a    b\t\tc\n\n\n\nd. Read more →',
          rawHtml: null,
          sourceUrl: 'https://lab.example.com/post/sp4_content',
          author: null,
          publishedAt: new Date('2026-05-04T00:00:00Z'),
        },
      ];

      const result = await ingestion.ingest(items, RSS_SOURCE);
      expect(result.inserted).toBe(1);

      const row = await prisma.hotNews.findFirstOrThrow({
        where: { sourceUrl: 'https://lab.example.com/post/sp4_content' },
      });
      expect(row.content).toBe('a b c\n\nd.');
    });
  });
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/ingestion.service.integration.spec.ts --reporter=verbose`

(Make sure local Postgres is running: `pnpm docker:dev` first.)

Expected: existing 6 tests fail on `IngestResult` shape (missing `hidden`); 4 new SP-4 tests fail on missing `status='HIDDEN'` / wrong `title` / wrong `content`.

- [ ] **Step 4: Edit `apps/worker/src/crawl/ingestion.service.ts` to the new implementation**

Replace the file contents with:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { getPrisma, Prisma, ContentStatus, type Platform } from '@ai-hot-news/db';
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
  hidden: number;
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

        // SP-4: pre-ingest cleaning
        const cleanTitle = stripTitleBoilerplate(raw.title);
        const cleanContent = stripContentBoilerplate(raw.contentText);

        // SP-4: dedupeHash uses cleaned title (input is more stable across feed variations)
        const dedupeHash = computeDedupeHash(sourceUrl, cleanTitle);

        // SP-4: filterReason — prefer crawler's verdict; otherwise run universal fallback
        const finalReason =
          raw.filterReason ?? checkUniversalQuality({ title: cleanTitle });

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
              filterReason: finalReason ?? null,
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
          // P2002 = unique constraint violation → duplicate, skip
          if ((createErr as { code?: string }).code === 'P2002') {
            result.skipped += 1;
          } else {
            throw createErr;
          }
        }
      } catch (err) {
        this.logger.warn(
          `Ingest item failed: ${raw.sourceUrl} → ${(err as Error).message}`,
        );
        result.failed += 1;
      }
    }
    return result;
  }
}
```

- [ ] **Step 5: Run the integration tests to confirm they pass**

Run: `pnpm --filter @ai-hot-news/worker exec vitest run src/crawl/ingestion.service.integration.spec.ts --reporter=verbose`

Expected: all 10 tests PASS (6 existing + 4 new).

- [ ] **Step 6: Run all worker tests + lint + typecheck**

Run: `pnpm --filter @ai-hot-news/worker run lint typecheck test`

Expected: exit 0, all tests green.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/crawl/ingestion.service.ts apps/worker/src/crawl/ingestion.service.integration.spec.ts
git commit -m "feat(worker): IngestionService applies SP-4 cleaning + status/filterReason write"
```

---

## Task 11: `HotNewsService` defaults to `WHERE status='VISIBLE'` (TDD via mocked Prisma)

**Files:**
- Modify: `apps/api/src/hot-news/hot-news.service.ts`
- Create: `apps/api/src/hot-news/hot-news.service.spec.ts`

- [ ] **Step 1: Write the failing test in a new `hot-news.service.spec.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HotNewsService } from './hot-news.service';
import * as dbModule from '@ai-hot-news/db';

describe('HotNewsService', () => {
  let service: HotNewsService;
  let prismaMock: {
    hotNews: {
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prismaMock = {
      hotNews: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn().mockImplementation(async (calls: Promise<unknown>[]) => {
        return Promise.all(calls);
      }),
    };
    vi.spyOn(dbModule, 'getPrisma').mockReturnValue(
      prismaMock as unknown as ReturnType<typeof dbModule.getPrisma>,
    );
    service = new HotNewsService();
  });

  it('passes where: { status: "VISIBLE" } to findMany by default (SP-4)', async () => {
    await service.list(1, 20);
    expect(prismaMock.hotNews.findMany).toHaveBeenCalledTimes(1);
    const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
    expect(findManyArgs.where).toEqual({ status: 'VISIBLE' });
  });

  it('passes where: { status: "VISIBLE" } to count by default (SP-4)', async () => {
    await service.list(1, 20);
    expect(prismaMock.hotNews.count).toHaveBeenCalledTimes(1);
    const countArgs = prismaMock.hotNews.count.mock.calls[0]![0]!;
    expect(countArgs.where).toEqual({ status: 'VISIBLE' });
  });

  it('does NOT include status / filterReason in the DTO output', async () => {
    prismaMock.hotNews.findMany.mockResolvedValueOnce([
      {
        id: 'a',
        title: 'A',
        sourceUrl: 'https://example.com/a',
        sourcePlatform: 'RSS',
        author: null,
        publishedAt: new Date('2026-05-04T00:00:00Z'),
        crawledAt: new Date('2026-05-04T00:00:00Z'),
      },
    ]);
    prismaMock.hotNews.count.mockResolvedValueOnce(1);

    const result = await service.list(1, 20);

    expect(result.items[0]).not.toHaveProperty('status');
    expect(result.items[0]).not.toHaveProperty('filterReason');
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter @ai-hot-news/api exec vitest run src/hot-news/hot-news.service.spec.ts --reporter=verbose`

Expected: tests FAIL — `findMany` is called without a `where` argument (or with `where=undefined`).

- [ ] **Step 3: Edit `apps/api/src/hot-news/hot-news.service.ts`**

Replace the file with:

```ts
import { Injectable } from '@nestjs/common';
import { getPrisma, ContentStatus } from '@ai-hot-news/db';
import type { HotNewsListResponseDto } from '@ai-hot-news/types';

@Injectable()
export class HotNewsService {
  async list(page: number, pageSize: number): Promise<HotNewsListResponseDto> {
    const prisma = getPrisma();
    const skip = (page - 1) * pageSize;
    const where = { status: ContentStatus.VISIBLE };
    const [rows, total] = await prisma.$transaction([
      prisma.hotNews.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { publishedAt: 'desc' },
        select: {
          id: true,
          title: true,
          sourceUrl: true,
          sourcePlatform: true,
          author: true,
          publishedAt: true,
          crawledAt: true,
        },
      }),
      prisma.hotNews.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        sourceUrl: r.sourceUrl,
        sourcePlatform: r.sourcePlatform,
        author: r.author,
        publishedAt: r.publishedAt.toISOString(),
        crawledAt: r.crawledAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @ai-hot-news/api exec vitest run src/hot-news/hot-news.service.spec.ts --reporter=verbose`

Expected: 3 tests PASS.

- [ ] **Step 5: Run all api tests + lint + typecheck**

Run: `pnpm --filter @ai-hot-news/api run lint typecheck test`

Expected: exit 0, including the existing controller spec which uses a service mock and is unaffected.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/hot-news/hot-news.service.ts apps/api/src/hot-news/hot-news.service.spec.ts
git commit -m "feat(api): HotNewsService defaults to status=VISIBLE (SP-4)"
```

---

## Task 12: Backfill script `migrate-sp4.ts` + integration test (TDD)

**Files:**
- Create: `packages/db/scripts/migrate-sp4.ts`
- Create: `packages/db/scripts/migrate-sp4.spec.ts`

- [ ] **Step 1: Write the failing integration test**

Create `packages/db/scripts/migrate-sp4.spec.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, Platform, ContentStatus } from '../src';
import { runMigrateSp4 } from './migrate-sp4';

const prisma = getPrisma();

const TEST_PREFIX = 'https://lab.sp4.example.com/';

async function cleanup() {
  await prisma.hotNews.deleteMany({
    where: { sourceUrl: { startsWith: TEST_PREFIX } },
  });
  await prisma.hotNews.deleteMany({
    where: { sourceUrl: { startsWith: 'https://www.reddit.com/r/SP4Test/' } },
  });
}

describe('migrate-sp4 backfill', () => {
  beforeEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('Layer 1: re-normalizes sourceUrl with the SP-4 rules', async () => {
    // Insert a row with an http://m.example.com/ form that should canonicalize
    // to https://example.com (no trailing slash via existing rule).
    await prisma.hotNews.create({
      data: {
        title: 'Some title that is long enough',
        content: 'body',
        sourcePlatform: Platform.RSS,
        sourceUrl: 'http://m.example.sp4.example.com/post-old-url',  // legacy form
        publishedAt: new Date('2026-05-01T00:00:00Z'),
        dedupeHash: '00000000000000000000000000000001',
      },
    });

    const stats = await runMigrateSp4();

    expect(stats.layer1NormalizeUpdated).toBeGreaterThanOrEqual(1);

    const row = await prisma.hotNews.findFirst({
      where: { title: 'Some title that is long enough' },
    });
    // m.* prefix stripped, http→https, trailing path slash already absent
    expect(row?.sourceUrl).toBe('https://example.sp4.example.com/post-old-url');
  });

  it('Layer 1: collapses two rows that normalize to the same canonical URL (P2002)', async () => {
    // Row A: published earlier, already in canonical form
    await prisma.hotNews.create({
      data: {
        title: 'Same article title here',
        content: 'first body',
        sourcePlatform: Platform.RSS,
        sourceUrl: 'https://example.sp4.example.com/dup-article',
        publishedAt: new Date('2026-04-01T00:00:00Z'),
        dedupeHash: '00000000000000000000000000000010',
      },
    });
    // Row B: published later, in legacy http://m. form which normalizes to A
    await prisma.hotNews.create({
      data: {
        title: 'Same article title here',
        content: 'second body',
        sourcePlatform: Platform.RSS,
        sourceUrl: 'http://m.example.sp4.example.com/dup-article',
        publishedAt: new Date('2026-04-02T00:00:00Z'),
        dedupeHash: '00000000000000000000000000000011',
      },
    });

    const stats = await runMigrateSp4();

    expect(stats.layer1Collapsed).toBeGreaterThanOrEqual(1);

    // Only the earlier row survived
    const remaining = await prisma.hotNews.findMany({
      where: { sourceUrl: { contains: 'dup-article' } },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.content).toBe('first body');
  });

  it('Layer 2: marks low-ratio reddit rows HIDDEN with reddit_low_ratio', async () => {
    await prisma.hotNews.create({
      data: {
        title: 'Reddit post with bad ratio',
        content: 'body',
        sourcePlatform: Platform.REDDIT,
        sourceUrl: 'https://www.reddit.com/r/SP4Test/comments/lowratio',
        publishedAt: new Date('2026-05-01T00:00:00Z'),
        dedupeHash: '00000000000000000000000000000020',
        status: ContentStatus.VISIBLE,
        interactionData: {
          score: 100,
          comments: 50,
          externalUrl: null,
          redditId: 'lowratio',
          redditSubreddit: 'SP4Test',
          redditUpvoteRatio: 0.4,
        },
      },
    });

    const stats = await runMigrateSp4();

    expect(stats.layer2Hidden.reddit_low_ratio).toBeGreaterThanOrEqual(1);

    const row = await prisma.hotNews.findFirstOrThrow({
      where: { sourceUrl: 'https://www.reddit.com/r/SP4Test/comments/lowratio' },
    });
    expect(row.status).toBe(ContentStatus.HIDDEN);
    expect(row.filterReason).toBe('reddit_low_ratio');
  });

  it('Layer 2: marks short-title rows HIDDEN with title_too_short', async () => {
    await prisma.hotNews.create({
      data: {
        title: 'abc',
        content: 'body',
        sourcePlatform: Platform.RSS,
        sourceUrl: 'https://lab.sp4.example.com/short-title',
        publishedAt: new Date('2026-05-01T00:00:00Z'),
        dedupeHash: '00000000000000000000000000000030',
      },
    });

    const stats = await runMigrateSp4();

    expect(stats.layer2Hidden.title_too_short).toBeGreaterThanOrEqual(1);

    const row = await prisma.hotNews.findFirstOrThrow({
      where: { sourceUrl: 'https://lab.sp4.example.com/short-title' },
    });
    expect(row.status).toBe(ContentStatus.HIDDEN);
    expect(row.filterReason).toBe('title_too_short');
  });

  it('is idempotent: a second run reports zero updates', async () => {
    await prisma.hotNews.create({
      data: {
        title: 'A normal title that survives all checks',
        content: 'body',
        sourcePlatform: Platform.RSS,
        sourceUrl: 'https://lab.sp4.example.com/survivor',
        publishedAt: new Date('2026-05-01T00:00:00Z'),
        dedupeHash: '00000000000000000000000000000040',
      },
    });

    await runMigrateSp4();
    const second = await runMigrateSp4();

    expect(second.layer1NormalizeUpdated).toBe(0);
    expect(second.layer1Collapsed).toBe(0);
    expect(Object.values(second.layer2Hidden)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter @ai-hot-news/db exec vitest run scripts/migrate-sp4.spec.ts --reporter=verbose`

(Local Postgres must be up: `pnpm docker:dev`.)

Expected: tests FAIL with `Failed to resolve import './migrate-sp4'`.

- [ ] **Step 3: Create `packages/db/scripts/migrate-sp4.ts`**

```ts
import { Platform, ContentStatus, getPrisma } from '../src/index.js';
import {
  normalizeUrl,
  computeDedupeHash,
  stripTitleBoilerplate,
  checkRedditQuality,
  checkHnQuality,
  checkUniversalQuality,
} from '@ai-hot-news/utils';

export interface MigrateSp4Stats {
  layer1NormalizeUpdated: number;
  layer1Collapsed: number;
  layer1HashUpdated: number;
  layer2Hidden: Record<string, number>;
}

export async function runMigrateSp4(): Promise<MigrateSp4Stats> {
  const prisma = getPrisma();
  const stats: MigrateSp4Stats = {
    layer1NormalizeUpdated: 0,
    layer1Collapsed: 0,
    layer1HashUpdated: 0,
    layer2Hidden: {},
  };

  // === Layer 1: re-normalize URLs + recompute dedupeHash + collapse duplicates ===
  // Process oldest rows first so P2002 collapses delete the LATER row.
  const allRows = await prisma.hotNews.findMany({
    select: {
      id: true,
      sourceUrl: true,
      title: true,
      dedupeHash: true,
    },
    orderBy: { publishedAt: 'asc' },
  });

  for (const row of allRows) {
    const newUrl = normalizeUrl(row.sourceUrl);
    const cleanTitle = stripTitleBoilerplate(row.title);
    const newHash = computeDedupeHash(newUrl, cleanTitle);

    const urlChanged = newUrl !== row.sourceUrl;
    const hashChanged = newHash !== row.dedupeHash;
    const titleChanged = cleanTitle !== row.title;

    if (!urlChanged && !hashChanged && !titleChanged) continue;

    try {
      await prisma.hotNews.update({
        where: { id: row.id },
        data: {
          sourceUrl: newUrl,
          dedupeHash: newHash,
          title: cleanTitle,
        },
      });
      if (urlChanged) stats.layer1NormalizeUpdated += 1;
      if (hashChanged) stats.layer1HashUpdated += 1;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        // Another row already owns this canonical URL or hash → delete the later one
        await prisma.hotNews.delete({ where: { id: row.id } });
        stats.layer1Collapsed += 1;
      } else {
        throw err;
      }
    }
  }

  // === Layer 2: retroactively apply quality rules to currently-VISIBLE rows ===
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
        upvote_ratio:
          typeof ix.redditUpvoteRatio === 'number' ? ix.redditUpvoteRatio : null,
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
      stats.layer2Hidden[reason] = (stats.layer2Hidden[reason] ?? 0) + 1;
    }
  }

  return stats;
}

// Allow direct invocation: `tsx scripts/migrate-sp4.ts`
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('migrate-sp4.ts') ||
  process.argv[1]?.endsWith('migrate-sp4.js');

if (isDirectRun) {
  runMigrateSp4()
    .then((stats) => {
      console.log('SP-4 backfill complete:');
      console.log(JSON.stringify(stats, null, 2));
      return getPrisma().$disconnect();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('SP-4 backfill failed:', err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run the integration tests to confirm they pass**

Run: `pnpm --filter @ai-hot-news/db exec vitest run scripts/migrate-sp4.spec.ts --reporter=verbose`

Expected: 5 tests PASS.

- [ ] **Step 5: Verify the script runs as a standalone tsx invocation**

Run: `pnpm --filter @ai-hot-news/db run migrate-sp4`

Expected: exit 0, prints `SP-4 backfill complete:` followed by JSON stats. (On a freshly-migrated dev DB the stats may all be near-zero or contain genuine numbers depending on what's already in `hot_news` from SP-3.)

- [ ] **Step 6: Verify a second invocation is idempotent (zero changes)**

Run: `pnpm --filter @ai-hot-news/db run migrate-sp4`

Expected: same exit 0, output shows `layer1NormalizeUpdated: 0`, `layer1Collapsed: 0`, `layer2Hidden: {}` (assuming no new rows arrived between runs).

- [ ] **Step 7: Run db lint + typecheck**

Run: `pnpm --filter @ai-hot-news/db run typecheck`

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/db/scripts/migrate-sp4.ts packages/db/scripts/migrate-sp4.spec.ts
git rm packages/db/scripts/.gitkeep || true
git commit -m "feat(db): add migrate-sp4 backfill script (Layer 1 normalize + Layer 2 quality)"
```

---

## Task 13: Add `db:migrate-sp4` script to root `package.json`

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Edit root `package.json`**

In the `"scripts"` block, add the new line right after the existing `"db:seed"` line:

```json
    "db:seed": "if [ -f ./.env ]; then set -a; . ./.env; set +a; fi && pnpm --filter @ai-hot-news/db exec prisma db seed",
    "db:migrate-sp4": "if [ -f ./.env ]; then set -a; . ./.env; set +a; fi && pnpm --filter @ai-hot-news/db run migrate-sp4",
```

(The `set -a; . ./.env; set +a` block sources `.env` into the shell — same pattern as `db:seed` so `DATABASE_URL` is loaded for `tsx`.)

- [ ] **Step 2: Verify the script works from root**

Run: `pnpm db:migrate-sp4`

Expected: same output as Task 12 Step 5 / 6 — exit 0, prints stats.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(workspace): expose db:migrate-sp4 from root scripts"
```

---

## Task 14: Local end-to-end smoke

**Files:** none changed in this task — verification only.

- [ ] **Step 1: Make sure the dev stack is running**

Run: `pnpm docker:dev` (Postgres + Redis containers).

- [ ] **Step 2: Apply migrations + seed sources**

Run: `pnpm db:migrate:deploy && pnpm db:seed`

Expected: prisma reports `Already in sync` (migration applied earlier in Task 6) and seed adds/updates 14 SourceConfig rows (3 RSS + 3 HN + 8 Reddit).

- [ ] **Step 3: Run the SP-4 backfill once on local data**

Run: `pnpm db:migrate-sp4`

Expected: exit 0; printed stats show some `layer1NormalizeUpdated` (number depends on local data — likely a handful for hosts that previously had `m.` prefix or `http://`) and some `layer2Hidden` entries (Reddit low-ratio, HN low-engagement, etc.).

**Save the printed JSON stats** to a scratch buffer — Task 16 Step 4 will paste them into the decomposition spec's smoke-evidence section.

- [ ] **Step 4: Verify no rows have `status='VISIBLE'` AND a non-null `filterReason` (consistency check)**

Run:
```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  'SELECT COUNT(*) FROM hot_news WHERE status='\''VISIBLE'\'' AND "filterReason" IS NOT NULL'
```

Expected: `count = 0`.

(Note the double-quoted `"filterReason"` — Prisma's camelCase columns must be quoted in raw SQL.)

- [ ] **Step 5: Verify all rows with `status='HIDDEN'` have a `filterReason`**

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  'SELECT COUNT(*) FROM hot_news WHERE status='\''HIDDEN'\'' AND "filterReason" IS NULL'
```

Expected: `count = 0`.

- [ ] **Step 6: Show distribution by filterReason**

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c \
  'SELECT "filterReason", COUNT(*) FROM hot_news WHERE status='\''HIDDEN'\'' GROUP BY "filterReason" ORDER BY 2 DESC'
```

Expected output looks roughly like:
```
       filterReason      | count
-------------------------+-------
 reddit_low_engagement   |    25
 reddit_low_ratio        |    18
 hn_low_engagement       |    12
 title_too_short         |     2
```
(Exact numbers vary; the shape — multiple known reasons, no NULLs, no junk values — is what matters.)

- [ ] **Step 7: Start the worker + api + web stack and confirm a fresh crawl writes the new fields**

Run: `pnpm dev` (in a terminal you can leave open).

Wait ~5-7 minutes for boot crawls to complete, then in another terminal:

```bash
curl -s 'http://localhost:3001/hot-news?pageSize=5' | jq '.items | length'
# expect 5

curl -s 'http://localhost:3001/hot-news?pageSize=200' | jq '[.items[].sourcePlatform] | group_by(.) | map({plat: .[0], n: length})'
# expect a mix like [{plat:HACKERNEWS, n:>=20}, {plat:REDDIT, n:>=20}, {plat:RSS, n:>=10}]

curl -s 'http://localhost:3001/hot-news?pageSize=500' | jq '[.items[].sourcePlatform] | length'
# count visible items
```

The visible-count is expected to be LESS than the total `hot_news` row count from `SELECT COUNT(*) FROM hot_news` (HIDDEN rows are filtered out by `HotNewsService.list`).

- [ ] **Step 8: Open the web UI**

Open: `http://localhost:3000/news`

Expected:
- The list shows mixed RSS / HN / Reddit items with their badges.
- No items with obviously low Reddit upvote_ratio or score < 5 HN posts.
- No items with title shorter than 5 characters.
- Titles like `"GPT-5 announced"` (without `" - OpenAI Blog"` boilerplate, if any RSS source produced one).

- [ ] **Step 9: Stop the stack**

Hit Ctrl+C in the `pnpm dev` terminal.

- [ ] **Step 10: Run the full test suite to confirm nothing's regressed**

Run: `pnpm turbo run lint typecheck test`

Expected: all packages green.

(No commit in this task — it's a verification gate before deploy.)

---

## Task 15: Deploy to VPS + run backfill on production

**Files:** none changed.

This task assumes the SP-4 commits from Tasks 1-13 are already pushed to `main` and CI / `deploy.yml` has run successfully.

- [ ] **Step 1: Push the SP-4 work to main**

Run: `git push origin main`

Expected: GitHub Actions starts CI + deploy. Wait until the deploy workflow shows green.

- [ ] **Step 2: SSH to the VPS and pull the latest images (deploy.yml normally does this, but verify)**

```bash
ssh deploy@<vps>
cd /srv/ai-hot-news
docker compose ps
```

Expected: `api`, `worker`, `web` all `Up` and image tag matches the latest commit.

- [ ] **Step 3: Confirm the migration applied (auto-run by deploy.sh)**

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c "\d hot_news" | grep -i filter
```

Expected: a line confirming `filterReason | text |` exists (camelCase, nullable).

- [ ] **Step 4: Run the SP-4 backfill on production data (one-shot, manual)**

```bash
cd /srv/ai-hot-news

# 4a. Stop worker (single-writer assumption — see §10 decision 9 of decomposition spec).
docker compose -f docker/docker-compose.prod.yml --env-file .env stop worker

# 4b. Run the backfill via the prod-oneshot helper. The helper auto-detects
#     the worker image tag currently serving traffic (avoids :latest drift)
#     and runs the script inside a one-shot worker container that has
#     packages/db/scripts/, packages/utils/dist, and the @ai-hot-news/* symlinks.
bash scripts/run-prod-oneshot.sh packages/db scripts/migrate-sp4.ts

# 4c. Restart worker.
docker compose -f docker/docker-compose.prod.yml --env-file .env start worker
```

NOTE (post-mortem, post-2026-05-04 deployment): the originally-planned
`pnpm db:migrate-sp4` requires Node/pnpm on the VPS host (we don't install
those — host runs Docker only); the api-container fallback fails because the
api image is a NestJS standalone bundle without `node_modules/@ai-hot-news/utils`.
The `scripts/run-prod-oneshot.sh` helper is the canonical path going forward
(see decomposition spec §10 SP-4 decision 11 for full rationale + the contract
that future SP-7/SP-19 one-shot scripts must follow).

Expected: exit 0; printed stats. **Save the JSON output** — it goes into the decomposition spec update in Task 16.

- [ ] **Step 5: Smoke-test the production API**

```bash
curl -s 'https://<your-domain>/api/hot-news?pageSize=200' | jq '[.items[].sourcePlatform] | unique'
```

Expected: `["HACKERNEWS", "REDDIT", "RSS"]` (no nulls, no surprise values).

```bash
curl -s 'https://<your-domain>/api/hot-news?pageSize=500' | jq '.total'
```

Compare with the database row count:

```bash
docker exec ai-hot-news-postgres psql -U postgres -d ai_hot_news -c "SELECT COUNT(*) FROM hot_news"
```

Expected: API `total` < DB count (HIDDEN rows excluded).

- [ ] **Step 6: Visual smoke**

Open `https://<your-domain>/news` in a browser. Verify:
- No obvious low-quality items (low score / low ratio Reddit posts gone)
- Titles look cleaner (no trailing site names for whitelisted sources)
- All three platform badges still appear

(No commit in this task either.)

---

## Task 16: Write SP-4 results back into the decomposition spec

**Files:**
- Modify: `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md`

- [ ] **Step 1: Update §6 Phase 3 SP-4 status to ✅**

The Phase 3 table in the current spec has 3 columns (`| SP | 名称 | 依赖 |`) without a Status column. Add a Status column to match the Phase 0/1/2 format and mark SP-4 done. Replace the entire Phase 3 table with:

```markdown
| SP | 状态 | 名称 | 依赖 |
|----|------|------|------|
| **SP-4** | ✅ | 内容清洗 + 多层去重 | URL 规范化 / 内容哈希 / 标题相似度（PG fts），输出 `dedupeHash` |
| **SP-5** | ⏳ | AI 摘要 + 标签分类 | Vercel AI SDK · 摘要 + aiTags（公司/模型/类型）· 插拔式摘要策略接口 · prompt 模板入 `packages/prompts` |
| **SP-6** | ⏳ | 热度分计算 | PRD 6 维公式 · 时间窗参数化（默认 24h）· 入库时计算 + 定时重算（衰减） |
| **SP-7** | ⏳ | 跨平台热点合并 | pgvector embedding 入库 · 余弦相似度查询 · 阈值聚合赋 `groupId` · 归档机制（30 天后冷表） |
```

- [ ] **Step 2: Append decision-log entries to §10**

Add a new sub-section after the existing `### SP-3 Reddit 抓取器（2026-05-04）` block:

```markdown
### SP-4 内容清洗 + 多层去重（2026-05-04）

1. **去重 vs 热点发现的硬边界**：SP-4 只折叠"物理重复"（同 URL 异形如 http→https、m.x.com→x.com），跨平台同事件保留 N 行交给 SP-7 用 pgvector 余弦软合并 + groupId。SP-4 绝不引入跨 URL 标题相似度强制 unique，避免杀掉 PRD 核心的"3 个平台同时报道"热度信号。
2. **过滤分三个维度**：维度 1 合规/非内容 → crawler 阶段直接不入库（SP-3 沿用）；维度 2 质量低 → 入库 + status='HIDDEN' + filterReason；维度 3 主题不相关 → SP-4 不做，等 SP-5 LLM 打 aiTags。
3. **维度 2 选 HIDDEN 而非不入库**：阈值的 ground truth 现在不知道，HIDDEN 留数据可一行 SQL 反转测试；SP-7 跨平台合并时 HIDDEN 行可参与 group 形成做"覆盖度信号增强"；DB 体量影响 < 0.001%（+0.5MB/年）可忽略。
4. **维度 3 推到 SP-5 而非 SP-4 关键词层**：避免词表维护负担 + 双层冗余；SP-5 LLM 自然处理新话题；接受 SP-4 完工后约 1-2 周内列表仍有"高分非主题"内容的 trade-off。
5. **URL 规范化 6 条规则（中量）**：http→https 折叠、Reddit 老入口 alias、Twitter host alias、m./mobile. 子域剥离、重复 query 合并、空 ? 串剥离。**不动 www 子域**（OpenAI 裸域 vs Wikipedia 必带子域，策略不一致）。
6. **过滤逻辑放 crawler + utils/quality.ts 工具函数**：crawler 知 platform 字段语义；utils 集中阈值；与 SP-3 RedditCrawler.isValidPost 模式一致；platform-agnostic 兜底（universal）由 IngestionService 调用。
7. **ArticleExtractor 剥离 SP-4 独立**：SP-3 spec 把 ArticleExtractor 标在 SP-4 里，但 brainstorming 时确认该子系统独立性强（独立 worker / 独立队列 / 独立 fetch 限速），独立成 SP-4.5 或 SP-5 前置更合理。SP-4 完工后 link-post 保留 `content=title, rawHtml=null` 现状作为检测哨兵。
8. **backfill 脚本不进 deploy.sh**：一次性脚本进自动链路浪费部署时间；多次 deploy 后报告永远 0 updated 误导运维。手工 ssh 跑一次写进 commit log 标记。
```

- [ ] **Step 3: Append to §11 status tracking table**

Add a new row after the SP-3 row in the §11 status tracking table:

```markdown
| **SP-4** | 2026-05-04 | <commit range from Task 1 first commit to Task 13 last commit> ·spec: `2026-05-04-sp4-content-cleaning-dedup-design.md` ·plan: `2026-05-04-sp4-content-cleaning-dedup-plan.md` | `normalizeUrl` 6 条新规则（http→https / Reddit/Twitter alias / m./mobile. 剥离 / 重复 query 合并）· `stripTitleBoilerplate` + `stripContentBoilerplate`（白名单 + 模式集）· `quality.ts` 三函数 + `FILTER_REASONS` 常量 · `RawCrawledItem.filterReason` 字段 · `HotNews.filterReason` 列 + migration · `IngestionService` 入库前清洗 + status/filterReason 写入 + IngestResult.hidden · `HotNewsService` 默认 WHERE status=VISIBLE · `packages/db/scripts/migrate-sp4.ts` 一次性 backfill（Layer 1 normalize + Layer 2 quality） | **新过滤维度契约**：dimension 1 (compliance) → drop in crawler；dimension 2 (quality) → ingest with status='HIDDEN' + filterReason；dimension 3 (topic) → defer to SP-5 LLM。**HIDDEN 数据保留契约**：SP-7 跨平台合并消费 HIDDEN 行做覆盖度信号增强；SP-5 LLM 上线后可重新判定 status。**utils 内阈值约定**：所有 quality 阈值集中在 `packages/utils/src/quality.ts`，未来想 per-source 调整可升级到 SourceConfig.metadata 注入。**API 默认契约**：`GET /hot-news` 默认 `WHERE status='VISIBLE'`，不暴露 includeHidden（YAGNI）。 |
```

(Replace `<commit range>` with the actual `git log --oneline` range from Task 1 to Task 13. Run `git log --oneline -20` to get the range.)

- [ ] **Step 4: Add SP-4 backfill smoke evidence section**

After the existing `### SP-3 端到端 smoke 凭据（2026-05-04）` sub-section, add:

```markdown
### SP-4 端到端 smoke 凭据（2026-05-04）

- **Backfill 实测**：本地 `pnpm db:migrate-sp4` 输出 `<paste the JSON stats from Task 14 Step 3>`。VPS prod 跑同一脚本输出 `<paste the JSON stats from Task 15 Step 4>`。
- **DB 一致性实测**：`SELECT COUNT(*) FROM hot_news WHERE status='VISIBLE' AND "filterReason" IS NOT NULL` = 0；`SELECT COUNT(*) FROM hot_news WHERE status='HIDDEN' AND "filterReason" IS NULL` = 0。两条不变量在 backfill 后均成立。
- **API 默认过滤实测**：`curl https://<domain>/api/hot-news?pageSize=200 | jq '.total'` < `SELECT COUNT(*) FROM hot_news`，差值约等于 backfill 标 HIDDEN 行数 + 实时 crawl 写 HIDDEN 行数之和。
- **测试矩阵**：utils 33/33（url 18 + boilerplate 19 - duplicate counts noted, quality 14）+ worker 整体 PASS（含 ingestion integration 10/10、reddit crawler +3、hn crawler +3）+ api +3（hot-news.service.spec.ts）+ db scripts 5/5（migrate-sp4 integration）。`pnpm turbo run lint typecheck` 全 cached/clean，`pnpm turbo run build` 全包通过。
- **Idempotency 实测**：`pnpm db:migrate-sp4` 二次跑输出全 0（layer1NormalizeUpdated=0、layer1Collapsed=0、layer2Hidden={}）。`pnpm db:seed` 二次跑 SourceConfig 行数恒等于 14（不动）。
```

- [ ] **Step 5: Add the recommendation snippet at the end**

Update the "推进路线提示" section at the very end of the doc (or add one if missing) to point at SP-5:

```markdown
### 推进路线提示（更新于 SP-4 完成）

按 §6 Phase 3，SP-4 后的最优下一步是 **SP-5（AI 摘要 + aiTags）**。理由：

1. SP-4 brainstorming 时把"维度 3 主题相关性过滤"明确推到了 SP-5（LLM 打 aiTags 后 UI 按 tag 过滤）。SP-5 落地后 `/news` 列表才会真正"只剩想看的"。
2. SP-5 的 aiTags 是 SP-7 跨平台合并的输入之一（embedding + tags 双信号），完工后能直接推 SP-7。
3. SP-5 启动前可先并行做 **SP-4.5 ArticleExtractor**（HN/Reddit link-post 外链正文抓取），因为 SP-5 摘要 link-post 时需要外链正文。SP-4.5 是独立 worker / 独立队列，与 SP-5 无代码冲突，可并行启动。

建议下一步：进 SP-4.5 brainstorming（如要先解决 SP-5 的"无料可摘"前置）或 SP-5 brainstorming（如接受 link-post 暂只摘 title）。
```

- [ ] **Step 6: Run lint to make sure markdown is valid**

Run: `pnpm format:check`

Expected: exit 0 (or fix any formatting issues with `pnpm format`).

- [ ] **Step 7: Commit the docs update**

```bash
git add docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md
git commit -m "docs(sp4): mark SP-4 done, log decisions, record backfill smoke evidence"
```

- [ ] **Step 8: Push**

Run: `git push origin main`

Expected: CI green, no further deploy actions (docs-only change shouldn't rebuild images, but if deploy.yml runs anyway, it's a no-op).

---

## Self-review summary

After all 16 tasks:

- **Spec coverage:** every section of the SP-4 spec has at least one task implementing it (URL 6 rules → Task 1; boilerplate → Task 2; quality → Task 3; types field → Task 5; schema column → Task 6; crawler integration → Tasks 8-9; ingestion service → Task 10; api default filter → Task 11; backfill script → Tasks 12-13; smoke + deploy + docs → Tasks 14-16). The Out-of-scope items (ArticleExtractor, topic relevance, rawHtml clean, etc.) are explicitly listed in this plan's File Map and not turned into tasks, matching the spec.
- **Placeholder scan:** every task body contains either complete TypeScript code, a complete shell command with expected output, or a complete markdown insertion — no "TODO" / "implement later" / "add error handling" stubs.
- **Type consistency:** `filterReason` is the canonical name everywhere (RawCrawledItem field, HotNews column, utils return value, schema, migration). `FILTER_REASONS` constant string values (`reddit_low_ratio`, `reddit_low_engagement`, `hn_low_engagement`, `title_too_short`) match between Task 3 (definition), Task 8/9 (crawler tests), Task 10 (integration tests), and Task 12 (backfill tests). `IngestResult.hidden` consistently appears in Task 10 and Task 14 verification. `runMigrateSp4` exported function name is consistent between Task 12 (definition + tests) and Task 14 (CLI invocation through `migrate-sp4` package script).

Plan complete and saved to `docs/superpowers/plans/2026-05-04-sp4-content-cleaning-dedup-plan.md`.
