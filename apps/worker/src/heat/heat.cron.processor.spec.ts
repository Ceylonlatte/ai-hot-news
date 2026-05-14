import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  hotNews: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  sourceConfig: {
    findMany: vi.fn(),
  },
  $executeRawUnsafe: vi.fn(),
  $transaction: vi.fn(),
};

vi.mock('@ai-hot-news/db', () => ({
  getPrisma: () => mockPrisma,
}));

import { processHeatRefreshJob } from './heat.cron.processor';
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

describe('processHeatRefreshJob', () => {
  beforeEach(() => {
    mockPrisma.hotNews.findMany.mockReset();
    mockPrisma.hotNews.update.mockReset();
    mockPrisma.sourceConfig.findMany.mockReset();
    mockPrisma.$executeRawUnsafe.mockReset();
    mockPrisma.$transaction.mockImplementation(
      async (
        fnOrCalls: ((tx: typeof mockPrisma) => Promise<unknown>) | Promise<unknown>[],
      ) => {
        if (typeof fnOrCalls === 'function') return fnOrCalls(mockPrisma);
        return Promise.all(fnOrCalls);
      },
    );
  });

  afterEach(() => vi.useRealTimers());

  it('SELECTs all VISIBLE non-RSS rows within 48h, computes scores, batch UPDATEs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T13:00:00Z'));

    mockPrisma.hotNews.findMany.mockResolvedValue([
      {
        id: 'h1',
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: { score: 50, comments: 10 },
      },
      {
        id: 'h2',
        sourcePlatform: 'REDDIT',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: { score: 100, comments: 20, redditUpvoteRatio: 0.95 },
      },
    ]);
    mockPrisma.sourceConfig.findMany.mockResolvedValue([
      { platform: 'HACKERNEWS', weight: 0.5 },
      { platform: 'REDDIT', weight: 0.5 },
    ]);

    await processHeatRefreshJob(CFG);

    expect(mockPrisma.hotNews.findMany).toHaveBeenCalledTimes(1);
    const findArgs = mockPrisma.hotNews.findMany.mock.calls[0]![0]!;
    expect(findArgs.where.status).toBe('VISIBLE');
    expect(findArgs.where.sourcePlatform).toEqual({ not: 'RSS' });
    expect(findArgs.where.publishedAt.gte).toBeInstanceOf(Date);

    expect(mockPrisma.hotNews.update).toHaveBeenCalledTimes(2);

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const sqlCall = mockPrisma.$executeRawUnsafe.mock.calls[0]![0]! as string;
    expect(sqlCall).toMatch(/NTILE\(20\)/);
    expect(sqlCall).toMatch(/heatLevel/);
  });

  it('returns early when no candidate rows (no UPDATE, no NTILE)', async () => {
    mockPrisma.hotNews.findMany.mockResolvedValue([]);
    await processHeatRefreshJob(CFG);
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
    expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('uses sourceConfig weight per platform when available', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T13:00:00Z'));

    mockPrisma.hotNews.findMany.mockResolvedValue([
      {
        id: 'h1',
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: null,
      },
    ]);
    mockPrisma.sourceConfig.findMany.mockResolvedValue([
      { platform: 'HACKERNEWS', weight: 0.9 },
    ]);

    await processHeatRefreshJob(CFG);

    const updateArgs = mockPrisma.hotNews.update.mock.calls[0]![0]!;
    expect(updateArgs.data.heatScore).toBeCloseTo(46.97, 0);
  });
});
