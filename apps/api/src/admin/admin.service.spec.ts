import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminService } from './admin.service';
import * as dbModule from '@ai-hot-news/db';

const baseMock = () => ({
  hotNews: {
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
  },
  keywordMonitor: {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  },
  heatHistory: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
  keywordHit: {
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
  },
  llmUsage: {
    groupBy: vi.fn().mockResolvedValue([]),
  },
  $queryRaw: vi.fn().mockResolvedValue([]),
});

describe('AdminService', () => {
  let svc: AdminService;
  let prisma: ReturnType<typeof baseMock>;

  beforeEach(() => {
    prisma = baseMock();
    vi.spyOn(dbModule, 'getPrisma').mockReturnValue(
      prisma as unknown as ReturnType<typeof dbModule.getPrisma>,
    );
    svc = new AdminService();
  });

  describe('health', () => {
    it('returns workerHeartbeat=null + apiOk=true when no liveness file', async () => {
      const result = await svc.health();
      expect(result.apiOk).toBe(true);
      expect(result.workerHeartbeatAt).toBeNull();
      expect(typeof result.serverTime).toBe('string');
    });

    it('exposes lastSearchTickAt + lastHeatTickAt from db proxies', async () => {
      prisma.keywordMonitor.findFirst.mockResolvedValue({
        lastSearchedAt: new Date('2026-05-24T10:00:00Z'),
      });
      prisma.heatHistory.findFirst.mockResolvedValue({
        bucketAt: new Date('2026-05-24T09:30:00Z'),
      });
      const result = await svc.health();
      expect(result.lastSearchTickAt).toBe('2026-05-24T10:00:00.000Z');
      expect(result.lastHeatTickAt).toBe('2026-05-24T09:30:00.000Z');
    });
  });

  describe('contentPool', () => {
    it('returns counts + bySource + byPlatform + 24-bin growth array', async () => {
      prisma.hotNews.count
        .mockResolvedValueOnce(1500) // visible
        .mockResolvedValueOnce(50); // hidden
      prisma.$queryRaw
        // bySource
        .mockResolvedValueOnce([
          { source: 'crawler', count: 1200n },
          { source: 'search', count: 300n },
        ])
        // growth24h (1 row)
        .mockResolvedValueOnce([
          { hour: new Date('2026-05-24T10:00:00Z'), count: 12n },
        ]);
      prisma.hotNews.groupBy.mockResolvedValueOnce([
        { sourcePlatform: 'HACKERNEWS', _count: { _all: 800 } },
        { sourcePlatform: 'REDDIT', _count: { _all: 500 } },
      ]);

      const result = await svc.contentPool();
      expect(result.totalVisible).toBe(1500);
      expect(result.totalHidden).toBe(50);
      expect(result.bySource).toEqual([
        { source: 'crawler', count: 1200 },
        { source: 'search', count: 300 },
      ]);
      expect(result.byPlatform).toEqual([
        { platform: 'HACKERNEWS', count: 800 },
        { platform: 'REDDIT', count: 500 },
      ]);
      expect(result.growth24h).toHaveLength(24);
    });
  });

  describe('feeder', () => {
    it('marks enabled monitor as overdue when lastSearchedAt > 1.5x interval ago', async () => {
      const now = Date.now();
      const oneHourAgo = new Date(now - 60 * 60_000); // exactly 1h ago
      const threeHoursAgo = new Date(now - 3 * 60 * 60_000);
      prisma.keywordMonitor.findMany.mockResolvedValue([
        // Monitor A: H1 freq, last searched 1h ago — within 1.5x → not overdue
        {
          id: 'a',
          keyword: 'A',
          enabled: true,
          monitorFrequency: 'H1',
          lastSearchedAt: oneHourAgo,
        },
        // Monitor B: H1 freq, last 3h ago → overdue (> 1.5x)
        {
          id: 'b',
          keyword: 'B',
          enabled: true,
          monitorFrequency: 'H1',
          lastSearchedAt: threeHoursAgo,
        },
        // Monitor C: never searched → overdue
        {
          id: 'c',
          keyword: 'C',
          enabled: true,
          monitorFrequency: 'H1',
          lastSearchedAt: null,
        },
        // Monitor D: disabled — not overdue regardless
        {
          id: 'd',
          keyword: 'D',
          enabled: false,
          monitorFrequency: 'H1',
          lastSearchedAt: null,
        },
      ]);
      prisma.keywordHit.count.mockResolvedValue(99);

      const r = await svc.feeder();
      expect(r.hits24h).toBe(99);
      expect(r.monitors.find((m) => m.id === 'a')!.isOverdue).toBe(false);
      expect(r.monitors.find((m) => m.id === 'b')!.isOverdue).toBe(true);
      expect(r.monitors.find((m) => m.id === 'c')!.isOverdue).toBe(true);
      expect(r.monitors.find((m) => m.id === 'd')!.isOverdue).toBe(false);
      expect(r.monitors.find((m) => m.id === 'c')!.minutesSinceLastSearch).toBeNull();
    });
  });

  describe('keywordStats', () => {
    it('joins monitors × total + 24h hit counts; computes match rate against visible pool', async () => {
      prisma.keywordMonitor.findMany.mockResolvedValue([
        { id: 'k1', keyword: 'Claude', enabled: true },
        { id: 'k2', keyword: 'OpenAI', enabled: true },
        { id: 'k3', keyword: 'NoHits', enabled: true },
      ]);
      prisma.hotNews.count.mockResolvedValue(2000);
      prisma.keywordHit.groupBy
        // 24h slice (called first per Promise.all order)
        .mockResolvedValueOnce([
          { keywordId: 'k1', _count: { _all: 5 } },
        ])
        // total slice
        .mockResolvedValueOnce([
          { keywordId: 'k1', _count: { _all: 400 } },
          { keywordId: 'k2', _count: { _all: 100 } },
        ]);

      const r = await svc.keywordStats();
      // Sorted by hitCountTotal desc
      expect(r.items[0]!.keyword).toBe('Claude');
      expect(r.items[0]!.hitCountTotal).toBe(400);
      expect(r.items[0]!.hitCount24h).toBe(5);
      // 400/2000 = 20% → 20.0 (rounded to 1 decimal)
      expect(r.items[0]!.matchRatePct).toBe(20);
      const noHits = r.items.find((i) => i.keyword === 'NoHits')!;
      expect(noHits.hitCountTotal).toBe(0);
      expect(noHits.matchRatePct).toBe(0);
    });

    it('matchRatePct=0 when totalVisible=0 (avoid div-by-zero)', async () => {
      prisma.keywordMonitor.findMany.mockResolvedValue([
        { id: 'k1', keyword: 'X', enabled: true },
      ]);
      prisma.hotNews.count.mockResolvedValue(0);
      prisma.keywordHit.groupBy.mockResolvedValue([]);
      const r = await svc.keywordStats();
      expect(r.items[0]!.matchRatePct).toBe(0);
    });
  });

  describe('dbSize', () => {
    it('queries pg_class for the schema-owned tables and shapes rows', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          name: 'hot_news',
          row_count: 2000n,
          bytes: 5_000_000n,
          size_pretty: '4.8 MB',
        },
        {
          name: 'llm_usage',
          row_count: 6n,
          bytes: 8192n,
          size_pretty: '8 KB',
        },
      ]);
      const r = await svc.dbSize();
      expect(r.tables).toEqual([
        { name: 'hot_news', rowCount: 2000, bytes: 5_000_000, sizePretty: '4.8 MB' },
        { name: 'llm_usage', rowCount: 6, bytes: 8192, sizePretty: '8 KB' },
      ]);
    });
  });

  describe('llmCost', () => {
    it('computes 24h / 7d / 30d windows with byModel breakdown + totals', async () => {
      // Mock 3 calls to groupBy (one per window)
      prisma.llmUsage.groupBy.mockImplementation(async () => [
        {
          operation: 'summarize',
          model: 'deepseek/deepseek-v3.2',
          _count: { _all: 10 },
          _sum: { tokensIn: 5000, tokensOut: 1500, costUsd: 0.005 },
        },
        {
          operation: 'embed',
          model: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
          _count: { _all: 10 },
          _sum: { tokensIn: 300, tokensOut: 0, costUsd: 0 },
        },
      ]);

      const r = await svc.llmCost();
      expect(r.windows.map((w) => w.label)).toEqual(['24h', '7d', '30d']);
      const w24 = r.windows[0]!;
      expect(w24.totalCalls).toBe(20);
      expect(w24.totalTokensIn).toBe(5300);
      expect(w24.totalCostUsd).toBeCloseTo(0.005, 6);
      expect(w24.byModel).toHaveLength(2);
      expect(w24.byModel[0]!.unpriced).toBe(false);
    });

    it('marks model as unpriced when costUsd=null AND has calls', async () => {
      prisma.llmUsage.groupBy.mockImplementation(async () => [
        {
          operation: 'summarize',
          model: 'unknown/experimental',
          _count: { _all: 3 },
          _sum: { tokensIn: 100, tokensOut: 50, costUsd: null },
        },
      ]);
      const r = await svc.llmCost();
      const w24 = r.windows[0]!;
      expect(w24.byModel[0]!.unpriced).toBe(true);
      // totalCostUsd null when no priced rows
      expect(w24.totalCostUsd).toBeNull();
    });
  });
});
