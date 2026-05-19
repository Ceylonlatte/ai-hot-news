import { Injectable } from '@nestjs/common';
import { getPrisma, Prisma } from '@ai-hot-news/db';
import type { StatsSourcesDto, StatsTodayDto } from '@ai-hot-news/types';

const WINDOW_HOURS = 24;

@Injectable()
export class StatsService {
  /**
   * SP-9 (2026-05-19): Returns the 4-card stats for the Dashboard HomePage.
   * 2 raw SQL queries (counters via FILTER aggregates; sourceCount via JOIN
   * against source_configs). Uses Postgres `NOW() - INTERVAL '24 hours'`
   * instead of application-layer Date arithmetic — both sides are UTC so
   * results agree, but the SQL form is clearer and races-free.
   */
  async getToday(): Promise<StatsTodayDto> {
    const prisma = getPrisma();
    const windowEnd = new Date();
    const windowStart = new Date(
      windowEnd.getTime() - WINDOW_HOURS * 60 * 60 * 1000,
    );

    type CountersRow = {
      aggregate_count: bigint;
      burst_count: bigint;
      tagged_count: bigint;
    };
    const countersResult = await prisma.$queryRaw<CountersRow[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (
          WHERE status = 'VISIBLE'
            AND "publishedAt" >= NOW() - INTERVAL '24 hours'
        ) AS aggregate_count,
        COUNT(*) FILTER (
          WHERE status = 'VISIBLE'
            AND "publishedAt" >= NOW() - INTERVAL '24 hours'
            AND "heatLevel" = 'BURST'
        ) AS burst_count,
        COUNT(*) FILTER (
          WHERE status = 'VISIBLE'
            AND "publishedAt" >= NOW() - INTERVAL '24 hours'
            AND array_length("aiTags", 1) > 0
        ) AS tagged_count
      FROM hot_news
    `);
    const counters = countersResult[0] ?? {
      aggregate_count: 0n,
      burst_count: 0n,
      tagged_count: 0n,
    };

    type SourceRow = { source_count: bigint };
    const sourceResult = await prisma.$queryRaw<SourceRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT sc.id)::bigint AS source_count
      FROM source_configs sc
      INNER JOIN hot_news hn ON hn."sourcePlatform" = sc.platform
      WHERE sc.enabled = TRUE
        AND hn.status = 'VISIBLE'
        AND hn."publishedAt" >= NOW() - INTERVAL '24 hours'
    `);

    return {
      aggregateCount: Number(counters.aggregate_count),
      burstCount: Number(counters.burst_count),
      taggedCount: Number(counters.tagged_count),
      sourceCount: Number(sourceResult[0]?.source_count ?? 0n),
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
  }

  async getSources(): Promise<StatsSourcesDto> {
    throw new Error('Not implemented yet — see Task A3');
  }
}
