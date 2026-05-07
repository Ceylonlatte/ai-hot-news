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
