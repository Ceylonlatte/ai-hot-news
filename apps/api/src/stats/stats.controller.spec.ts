import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

describe('StatsController', () => {
  let controller: StatsController;
  let serviceMock: {
    getToday: ReturnType<typeof vi.fn>;
    getSources: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    serviceMock = {
      getToday: vi.fn(),
      getSources: vi.fn(),
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
});
