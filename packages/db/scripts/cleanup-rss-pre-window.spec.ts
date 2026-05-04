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

    expect(stats.deleted).toBeGreaterThanOrEqual(1);
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

    await runCleanupRssPreWindow();

    const remaining = await prisma.hotNews.count({
      where: { sourceUrl: { startsWith: TEST_URL_PREFIX } },
    });
    expect(remaining).toBe(2);

    const survivors = await prisma.hotNews.findMany({
      where: { sourceUrl: { startsWith: TEST_URL_PREFIX } },
      select: { sourcePlatform: true },
    });
    expect(survivors.map((s) => s.sourcePlatform).sort()).toEqual([
      'HACKERNEWS',
      'REDDIT',
    ]);
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

    await runCleanupRssPreWindow();

    const survivor = await prisma.hotNews.findUnique({
      where: { sourceUrl: TEST_URL_PREFIX + 'boundary' },
    });
    expect(survivor).not.toBeNull();
  });
});
