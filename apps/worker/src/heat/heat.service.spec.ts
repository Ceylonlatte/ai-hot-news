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
  it('returns {heatScore:0, engagementScore:0} for RSS rows (early return)', () => {
    const result = computeHeatScore(
      {
        sourcePlatform: 'RSS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: null,
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    expect(result).toEqual({ heatScore: 0, engagementScore: 0 });
  });

  it('time decay: 1h old HN row, no interaction → timeScore weighted + sourceScore', () => {
    const { heatScore } = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: null,
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    expect(heatScore).toBeCloseTo(36.97, 1);
  });

  it('time decay: 48h old HN row → timeScore ~e^-1 weighted', () => {
    const { heatScore } = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-07T13:00:00Z'),
        interactionData: null,
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    expect(heatScore).toBeCloseTo(21.7, 0);
  });

  it('sourceWeight 1.0 → sourceScore contributes +12.5 vs weight=0.5 (heatScore)', () => {
    const r05 = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: null,
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    const r10 = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: null,
      },
      1.0,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    expect(r10.heatScore - r05.heatScore).toBeCloseTo(12.5, 1);
    // SP-6 follow-up: engagementScore 也跟 sourceWeight 线性相关（不含 time decay）
    expect(r10.engagementScore - r05.engagementScore).toBeCloseTo(12.5, 1);
  });

  it('full case: HN row score=100/comments=20, age=24h, weight=0.5', () => {
    const { heatScore } = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-08T13:00:00Z'),
        interactionData: { score: 100, comments: 20 },
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    expect(heatScore).toBeCloseTo(55.5, 0);
  });

  // SP-6 follow-up (2026-05-23): engagementScore 不依赖 publishedAt — 同 row
  // 24h 后查询应返回同样 engagementScore，但 heatScore 因 time decay 显著降低。
  it('engagementScore is time-independent (24h difference → same engagementScore)', () => {
    const input = {
      sourcePlatform: 'HACKERNEWS' as const,
      publishedAt: new Date('2026-05-08T13:00:00Z'),
      interactionData: { score: 100, comments: 20 },
    };
    const r24h = computeHeatScore(
      input,
      0.5,
      new Date('2026-05-09T13:00:00Z'), // 24h after publish
      CFG,
    );
    const r48h = computeHeatScore(
      input,
      0.5,
      new Date('2026-05-10T13:00:00Z'), // 48h after publish
      CFG,
    );
    expect(r48h.engagementScore).toBeCloseTo(r24h.engagementScore, 5);
    // heatScore drops because timeScore decayed
    expect(r48h.heatScore).toBeLessThan(r24h.heatScore);
  });

  it('engagementScore = heatScore minus the time-decay component (×0.25)', () => {
    const result = computeHeatScore(
      {
        sourcePlatform: 'HACKERNEWS',
        publishedAt: new Date('2026-05-09T12:00:00Z'),
        interactionData: { score: 100, comments: 20 },
      },
      0.5,
      new Date('2026-05-09T13:00:00Z'),
      CFG,
    );
    // 1h old → timeScore = exp(-1/48) * 100 ≈ 97.94
    const expectedTimeContrib = Math.exp(-1 / 48) * 100 * 0.25;
    expect(result.heatScore - result.engagementScore).toBeCloseTo(expectedTimeContrib, 1);
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

  it('SELECTs the row + sourceConfig.weight, then UPDATEs heatScore + engagementScore (not heatLevel)', async () => {
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
    expect(updateArgs.data.engagementScore).toBeGreaterThan(0); // SP-6 follow-up
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
    // SP-6 follow-up: engagementScore = source 0.5 × 100 × 0.25 = 12.5 (interaction=0, cross=0)
    expect(updateArgs.data.engagementScore).toBeCloseTo(12.5, 1);
  });
});
