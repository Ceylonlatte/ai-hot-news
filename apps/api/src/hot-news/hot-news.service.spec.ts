import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HotNewsService } from './hot-news.service';
import * as dbModule from '@ai-hot-news/db';

describe('HotNewsService', () => {
  let service: HotNewsService;
  let prismaMock: {
    hotNews: {
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      groupBy: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prismaMock = {
      hotNews: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
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
      groupId: true,
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

  describe('SP-6 sort + heat field passthrough', () => {
    it('defaults to orderBy publishedAt desc when sort is undefined', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
      await service.list(1, 20);
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(findManyArgs.orderBy).toEqual([{ publishedAt: 'desc' }]);
      vi.useRealTimers();
    });

    it('uses orderBy [heatScore desc, publishedAt desc] when sort=heat', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
      await service.list(1, 20, ['HACKERNEWS', 'REDDIT'], 'heat');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(findManyArgs.orderBy).toEqual([
        { heatScore: 'desc' },
        { publishedAt: 'desc' },
      ]);
      vi.useRealTimers();
    });

    it('filters out RSS from platforms when sort=heat (SP-6 §0 Q1/Q2)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
      await service.list(1, 20, ['RSS', 'HACKERNEWS', 'REDDIT'], 'heat');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      const platformsInOr = findManyArgs.where.OR.map(
        (c: { sourcePlatform: string }) => c.sourcePlatform,
      );
      expect(platformsInOr).not.toContain('RSS');
      expect(platformsInOr).toEqual(['HACKERNEWS', 'REDDIT']);
      vi.useRealTimers();
    });

    it('returns empty result when sort=heat AND only RSS platform requested', async () => {
      const result = await service.list(1, 20, ['RSS'], 'heat');
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(prismaMock.hotNews.findMany).not.toHaveBeenCalled();
    });

    it('keeps RSS in platforms when sort=time (default)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
      await service.list(1, 20, ['RSS', 'HACKERNEWS'], 'time');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      const platformsInOr = findManyArgs.where.OR.map(
        (c: { sourcePlatform: string }) => c.sourcePlatform,
      );
      expect(platformsInOr).toContain('RSS');
      vi.useRealTimers();
    });

    it('selects heatScore + heatLevel from prisma', async () => {
      await service.list(1, 20);
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(findManyArgs.select).toMatchObject({
        heatScore: true,
        heatLevel: true,
      });
    });

    it('passes heatScore + heatLevel through to DTO', async () => {
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'h1',
          title: 'Anthropic launches Claude 5',
          titleZh: 'Anthropic 发布 Claude 5',
          summary: 'Anthropic 发布了 Claude 5。',
          aiTags: ['company:anthropic'],
          sourceUrl: 'https://example.com/h1',
          sourcePlatform: 'REDDIT',
          author: 'r/anthropic_user',
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:01:00Z'),
          heatScore: 67.4,
          heatLevel: 'HOT',
          groupId: null,
        },
      ]);
      prismaMock.hotNews.count.mockResolvedValueOnce(1);

      const result = await service.list(1, 20, ['REDDIT'], 'heat');

      expect(result.items[0]!.heatScore).toBe(67.4);
      expect(result.items[0]!.heatLevel).toBe('HOT');
    });
  });

  describe('SP-7 cross-platform groupId / groupSize', () => {
    it('singleton row (groupId=null) maps to groupSize=1 and skips the groupBy query', async () => {
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'a',
          title: 'Singleton',
          titleZh: null,
          summary: 's',
          aiTags: [],
          sourceUrl: 'https://example.com/a',
          sourcePlatform: 'HACKERNEWS',
          author: null,
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:00:00Z'),
          heatScore: 0,
          heatLevel: null,
          groupId: null,
        },
      ]);
      prismaMock.hotNews.count.mockResolvedValueOnce(1);

      const result = await service.list(1, 20);

      expect(result.items[0]!.groupId).toBeNull();
      expect(result.items[0]!.groupSize).toBe(1);
      expect(prismaMock.hotNews.groupBy).not.toHaveBeenCalled();
    });

    it('cross-platform group of 3 → every member receives groupSize=3 via ONE groupBy query', async () => {
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'r1', title: 'a', titleZh: null, summary: 's', aiTags: [],
          sourceUrl: 'https://example.com/r1', sourcePlatform: 'HACKERNEWS',
          author: null,
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:00:00Z'),
          heatScore: 0, heatLevel: null,
          groupId: 'grp-shared',
        },
        {
          id: 'r2', title: 'b', titleZh: null, summary: 's', aiTags: [],
          sourceUrl: 'https://example.com/r2', sourcePlatform: 'REDDIT',
          author: null,
          publishedAt: new Date('2026-05-10T09:00:00Z'),
          crawledAt: new Date('2026-05-10T09:00:00Z'),
          heatScore: 0, heatLevel: null,
          groupId: 'grp-shared',
        },
      ]);
      prismaMock.hotNews.count.mockResolvedValueOnce(2);
      prismaMock.hotNews.groupBy.mockResolvedValueOnce([
        { groupId: 'grp-shared', _count: { _all: 3 } },
      ]);

      const result = await service.list(1, 20);

      expect(prismaMock.hotNews.groupBy).toHaveBeenCalledTimes(1);
      const groupByArgs = prismaMock.hotNews.groupBy.mock.calls[0]![0]!;
      expect(groupByArgs).toMatchObject({
        by: ['groupId'],
        where: { groupId: { in: ['grp-shared'] }, status: 'VISIBLE' },
        _count: { _all: true },
      });
      expect(result.items[0]!.groupSize).toBe(3);
      expect(result.items[1]!.groupSize).toBe(3);
      expect(result.items[0]!.groupId).toBe('grp-shared');
    });

    it('groupSize falls back to 1 if groupBy returns no row for a groupId (rare race)', async () => {
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'r1', title: 'a', titleZh: null, summary: 's', aiTags: [],
          sourceUrl: 'https://example.com/r1', sourcePlatform: 'HACKERNEWS',
          author: null,
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:00:00Z'),
          heatScore: 0, heatLevel: null,
          groupId: 'grp-ghost',
        },
      ]);
      prismaMock.hotNews.count.mockResolvedValueOnce(1);
      prismaMock.hotNews.groupBy.mockResolvedValueOnce([]); // no count row

      const result = await service.list(1, 20);

      expect(result.items[0]!.groupId).toBe('grp-ghost');
      expect(result.items[0]!.groupSize).toBe(1);
    });

    it('issues exactly ONE groupBy query regardless of how many rows share groupIds', async () => {
      prismaMock.hotNews.findMany.mockResolvedValueOnce(
        Array.from({ length: 10 }, (_, i) => ({
          id: `r${i}`, title: 't', titleZh: null, summary: 's', aiTags: [],
          sourceUrl: `https://example.com/r${i}`, sourcePlatform: 'HACKERNEWS',
          author: null,
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:00:00Z'),
          heatScore: 0, heatLevel: null,
          groupId: i < 5 ? 'grp-A' : 'grp-B',
        })),
      );
      prismaMock.hotNews.count.mockResolvedValueOnce(10);
      prismaMock.hotNews.groupBy.mockResolvedValueOnce([
        { groupId: 'grp-A', _count: { _all: 5 } },
        { groupId: 'grp-B', _count: { _all: 5 } },
      ]);

      await service.list(1, 20);

      expect(prismaMock.hotNews.groupBy).toHaveBeenCalledTimes(1);
      const groupByArgs = prismaMock.hotNews.groupBy.mock.calls[0]![0]!;
      expect((groupByArgs.where.groupId.in as string[]).sort()).toEqual(['grp-A', 'grp-B']);
    });
  });
});
