import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HotNewsService } from './hot-news.service';
import * as dbModule from '@ai-hot-news/db';

describe('HotNewsService', () => {
  let service: HotNewsService;
  let prismaMock: {
    hotNews: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      groupBy: ReturnType<typeof vi.fn>;
    };
    heatHistory: {
      findMany: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
    $queryRaw: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prismaMock = {
      hotNews: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      heatHistory: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn().mockImplementation(async (calls: Promise<unknown>[]) => {
        return Promise.all(calls);
      }),
      // SP-7-D fold path uses two $queryRaw calls: one to pick representative
      // ids (DISTINCT ON + LIMIT/OFFSET), one for the COUNT(DISTINCT) total.
      // Default returns are empty + 0 so tests targeting the expand path
      // (which never touches $queryRaw) are unaffected.
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(dbModule, 'getPrisma').mockReturnValue(
      prismaMock as unknown as ReturnType<typeof dbModule.getPrisma>,
    );
    service = new HotNewsService();
  });

  it('keeps status:VISIBLE filter on findMany (SP-4 contract)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    await service.list(1, 20, undefined, undefined, 'expand');
    expect(prismaMock.hotNews.findMany).toHaveBeenCalledTimes(1);
    const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
    expect(findManyArgs.where.status).toBe('VISIBLE');
    vi.useRealTimers();
  });

  it('keeps status:VISIBLE filter on count (SP-4 contract)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    await service.list(1, 20, undefined, undefined, 'expand');
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

    const result = await service.list(1, 20, undefined, undefined, 'expand');

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

    const result = await service.list(1, 20, undefined, undefined, 'expand');

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
      await service.list(1, 20, undefined, undefined, 'expand');
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
      await service.list(1, 20, ['RSS'], undefined, 'expand');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(findManyArgs.where.OR).toHaveLength(1);
      const expectedCutoff = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
      expect(findManyArgs.where.OR[0].sourcePlatform).toBe('RSS');
      expect(findManyArgs.where.OR[0].publishedAt).toEqual({ gte: expectedCutoff });
    });

    it('platforms=[HACKERNEWS] uses 48h window for that one platform', async () => {
      await service.list(1, 20, ['HACKERNEWS'], undefined, 'expand');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(findManyArgs.where.OR).toHaveLength(1);
      expect(findManyArgs.where.OR[0].sourcePlatform).toBe('HACKERNEWS');
      const expectedCutoff = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);
      expect(findManyArgs.where.OR[0].publishedAt).toEqual({ gte: expectedCutoff });
    });

    it('platforms=[] (empty array) falls back to default [HACKERNEWS, REDDIT]', async () => {
      await service.list(1, 20, [], undefined, 'expand');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(findManyArgs.where.OR).toHaveLength(2);
      const platforms = findManyArgs.where.OR
        .map((e: { sourcePlatform: string }) => e.sourcePlatform)
        .sort();
      expect(platforms).toEqual(['HACKERNEWS', 'REDDIT']);
    });

    it('count() receives the same where clause as findMany()', async () => {
      await service.list(1, 20, ['RSS'], undefined, 'expand');
      const findManyWhere = prismaMock.hotNews.findMany.mock.calls[0]![0]!.where;
      const countWhere = prismaMock.hotNews.count.mock.calls[0]![0]!.where;
      expect(countWhere).toEqual(findManyWhere);
    });
  });

  describe('SP-6 sort + heat field passthrough', () => {
    it('defaults to orderBy publishedAt desc when sort is undefined', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
      await service.list(1, 20, undefined, undefined, 'expand');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(findManyArgs.orderBy).toEqual([{ publishedAt: 'desc' }]);
      vi.useRealTimers();
    });

    it('uses orderBy [heatScore desc, publishedAt desc] when sort=heat', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
      await service.list(1, 20, ['HACKERNEWS', 'REDDIT'], 'heat', 'expand');
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
      await service.list(1, 20, ['RSS', 'HACKERNEWS', 'REDDIT'], 'heat', 'expand');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      const platformsInOr = findManyArgs.where.OR.map(
        (c: { sourcePlatform: string }) => c.sourcePlatform,
      );
      expect(platformsInOr).not.toContain('RSS');
      expect(platformsInOr).toEqual(['HACKERNEWS', 'REDDIT']);
      vi.useRealTimers();
    });

    it('returns empty result when sort=heat AND only RSS platform requested', async () => {
      const result = await service.list(1, 20, ['RSS'], 'heat', 'expand');
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(prismaMock.hotNews.findMany).not.toHaveBeenCalled();
    });

    it('keeps RSS in platforms when sort=time (default)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
      await service.list(1, 20, ['RSS', 'HACKERNEWS'], 'time', 'expand');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      const platformsInOr = findManyArgs.where.OR.map(
        (c: { sourcePlatform: string }) => c.sourcePlatform,
      );
      expect(platformsInOr).toContain('RSS');
      vi.useRealTimers();
    });

    it('selects heatScore + heatLevel from prisma', async () => {
      await service.list(1, 20, undefined, undefined, 'expand');
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

      const result = await service.list(1, 20, ['REDDIT'], 'heat', 'expand');

      expect(result.items[0]!.heatScore).toBe(67.4);
      expect(result.items[0]!.heatLevel).toBe('HOT');
    });
  });

  describe('SP-7 cross-platform groupId / groupSize / groupPlatforms', () => {
    it('singleton row (groupId=null) maps to groupSize=1, groupPlatforms={}, and skips the groupBy query', async () => {
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

      const result = await service.list(1, 20, undefined, undefined, 'expand');

      expect(result.items[0]!.groupId).toBeNull();
      expect(result.items[0]!.groupSize).toBe(1);
      expect(result.items[0]!.groupPlatforms).toEqual({});
      expect(prismaMock.hotNews.groupBy).not.toHaveBeenCalled();
    });

    it('cross-platform group of 3 → every member receives groupSize=3 + per-platform breakdown via ONE groupBy', async () => {
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
      // SP-7-C: groupBy now buckets by (groupId, sourcePlatform); the same group
      // appears once per platform that contributed members.
      prismaMock.hotNews.groupBy.mockResolvedValueOnce([
        { groupId: 'grp-shared', sourcePlatform: 'HACKERNEWS', _count: { _all: 1 } },
        { groupId: 'grp-shared', sourcePlatform: 'REDDIT', _count: { _all: 2 } },
      ]);

      const result = await service.list(1, 20, undefined, undefined, 'expand');

      expect(prismaMock.hotNews.groupBy).toHaveBeenCalledTimes(1);
      const groupByArgs = prismaMock.hotNews.groupBy.mock.calls[0]![0]!;
      expect(groupByArgs).toMatchObject({
        by: ['groupId', 'sourcePlatform'],
        where: { groupId: { in: ['grp-shared'] }, status: 'VISIBLE' },
        _count: { _all: true },
      });
      expect(result.items[0]!.groupSize).toBe(3);
      expect(result.items[1]!.groupSize).toBe(3);
      expect(result.items[0]!.groupId).toBe('grp-shared');
      expect(result.items[0]!.groupPlatforms).toEqual({
        HACKERNEWS: 1,
        REDDIT: 2,
      });
      expect(result.items[1]!.groupPlatforms).toEqual({
        HACKERNEWS: 1,
        REDDIT: 2,
      });
    });

    it('groupSize falls back to 1 + groupPlatforms={} if groupBy returns no row for a groupId (rare race)', async () => {
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

      const result = await service.list(1, 20, undefined, undefined, 'expand');

      expect(result.items[0]!.groupId).toBe('grp-ghost');
      expect(result.items[0]!.groupSize).toBe(1);
      expect(result.items[0]!.groupPlatforms).toEqual({});
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
      // SP-7-C: 4 rows after (groupId, sourcePlatform) bucketing — both
      // groups only have HACKERNEWS in the mock, but a real run could yield
      // more buckets without changing the query count.
      prismaMock.hotNews.groupBy.mockResolvedValueOnce([
        { groupId: 'grp-A', sourcePlatform: 'HACKERNEWS', _count: { _all: 5 } },
        { groupId: 'grp-B', sourcePlatform: 'HACKERNEWS', _count: { _all: 5 } },
      ]);

      await service.list(1, 20, undefined, undefined, 'expand');

      expect(prismaMock.hotNews.groupBy).toHaveBeenCalledTimes(1);
      const groupByArgs = prismaMock.hotNews.groupBy.mock.calls[0]![0]!;
      expect((groupByArgs.where.groupId.in as string[]).sort()).toEqual(['grp-A', 'grp-B']);
    });
  });

  describe('SP-7-D fold path', () => {
    /** Helper: stage the two $queryRaw calls expected by the fold path —
     *  first call returns representative ids, second returns the total
     *  bucket count. */
    function stageFoldQueries(repIds: string[], total: number) {
      prismaMock.$queryRaw
        .mockResolvedValueOnce(repIds.map((id) => ({ id })))
        .mockResolvedValueOnce([{ total: BigInt(total) }]);
    }

    it('default groupMode is fold; runs DISTINCT-ON via $queryRaw not findMany+count', async () => {
      stageFoldQueries(['a'], 1);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'a', title: 'A', titleZh: null, summary: null, aiTags: [],
          sourceUrl: 'https://example.com/a', sourcePlatform: 'HACKERNEWS',
          author: null,
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:00:00Z'),
          heatScore: 0, heatLevel: null, groupId: null,
        },
      ]);

      const result = await service.list(1, 20);

      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
      // Hydration findMany ran exactly once with id IN representativeIds.
      expect(prismaMock.hotNews.findMany).toHaveBeenCalledTimes(1);
      const hydrateArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(hydrateArgs.where).toMatchObject({ id: { in: ['a'] } });
      // expand path (count + transactional findMany) was NOT used.
      expect(prismaMock.hotNews.count).not.toHaveBeenCalled();
      expect(result.total).toBe(1);
      expect(result.items[0]!.id).toBe('a');
    });

    it('singleton row in fold mode → groupMembers is empty array', async () => {
      stageFoldQueries(['a'], 1);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'a', title: 'Solo', titleZh: null, summary: null, aiTags: [],
          sourceUrl: 'https://example.com/a', sourcePlatform: 'HACKERNEWS',
          author: null,
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:00:00Z'),
          heatScore: 0, heatLevel: null, groupId: null,
        },
      ]);

      const result = await service.list(1, 20);

      expect(result.items[0]!.groupId).toBeNull();
      expect(result.items[0]!.groupSize).toBe(1);
      expect(result.items[0]!.groupMembers).toEqual([]);
    });

    it('group of 3 → representative + 2 members eager-loaded into groupMembers', async () => {
      stageFoldQueries(['rep'], 1);
      // Hydration: just the representative.
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'rep', title: 'Rep', titleZh: 'Rep ZH', summary: 's', aiTags: [],
          sourceUrl: 'https://example.com/rep', sourcePlatform: 'HACKERNEWS',
          author: null,
          publishedAt: new Date('2026-05-10T12:00:00Z'),
          crawledAt: new Date('2026-05-10T12:00:00Z'),
          heatScore: 80, heatLevel: 'HOT', groupId: 'grp-X',
        },
      ]);
      // SP-7-C breakdown groupBy.
      prismaMock.hotNews.groupBy.mockResolvedValueOnce([
        { groupId: 'grp-X', sourcePlatform: 'HACKERNEWS', _count: { _all: 1 } },
        { groupId: 'grp-X', sourcePlatform: 'REDDIT', _count: { _all: 2 } },
      ]);
      // SP-7-D members fetch (excluding the representative).
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'm1', title: 'M1', titleZh: null,
          sourceUrl: 'https://example.com/m1', sourcePlatform: 'REDDIT',
          author: 'r/openai',
          publishedAt: new Date('2026-05-10T08:00:00Z'),
          groupId: 'grp-X',
        },
        {
          id: 'm2', title: 'M2', titleZh: 'M2 ZH',
          sourceUrl: 'https://example.com/m2', sourcePlatform: 'REDDIT',
          author: 'r/agi',
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          groupId: 'grp-X',
        },
      ]);

      const result = await service.list(1, 20);

      expect(result.items[0]!.groupId).toBe('grp-X');
      expect(result.items[0]!.groupSize).toBe(3);
      expect(result.items[0]!.groupPlatforms).toEqual({
        HACKERNEWS: 1,
        REDDIT: 2,
      });
      expect(result.items[0]!.groupMembers).toHaveLength(2);
      expect(result.items[0]!.groupMembers[0]).toMatchObject({
        id: 'm1',
        title: 'M1',
        sourcePlatform: 'REDDIT',
      });
      // Representative is NOT duplicated in groupMembers.
      expect(result.items[0]!.groupMembers.find((m) => m.id === 'rep')).toBeUndefined();
      // Members fetch ran with NOT-IN repIds and ordered ASC by publishedAt.
      const memberFetchArgs = prismaMock.hotNews.findMany.mock.calls[1]![0]!;
      expect(memberFetchArgs.where).toMatchObject({
        groupId: { in: ['grp-X'] },
        status: 'VISIBLE',
        NOT: { id: { in: ['rep'] } },
      });
      expect(memberFetchArgs.orderBy).toEqual([{ publishedAt: 'asc' }]);
    });

    it('groupMembers does NOT include heat / aiTags / crawledAt fields', async () => {
      stageFoldQueries(['rep'], 1);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'rep', title: 'Rep', titleZh: null, summary: null, aiTags: [],
          sourceUrl: 'https://example.com/rep', sourcePlatform: 'HACKERNEWS',
          author: null,
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:00:00Z'),
          heatScore: 0, heatLevel: null, groupId: 'grp-Y',
        },
      ]);
      prismaMock.hotNews.groupBy.mockResolvedValueOnce([
        { groupId: 'grp-Y', sourcePlatform: 'HACKERNEWS', _count: { _all: 2 } },
      ]);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'm', title: 'M', titleZh: null,
          sourceUrl: 'https://example.com/m', sourcePlatform: 'HACKERNEWS',
          author: null,
          publishedAt: new Date('2026-05-10T08:00:00Z'),
          groupId: 'grp-Y',
        },
      ]);

      const result = await service.list(1, 20);
      const member = result.items[0]!.groupMembers[0]!;
      expect(member).not.toHaveProperty('heatScore');
      expect(member).not.toHaveProperty('heatLevel');
      expect(member).not.toHaveProperty('aiTags');
      expect(member).not.toHaveProperty('summary');
      expect(member).not.toHaveProperty('crawledAt');
      expect(member).toMatchObject({
        id: 'm',
        title: 'M',
        sourcePlatform: 'HACKERNEWS',
        publishedAt: '2026-05-10T08:00:00.000Z',
      });
    });

    it('total reflects DISTINCT bucket count from $queryRaw, not findMany row count', async () => {
      // Imagine 87-row Claude megagroup + 5 singletons → 6 buckets.
      stageFoldQueries(['rep1', 'rep2'], 6);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'rep1', title: '', titleZh: null, summary: null, aiTags: [],
          sourceUrl: 'u1', sourcePlatform: 'HACKERNEWS',
          author: null,
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:00:00Z'),
          heatScore: 0, heatLevel: null, groupId: null,
        },
        {
          id: 'rep2', title: '', titleZh: null, summary: null, aiTags: [],
          sourceUrl: 'u2', sourcePlatform: 'REDDIT',
          author: null,
          publishedAt: new Date('2026-05-10T11:00:00Z'),
          crawledAt: new Date('2026-05-10T11:00:00Z'),
          heatScore: 0, heatLevel: null, groupId: null,
        },
      ]);

      const result = await service.list(1, 20);
      expect(result.total).toBe(6);
      expect(result.items).toHaveLength(2);
    });

    it('returns empty without hydration when $queryRaw yields zero ids', async () => {
      stageFoldQueries([], 0);

      const result = await service.list(1, 20);

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(prismaMock.hotNews.findMany).not.toHaveBeenCalled();
      expect(prismaMock.hotNews.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('SP-7-E subreddit field passthrough', () => {
    /** Reuse fold-path stager since subreddit is also relevant for fold groupMembers. */
    function stageFoldQueries(repIds: string[], total: number) {
      prismaMock.$queryRaw
        .mockResolvedValueOnce(repIds.map((id) => ({ id })))
        .mockResolvedValueOnce([{ total: BigInt(total) }]);
    }

    it('Reddit rep row → subreddit pulled from interactionData.redditSubreddit', async () => {
      stageFoldQueries(['r1'], 1);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'r1', title: 't', titleZh: null, summary: 's', aiTags: [],
          sourceUrl: 'https://reddit.com/r/agi/x', sourcePlatform: 'REDDIT',
          author: 'user1',
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:00:00Z'),
          heatScore: 0, heatLevel: null, groupId: null,
          interactionData: { redditSubreddit: 'agi', redditId: 'abc123' },
        },
      ]);

      const result = await service.list(1, 20, ['REDDIT']);

      expect(result.items[0]!.subreddit).toBe('agi');
      // The full JSONB is NOT exposed — only the derived field.
      expect(result.items[0]).not.toHaveProperty('interactionData');
    });

    it('HN row → subreddit is null even if interactionData has random fields', async () => {
      stageFoldQueries(['h1'], 1);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'h1', title: 't', titleZh: null, summary: null, aiTags: [],
          sourceUrl: 'https://news.ycombinator.com/item?id=1', sourcePlatform: 'HACKERNEWS',
          author: 'alice',
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:00:00Z'),
          heatScore: 0, heatLevel: null, groupId: null,
          interactionData: { hnId: 44000001, hnPosition: 3 },
        },
      ]);

      const result = await service.list(1, 20, ['HACKERNEWS']);
      expect(result.items[0]!.subreddit).toBeNull();
    });

    it('legacy Reddit row missing interactionData entirely → subreddit = null (not throw)', async () => {
      stageFoldQueries(['r-legacy'], 1);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'r-legacy', title: 't', titleZh: null, summary: null, aiTags: [],
          sourceUrl: 'https://reddit.com/r/?', sourcePlatform: 'REDDIT',
          author: 'oldsoul',
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:00:00Z'),
          heatScore: 0, heatLevel: null, groupId: null,
          interactionData: null,
        },
      ]);

      const result = await service.list(1, 20, ['REDDIT']);
      expect(result.items[0]!.subreddit).toBeNull();
    });

    it('Reddit row with interactionData but no redditSubreddit field → null (corrupt-tolerant)', async () => {
      stageFoldQueries(['r-corrupt'], 1);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'r-corrupt', title: 't', titleZh: null, summary: null, aiTags: [],
          sourceUrl: 'https://reddit.com/r/?', sourcePlatform: 'REDDIT',
          author: null,
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:00:00Z'),
          heatScore: 0, heatLevel: null, groupId: null,
          interactionData: { score: 100, comments: 5 },
        },
      ]);

      const result = await service.list(1, 20, ['REDDIT']);
      expect(result.items[0]!.subreddit).toBeNull();
    });

    it('Reddit row with non-string redditSubreddit (e.g. number from buggy migration) → null', async () => {
      stageFoldQueries(['r-bad'], 1);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'r-bad', title: 't', titleZh: null, summary: null, aiTags: [],
          sourceUrl: 'https://reddit.com/r/?', sourcePlatform: 'REDDIT',
          author: null,
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:00:00Z'),
          heatScore: 0, heatLevel: null, groupId: null,
          interactionData: { redditSubreddit: 12345 },
        },
      ]);

      const result = await service.list(1, 20, ['REDDIT']);
      expect(result.items[0]!.subreddit).toBeNull();
    });

    it('groupMembers also carry per-member subreddit', async () => {
      stageFoldQueries(['rep'], 1);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'rep', title: 'Rep', titleZh: null, summary: 's', aiTags: [],
          sourceUrl: 'https://reddit.com/r/agi/rep', sourcePlatform: 'REDDIT',
          author: null,
          publishedAt: new Date('2026-05-10T12:00:00Z'),
          crawledAt: new Date('2026-05-10T12:00:00Z'),
          heatScore: 0, heatLevel: null, groupId: 'grp-mixed',
          interactionData: { redditSubreddit: 'agi' },
        },
      ]);
      prismaMock.hotNews.groupBy.mockResolvedValueOnce([
        { groupId: 'grp-mixed', sourcePlatform: 'REDDIT', _count: { _all: 2 } },
        { groupId: 'grp-mixed', sourcePlatform: 'HACKERNEWS', _count: { _all: 1 } },
      ]);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'm-reddit', title: 'M-R', titleZh: null,
          sourceUrl: 'https://reddit.com/r/openai/x', sourcePlatform: 'REDDIT',
          author: 'u/cross-poster',
          publishedAt: new Date('2026-05-10T08:00:00Z'),
          groupId: 'grp-mixed',
          interactionData: { redditSubreddit: 'OpenAI' },
        },
        {
          id: 'm-hn', title: 'M-HN', titleZh: null,
          sourceUrl: 'https://news.ycombinator.com/item?id=2', sourcePlatform: 'HACKERNEWS',
          author: 'bob',
          publishedAt: new Date('2026-05-10T09:00:00Z'),
          groupId: 'grp-mixed',
          interactionData: { hnId: 99 },
        },
      ]);

      const result = await service.list(1, 20);

      expect(result.items[0]!.subreddit).toBe('agi');
      expect(result.items[0]!.groupMembers).toHaveLength(2);
      const reddit = result.items[0]!.groupMembers.find((m) => m.id === 'm-reddit')!;
      const hn = result.items[0]!.groupMembers.find((m) => m.id === 'm-hn')!;
      expect(reddit.subreddit).toBe('OpenAI');
      expect(hn.subreddit).toBeNull();
      // Members slice still does NOT include the raw JSONB.
      expect(reddit).not.toHaveProperty('interactionData');
    });

    it('expand mode also populates subreddit on rep rows', async () => {
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'r1', title: 't', titleZh: null, summary: null, aiTags: [],
          sourceUrl: 'https://reddit.com/r/LocalLLaMA/x', sourcePlatform: 'REDDIT',
          author: 'someone',
          publishedAt: new Date('2026-05-10T10:00:00Z'),
          crawledAt: new Date('2026-05-10T10:00:00Z'),
          heatScore: 0, heatLevel: null, groupId: null,
          interactionData: { redditSubreddit: 'LocalLLaMA' },
        },
      ]);
      prismaMock.hotNews.count.mockResolvedValueOnce(1);

      const result = await service.list(1, 20, ['REDDIT'], 'time', 'expand');

      expect(result.items[0]!.subreddit).toBe('LocalLLaMA');
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    });
  });

  // ─── SP-10: range + tags filtering ───────────────────────────────────────
  describe('SP-10 range + tags filters', () => {
    const NOW = new Date('2026-05-21T14:00:00Z');

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    it('range=1d overrides platform window — HN/Reddit use 24h instead of 48h', async () => {
      await service.list(1, 20, undefined, undefined, 'expand', '1d');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      const expectedCutoff = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
      for (const clause of findManyArgs.where.OR) {
        expect(clause.publishedAt).toEqual({ gte: expectedCutoff });
      }
    });

    it('range=7d overrides RSS 7d default too (consistent 7d for all selected platforms)', async () => {
      await service.list(1, 20, ['HACKERNEWS', 'REDDIT'], undefined, 'expand', '7d');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      const expectedCutoff = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
      // community tab default platform window is 48h; range=7d expands beyond it
      for (const clause of findManyArgs.where.OR) {
        expect(clause.publishedAt).toEqual({ gte: expectedCutoff });
      }
    });

    it('range=30d allows 30-day lookback (aligned with SP-10.5 TTL upper bound)', async () => {
      await service.list(1, 20, undefined, undefined, 'expand', '30d');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      const expectedCutoff = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
      expect(findManyArgs.where.OR[0].publishedAt).toEqual({ gte: expectedCutoff });
    });

    it('range=undefined preserves legacy per-platform window (HN/Reddit 48h, RSS 7d)', async () => {
      await service.list(1, 20, ['RSS', 'HACKERNEWS'], 'time', 'expand');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      const rss = findManyArgs.where.OR.find(
        (e: { sourcePlatform: string }) => e.sourcePlatform === 'RSS',
      );
      const hn = findManyArgs.where.OR.find(
        (e: { sourcePlatform: string }) => e.sourcePlatform === 'HACKERNEWS',
      );
      expect(rss.publishedAt).toEqual({ gte: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000) });
      expect(hn.publishedAt).toEqual({ gte: new Date(NOW.getTime() - 48 * 60 * 60 * 1000) });
    });

    it('tags=[category:Opinion] applies aiTags hasEvery clause', async () => {
      await service.list(1, 20, undefined, undefined, 'expand', undefined, ['category:Opinion']);
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(findManyArgs.where.aiTags).toEqual({ hasEvery: ['category:Opinion'] });
    });

    it('tags=[A,B] applies AND semantics via hasEvery', async () => {
      await service.list(1, 20, undefined, undefined, 'expand', undefined, [
        'category:Opinion',
        'company:OpenAI',
      ]);
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(findManyArgs.where.aiTags).toEqual({
        hasEvery: ['category:Opinion', 'company:OpenAI'],
      });
    });

    it('tags=undefined omits aiTags clause entirely (legacy clients unaffected)', async () => {
      await service.list(1, 20, undefined, undefined, 'expand');
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(findManyArgs.where.aiTags).toBeUndefined();
    });

    it('tags=[] (empty array) omits aiTags clause (DTO transform also returns undefined)', async () => {
      await service.list(1, 20, undefined, undefined, 'expand', undefined, []);
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(findManyArgs.where.aiTags).toBeUndefined();
    });

    it('range + tags combine — both clauses present, count() shares the same where', async () => {
      await service.list(1, 20, undefined, undefined, 'expand', '7d', ['category:Funding']);
      const findManyArgs = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      const countArgs = prismaMock.hotNews.count.mock.calls[0]![0]!;
      const expectedCutoff = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
      expect(findManyArgs.where.OR[0].publishedAt).toEqual({ gte: expectedCutoff });
      expect(findManyArgs.where.aiTags).toEqual({ hasEvery: ['category:Funding'] });
      // count() must use the EXACT same where to keep pagination total correct
      expect(countArgs.where).toEqual(findManyArgs.where);
    });

    it('groupMode=fold path: tags are embedded in raw SQL (aiTags @> ARRAY[...])', async () => {
      // Stage fold path: two $queryRaw calls (rep ids + total)
      prismaMock.$queryRaw
        .mockResolvedValueOnce([{ id: 'fold-1' }])
        .mockResolvedValueOnce([{ total: BigInt(1) }]);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'fold-1', title: 'F', titleZh: null, summary: null,
          aiTags: ['category:OpenSource'],
          sourceUrl: 'https://example.com/fold-1', sourcePlatform: 'HACKERNEWS',
          author: null,
          publishedAt: new Date(NOW.getTime() - 3600_000),
          crawledAt: new Date(NOW.getTime() - 3600_000),
          heatScore: 0, heatLevel: null, groupId: null,
          interactionData: null,
        },
      ]);

      await service.list(1, 20, undefined, undefined, 'fold', '1d', ['category:OpenSource']);

      // Fold path uses $queryRaw; the SQL must reference @> with tag array.
      // Prisma's Sql template parameterizes values, so we inspect the assembled
      // call's values (or strings) to confirm both pieces are present.
      const firstCall = prismaMock.$queryRaw.mock.calls[0]![0]!;
      // Prisma.sql produces { strings, values } objects; check both surfaces.
      const serialized = JSON.stringify(firstCall);
      expect(serialized).toMatch(/aiTags|"aiTags"/);
      // The tag values must be in `values` array passed alongside the SQL.
      // (Prisma.sql wraps these in a Sql instance whose `values` contains the bound parameters.)
      expect(serialized).toMatch(/OpenSource/);
    });
  });

  // ─── SP-12: q (pg_trgm search overlay) ────────────────────────────────
  describe('SP-12 q (trigram search)', () => {
    const NOW = new Date('2026-05-22T14:00:00Z');

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    it('q=undefined: legacy Prisma findMany path stays untouched (zero regression)', async () => {
      await service.list(1, 20, undefined, undefined, 'expand');
      // expand path with no q → uses prisma.hotNews.findMany, not $queryRaw
      expect(prismaMock.hotNews.findMany).toHaveBeenCalled();
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    });

    it('q="OpenAI" in expand mode: switches to $queryRaw (Prisma cannot run % operator)', async () => {
      prismaMock.$queryRaw
        .mockResolvedValueOnce([{ id: 'hit-1' }])
        .mockResolvedValueOnce([{ total: BigInt(1) }]);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'hit-1', title: 'OpenAI releases GPT-5', titleZh: null, summary: null,
          aiTags: ['company:OpenAI'],
          sourceUrl: 'https://example.com/x', sourcePlatform: 'HACKERNEWS',
          author: null,
          publishedAt: new Date(NOW.getTime() - 3600_000),
          crawledAt: new Date(NOW.getTime() - 3600_000),
          heatScore: 0, heatLevel: null, groupId: null,
          interactionData: null,
        },
      ]);

      await service.list(1, 20, undefined, undefined, 'expand', undefined, undefined, 'OpenAI');

      // q is set → must go through $queryRaw (similarity ordering)
      expect(prismaMock.$queryRaw).toHaveBeenCalled();
      // The first call must reference the search expression + pg_trgm % operator
      const firstCall = prismaMock.$queryRaw.mock.calls[0]![0]!;
      const serialized = JSON.stringify(firstCall);
      expect(serialized).toMatch(/OpenAI/);
      // The expression should include the canonical search columns
      expect(serialized).toMatch(/titleZh|aiTags/);
    });

    it('q + tags: both AND-applied (q similarity AND aiTags hasEvery)', async () => {
      prismaMock.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: BigInt(0) }]);
      await service.list(
        1, 20, undefined, undefined, 'expand', '30d',
        ['category:Release'],
        'GPT-5',
      );
      const firstCall = prismaMock.$queryRaw.mock.calls[0]![0]!;
      const serialized = JSON.stringify(firstCall);
      expect(serialized).toMatch(/GPT-5/);
      expect(serialized).toMatch(/category:Release/);
    });

    it('q + range=7d: 7-day window applied in search SQL', async () => {
      prismaMock.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: BigInt(0) }]);
      await service.list(1, 20, undefined, undefined, 'expand', '7d', undefined, 'Claude');
      const firstCall = prismaMock.$queryRaw.mock.calls[0]![0]!;
      const serialized = JSON.stringify(firstCall);
      // 7-day cutoff = NOW - 7*24h
      const expectedCutoff = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      expect(serialized).toMatch(/Claude/);
      expect(serialized).toContain(expectedCutoff);
    });

    it('q in fold mode: also routes through $queryRaw (existing fold path absorbs search clause)', async () => {
      prismaMock.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: BigInt(0) }]);
      await service.list(1, 20, undefined, undefined, 'fold', undefined, undefined, 'Anthropic');
      expect(prismaMock.$queryRaw).toHaveBeenCalled();
      const firstCall = prismaMock.$queryRaw.mock.calls[0]![0]!;
      expect(JSON.stringify(firstCall)).toMatch(/Anthropic/);
    });

    it('q="" (empty string after trim) — treated as no-search, legacy path', async () => {
      // Empty string should be impossible from DTO (Transform trim returns
      // empty), but defensively the service must not call $queryRaw if
      // q is undefined OR empty.
      await service.list(1, 20, undefined, undefined, 'expand', undefined, undefined, '');
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
      expect(prismaMock.hotNews.findMany).toHaveBeenCalled();
    });

    it('q with similarity ORDER BY: SQL contains similarity() function call', async () => {
      prismaMock.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: BigInt(0) }]);
      await service.list(1, 20, undefined, undefined, 'expand', undefined, undefined, 'RAG');
      const firstCall = prismaMock.$queryRaw.mock.calls[0]![0]!;
      const serialized = JSON.stringify(firstCall);
      expect(serialized).toMatch(/similarity/);
    });
  });

  // ─── SP-11: detail() ─────────────────────────────────────────────────────
  describe('detail', () => {
    const baseRow = {
      id: 'rep1',
      title: 'Title',
      titleZh: '标题',
      summary: 'Summary',
      content: 'Full body',
      sourcePlatform: 'HACKERNEWS' as const,
      sourceUrl: 'https://news.ycombinator.com/item?id=42',
      author: 'pg',
      publishedAt: new Date('2026-05-19T10:00:00Z'),
      crawledAt: new Date('2026-05-19T10:05:00Z'),
      aiTags: ['company:openai', 'tech:security'],
      matchedKeywords: [],
      heatScore: 72.5,
      heatLevel: 'BURST' as const,
      groupId: 'grp-xyz',
      extractStatus: 'OK',
    };

    it('returns null when row does not exist', async () => {
      prismaMock.hotNews.findUnique.mockResolvedValueOnce(null);
      const result = await service.detail('does-not-exist');
      expect(result).toBeNull();
      // Must NOT touch relatedItems path on 404.
      expect(prismaMock.hotNews.findMany).not.toHaveBeenCalled();
    });

    it('returns row with empty relatedItems when groupId is null and aiTags is empty', async () => {
      prismaMock.hotNews.findUnique.mockResolvedValueOnce({
        ...baseRow,
        groupId: null,
        aiTags: [],
      });
      const result = await service.detail('rep1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('rep1');
      expect(result!.relatedItems).toEqual([]);
      expect(prismaMock.hotNews.findMany).not.toHaveBeenCalled();
    });

    it('returns related via groupId when groupId is set (excludes self, limit 5, sort heatScore DESC)', async () => {
      prismaMock.hotNews.findUnique.mockResolvedValueOnce(baseRow);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 's1', title: 'Sibling 1', titleZh: null,
          sourcePlatform: 'REDDIT', heatScore: 65, heatLevel: 'HOT',
          publishedAt: new Date('2026-05-19T09:00:00Z'),
        },
        {
          id: 's2', title: 'Sibling 2', titleZh: 'Z2',
          sourcePlatform: 'HACKERNEWS', heatScore: 60, heatLevel: 'HOT',
          publishedAt: new Date('2026-05-19T08:30:00Z'),
        },
      ]);

      const result = await service.detail('rep1');
      expect(result!.relatedItems).toHaveLength(2);
      expect(result!.relatedItems[0]!.id).toBe('s1');
      expect(result!.relatedItems[0]!.heatScore).toBe(65);

      const args = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      expect(args.where.groupId).toBe('grp-xyz');
      expect(args.where.id).toEqual({ not: 'rep1' });
      expect(args.where.status).toBe('VISIBLE');
      expect(args.take).toBe(5);
      expect(args.orderBy).toEqual({ heatScore: 'desc' });
    });

    it('falls back to aiTag overlap when groupId is null but aiTags is non-empty', async () => {
      prismaMock.hotNews.findUnique.mockResolvedValueOnce({
        ...baseRow,
        groupId: null,
      });
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'tag-overlap-1', title: 'Tag match',
          titleZh: null, sourcePlatform: 'REDDIT', heatScore: 40, heatLevel: 'NORMAL',
          publishedAt: new Date('2026-05-19T07:00:00Z'),
        },
      ]);

      const result = await service.detail('rep1');
      expect(result!.relatedItems).toHaveLength(1);
      expect(result!.relatedItems[0]!.id).toBe('tag-overlap-1');

      const args = prismaMock.hotNews.findMany.mock.calls[0]![0]!;
      // Fallback path uses hasSome on aiTags, NOT groupId.
      expect(args.where.aiTags).toEqual({ hasSome: ['company:openai', 'tech:security'] });
      expect(args.where.id).toEqual({ not: 'rep1' });
      expect(args.where.groupId).toBeUndefined();
    });

    it('falls back to aiTag overlap when groupId is set but no group siblings exist', async () => {
      prismaMock.hotNews.findUnique.mockResolvedValueOnce(baseRow);
      // First findMany: group query → empty.
      prismaMock.hotNews.findMany.mockResolvedValueOnce([]);
      // Second findMany: aiTag fallback → 1 hit.
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 'tag-fallback', title: 'Tag fallback',
          titleZh: null, sourcePlatform: 'HACKERNEWS', heatScore: 30, heatLevel: 'NORMAL',
          publishedAt: new Date('2026-05-19T06:00:00Z'),
        },
      ]);

      const result = await service.detail('rep1');
      expect(result!.relatedItems).toHaveLength(1);
      expect(result!.relatedItems[0]!.id).toBe('tag-fallback');
      expect(prismaMock.hotNews.findMany).toHaveBeenCalledTimes(2);
    });

    it('serializes ISO timestamps on detail + relatedItems', async () => {
      prismaMock.hotNews.findUnique.mockResolvedValueOnce(baseRow);
      prismaMock.hotNews.findMany.mockResolvedValueOnce([
        {
          id: 's1', title: 'Sib', titleZh: null,
          sourcePlatform: 'REDDIT', heatScore: 50, heatLevel: 'HOT',
          publishedAt: new Date('2026-05-19T09:30:15Z'),
        },
      ]);

      const result = await service.detail('rep1');
      expect(typeof result!.publishedAt).toBe('string');
      expect(result!.publishedAt).toBe('2026-05-19T10:00:00.000Z');
      expect(result!.crawledAt).toBe('2026-05-19T10:05:00.000Z');
      expect(result!.relatedItems[0]!.publishedAt).toBe('2026-05-19T09:30:15.000Z');
    });
  });

  // ─── SP-11: heatHistory() ────────────────────────────────────────────────
  describe('heatHistory', () => {
    it('returns ascending bucket series for hours=48 (default)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-19T14:00:00Z'));
      prismaMock.heatHistory.findMany.mockResolvedValueOnce([
        {
          bucketAt: new Date('2026-05-19T12:00:00Z'),
          heatScore: 40,
          heatLevel: 'NORMAL',
        },
        {
          bucketAt: new Date('2026-05-19T13:30:00Z'),
          heatScore: 55,
          heatLevel: 'HOT',
        },
      ]);

      const result = await service.heatHistory('rep1', 48);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]!.heatScore).toBe(40);
      expect(result.items[0]!.bucketAt).toBe('2026-05-19T12:00:00.000Z');
      expect(result.hours).toBe(48);

      const args = prismaMock.heatHistory.findMany.mock.calls[0]![0]!;
      expect(args.where.hotNewsId).toBe('rep1');
      expect(args.where.bucketAt.gte).toEqual(
        new Date('2026-05-17T14:00:00Z'), // now - 48h
      );
      expect(args.orderBy).toEqual({ bucketAt: 'asc' });
      vi.useRealTimers();
    });

    it('respects hours=24', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-19T14:00:00Z'));
      await service.heatHistory('rep1', 24);
      const args = prismaMock.heatHistory.findMany.mock.calls[0]![0]!;
      expect(args.where.bucketAt.gte).toEqual(
        new Date('2026-05-18T14:00:00Z'),
      );
      vi.useRealTimers();
    });

    it('respects hours=72', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-19T14:00:00Z'));
      await service.heatHistory('rep1', 72);
      const args = prismaMock.heatHistory.findMany.mock.calls[0]![0]!;
      expect(args.where.bucketAt.gte).toEqual(
        new Date('2026-05-16T14:00:00Z'),
      );
      vi.useRealTimers();
    });

    it('returns empty items + correct window when row has no snapshots yet', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-19T14:00:00Z'));
      const result = await service.heatHistory('brand-new-id', 48);
      expect(result.items).toEqual([]);
      expect(result.hours).toBe(48);
      expect(result.windowEnd).toBe('2026-05-19T14:00:00.000Z');
      expect(result.windowStart).toBe('2026-05-17T14:00:00.000Z');
      vi.useRealTimers();
    });
  });
});
