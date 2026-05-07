import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  it('keeps status:VISIBLE filter on findMany (SP-4 contract)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    await service.list(1, 20);
    expect(prismaMock.hotNews.findMany).toHaveBeenCalledTimes(1);
    const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
    expect(findManyArgs.where.status).toBe('VISIBLE');
    vi.useRealTimers();
  });

  it('keeps status:VISIBLE filter on count (SP-4 contract)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    await service.list(1, 20);
    expect(prismaMock.hotNews.count).toHaveBeenCalledTimes(1);
    const countArgs = prismaMock.hotNews.count.mock.calls[0]![0]!;
    expect(countArgs.where.status).toBe('VISIBLE');
    vi.useRealTimers();
  });

  it('does NOT include status / filterReason in the DTO output', async () => {
    prismaMock.hotNews.findMany.mockResolvedValueOnce([
      {
        id: 'a',
        title: 'A',
        titleZh: null,
        summary: null,
        aiTags: [],
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

  it('SP-5: passes titleZh + summary + aiTags through to the DTO', async () => {
    prismaMock.hotNews.findMany.mockResolvedValueOnce([
      {
        id: 'b',
        title: 'OpenAI launches GPT-5',
        titleZh: 'OpenAI 发布 GPT-5：推理大幅提升',
        summary: 'OpenAI 发布 GPT-5，已开放给所有 API 用户。',
        aiTags: ['company:OpenAI', 'model:GPT-5', 'category:Product', 'tech:LLM'],
        sourceUrl: 'https://example.com/b',
        sourcePlatform: 'RSS',
        author: null,
        publishedAt: new Date('2026-05-07T12:00:00Z'),
        crawledAt: new Date('2026-05-07T12:00:00Z'),
      },
      {
        id: 'c',
        title: 'Pending row',
        titleZh: null,
        summary: null,
        aiTags: [],
        sourceUrl: 'https://example.com/c',
        sourcePlatform: 'HACKERNEWS',
        author: 'alice',
        publishedAt: new Date('2026-05-07T12:30:00Z'),
        crawledAt: new Date('2026-05-07T12:30:00Z'),
      },
    ]);
    prismaMock.hotNews.count.mockResolvedValueOnce(2);

    const result = await service.list(1, 20);

    expect(result.items[0]).toMatchObject({
      id: 'b',
      titleZh: 'OpenAI 发布 GPT-5：推理大幅提升',
      summary: 'OpenAI 发布 GPT-5，已开放给所有 API 用户。',
      aiTags: ['company:OpenAI', 'model:GPT-5', 'category:Product', 'tech:LLM'],
    });
    expect(result.items[1]).toMatchObject({
      id: 'c',
      titleZh: null,
      summary: null,
      aiTags: [],
    });

    const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
    expect(findManyArgs.select).toMatchObject({
      titleZh: true,
      summary: true,
      aiTags: true,
    });
  });

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
      const expectedCutoff = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);
      expect(findManyArgs.where.OR[0].publishedAt).toEqual({ gte: expectedCutoff });
    });

    it('platforms=[] (empty array) falls back to default [HACKERNEWS, REDDIT]', async () => {
      await service.list(1, 20, []);
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(findManyArgs.where.OR).toHaveLength(2);
      const platforms = findManyArgs.where.OR
        .map((e: { sourcePlatform: string }) => e.sourcePlatform)
        .sort();
      expect(platforms).toEqual(['HACKERNEWS', 'REDDIT']);
    });

    it('count() receives the same where clause as findMany()', async () => {
      await service.list(1, 20, ['RSS']);
      const findManyWhere = prismaMock.hotNews.findMany.mock.calls[0]![0]!.where;
      const countWhere = prismaMock.hotNews.count.mock.calls[0]![0]!.where;
      expect(countWhere).toEqual(findManyWhere);
    });
  });
});
