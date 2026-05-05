import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Platform, getPrisma } from '@ai-hot-news/db';
import { runWipe } from './wipe-hot-news-pre-ai';

const prisma = getPrisma();

describe('wipe-hot-news-pre-ai', () => {
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
          sourceUrl: 'https://news.ycombinator.com/item?id=1',
          title: 'a',
          content: 'a',
          rawHtml: null,
          publishedAt: new Date('2026-05-01'),
          dedupeHash: 'h1',
          status: 'VISIBLE',
        },
        {
          sourcePlatform: Platform.RSS,
          sourceUrl: 'https://example.com/post',
          title: 'b',
          content: 'b',
          rawHtml: null,
          publishedAt: new Date('2026-05-02'),
          dedupeHash: 'h2',
          status: 'HIDDEN',
        },
      ],
    });
    const before = await prisma.hotNews.count();
    expect(before).toBe(2);

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
