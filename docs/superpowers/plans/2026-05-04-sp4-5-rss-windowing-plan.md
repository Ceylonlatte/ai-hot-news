# SP-4.5 RSS Windowing + Platform Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Constrain RSS to a 7-day window, give it a dedicated "权威媒体" tab, drop RSS crawl frequency from 30min to 1d, and clean 1119 historical pre-window RSS rows so first-page UX matches user-facing time-relevance expectations.

**Architecture:** Three orthogonal layers (a) `IngestionService` ingest-time RSS cutoff filter, (b) `HotNewsService` API-time per-platform window filter via new `?platforms=` query, (c) one-shot prod DELETE script + SQL `crawlInterval` update. SP-4 internals (cleaning / dedupe / quality) untouched.

**Tech Stack:** NestJS (api + worker) · Prisma · vitest · class-validator/transformer · Next.js (web, App Router) · BullMQ repeat job (auto-rebound on worker restart) · `scripts/run-prod-oneshot.sh` helper (SP-4 standard).

**Spec:** `docs/superpowers/specs/2026-05-04-sp4-5-rss-windowing-design.md`

---

## Pre-flight: assumptions about codebase state

These were verified before plan creation. If any have shifted, stop and re-verify before coding:

- `IngestResult` is defined inline in `apps/worker/src/crawl/ingestion.service.ts` (not in `packages/types`). Current fields: `fetched / inserted / skipped / hidden / failed`.
- `HotNewsService.list(page, pageSize)` filters `WHERE status='VISIBLE'` only. No platform / window logic yet.
- `ListHotNewsQuery` DTO uses `class-validator` (`@IsInt @Min @Max @IsOptional`). `pageSize` capped at 50.
- `HotNewsController.list()` calls `this.service.list(query.page, query.pageSize)`.
- `fetchHotNewsList(page, pageSize)` in `apps/web/lib/api.ts` is the only API call site.
- `apps/web/app/news/page.tsx` reads `?page=` and renders the list.
- Prod data (verified 2026-05-04 ~20:00 UTC+8): 2030 visible / 266 hidden; 1129 RSS rows (1119 ≥ 7 days old).
- Source crawl intervals: RSS=1800s, HN Top=900s, HN Show/Ask=1800s, Reddit=3600s.
- `scripts/run-prod-oneshot.sh` exists from SP-4 post-mortem; `apps/worker/Dockerfile` already `COPY packages/db/scripts`.

---

## Task 1: Add RSS ingest cutoff to IngestionService

**Goal:** Drop RSS items with `publishedAt < now - 7d` (or null) before they reach the dedupe / insert path. HN/Reddit unaffected.

**Files:**
- Modify: `apps/worker/src/crawl/ingestion.service.ts`
- Test: `apps/worker/src/crawl/ingestion.service.spec.ts`

- [ ] **Step 1.1: Write the failing tests**

Add four cases to the existing `ingestion.service.spec.ts` (or create the file if it doesn't yet have a window block). Use the existing prisma mock pattern in the file — only show the block specific to this task here:

```ts
// apps/worker/src/crawl/ingestion.service.spec.ts (add inside the existing describe)
import { Platform } from '@ai-hot-news/db';

describe('SP-4.5 RSS ingest window', () => {
  const NOW = new Date('2026-05-10T12:00:00Z');
  const cutoff = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000); // 2026-05-03T12:00:00Z

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('drops RSS item with publishedAt outside the 7d window (counted as skipped)', async () => {
    const result = await service.ingest(
      [
        {
          title: 'Old RSS post that should be dropped',
          contentText: 'body',
          rawHtml: null,
          sourceUrl: 'https://openai.com/blog/old-2015',
          author: null,
          publishedAt: new Date('2025-01-01T00:00:00Z'), // far before cutoff
          filterReason: null,
        },
      ],
      { id: 's1', platform: Platform.RSS, url: '...', identifier: null, name: 'OpenAI' },
    );
    expect(result.skipped).toBe(1);
    expect(result.inserted).toBe(0);
    expect(prismaMock.hotNews.create).not.toHaveBeenCalled();
  });

  it('drops RSS item with null publishedAt (cannot prove it is fresh)', async () => {
    const result = await service.ingest(
      [
        {
          title: 'No date title here',
          contentText: 'body',
          rawHtml: null,
          sourceUrl: 'https://openai.com/blog/no-date',
          author: null,
          publishedAt: null,
          filterReason: null,
        },
      ],
      { id: 's1', platform: Platform.RSS, url: '...', identifier: null, name: 'OpenAI' },
    );
    expect(result.skipped).toBe(1);
    expect(prismaMock.hotNews.create).not.toHaveBeenCalled();
  });

  it('keeps RSS item with publishedAt exactly at the cutoff boundary (>=)', async () => {
    await service.ingest(
      [
        {
          title: 'Edge case at the boundary',
          contentText: 'body',
          rawHtml: null,
          sourceUrl: 'https://openai.com/blog/edge',
          author: null,
          publishedAt: cutoff, // exactly now - 7d
          filterReason: null,
        },
      ],
      { id: 's1', platform: Platform.RSS, url: '...', identifier: null, name: 'OpenAI' },
    );
    expect(prismaMock.hotNews.create).toHaveBeenCalledTimes(1);
  });

  it('does NOT apply window cutoff to HN or Reddit (publishedAt: null still gets crawledAt fallback)', async () => {
    const veryOld = new Date('2024-01-01T00:00:00Z');
    await service.ingest(
      [
        {
          title: 'HN old item should still be ingested',
          contentText: 'body',
          rawHtml: null,
          sourceUrl: 'https://news.ycombinator.com/item?id=1',
          author: null,
          publishedAt: veryOld,
          filterReason: null,
        },
      ],
      { id: 's2', platform: Platform.HACKERNEWS, url: null, identifier: 'hn', name: 'HN' },
    );
    expect(prismaMock.hotNews.create).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 1.2: Run tests, confirm all four FAIL**

```bash
pnpm --filter @ai-hot-news/worker test -- --run ingestion.service.spec
```
Expected: 4 failures in the new block (RSS items still being inserted because cutoff doesn't exist yet).

- [ ] **Step 1.3: Implement the cutoff filter**

Edit `apps/worker/src/crawl/ingestion.service.ts`. Add the constant + helper near the top (under existing imports), then call it in the per-item loop, before `if (!raw.sourceUrl)`. Keep `IngestResult.skipped` as the bucket (avoid adding new exported fields):

```ts
// Top of file, after imports
const RSS_INGEST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isWithinIngestWindow(
  raw: RawCrawledItem,
  source: SourceLike,
  now: Date,
): boolean {
  if (source.platform !== 'RSS') return true;
  if (!raw.publishedAt) return false;
  return raw.publishedAt.getTime() >= now.getTime() - RSS_INGEST_WINDOW_MS;
}
```

Then inside `ingest()`, immediately after `for (const raw of items) { try {`, prepend:

```ts
if (!isWithinIngestWindow(raw, source, new Date())) {
  result.skipped += 1;
  continue;
}
```

(Place it before `if (!raw.sourceUrl)` so out-of-window items are dropped first, regardless of URL validity.)

- [ ] **Step 1.4: Run tests, confirm all four PASS + the rest of the suite stays green**

```bash
pnpm --filter @ai-hot-news/worker test -- --run ingestion.service.spec
pnpm --filter @ai-hot-news/worker test
```
Expected: all PASS.

- [ ] **Step 1.5: Commit**

```bash
git add apps/worker/src/crawl/ingestion.service.ts apps/worker/src/crawl/ingestion.service.spec.ts
git commit -m "feat(sp4.5): drop RSS items outside the 7d ingest window

Adds an early-return guard in IngestionService.ingest() that:
- Applies only to RSS (HN/Reddit untouched).
- Treats null publishedAt as out-of-window (cannot prove freshness).
- Boundary-inclusive: publishedAt == now-7d is kept.

Counts dropped items into result.skipped (no new IngestResult field)."
```

---

## Task 2: One-shot cleanup script for pre-window RSS rows

**Goal:** A `tsx` script that prod runs once via `scripts/run-prod-oneshot.sh`. Deletes RSS rows where `publishedAt < now - 7d`. Prints before/after counts. Integration-tested against the dev DB.

**Files:**
- Create: `packages/db/scripts/cleanup-rss-pre-window.ts`
- Create: `packages/db/scripts/cleanup-rss-pre-window.spec.ts`

- [ ] **Step 2.1: Write the failing integration tests**

```ts
// packages/db/scripts/cleanup-rss-pre-window.spec.ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, Platform } from '@ai-hot-news/db';
import { runCleanupRssPreWindow } from './cleanup-rss-pre-window';

const prisma = getPrisma();

const TEST_URL_PREFIX = 'https://sp45-cleanup.example.com/';

async function cleanup() {
  await prisma.hotNews.deleteMany({
    where: { sourceUrl: { startsWith: TEST_URL_PREFIX } },
  });
}

function olderThan(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe('cleanup-rss-pre-window', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('deletes RSS rows older than 7 days', async () => {
    await prisma.hotNews.createMany({
      data: [
        {
          title: 'Old RSS row',
          content: 'body',
          sourcePlatform: Platform.RSS,
          sourceUrl: TEST_URL_PREFIX + 'old',
          publishedAt: olderThan(8),
          dedupeHash: 'sp45-clean-old-1',
        },
        {
          title: 'Fresh RSS row',
          content: 'body',
          sourcePlatform: Platform.RSS,
          sourceUrl: TEST_URL_PREFIX + 'fresh',
          publishedAt: olderThan(1),
          dedupeHash: 'sp45-clean-fresh-1',
        },
      ],
    });

    const stats = await runCleanupRssPreWindow();

    expect(stats.deleted).toBe(1);
    expect(stats.remainingRss).toBeGreaterThanOrEqual(1);

    const remaining = await prisma.hotNews.findMany({
      where: { sourceUrl: { startsWith: TEST_URL_PREFIX } },
      select: { sourceUrl: true },
    });
    expect(remaining.map((r) => r.sourceUrl)).toEqual([TEST_URL_PREFIX + 'fresh']);
  });

  it('does NOT delete HN/Reddit rows even if older than 7 days', async () => {
    await prisma.hotNews.createMany({
      data: [
        {
          title: 'Old HN row that must survive',
          content: 'body',
          sourcePlatform: Platform.HACKERNEWS,
          sourceUrl: TEST_URL_PREFIX + 'hn-old',
          publishedAt: olderThan(30),
          dedupeHash: 'sp45-clean-hn-old',
        },
        {
          title: 'Old Reddit row that must survive',
          content: 'body',
          sourcePlatform: Platform.REDDIT,
          sourceUrl: TEST_URL_PREFIX + 'rd-old',
          publishedAt: olderThan(60),
          dedupeHash: 'sp45-clean-rd-old',
        },
      ],
    });

    const stats = await runCleanupRssPreWindow();
    expect(stats.deleted).toBe(0);

    const remaining = await prisma.hotNews.count({
      where: { sourceUrl: { startsWith: TEST_URL_PREFIX } },
    });
    expect(remaining).toBe(2);
  });

  it('boundary case: row exactly at now - 7d is kept (>=)', async () => {
    // Use 7 days minus 1 second to robustly land on "kept" side without flake.
    const justInside = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 1000);
    await prisma.hotNews.create({
      data: {
        title: 'Boundary RSS row',
        content: 'body',
        sourcePlatform: Platform.RSS,
        sourceUrl: TEST_URL_PREFIX + 'boundary',
        publishedAt: justInside,
        dedupeHash: 'sp45-clean-boundary',
      },
    });

    const stats = await runCleanupRssPreWindow();
    expect(stats.deleted).toBe(0);
  });
});
```

- [ ] **Step 2.2: Run tests, confirm they fail (module not found)**

```bash
pnpm --filter @ai-hot-news/db test -- --run cleanup-rss-pre-window.spec
```
Expected: FAIL with "Cannot find module './cleanup-rss-pre-window'".

- [ ] **Step 2.3: Implement the script**

```ts
// packages/db/scripts/cleanup-rss-pre-window.ts
import { Platform, getPrisma } from '@ai-hot-news/db';

export interface CleanupResult {
  cutoff: string;
  toDelete: number;
  deleted: number;
  remainingRss: number;
}

export async function runCleanupRssPreWindow(): Promise<CleanupResult> {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const toDelete = await prisma.hotNews.count({
    where: {
      sourcePlatform: Platform.RSS,
      publishedAt: { lt: cutoff },
    },
  });

  const result = await prisma.hotNews.deleteMany({
    where: {
      sourcePlatform: Platform.RSS,
      publishedAt: { lt: cutoff },
    },
  });

  const remainingRss = await prisma.hotNews.count({
    where: { sourcePlatform: Platform.RSS },
  });

  return {
    cutoff: cutoff.toISOString(),
    toDelete,
    deleted: result.count,
    remainingRss,
  };
}

async function main(): Promise<void> {
  const stats = await runCleanupRssPreWindow();
  console.log(JSON.stringify(stats, null, 2));
}

const isMainEntry =
  typeof require !== 'undefined' && require.main === module;
const isTsxEntry = process.argv[1]?.endsWith('cleanup-rss-pre-window.ts');

if (isMainEntry || isTsxEntry) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(async () => {
      await getPrisma().$disconnect();
      process.exit(0);
    });
}
```

- [ ] **Step 2.4: Run tests, confirm PASS**

```bash
pnpm --filter @ai-hot-news/db test -- --run cleanup-rss-pre-window.spec
```
Expected: 3 PASS.

- [ ] **Step 2.5: Commit**

```bash
git add packages/db/scripts/cleanup-rss-pre-window.ts packages/db/scripts/cleanup-rss-pre-window.spec.ts
git commit -m "feat(sp4.5): one-shot cleanup script for pre-window RSS rows

DELETEs hot_news rows where sourcePlatform='RSS' AND publishedAt < now-7d.
Prints before/after counts as JSON.

To be run on prod via scripts/run-prod-oneshot.sh once worker is stopped.
HN/Reddit rows are explicitly NOT touched."
```

---

## Task 3: Idempotent SQL to update RSS crawlInterval

**Goal:** A versioned SQL file that bumps RSS source `crawlInterval` from 1800s (30min) to 86400s (1d). Idempotent — running twice does nothing extra.

**Files:**
- Create: `packages/db/scripts/sp4-5-update-rss-interval.sql`

> Why a `.sql` (not Prisma migration): this is a one-shot config change to seed data, not a schema change. Doesn't fit the migrations folder.

- [ ] **Step 3.1: Write the SQL**

```sql
-- packages/db/scripts/sp4-5-update-rss-interval.sql
-- SP-4.5: drop RSS crawl frequency from 30min to 1d.
-- Idempotent: the WHERE clause prevents re-applying after first run.
UPDATE source_configs
SET "crawlInterval" = 86400
WHERE platform = 'RSS' AND "crawlInterval" <> 86400;
```

- [ ] **Step 3.2: Sanity-check against local DB**

```bash
docker compose -f docker/docker-compose.yml exec postgres \
  psql -U ai_hot_news -d ai_hot_news_dev \
  -f - < packages/db/scripts/sp4-5-update-rss-interval.sql

docker compose -f docker/docker-compose.yml exec postgres \
  psql -U ai_hot_news -d ai_hot_news_dev \
  -c "SELECT platform, name, \"crawlInterval\" FROM source_configs WHERE platform='RSS';"
```
Expected: all RSS rows show `crawlInterval=86400`. Re-running the SQL prints `UPDATE 0`.

- [ ] **Step 3.3: Commit**

```bash
git add packages/db/scripts/sp4-5-update-rss-interval.sql
git commit -m "feat(sp4.5): idempotent SQL to bump RSS crawlInterval to 1d

Updates source_configs.crawlInterval 1800 → 86400 for RSS rows only.
Idempotent via 'WHERE crawlInterval <> 86400'."
```

---

## Task 4: Extend ListHotNewsQuery DTO with `platforms`

**Goal:** Accept `?platforms=RSS` or `?platforms=HACKERNEWS,REDDIT` from API clients. Validate via class-validator. Reject unknown platforms with 400 (kept simple — defer fallback logic to service).

**Files:**
- Modify: `apps/api/src/hot-news/dto/list-hot-news.query.ts`
- Test: `apps/api/src/hot-news/dto/list-hot-news.query.spec.ts` (new file)

- [ ] **Step 4.1: Write the failing tests**

```ts
// apps/api/src/hot-news/dto/list-hot-news.query.spec.ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, it, expect } from 'vitest';
import { ListHotNewsQuery } from './list-hot-news.query';

async function validateRaw(raw: Record<string, unknown>) {
  const dto = plainToInstance(ListHotNewsQuery, raw);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('ListHotNewsQuery', () => {
  it('accepts no platforms (default undefined)', async () => {
    const { dto, errors } = await validateRaw({});
    expect(errors).toEqual([]);
    expect(dto.platforms).toBeUndefined();
  });

  it('parses single platform from comma-string', async () => {
    const { dto, errors } = await validateRaw({ platforms: 'RSS' });
    expect(errors).toEqual([]);
    expect(dto.platforms).toEqual(['RSS']);
  });

  it('parses multiple platforms', async () => {
    const { dto, errors } = await validateRaw({ platforms: 'HACKERNEWS,REDDIT' });
    expect(errors).toEqual([]);
    expect(dto.platforms).toEqual(['HACKERNEWS', 'REDDIT']);
  });

  it('uppercases lowercase input', async () => {
    const { dto, errors } = await validateRaw({ platforms: 'rss' });
    expect(errors).toEqual([]);
    expect(dto.platforms).toEqual(['RSS']);
  });

  it('rejects unknown platform value', async () => {
    const { errors } = await validateRaw({ platforms: 'TIKTOK' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4.2: Run tests, confirm FAIL**

```bash
pnpm --filter @ai-hot-news/api test -- --run list-hot-news.query.spec
```
Expected: FAIL — `dto.platforms` not defined.

- [ ] **Step 4.3: Update the DTO**

```ts
// apps/api/src/hot-news/dto/list-hot-news.query.ts
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const ALLOWED_PLATFORMS = ['RSS', 'HACKERNEWS', 'REDDIT'] as const;
type AllowedPlatform = (typeof ALLOWED_PLATFORMS)[number];

export class ListHotNewsQuery {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 20;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value == null) return undefined;
    if (typeof value !== 'string') return value;
    return value
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
  })
  @IsArray()
  @IsIn(ALLOWED_PLATFORMS, { each: true })
  platforms?: AllowedPlatform[];
}
```

- [ ] **Step 4.4: Run tests, confirm PASS**

```bash
pnpm --filter @ai-hot-news/api test -- --run list-hot-news.query.spec
```
Expected: 5 PASS.

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/hot-news/dto/list-hot-news.query.ts apps/api/src/hot-news/dto/list-hot-news.query.spec.ts
git commit -m "feat(sp4.5): add platforms[] to ListHotNewsQuery

Accepts ?platforms=RSS or ?platforms=HACKERNEWS,REDDIT.
- Trim + uppercase via @Transform
- Validate each entry against {RSS, HACKERNEWS, REDDIT}
- Optional: undefined when absent (service applies default)"
```

---

## Task 5: HotNewsService — per-platform window filter

**Goal:** Wire `platforms` into the Prisma `where` clause with per-platform time windows: HN=48h, Reddit=48h, RSS=7d. Default (when `platforms` undefined) = `[HACKERNEWS, REDDIT]`.

**Files:**
- Modify: `apps/api/src/hot-news/hot-news.service.ts`
- Modify: `apps/api/src/hot-news/hot-news.service.spec.ts`

- [ ] **Step 5.1: Write the failing tests**

Append a new `describe` block (keep existing tests intact):

```ts
// apps/api/src/hot-news/hot-news.service.spec.ts (append)
describe('SP-4.5 platform window filter', () => {
  const NOW = new Date('2026-05-10T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('default platforms=[HACKERNEWS,REDDIT] with 48h windows', async () => {
    await service.list(1, 20);
    const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
    expect(findManyArgs.where.status).toBe('VISIBLE');
    expect(findManyArgs.where.OR).toHaveLength(2);
    const hn = findManyArgs.where.OR.find(
      (e: { sourcePlatform: string }) => e.sourcePlatform === 'HACKERNEWS',
    );
    const rd = findManyArgs.where.OR.find(
      (e: { sourcePlatform: string }) => e.sourcePlatform === 'REDDIT',
    );
    const expectedCutoff = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);
    expect(hn.publishedAt).toEqual({ gte: expectedCutoff });
    expect(rd.publishedAt).toEqual({ gte: expectedCutoff });
  });

  it('platforms=[RSS] uses 7d window', async () => {
    await service.list(1, 20, ['RSS']);
    const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
    expect(findManyArgs.where.OR).toHaveLength(1);
    const expectedCutoff = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(findManyArgs.where.OR[0].sourcePlatform).toBe('RSS');
    expect(findManyArgs.where.OR[0].publishedAt).toEqual({ gte: expectedCutoff });
  });

  it('platforms=[HACKERNEWS] uses 48h window for that one platform', async () => {
    await service.list(1, 20, ['HACKERNEWS']);
    const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
    expect(findManyArgs.where.OR).toHaveLength(1);
    expect(findManyArgs.where.OR[0].sourcePlatform).toBe('HACKERNEWS');
  });

  it('count() receives the same where clause as findMany()', async () => {
    await service.list(1, 20, ['RSS']);
    const findManyWhere = prismaMock.hotNews.findMany.mock.calls[0]![0]!.where;
    const countWhere = prismaMock.hotNews.count.mock.calls[0]![0]!.where;
    expect(countWhere).toEqual(findManyWhere);
  });
});
```

Also update the existing default-test expectation — the prior assertion `expect(where).toEqual({ status: 'VISIBLE' })` will no longer hold (we now also add `OR: [...]`). Replace those two existing tests' expectations:

```ts
// Replace the body of "passes where: { status: 'VISIBLE' } to findMany by default (SP-4)":
it('keeps status:VISIBLE filter on findMany (SP-4 contract)', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
  await service.list(1, 20);
  const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
  expect(findManyArgs.where.status).toBe('VISIBLE');
  vi.useRealTimers();
});

// And similarly for the count-default test — assert .where.status === 'VISIBLE'.
```

- [ ] **Step 5.2: Run tests, confirm new ones FAIL + old ones may FAIL too (signature change pending)**

```bash
pnpm --filter @ai-hot-news/api test -- --run hot-news.service.spec
```
Expected: failures around the new `OR` shape + service signature.

- [ ] **Step 5.3: Update the service**

```ts
// apps/api/src/hot-news/hot-news.service.ts
import { Injectable } from '@nestjs/common';
import { getPrisma, ContentStatus, type Platform } from '@ai-hot-news/db';
import type { HotNewsListResponseDto } from '@ai-hot-news/types';

const PLATFORM_WINDOW_HOURS: Record<Platform, number> = {
  TWITTER: 48, // unused for now, but typesafe for future
  HACKERNEWS: 48,
  REDDIT: 48,
  RSS: 24 * 7,
};

const DEFAULT_PLATFORMS: Platform[] = ['HACKERNEWS', 'REDDIT'];

@Injectable()
export class HotNewsService {
  async list(
    page: number,
    pageSize: number,
    platforms?: Platform[],
  ): Promise<HotNewsListResponseDto> {
    const prisma = getPrisma();
    const skip = (page - 1) * pageSize;
    const effectivePlatforms = platforms?.length ? platforms : DEFAULT_PLATFORMS;
    const now = new Date();

    const orClauses = effectivePlatforms.map((p) => ({
      sourcePlatform: p,
      publishedAt: {
        gte: new Date(now.getTime() - PLATFORM_WINDOW_HOURS[p] * 60 * 60 * 1000),
      },
    }));

    const where = {
      status: ContentStatus.VISIBLE,
      OR: orClauses,
    };

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

- [ ] **Step 5.4: Run tests, confirm PASS**

```bash
pnpm --filter @ai-hot-news/api test -- --run hot-news.service.spec
```
Expected: all PASS.

- [ ] **Step 5.5: Commit**

```bash
git add apps/api/src/hot-news/hot-news.service.ts apps/api/src/hot-news/hot-news.service.spec.ts
git commit -m "feat(sp4.5): per-platform window filter in HotNewsService

- Hardcoded PLATFORM_WINDOW_HOURS (HN=48, Reddit=48, RSS=168).
- Default platforms = [HACKERNEWS, REDDIT] when query omits it.
- where = status=VISIBLE AND (OR per-platform { sourcePlatform, publishedAt>=cutoff }).
- count() shares the same where as findMany() for accurate pagination."
```

---

## Task 6: Wire DTO → Service in HotNewsController

**Goal:** Pass `query.platforms` from the DTO into `service.list()`. Update controller test if any. (Currently no controller-level spec asserts the call args; we'll add one.)

**Files:**
- Modify: `apps/api/src/hot-news/hot-news.controller.ts`
- Modify (or create): `apps/api/src/hot-news/hot-news.controller.spec.ts`

- [ ] **Step 6.1: Write the failing test**

```ts
// apps/api/src/hot-news/hot-news.controller.spec.ts (add or replace)
import { describe, it, expect, vi } from 'vitest';
import { HotNewsController } from './hot-news.controller';
import { HotNewsService } from './hot-news.service';
import { ListHotNewsQuery } from './dto/list-hot-news.query';

describe('HotNewsController', () => {
  it('passes query.platforms to service.list', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    const controller = new HotNewsController({ list } as unknown as HotNewsService);
    const query = new ListHotNewsQuery();
    query.page = 1;
    query.pageSize = 20;
    query.platforms = ['RSS'];
    await controller.list(query);
    expect(list).toHaveBeenCalledWith(1, 20, ['RSS']);
  });

  it('passes undefined platforms when query omits it', async () => {
    const list = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    const controller = new HotNewsController({ list } as unknown as HotNewsService);
    const query = new ListHotNewsQuery();
    await controller.list(query);
    expect(list).toHaveBeenCalledWith(1, 20, undefined);
  });
});
```

- [ ] **Step 6.2: Run, FAIL**

```bash
pnpm --filter @ai-hot-news/api test -- --run hot-news.controller.spec
```

- [ ] **Step 6.3: Update controller**

```ts
// apps/api/src/hot-news/hot-news.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { HotNewsService } from './hot-news.service';
import { ListHotNewsQuery } from './dto/list-hot-news.query';
import type { HotNewsListResponseDto } from './dto/hot-news-list.response';

@Controller('hot-news')
export class HotNewsController {
  constructor(private readonly service: HotNewsService) {}

  @Get()
  list(@Query() query: ListHotNewsQuery): Promise<HotNewsListResponseDto> {
    return this.service.list(query.page, query.pageSize, query.platforms);
  }
}
```

- [ ] **Step 6.4: Run, PASS**

```bash
pnpm --filter @ai-hot-news/api test
```
Expected: full api suite green.

- [ ] **Step 6.5: Commit**

```bash
git add apps/api/src/hot-news/hot-news.controller.ts apps/api/src/hot-news/hot-news.controller.spec.ts
git commit -m "feat(sp4.5): wire query.platforms through HotNewsController"
```

---

## Task 7: Front-end fetcher accepts platforms

**Goal:** `fetchHotNewsList` accepts an optional `platforms?: Platform[]` and serializes it as `?platforms=A,B`. No UI changes yet.

**Files:**
- Modify: `apps/web/lib/api.ts`
- Test: `apps/web/lib/api.spec.ts` (new)

- [ ] **Step 7.1: Write the failing test**

```ts
// apps/web/lib/api.spec.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHotNewsList } from './api';

describe('fetchHotNewsList URL building', () => {
  afterEach(() => vi.restoreAllMocks());

  it('omits platforms when not passed', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 }), {
          status: 200,
        }),
      );
    await fetchHotNewsList(1, 20);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = (fetchSpy.mock.calls[0]![0] as string);
    expect(url).toContain('page=1');
    expect(url).toContain('pageSize=20');
    expect(url).not.toContain('platforms=');
  });

  it('serializes platforms as comma-joined string', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 }), {
          status: 200,
        }),
      );
    await fetchHotNewsList(1, 20, ['HACKERNEWS', 'REDDIT']);
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('platforms=HACKERNEWS%2CREDDIT'); // %2C = ','
  });
});
```

- [ ] **Step 7.2: Run, FAIL**

```bash
pnpm --filter web test -- --run api.spec
```

- [ ] **Step 7.3: Update fetcher**

```ts
// apps/web/lib/api.ts
import type { HotNewsListResponseDto } from '@ai-hot-news/types';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const FETCH_TIMEOUT_MS = 10_000;

export type FeedPlatform = 'HACKERNEWS' | 'REDDIT' | 'RSS';

export async function fetchHotNewsList(
  page: number,
  pageSize: number,
  platforms?: FeedPlatform[],
): Promise<HotNewsListResponseDto> {
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (platforms && platforms.length > 0) {
    qs.set('platforms', platforms.join(','));
  }
  const res = await fetch(`${API_URL}/hot-news?${qs.toString()}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as HotNewsListResponseDto;
}
```

- [ ] **Step 7.4: Run, PASS**

```bash
pnpm --filter web test
```

- [ ] **Step 7.5: Commit**

```bash
git add apps/web/lib/api.ts apps/web/lib/api.spec.ts
git commit -m "feat(sp4.5): fetchHotNewsList accepts optional platforms[]"
```

---

## Task 8: Front-end Tab UI on /news

**Goal:** Two server-rendered tabs at the top of `/news`: "社区热点" (default, `HACKERNEWS,REDDIT`) and "权威媒体" (`RSS`). Active tab driven by `?tab=` URL param. No client-side JS for state — tabs are anchor links, page is server-rendered (matches existing App Router style).

**Files:**
- Create: `apps/web/app/news/_components/feed-tabs.tsx`
- Modify: `apps/web/app/news/page.tsx`
- Modify: `apps/web/app/news/_components/pagination.tsx` (preserve `tab` in pagination links)

- [ ] **Step 8.1: Create the FeedTabs component**

```tsx
// apps/web/app/news/_components/feed-tabs.tsx
import Link from 'next/link';

export type FeedTab = 'community' | 'media';

const TABS: Array<{ key: FeedTab; label: string }> = [
  { key: 'community', label: '社区热点 · 48h' },
  { key: 'media', label: '权威媒体 · 7d' },
];

export function parseTab(raw: string | undefined): FeedTab {
  return raw === 'media' ? 'media' : 'community';
}

export function FeedTabs({ active }: { active: FeedTab }) {
  return (
    <nav className="mb-4 flex gap-2 border-b border-gray-200">
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/news?tab=${t.key}`}
            className={
              'border-b-2 px-3 py-2 text-sm transition-colors ' +
              (isActive
                ? 'border-blue-600 font-medium text-blue-700'
                : 'border-transparent text-gray-600 hover:text-gray-900')
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 8.2: Update /news/page.tsx to use FeedTabs + new fetcher signature**

```tsx
// apps/web/app/news/page.tsx
import { fetchHotNewsList, type FeedPlatform } from '@/lib/api';
import { ListHeader } from './_components/list-header';
import { NewsItem } from './_components/news-item';
import { Pagination } from './_components/pagination';
import { EmptyState } from './_components/empty-state';
import { ErrorState } from './_components/error-state';
import { FeedTabs, parseTab, type FeedTab } from './_components/feed-tabs';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ page?: string; tab?: string }>;
}

const TAB_PLATFORMS: Record<FeedTab, FeedPlatform[]> = {
  community: ['HACKERNEWS', 'REDDIT'],
  media: ['RSS'],
};

export default async function NewsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const parsed = parseInt(sp.page ?? '1', 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const pageSize = 20;
  const tab = parseTab(sp.tab);
  const platforms = TAB_PLATFORMS[tab];

  let data;
  try {
    data = await fetchHotNewsList(page, pageSize, platforms);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : 'Unknown error'} />;
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <FeedTabs active={tab} />
      {data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <ListHeader total={data.total} latestCrawledAt={data.items[0]?.crawledAt} />
          <ul className="mt-4 divide-y divide-gray-200">
            {data.items.map((item) => (
              <NewsItem key={item.id} item={item} />
            ))}
          </ul>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} tab={tab} />
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 8.3: Update Pagination to preserve `tab`**

```tsx
// apps/web/app/news/_components/pagination.tsx
import Link from 'next/link';
import type { FeedTab } from './feed-tabs';

export function Pagination({
  page,
  pageSize,
  total,
  tab,
}: {
  page: number;
  pageSize: number;
  total: number;
  tab: FeedTab;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);

  const baseClass = 'rounded border border-gray-300 px-3 py-1 text-sm';
  const disabledClass = 'pointer-events-none opacity-40';

  const link = (p: number) => `/news?tab=${tab}&page=${p}`;

  return (
    <div className="mt-6 flex items-center justify-center gap-3 text-sm text-gray-700">
      <Link href={link(prev)} className={`${baseClass} ${page <= 1 ? disabledClass : ''}`}>
        上一页
      </Link>
      <span>
        第 {page} / {totalPages} 页
      </span>
      <Link href={link(next)} className={`${baseClass} ${page >= totalPages ? disabledClass : ''}`}>
        下一页
      </Link>
    </div>
  );
}
```

- [ ] **Step 8.4: Run web build + tests to make sure nothing is broken**

```bash
pnpm --filter web build
pnpm --filter web test
```
Expected: build passes, all tests green.

- [ ] **Step 8.5: Commit**

```bash
git add apps/web/app/news/_components/feed-tabs.tsx \
        apps/web/app/news/page.tsx \
        apps/web/app/news/_components/pagination.tsx
git commit -m "feat(sp4.5): add 社区/权威媒体 tab switcher on /news

- New FeedTabs component reading ?tab=community|media (default community).
- Page.tsx maps tab to platforms[] passed to fetcher.
- Pagination preserves ?tab= so prev/next stay on the same tab."
```

---

## Task 9: Update decomposition design — SP-4.5 status row & plan link

**Goal:** When implementation lands, add a row to the §11 status table pointing to this plan. Keep this task **after** prod smoke completes (Task 11), so the commit range is final.

> Note: this is a "doc-only" task that runs **after** all code-level tasks ship and the prod smoke is green. Move the "in_progress" todo to it only after Task 11 evidence is captured.

**Files:**
- Modify: `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md` (§11 status table)

- [ ] **Step 9.1: Insert SP-4.5 row after the existing SP-4 row**

```markdown
| **SP-4.5** | <YYYY-MM-DD> | `<commit-range>`·spec: `2026-05-04-sp4-5-rss-windowing-design.md` ·plan: `2026-05-04-sp4-5-rss-windowing-plan.md` | `IngestionService.isWithinIngestWindow()` 7d cutoff (RSS only) · `cleanup-rss-pre-window.ts` 一次性 DELETE 1119 条历史 RSS · `sp4-5-update-rss-interval.sql` 把 RSS `crawlInterval` 1800→86400 · `HotNewsService.list(page, size, platforms?)` + `PLATFORM_WINDOW_HOURS` 表 · `ListHotNewsQuery.platforms` 解析 · `FeedTabs` + `?tab=community\|media` 切换 · `Pagination` 保留 tab | `fetchHotNewsList` 新签名（`platforms?: FeedPlatform[]`）`/news?tab=` URL 协议 · API `?platforms=` 查询参数 · 默认 list 行为变更（之前全部、现在 HN+REDDIT 48h）· `IngestResult.skipped` 现包含「平台 cutoff 丢弃」（无新字段）· RSS 拉取节流：30min→1d，OpenAI 新博客 ≤24h 延迟 |
```

- [ ] **Step 9.2: Append a smoke section "SP-4.5 端到端 smoke 凭据"**

Mirror the SP-4 smoke section's style (`本地 backfill 实测` + `VPS prod backfill 实测` + `DB 不变量实测` + `VPS API smoke`). Capture the actual prod numbers from Task 11 evidence.

- [ ] **Step 9.3: Commit**

```bash
git add docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md
git commit -m "docs(sp4.5): mark SP-4.5 complete in decomposition design

§11 status row + smoke evidence (commit range, prod stats, API smoke)."
```

---

## Task 10: Local verify — full monorepo lint/typecheck/test

**Goal:** Before opening a PR, confirm everything is green locally.

- [ ] **Step 10.1: Lint, typecheck, test**

```bash
pnpm turbo run lint
pnpm turbo run typecheck
pnpm turbo run test
```
Expected: all green. If `pnpm turbo run test` fails for the `db` package due to missing `DATABASE_URL`, ensure `packages/db/test/setup-env.ts` exists (created in SP-4); see `2026-05-04-sp4-content-cleaning-dedup-plan.md` Task 14 for context.

- [ ] **Step 10.2: Push branch + open PR**

```bash
git push -u origin HEAD
gh pr create --title "SP-4.5 RSS 时效性窗口 + 平台分区" --body "$(cat <<'EOF'
## Summary
- RSS ingest cutoff 7d (drops items in IngestionService before dedupe).
- API `?platforms=` query + per-platform window (HN/Reddit 48h, RSS 7d).
- `/news` now has 2 tabs: 社区 (default) / 权威媒体.
- One-shot `cleanup-rss-pre-window.ts` + `sp4-5-update-rss-interval.sql` for prod.
- RSS `crawlInterval` 30min → 1d.

## Test plan
- [ ] CI green (lint + typecheck + test).
- [ ] After deploy, run `cleanup-rss-pre-window.ts` on prod.
- [ ] Apply `sp4-5-update-rss-interval.sql` on prod.
- [ ] Smoke `?platforms=RSS` and default `/api/hot-news`.
- [ ] Verify DB invariants (RSS row count drops by ~1119; HN/Reddit unchanged).

Spec: `docs/superpowers/specs/2026-05-04-sp4-5-rss-windowing-design.md`
Plan: `docs/superpowers/plans/2026-05-04-sp4-5-rss-windowing-plan.md`
EOF
)"
```

- [ ] **Step 10.3: Wait for CI green, merge to main**

Once green, squash-merge or rebase-merge per repo convention. GitHub Actions auto-deploys to VPS.

---

## Task 11: Production deployment + smoke

**Goal:** Run the cleanup script and SQL config update on prod, verify all invariants, and capture smoke evidence to feed back into Task 9.

**Pre-flight (do BEFORE any prod write):**
- [ ] **Step 11.0a: Confirm GitHub Actions deploy succeeded** (check the merge commit's workflow run shows green for both worker and api images)
- [ ] **Step 11.0b: Capture pre-state baseline** (must run BEFORE the cleanup script)

```bash
ssh ai-hot-news-prod 'docker exec docker-postgres-1 psql -U ai_hot_news -d ai_hot_news_prod -c "
SELECT \"sourcePlatform\", status, COUNT(*) FROM hot_news GROUP BY 1,2 ORDER BY 1,2;
"'
```
Save output to a scratch note. Expected baseline (will drift slightly with new ingests):
- RSS VISIBLE ≈ 1129 / HIDDEN 0
- HN VISIBLE ~636 / HIDDEN ~157
- REDDIT VISIBLE ~270 / HIDDEN ~109

- [ ] **Step 11.1: Stop worker (single-writer)**

```bash
ssh ai-hot-news-prod
cd /srv/ai-hot-news
docker compose -f docker/docker-compose.prod.yml --env-file .env stop worker
```

- [ ] **Step 11.2: Run cleanup script via the prod-oneshot helper**

```bash
bash scripts/run-prod-oneshot.sh packages/db scripts/cleanup-rss-pre-window.ts
```
Expected JSON output:
```json
{
  "cutoff": "2026-04-27T...",
  "toDelete": 1119,
  "deleted": 1119,
  "remainingRss": 10
}
```
(Numbers may shift ±5 depending on the exact moment.)

- [ ] **Step 11.3: Apply the crawlInterval SQL**

```bash
docker compose -f docker/docker-compose.prod.yml exec postgres \
  psql -U ai_hot_news -d ai_hot_news_prod \
  -c "UPDATE source_configs SET \"crawlInterval\" = 86400 WHERE platform = 'RSS' AND \"crawlInterval\" <> 86400;"
```
Expected: `UPDATE 4` (Anthropic + OpenAI + DeepMind + Google Research, regardless of `enabled`).

Verify:
```bash
docker compose -f docker/docker-compose.prod.yml exec postgres \
  psql -U ai_hot_news -d ai_hot_news_prod \
  -c "SELECT name, \"crawlInterval\" FROM source_configs WHERE platform='RSS';"
```
Expected: all rows show `86400`.

- [ ] **Step 11.4: Restart worker**

```bash
docker compose -f docker/docker-compose.prod.yml --env-file .env start worker
```

`CrawlScheduler.onModuleInit()` re-registers BullMQ repeat jobs with the new 86400s interval.

- [ ] **Step 11.5: API smoke**

```bash
# Default (community tab)
curl -s 'https://hotnews.shinpeionline.top/api/hot-news?pageSize=50' | jq '.total, (.items[0:3] | map({title, sourcePlatform, publishedAt}))'
# Expected: total ≈ 380; items only HACKERNEWS or REDDIT.

# Media tab
curl -s 'https://hotnews.shinpeionline.top/api/hot-news?platforms=RSS&pageSize=50' | jq '.total, (.items[0:3] | map({title, sourcePlatform, publishedAt}))'
# Expected: total ≤ 10; items all RSS; publishedAt all within last 7d.

# Sanity
curl -s 'https://hotnews.shinpeionline.top/api/hot-news?platforms=HACKERNEWS&pageSize=10' | jq '.items | map(.sourcePlatform) | unique'
# Expected: ["HACKERNEWS"]
```

- [ ] **Step 11.6: DB-side invariant check**

```bash
ssh ai-hot-news-prod 'docker exec docker-postgres-1 psql -U ai_hot_news -d ai_hot_news_prod -c "
SELECT \"sourcePlatform\", status, COUNT(*) FROM hot_news GROUP BY 1,2 ORDER BY 1,2;
SELECT MIN(\"publishedAt\"), MAX(\"publishedAt\") FROM hot_news WHERE \"sourcePlatform\"='\''RSS'\'';
"'
```
Expected:
- RSS VISIBLE ≈ 10, HIDDEN 0 (post-cleanup, before the next 1d crawl)
- HN/Reddit unchanged from baseline
- RSS `MIN(publishedAt) >= now - 7d`

- [ ] **Step 11.7: Confirm RSS scheduler registered new interval**

```bash
ssh ai-hot-news-prod 'docker logs --tail 200 docker-worker-1 2>&1 | grep -i -E "crawl-repeat|RSS" | head -20'
```
Expected: log lines showing `crawl-repeat-<rss-source-id>` with `every: 86400000`. (Format depends on existing log statements; if none, accept the indirect proof from Step 11.3 verification + Step 11.4.)

- [ ] **Step 11.8: Capture all observations as a scratchpad note**

Save under `docs/superpowers/notes/2026-05-04-sp45-prod-smoke.md` (or paste into your own log) for use in Task 9. Include:
- Baseline counts from Step 11.0b
- Cleanup JSON from Step 11.2
- Both API smoke `total` numbers from Step 11.5
- DB invariant counts from Step 11.6
- Commit range (HEAD of main at smoke time vs SP-4 final commit `760fb20`)

- [ ] **Step 11.9: Now go back and execute Task 9** with the captured numbers. Commit. Done.

---

## Self-Review (run before handing off)

> The author of the plan completes this checklist; the engineer executing the plan does not.

**Spec coverage** — does each spec section map to a task?

| Spec § | Coverage |
|---|---|
| §2.1 Goal 1 (HN/Reddit 48h tab) | Task 5 + 8 |
| §2.1 Goal 2 (RSS 7d tab) | Task 5 + 8 |
| §2.1 Goal 3 (RSS pull throttle) | Task 3 (SQL) + Task 11.4 (worker restart picks it up) |
| §2.1 Goal 4 (DELETE 1119 historical RSS) | Task 2 (script) + Task 11.2 (run on prod) |
| §2.1 Goal 5 (no schema change) | Confirmed — no Prisma migration in any task |
| §2.1 Goal 6 (HN/Reddit untouched) | Task 1 explicitly tests "HN ignores window"; Task 2 explicitly tests "HN/Reddit not deleted" |
| §4.1 API contract | Task 4 (DTO) + Task 5 (service) + Task 6 (controller) |
| §4.2 Ingest cutoff | Task 1 |
| §4.3 SQL config update | Task 3 + Task 11.3 |
| §5 History data DELETE | Task 2 + Task 11.2 |
| §6 Tests (unit) | Tasks 1.1, 2.1, 4.1, 5.1, 6.1, 7.1 |
| §6 Tests (integration) | Task 2.1 covers crawler→ingest behavior via the cutoff helper at the ingestion boundary; explicit RSS-feed→DB end-to-end is **deferred** to Task 11 prod smoke. Acceptable trade-off given vitest mocking would essentially re-test Task 1 logic. |
| §7 Deployment | Task 11 |
| §8 Decision log sync | Already done at spec time (committed `da31a09`); §9 tasks pull plan link only |

**Gap:** §6 mentions an "explicit RSS-feed → DB integration test mocking the rss-parser". I deliberately omitted it in favor of (a) Task 1 unit testing the cutoff at `IngestionService` boundary + (b) Task 11 real-prod smoke. If the implementing engineer disagrees, add a `apps/worker/src/crawl/crawlers/rss.crawler.spec.ts` extension that mocks `parser.parseURL` to return 50 items with mixed `isoDate`s and asserts only ~10 reach DB. Not blocking.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / "add appropriate error handling" — verified by re-reading each task's code blocks.

**Type consistency:**
- `IngestResult.skipped` (existing) used for both pre-existing skip causes AND new RSS cutoff drop in Task 1 — explicitly intentional, called out in the commit message.
- `Platform` type from `@ai-hot-news/db` used everywhere; `FeedPlatform` in the web layer is a narrowed local string union (`'HACKERNEWS' | 'REDDIT' | 'RSS'`) — intentional, web doesn't need to import from db.
- `ALLOWED_PLATFORMS` in DTO (Task 4) hardcodes the same set as `FeedPlatform`. Drift is possible if someone adds a 4th platform. Acceptable for SP-4.5; revisit if SP-?? adds Twitter ingestion.
- `parseTab(raw)` in Task 8 returns `'community' | 'media'`; `TAB_PLATFORMS` map keyed by the same union — consistent.
- All time-window computations use `now.getTime() - hours * 60 * 60 * 1000` pattern. Consistent across Tasks 1, 2, 5.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-04-sp4-5-rss-windowing-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fastest iteration

**2. Inline Execution** — execute tasks here in this session, batch with checkpoints

**Which approach?**
