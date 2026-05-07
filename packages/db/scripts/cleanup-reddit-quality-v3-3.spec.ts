import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, Platform } from '@ai-hot-news/db';
import { runCleanupRedditQualityV3_3 } from './cleanup-reddit-quality-v3-3';

const prisma = getPrisma();

const TEST_URL_PREFIX = 'https://sp5-v3-3-cleanup.example.com/';

async function cleanup() {
  await prisma.hotNews.deleteMany({
    where: { sourceUrl: { startsWith: TEST_URL_PREFIX } },
  });
}

interface SeedShape {
  slug: string;
  platform?: Platform;
  score?: number;
  comments?: number;
  redditUpvoteRatio?: number | null;
  interactionData?: unknown;
}

async function seed({
  slug,
  platform = Platform.REDDIT,
  score,
  comments,
  redditUpvoteRatio,
  interactionData,
}: SeedShape) {
  const ix =
    interactionData !== undefined
      ? interactionData
      : score !== undefined
        ? {
            score,
            comments: comments ?? 0,
            redditUpvoteRatio: redditUpvoteRatio ?? null,
            redditId: `t3_${slug}`,
            redditSubreddit: 'test',
          }
        : null;

  return prisma.hotNews.create({
    data: {
      title: `Test ${slug}`,
      content: 'body',
      sourcePlatform: platform,
      sourceUrl: TEST_URL_PREFIX + slug,
      publishedAt: new Date(),
      dedupeHash: `sp5-v3-3-${slug}`,
      interactionData: ix as never,
    },
  });
}

describe('cleanup-reddit-quality-v3-3', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('drops 钓鱼帖 pattern (ratio<0.7)', async () => {
    await seed({ slug: 'fish', score: 100, comments: 151, redditUpvoteRatio: 0.5 });
    await seed({ slug: 'high', score: 100, comments: 50, redditUpvoteRatio: 0.95 });

    const stats = await runCleanupRedditQualityV3_3();

    expect(stats.byReason.reddit_low_ratio).toBeGreaterThanOrEqual(1);
    expect(stats.deleted).toBeGreaterThanOrEqual(1);
    const remaining = await prisma.hotNews.findMany({
      where: { sourceUrl: { startsWith: TEST_URL_PREFIX } },
      select: { sourceUrl: true },
    });
    expect(remaining.map((r) => r.sourceUrl)).toContain(TEST_URL_PREFIX + 'high');
    expect(remaining.map((r) => r.sourceUrl)).not.toContain(TEST_URL_PREFIX + 'fish');
  });

  it('drops 伸手党 pattern (score<10 AND comments<5)', async () => {
    await seed({ slug: 'beg', score: 1, comments: 2, redditUpvoteRatio: 1.0 });
    await seed({ slug: 'discussion', score: 3, comments: 8, redditUpvoteRatio: 0.95 });
    await seed({ slug: 'popular', score: 10, comments: 0, redditUpvoteRatio: 0.95 });

    const stats = await runCleanupRedditQualityV3_3();

    expect(stats.byReason.reddit_low_engagement).toBeGreaterThanOrEqual(1);
    const remaining = await prisma.hotNews.findMany({
      where: { sourceUrl: { startsWith: TEST_URL_PREFIX } },
      select: { sourceUrl: true },
    });
    expect(remaining.map((r) => r.sourceUrl).sort()).toEqual([
      TEST_URL_PREFIX + 'discussion',
      TEST_URL_PREFIX + 'popular',
    ]);
  });

  it('preserves rows with missing interactionData (conservative)', async () => {
    await seed({ slug: 'noix', interactionData: null });

    const stats = await runCleanupRedditQualityV3_3();

    expect(stats.byReason.missing_interaction_data).toBeGreaterThanOrEqual(1);
    const survivor = await prisma.hotNews.findUnique({
      where: { sourceUrl: TEST_URL_PREFIX + 'noix' },
    });
    expect(survivor).not.toBeNull();
  });

  it('does NOT touch HACKERNEWS / RSS rows even when their interactionData would fail Reddit thresholds', async () => {
    await seed({
      slug: 'hn-low',
      platform: Platform.HACKERNEWS,
      interactionData: { score: 1, comments: 0, hnId: 99999 },
    });
    await seed({
      slug: 'rss-row',
      platform: Platform.RSS,
      interactionData: null,
    });

    await runCleanupRedditQualityV3_3();

    const survivors = await prisma.hotNews.findMany({
      where: { sourceUrl: { startsWith: TEST_URL_PREFIX } },
      select: { sourcePlatform: true },
    });
    expect(survivors.map((s) => s.sourcePlatform).sort()).toEqual(
      ['HACKERNEWS', 'RSS'],
    );
  });

  it('idempotent: a second run drops zero (all survivors pass)', async () => {
    await seed({ slug: 'idem-fish', score: 100, comments: 151, redditUpvoteRatio: 0.5 });
    await seed({ slug: 'idem-pop', score: 100, comments: 50, redditUpvoteRatio: 0.95 });

    await runCleanupRedditQualityV3_3();
    const second = await runCleanupRedditQualityV3_3();

    expect(second.deleted).toBe(0);
    expect(second.byReason.reddit_low_ratio).toBe(0);
    expect(second.byReason.reddit_low_engagement).toBe(0);
  });

  it('handles null upvote_ratio gracefully (cold post: only engagement rule applies)', async () => {
    await seed({ slug: 'cold-pass', score: 50, comments: 20, redditUpvoteRatio: null });
    await seed({ slug: 'cold-fail', score: 1, comments: 0, redditUpvoteRatio: null });

    const stats = await runCleanupRedditQualityV3_3();

    expect(stats.byReason.reddit_low_engagement).toBeGreaterThanOrEqual(1);
    const remaining = await prisma.hotNews.findMany({
      where: { sourceUrl: { startsWith: TEST_URL_PREFIX } },
      select: { sourceUrl: true },
    });
    expect(remaining.map((r) => r.sourceUrl)).toContain(TEST_URL_PREFIX + 'cold-pass');
    expect(remaining.map((r) => r.sourceUrl)).not.toContain(TEST_URL_PREFIX + 'cold-fail');
  });
});
