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
});
