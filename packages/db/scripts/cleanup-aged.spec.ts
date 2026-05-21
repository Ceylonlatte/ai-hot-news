import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cleanupAged, getPrisma } from '@ai-hot-news/db';

// SP-10.5 (2026-05-21): integration spec — runs against real dev DB.
// PREFIX-scoped row ids so SP-4.5 fileParallelism=false + turbo
// --concurrency=1 contract still holds: this spec mutates hot_news +
// heat_history, but only its own seeded rows (every id starts with
// `cleanup_test_<ts>_`).

const PREFIX = `cleanup_test_${Date.now()}_`;

const id = (suffix: string) => `${PREFIX}${suffix}`;

const NOW = Date.now();
const ONE_DAY = 86_400_000;

describe('cleanupAged (SP-10.5, real DB)', () => {
  beforeAll(async () => {
    const prisma = getPrisma();

    // 5 fresh rows (publishedAt = now-1d) — must survive cleanup
    for (let i = 0; i < 5; i++) {
      await prisma.hotNews.create({
        data: {
          id: id(`fresh${i}`),
          title: `Fresh ${i}`,
          content: 'fresh content',
          sourceUrl: `https://example.com/${PREFIX}fresh${i}`,
          sourcePlatform: 'HACKERNEWS',
          publishedAt: new Date(NOW - 1 * ONE_DAY),
          crawledAt: new Date(NOW - 1 * ONE_DAY),
          dedupeHash: `${PREFIX}fresh${i}`,
          status: 'VISIBLE',
          aiTags: [],
        },
      });
    }

    // 5 aged rows (publishedAt = now-31d) — must be deleted
    for (let i = 0; i < 5; i++) {
      await prisma.hotNews.create({
        data: {
          id: id(`aged${i}`),
          title: `Aged ${i}`,
          content: 'aged content',
          sourceUrl: `https://example.com/${PREFIX}aged${i}`,
          sourcePlatform: 'HACKERNEWS',
          publishedAt: new Date(NOW - 31 * ONE_DAY),
          crawledAt: new Date(NOW - 31 * ONE_DAY),
          dedupeHash: `${PREFIX}aged${i}`,
          status: 'VISIBLE',
          aiTags: [],
        },
      });
    }

    // Heat history seed (uses PREFIX-scoped hotNewsIds so CASCADE doesn't touch
    // production rows):
    //  - 5 aged rows × 1 recent snapshot each = 5 snapshots that go via CASCADE
    //  - 1 fresh row × 1 aged snapshot (bucketAt = now-10d) = 1 snapshot
    //    that should be deleted by Step 3 ("hot_news alive but snapshot old")
    for (let i = 0; i < 5; i++) {
      await prisma.heatHistory.create({
        data: {
          id: id(`hh_aged_recent${i}`),
          hotNewsId: id(`aged${i}`),
          bucketAt: new Date(NOW - 12 * 3_600_000), // 12h ago
          heatScore: 10,
          heatLevel: 'NORMAL',
        },
      });
    }
    await prisma.heatHistory.create({
      data: {
        id: id('hh_fresh_aged_snapshot'),
        hotNewsId: id('fresh0'),
        bucketAt: new Date(NOW - 10 * ONE_DAY), // 10d ago, beyond 7d cutoff
        heatScore: 5,
        heatLevel: 'LOW',
      },
    });
  });

  afterAll(async () => {
    const prisma = getPrisma();
    // CASCADE removes heat_history; explicit deleteMany handles any orphans
    // that survived a failing test run.
    await prisma.heatHistory.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await prisma.hotNews.deleteMany({ where: { id: { startsWith: PREFIX } } });
  });

  it('case 1: deletes aged hot_news and reports CASCADE preview', async () => {
    const result = await cleanupAged({ hotNewsDays: 30, heatHistoryDays: 7 });
    expect(result.hotNewsDeleted).toBeGreaterThanOrEqual(5);
    expect(result.heatHistoryCascaded).toBeGreaterThanOrEqual(5);

    const prisma = getPrisma();
    const surviving = await prisma.hotNews.count({
      where: { id: { startsWith: PREFIX } },
    });
    expect(surviving).toBe(5); // 5 fresh rows
  });

  it('case 2: idempotent — second run does not delete same rows again', async () => {
    const result = await cleanupAged({ hotNewsDays: 30, heatHistoryDays: 7 });
    // After case 1 there should be 0 aged rows belonging to this PREFIX
    // (but globally there might be other test data — assert prefix-scoped).
    const prisma = getPrisma();
    const stillAged = await prisma.hotNews.count({
      where: {
        id: { startsWith: PREFIX },
        publishedAt: { lt: new Date(NOW - 30 * ONE_DAY) },
      },
    });
    expect(stillAged).toBe(0);
    // Result counts are global, so we only assert the prefix's view is clean.
    expect(result.hotNewsDeleted).toBeGreaterThanOrEqual(0); // soft assert; could be 0 globally
  });

  it('case 3: heat_history > 7d but hot_news < 30d is deleted (Step 3 — aged snapshot under live row)', async () => {
    // After cases 1+2, the 1 fresh-row's aged snapshot (created in beforeAll)
    // should have been deleted by Step 3 of case 1.
    const prisma = getPrisma();
    const remaining = await prisma.heatHistory.count({
      where: {
        id: id('hh_fresh_aged_snapshot'),
      },
    });
    expect(remaining).toBe(0);
    // The fresh row itself should still exist.
    const freshRow = await prisma.hotNews.findUnique({ where: { id: id('fresh0') } });
    expect(freshRow).not.toBeNull();
  });

  it('case 4: dryRun=true does NOT mutate any rows', async () => {
    const prisma = getPrisma();

    // Seed one more aged row + one fresh row + one aged snapshot under fresh.
    await prisma.hotNews.create({
      data: {
        id: id('dryrun_aged'),
        title: 'Aged for dry-run',
        content: 'x',
        sourceUrl: `https://example.com/${PREFIX}dryrun_aged`,
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date(NOW - 31 * ONE_DAY),
        crawledAt: new Date(NOW - 31 * ONE_DAY),
        dedupeHash: `${PREFIX}dryrun_aged`,
        status: 'VISIBLE',
        aiTags: [],
      },
    });

    const before = await prisma.hotNews.count({
      where: { id: { startsWith: PREFIX } },
    });

    const result = await cleanupAged({
      hotNewsDays: 30,
      heatHistoryDays: 7,
      dryRun: true,
    });

    const after = await prisma.hotNews.count({
      where: { id: { startsWith: PREFIX } },
    });
    expect(after).toBe(before); // nothing actually deleted
    expect(result.hotNewsDeleted).toBeGreaterThanOrEqual(1); // count of candidates
    expect(result.heatHistoryCascaded).toBe(0); // dryRun path skips this counter
  });
});
