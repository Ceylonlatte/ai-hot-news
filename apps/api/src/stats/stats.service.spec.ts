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
});
