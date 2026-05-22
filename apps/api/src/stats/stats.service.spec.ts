import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatsService } from './stats.service';
import * as dbModule from '@ai-hot-news/db';

describe('StatsService', () => {
  let service: StatsService;
  let prismaMock: {
    $queryRaw: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prismaMock = {
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(dbModule, 'getPrisma').mockReturnValue(
      prismaMock as unknown as ReturnType<typeof dbModule.getPrisma>,
    );
    service = new StatsService();
  });

  describe('getToday', () => {
    it('returns 4 counters with window range', async () => {
      // SP-9: getToday issues 2 raw queries — one CountersRow, one SourceRow.
      prismaMock.$queryRaw
        .mockResolvedValueOnce([
          { aggregate_count: 234n, burst_count: 7n, tagged_count: 189n },
        ])
        .mockResolvedValueOnce([{ source_count: 4n }]);
      const result = await service.getToday();
      expect(result.aggregateCount).toBe(234);
      expect(result.burstCount).toBe(7);
      expect(result.taggedCount).toBe(189);
      expect(result.sourceCount).toBe(4);
      // windowStart is 24h before windowEnd
      const startMs = Date.parse(result.windowStart);
      const endMs = Date.parse(result.windowEnd);
      expect(endMs - startMs).toBe(24 * 60 * 60 * 1000);
    });

    it('returns zeros when DB is empty', async () => {
      prismaMock.$queryRaw
        .mockResolvedValueOnce([
          { aggregate_count: 0n, burst_count: 0n, tagged_count: 0n },
        ])
        .mockResolvedValueOnce([{ source_count: 0n }]);
      const result = await service.getToday();
      expect(result.aggregateCount).toBe(0);
      expect(result.burstCount).toBe(0);
      expect(result.taggedCount).toBe(0);
      expect(result.sourceCount).toBe(0);
    });

    it('tolerates missing source_count row (defensive)', async () => {
      // If the SourceConfig JOIN returns 0 rows the SELECT COUNT returns
      // a single row with source_count=0, not an empty array. But test
      // the defensive fallback path anyway.
      prismaMock.$queryRaw
        .mockResolvedValueOnce([
          { aggregate_count: 10n, burst_count: 1n, tagged_count: 5n },
        ])
        .mockResolvedValueOnce([]);
      const result = await service.getToday();
      expect(result.sourceCount).toBe(0);
    });
  });

  describe('getSources', () => {
    it('distributes pct via hare-quota; rounding residual lands on last bucket', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        { platform: 'HACKERNEWS', count: 100n },
        { platform: 'REDDIT', count: 100n },
        { platform: 'RSS', count: 100n },
      ]);
      const result = await service.getSources();
      expect(result.total).toBe(300);
      expect(result.platforms).toHaveLength(3);
      // 33.33 / 33.33 / 33.33 → floors to 33/33/33, residual=1 lands on last
      expect(result.platforms.map((p) => p.pct)).toEqual([33, 33, 34]);
      expect(result.platforms.reduce((s, p) => s + p.pct, 0)).toBe(100);
    });

    it('returns empty when 24h window has no rows', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.getSources();
      expect(result.total).toBe(0);
      expect(result.platforms).toEqual([]);
    });

    it('handles a single platform (100%)', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        { platform: 'HACKERNEWS', count: 50n },
      ]);
      const result = await service.getSources();
      expect(result.platforms).toEqual([
        { platform: 'HACKERNEWS', count: 50, pct: 100 },
      ]);
      expect(result.total).toBe(50);
    });

    it('preserves DB ordering (count DESC) — no reorder in service layer', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        { platform: 'REDDIT', count: 592n },
        { platform: 'HACKERNEWS', count: 146n },
        { platform: 'RSS', count: 68n },
      ]);
      const result = await service.getSources();
      expect(result.platforms.map((p) => p.platform)).toEqual([
        'REDDIT',
        'HACKERNEWS',
        'RSS',
      ]);
    });

    it('windowStart is 24h before windowEnd', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.getSources();
      const diff =
        Date.parse(result.windowEnd) - Date.parse(result.windowStart);
      expect(diff).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('getHeatCurve', () => {
    it('returns 24 buckets oldest-first', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce(
        Array.from({ length: 24 }, (_, i) => ({ h: i, max_heat: i * 2 })),
      );
      const result = await service.getHeatCurve();
      expect(result.buckets).toHaveLength(24);
      expect(result.hourLabels).toHaveLength(24);
      // SQL output order is h ASC; service should preserve it.
      expect(result.buckets[0]).toBe(0);
      expect(result.buckets[23]).toBe(46);
    });

    it('returns 24 zeros when no rows in any bucket', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce(
        Array.from({ length: 24 }, (_, i) => ({ h: i, max_heat: 0 })),
      );
      const result = await service.getHeatCurve();
      expect(result.buckets).toEqual(new Array(24).fill(0));
    });

    it('hourLabels are zero-padded HH:00 format', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce(
        Array.from({ length: 24 }, (_, i) => ({ h: i, max_heat: 0 })),
      );
      const result = await service.getHeatCurve();
      for (const label of result.hourLabels) {
        expect(label).toMatch(/^\d{2}:00$/);
      }
    });

    it('tolerates DB returning < 24 rows (degraded but does not crash)', async () => {
      // Should not happen with generate_series but defensive: take what came
      // back and zero-pad the rest. Service maps `h` ordering to position.
      prismaMock.$queryRaw.mockResolvedValueOnce([
        { h: 0, max_heat: 10 },
        { h: 1, max_heat: 20 },
      ]);
      const result = await service.getHeatCurve();
      expect(result.buckets).toHaveLength(24);
      expect(result.buckets[0]).toBe(10);
      expect(result.buckets[1]).toBe(20);
      expect(result.buckets[2]).toBe(0);
    });
  });

  describe('getTrendingKeywords', () => {
    it('uses 9999 sentinel for prior=0 case (NEW)', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        { tag: 'company:openai', cur: 5n, prior: 0n, growth_pct: 9999 },
      ]);
      const result = await service.getTrendingKeywords(8);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        tag: 'company:openai',
        label: 'OpenAI',
        count24h: 5,
        countPrior24h: 0,
        growthPct: 9999,
      });
    });

    it('computes positive growth percentages and Title-cases labels', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        { tag: 'model:claude-4', cur: 15n, prior: 10n, growth_pct: 50 },
        { tag: 'category:research', cur: 5n, prior: 10n, growth_pct: -50 },
      ]);
      const result = await service.getTrendingKeywords(8);
      expect(result.items.map((i) => i.growthPct)).toEqual([50, -50]);
      expect(result.items.map((i) => i.label)).toEqual(['Claude 4', 'Research']);
    });

    it('clamps limit to [1, 20]', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      await service.getTrendingKeywords(100);
      await service.getTrendingKeywords(0);
      await service.getTrendingKeywords(-5);
      await service.getTrendingKeywords(Number.NaN);
      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(4);
    });

    it('returns empty when no tags qualify', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.getTrendingKeywords(8);
      expect(result.items).toEqual([]);
    });

    it('preserves SQL-side ordering (no service-layer reorder)', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        { tag: 'tech:rag', cur: 30n, prior: 10n, growth_pct: 200 },
        { tag: 'model:claude-4', cur: 20n, prior: 10n, growth_pct: 100 },
        { tag: 'company:openai', cur: 10n, prior: 5n, growth_pct: 100 },
      ]);
      const result = await service.getTrendingKeywords(8);
      expect(result.items.map((i) => i.label)).toEqual([
        'RAG',
        'Claude 4',
        'OpenAI',
      ]);
    });
  });

  describe('topTags (SP-12)', () => {
    it('returns tag rows from raw SQL with mapped { tag, count } shape', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        { tag: 'company:OpenAI', count: 150n },
        { tag: 'category:Opinion', count: 120n },
        { tag: 'model:GPT-5', count: 80n },
      ]);
      const result = await service.topTags(30, 20);
      expect(result.tags).toEqual([
        { tag: 'company:OpenAI', count: 150 },
        { tag: 'category:Opinion', count: 120 },
        { tag: 'model:GPT-5', count: 80 },
      ]);
      expect(result.days).toBe(30);
      expect(result.limit).toBe(20);
    });

    it('window range = days * 24h', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.topTags(7, 10);
      const startMs = Date.parse(result.windowStart);
      const endMs = Date.parse(result.windowEnd);
      expect(endMs - startMs).toBe(7 * 24 * 60 * 60 * 1000);
      expect(result.days).toBe(7);
      expect(result.limit).toBe(10);
    });

    it('clamps days to [1, 90]', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      const big = await service.topTags(365, 20);
      expect(big.days).toBe(90);
      const tiny = await service.topTags(0, 20);
      expect(tiny.days).toBe(30); // default for invalid
      const neg = await service.topTags(-5, 20);
      expect(neg.days).toBe(30);
      const nan = await service.topTags(Number.NaN, 20);
      expect(nan.days).toBe(30);
    });

    it('clamps limit to [1, 50]', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      const big = await service.topTags(30, 999);
      expect(big.limit).toBe(50);
      const tiny = await service.topTags(30, 0);
      expect(tiny.limit).toBe(20); // default for invalid
      const nan = await service.topTags(30, Number.NaN);
      expect(nan.limit).toBe(20);
    });

    it('returns empty tags array on DB empty', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([]);
      const result = await service.topTags(30, 20);
      expect(result.tags).toEqual([]);
    });

    it('SQL filters out tech: prefix (controlled namespaces only)', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([]);
      await service.topTags(30, 20);
      const sql = prismaMock.$queryRaw.mock.calls[0]![0]!;
      const serialized = JSON.stringify(sql);
      // The SQL must reference 'company:' / 'model:' / 'category:' explicitly
      expect(serialized).toMatch(/company:/);
      expect(serialized).toMatch(/model:/);
      expect(serialized).toMatch(/category:/);
      // ... and must NOT reference tech: (would be a regression)
      expect(serialized).not.toMatch(/tech:/);
    });
  });
});
