import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, Platform, ContentStatus } from '@ai-hot-news/db';
import { processHeatRefreshJob } from './heat.cron.processor';
import { loadHeatConfig } from './heat.config';
import { computeBucketAt } from './bucket-at';

const prisma = getPrisma();
const TEST_PREFIX = 'sp6-cron-test-';

async function reset() {
  // Cascading delete (FK ON DELETE CASCADE) cleans heat_history for these rows.
  await prisma.hotNews.deleteMany({
    where: { sourceUrl: { startsWith: TEST_PREFIX } },
  });
}

describe('processHeatRefreshJob (integration)', () => {
  beforeEach(reset);

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it('updates heatScore + heatLevel for VISIBLE non-RSS rows in 48h window', async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    const fortyNineHoursAgo = new Date(now.getTime() - 49 * 60 * 60 * 1000);

    const rows = [
      {
        sourcePlatform: Platform.HACKERNEWS,
        score: 200,
        comments: 50,
        age: oneHourAgo,
      },
      {
        sourcePlatform: Platform.HACKERNEWS,
        score: 5,
        comments: 1,
        age: oneHourAgo,
      },
      {
        sourcePlatform: Platform.REDDIT,
        score: 1500,
        comments: 200,
        ratio: 0.95,
        age: oneHourAgo,
      },
      {
        sourcePlatform: Platform.REDDIT,
        score: 50,
        comments: 5,
        ratio: 0.5,
        age: oneHourAgo,
      },
    ];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const interactionData =
        r.sourcePlatform === Platform.REDDIT
          ? { score: r.score, comments: r.comments, redditUpvoteRatio: r.ratio }
          : { score: r.score, comments: r.comments };
      await prisma.hotNews.create({
        data: {
          title: `Test row ${i}`,
          content: `Test row ${i}`,
          sourcePlatform: r.sourcePlatform,
          sourceUrl: `${TEST_PREFIX}${i}`,
          publishedAt: r.age,
          dedupeHash: `${TEST_PREFIX}hash-${i}`,
          status: ContentStatus.VISIBLE,
          interactionData,
        },
      });
    }
    // RSS row — must NOT be touched
    await prisma.hotNews.create({
      data: {
        title: 'RSS row',
        content: 'RSS row',
        sourcePlatform: Platform.RSS,
        sourceUrl: `${TEST_PREFIX}rss`,
        publishedAt: oneHourAgo,
        dedupeHash: `${TEST_PREFIX}hash-rss`,
        status: ContentStatus.VISIBLE,
        interactionData: undefined,
      },
    });
    // >48h old — outside the cron window
    await prisma.hotNews.create({
      data: {
        title: 'Old row',
        content: 'Old row',
        sourcePlatform: Platform.HACKERNEWS,
        sourceUrl: `${TEST_PREFIX}old`,
        publishedAt: fortyNineHoursAgo,
        dedupeHash: `${TEST_PREFIX}hash-old`,
        status: ContentStatus.VISIBLE,
        interactionData: { score: 9999, comments: 999 },
      },
    });

    await processHeatRefreshJob(loadHeatConfig());

    const fresh = await prisma.hotNews.findMany({
      where: { sourceUrl: { startsWith: TEST_PREFIX } },
      orderBy: { sourceUrl: 'asc' },
      select: {
        sourceUrl: true,
        sourcePlatform: true,
        heatScore: true,
        heatLevel: true,
      },
    });

    const nonRss = fresh.filter(
      (r) => r.sourcePlatform !== 'RSS' && !r.sourceUrl.endsWith('-old'),
    );
    for (const r of nonRss) {
      expect(r.heatScore).toBeGreaterThan(0);
    }

    const rss = fresh.find((r) => r.sourceUrl.endsWith('-rss'))!;
    expect(rss.heatScore).toBe(0);
    expect(rss.heatLevel).toBe('LOW');

    const old = fresh.find((r) => r.sourceUrl.endsWith('-old'))!;
    expect(old.heatScore).toBe(0);
  });

  it('NTILE(20) recomputes heatLevel — top row gets BURST', async () => {
    const now = new Date();
    for (let i = 0; i < 25; i++) {
      await prisma.hotNews.create({
        data: {
          title: `NTILE row ${i}`,
          content: `NTILE row ${i}`,
          sourcePlatform: Platform.HACKERNEWS,
          sourceUrl: `${TEST_PREFIX}ntile-${i}`,
          publishedAt: now,
          dedupeHash: `${TEST_PREFIX}ntile-hash-${i}`,
          status: ContentStatus.VISIBLE,
          interactionData: { score: i * 100, comments: i * 20 },
        },
      });
    }

    await processHeatRefreshJob(loadHeatConfig());

    const sorted = await prisma.hotNews.findMany({
      where: { sourceUrl: { startsWith: `${TEST_PREFIX}ntile-` } },
      orderBy: { heatScore: 'desc' },
      select: { sourceUrl: true, heatScore: true, heatLevel: true },
    });

    expect(sorted[0]!.heatLevel).toBe('BURST');
    expect(sorted[sorted.length - 1]!.heatLevel).toBe('LOW');
    const levels = new Set(sorted.map((r) => r.heatLevel));
    expect(levels.has('BURST')).toBe(true);
    expect(levels.has('HOT')).toBe(true);
    expect(levels.has('NORMAL')).toBe(true);
    expect(levels.has('LOW')).toBe(true);
  });

  it('SP-11 — writes one heat_history row per (visible, non-RSS, 48h) entry per bucket', async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Two visible HN, one RSS (must be ignored), one >48h (must be ignored).
    await prisma.hotNews.create({
      data: {
        title: 'HN row 1',
        content: 'HN row 1',
        sourcePlatform: Platform.HACKERNEWS,
        sourceUrl: `${TEST_PREFIX}history-1`,
        publishedAt: oneHourAgo,
        dedupeHash: `${TEST_PREFIX}history-hash-1`,
        status: ContentStatus.VISIBLE,
        interactionData: { score: 100, comments: 20 },
      },
    });
    await prisma.hotNews.create({
      data: {
        title: 'HN row 2',
        content: 'HN row 2',
        sourcePlatform: Platform.HACKERNEWS,
        sourceUrl: `${TEST_PREFIX}history-2`,
        publishedAt: oneHourAgo,
        dedupeHash: `${TEST_PREFIX}history-hash-2`,
        status: ContentStatus.VISIBLE,
        interactionData: { score: 50, comments: 5 },
      },
    });
    await prisma.hotNews.create({
      data: {
        title: 'RSS row',
        content: 'RSS row',
        sourcePlatform: Platform.RSS,
        sourceUrl: `${TEST_PREFIX}history-rss`,
        publishedAt: oneHourAgo,
        dedupeHash: `${TEST_PREFIX}history-hash-rss`,
        status: ContentStatus.VISIBLE,
        interactionData: undefined,
      },
    });
    await prisma.hotNews.create({
      data: {
        title: 'Old row',
        content: 'Old row',
        sourcePlatform: Platform.HACKERNEWS,
        sourceUrl: `${TEST_PREFIX}history-old`,
        publishedAt: new Date(now.getTime() - 49 * 60 * 60 * 1000),
        dedupeHash: `${TEST_PREFIX}history-hash-old`,
        status: ContentStatus.VISIBLE,
        interactionData: { score: 100, comments: 10 },
      },
    });

    // Tick 1
    await processHeatRefreshJob(loadHeatConfig());
    const ids = await prisma.hotNews.findMany({
      where: { sourceUrl: { startsWith: `${TEST_PREFIX}history-` } },
      select: { id: true, sourceUrl: true },
    });
    const visibleNonRssIds = ids
      .filter((r) => r.sourceUrl === `${TEST_PREFIX}history-1` || r.sourceUrl === `${TEST_PREFIX}history-2`)
      .map((r) => r.id);
    const rssId = ids.find((r) => r.sourceUrl === `${TEST_PREFIX}history-rss`)!.id;
    const oldId = ids.find((r) => r.sourceUrl === `${TEST_PREFIX}history-old`)!.id;

    const after1 = await prisma.heatHistory.findMany({
      where: { hotNewsId: { in: [...visibleNonRssIds, rssId, oldId] } },
    });
    expect(after1.filter((h) => visibleNonRssIds.includes(h.hotNewsId)).length).toBe(2);
    expect(after1.filter((h) => h.hotNewsId === rssId).length).toBe(0);
    expect(after1.filter((h) => h.hotNewsId === oldId).length).toBe(0);

    // All rows aligned to the same bucket (within the same tick).
    const buckets = new Set(after1.map((h) => h.bucketAt.toISOString()));
    expect(buckets.size).toBe(1);
    const onlyBucket = [...buckets][0]!;
    expect(onlyBucket).toBe(computeBucketAt(new Date()).toISOString().replace(/\d{3}Z$/, '000Z'));

    // Tick 2 (same bucket because we ran immediately) — must be idempotent.
    await processHeatRefreshJob(loadHeatConfig());
    const after2 = await prisma.heatHistory.findMany({
      where: { hotNewsId: { in: visibleNonRssIds } },
    });
    expect(after2.length).toBe(2);

    // heatScore should still match the row's current heatScore.
    const current = await prisma.hotNews.findMany({
      where: { id: { in: visibleNonRssIds } },
      select: { id: true, heatScore: true, heatLevel: true },
    });
    for (const c of current) {
      const snap = after2.find((h) => h.hotNewsId === c.id)!;
      expect(snap.heatScore).toBeCloseTo(c.heatScore, 5);
      expect(snap.heatLevel).toBe(c.heatLevel);
    }
  });
});
