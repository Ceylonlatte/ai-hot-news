import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

describe('StatsController', () => {
  let controller: StatsController;
  let serviceMock: {
    getToday: ReturnType<typeof vi.fn>;
    getSources: ReturnType<typeof vi.fn>;
    getHeatCurve: ReturnType<typeof vi.fn>;
    getTrendingKeywords: ReturnType<typeof vi.fn>;
    topTags: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    serviceMock = {
      getToday: vi.fn(),
      getSources: vi.fn(),
      getHeatCurve: vi.fn(),
      getTrendingKeywords: vi.fn(),
      topTags: vi.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatsController],
      providers: [{ provide: StatsService, useValue: serviceMock }],
    }).compile();
    controller = module.get<StatsController>(StatsController);
  });

  it('GET /stats/today delegates to service.getToday()', async () => {
    const expected = {
      aggregateCount: 234,
      burstCount: 7,
      taggedCount: 189,
      sourceCount: 4,
      windowStart: '2026-05-19T00:00:00.000Z',
      windowEnd: '2026-05-20T00:00:00.000Z',
    };
    serviceMock.getToday.mockResolvedValue(expected);
    await expect(controller.today()).resolves.toEqual(expected);
    expect(serviceMock.getToday).toHaveBeenCalledTimes(1);
  });

  it('GET /stats/sources delegates to service.getSources()', async () => {
    const expected = {
      platforms: [{ platform: 'HACKERNEWS', count: 100, pct: 100 }],
      total: 100,
      windowStart: '2026-05-19T00:00:00.000Z',
      windowEnd: '2026-05-20T00:00:00.000Z',
    };
    serviceMock.getSources.mockResolvedValue(expected);
    await expect(controller.sources()).resolves.toEqual(expected);
    expect(serviceMock.getSources).toHaveBeenCalledTimes(1);
  });

  it('GET /stats/heat-curve delegates to service.getHeatCurve()', async () => {
    const expected = {
      buckets: new Array(24).fill(0),
      hourLabels: new Array(24).fill('00:00'),
      windowStart: 'a',
      windowEnd: 'b',
    };
    serviceMock.getHeatCurve.mockResolvedValue(expected);
    await expect(controller.heatCurve()).resolves.toEqual(expected);
  });

  it('GET /stats/trending-keywords uses default limit=8', async () => {
    const expected = { items: [], windowStart: 'a', windowEnd: 'b' };
    serviceMock.getTrendingKeywords.mockResolvedValue(expected);
    await controller.trendingKeywords('8');
    expect(serviceMock.getTrendingKeywords).toHaveBeenCalledWith(8);
  });

  it('GET /stats/trending-keywords passes parsed limit', async () => {
    const expected = { items: [], windowStart: 'a', windowEnd: 'b' };
    serviceMock.getTrendingKeywords.mockResolvedValue(expected);
    await controller.trendingKeywords('5');
    expect(serviceMock.getTrendingKeywords).toHaveBeenCalledWith(5);
  });

  it('GET /stats/trending-keywords passes NaN-safe limit when bogus string', async () => {
    // DefaultValuePipe still returns the raw string; parseInt of 'foo' is NaN.
    // Service is responsible for clamping (we verified that in service spec).
    const expected = { items: [], windowStart: 'a', windowEnd: 'b' };
    serviceMock.getTrendingKeywords.mockResolvedValue(expected);
    await controller.trendingKeywords('foo');
    expect(serviceMock.getTrendingKeywords).toHaveBeenCalledWith(NaN);
  });

  describe('GET /stats/top-tags (SP-12)', () => {
    const expected = {
      tags: [{ tag: 'company:OpenAI', count: 150 }],
      days: 30,
      limit: 20,
      windowStart: 'a',
      windowEnd: 'b',
    };

    it('uses default days=30 and limit=20', async () => {
      serviceMock.topTags.mockResolvedValue(expected);
      await controller.topTags('30', '20');
      expect(serviceMock.topTags).toHaveBeenCalledWith(30, 20);
    });

    it('passes parsed integer days + limit', async () => {
      serviceMock.topTags.mockResolvedValue(expected);
      await controller.topTags('7', '50');
      expect(serviceMock.topTags).toHaveBeenCalledWith(7, 50);
    });
  });
});
