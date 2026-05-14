import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  hotNews: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  sourceConfig: {
    findFirst: vi.fn(),
  },
};

vi.mock('@ai-hot-news/db', () => ({
  getPrisma: () => mockPrisma,
}));

import { HeatService, computeHeatScore } from './heat.service';
import type { HeatConfig } from './heat.config';

const CFG: HeatConfig = {
  decayTauHours: 48,
  cronIntervalMin: 30,
  batchSize: 500,
  concurrency: 2,
  maxHn: 500,
  maxReddit: 5000,
  maxTwitter: 100000,
};

describe('computeHeatScore', () => {
  it('returns 0 for RSS rows (early return)', () => {
    const score = computeHeatScore(
      {
        sourcePlatform: 'RSS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: null,
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    expect(score).toBe(0);
  });

  it('time decay: 1h old HN row, no interaction → timeScore weighted + sourceScore', () => {
    const score = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: null,
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    expect(score).toBeCloseTo(36.97, 1);
  });

  it('time decay: 48h old HN row → timeScore ~e^-1 weighted', () => {
    const score = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-07T13:00:00Z'),
        interactionData: null,
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    expect(score).toBeCloseTo(21.7, 0);
  });

  it('sourceWeight 1.0 → sourceScore contributes +12.5 vs weight=0.5', () => {
    const score05 = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: null,
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    const score10 = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: null,
      },
      1.0,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    expect(score10 - score05).toBeCloseTo(12.5, 1);
  });

  it('full case: HN row score=100/comments=20, age=24h, weight=0.5', () => {
    const score = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-08T13:00:00Z'),
        interactionData: { score: 100, comments: 20 },
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    expect(score).toBeCloseTo(55.5, 0);
  });
});

describe('HeatService.run', () => {
  let service: HeatService;

  beforeEach(() => {
    mockPrisma.hotNews.findUnique.mockReset();
    mockPrisma.hotNews.update.mockReset();
    mockPrisma.sourceConfig.findFirst.mockReset();
    service = new HeatService(CFG);
  });

  afterEach(() => vi.useRealTimers());

  it('SELECTs the row + sourceConfig.weight, then UPDATEs heatScore only (not heatLevel)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T13:00:00Z'));

    mockPrisma.hotNews.findUnique.mockResolvedValue({
      id: 'h1',
      sourcePlatform: 'HACKERNEWS',
      publishedAt: new Date('2026-05-08T13:00:00Z'),
      interactionData: { score: 100, comments: 20 },
    });
    mockPrisma.sourceConfig.findFirst.mockResolvedValue({ weight: 0.5 });

    await service.run('h1');

    expect(mockPrisma.hotNews.findUnique).toHaveBeenCalledWith({
      where: { id: 'h1' },
      select: { sourcePlatform: true, publishedAt: true, interactionData: true },
    });
    expect(mockPrisma.hotNews.update).toHaveBeenCalledTimes(1);
    const updateArgs = mockPrisma.hotNews.update.mock.calls[0]![0]!;
    expect(updateArgs.where).toEqual({ id: 'h1' });
    expect(updateArgs.data.heatScore).toBeCloseTo(55.5, 0);
    expect(updateArgs.data.heatLevel).toBeUndefined();
  });

  it('skips computation if row no longer exists (gracefully no-op)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(null);
    await expect(service.run('missing')).resolves.toBeUndefined();
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
  });

  it('uses default weight 0.5 if SourceConfig row not found', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T13:00:00Z'));

    mockPrisma.hotNews.findUnique.mockResolvedValue({
      id: 'h2',
      sourcePlatform: 'HACKERNEWS',
      publishedAt: new Date('2026-05-09T12:00:00Z'),
      interactionData: null,
    });
    mockPrisma.sourceConfig.findFirst.mockResolvedValue(null);

    await service.run('h2');

    const updateArgs = mockPrisma.hotNews.update.mock.calls[0]![0]!;
    expect(updateArgs.data.heatScore).toBeCloseTo(36.97, 1);
  });
});
