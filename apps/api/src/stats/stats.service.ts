import { Injectable } from '@nestjs/common';
import { getPrisma, Prisma } from '@ai-hot-news/db';
import { stripTagLabel } from '@ai-hot-news/utils';
import type {
  HeatCurveDto,
  StatsSourcesDto,
  StatsTodayDto,
  TrendingKeywordsDto,
} from '@ai-hot-news/types';

const WINDOW_HOURS = 24;
const DEFAULT_TRENDING_LIMIT = 8;
const MAX_TRENDING_LIMIT = 20;

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

  /**
   * SP-9 (2026-05-19): Returns the 24h per-platform breakdown for the
   * "信源分布" card. RSS is INCLUDED here (coverage signal, not heat).
   * Percentages sum to exactly 100 via the hare-quota residual-to-last-
   * bucket assignment (see `distributePct` below).
   */
  async getSources(): Promise<StatsSourcesDto> {
    const prisma = getPrisma();
    const windowEnd = new Date();
    const windowStart = new Date(
      windowEnd.getTime() - WINDOW_HOURS * 60 * 60 * 1000,
    );

    type Row = {
      platform: 'TWITTER' | 'HACKERNEWS' | 'REDDIT' | 'RSS';
      count: bigint;
    };
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT "sourcePlatform"::text AS platform, COUNT(*)::bigint AS count
      FROM hot_news
      WHERE status = 'VISIBLE'
        AND "publishedAt" >= NOW() - INTERVAL '24 hours'
      GROUP BY "sourcePlatform"
      ORDER BY count DESC
    `);

    const counts = rows.map((r) => ({
      platform: r.platform,
      count: Number(r.count),
    }));
    const total = counts.reduce((s, c) => s + c.count, 0);
    const platforms = distributePct(counts, total);

    return {
      platforms,
      total,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
  }

  /**
   * SP-9 (2026-05-19): Returns 24 hourly buckets of MAX(heatScore) over
   * the last 24h, oldest-first. RSS is excluded (SP-6 §0 Q1/Q2 contract —
   * RSS does not participate in heat ranking).
   *
   * Implementation: PG `generate_series(0,23)` LEFT JOIN to `hot_news`
   * with time-window predicates that bucket by `date_trunc('hour', NOW())`.
   * Empty hour buckets return 0 via `COALESCE`. The current (partial)
   * hour is at index 23 — the UI renders its label as "现在" instead of
   * the literal time (see `<HeatCurve>` in packages/ui).
   */
  async getHeatCurve(): Promise<HeatCurveDto> {
    const prisma = getPrisma();
    const windowEnd = new Date();
    const windowStart = new Date(
      windowEnd.getTime() - WINDOW_HOURS * 60 * 60 * 1000,
    );

    type Row = { h: number; max_heat: number };
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      WITH hours AS (SELECT generate_series(0, 23) AS h)
      SELECT
        h::int,
        COALESCE(MAX(hn."heatScore"), 0)::float AS max_heat
      FROM hours
      LEFT JOIN hot_news hn
        ON hn.status = 'VISIBLE'
        AND hn."sourcePlatform" != 'RSS'
        AND hn."publishedAt" >= date_trunc('hour', NOW()) - INTERVAL '23 hours' + (h * INTERVAL '1 hour')
        AND hn."publishedAt" <  date_trunc('hour', NOW()) - INTERVAL '23 hours' + ((h + 1) * INTERVAL '1 hour')
      GROUP BY h
      ORDER BY h ASC
    `);

    // Defensive: even though generate_series guarantees 24 rows, downstream
    // callers should never blow up if DB returns less (e.g. due to a future
    // restructure). Build a fully-populated 24-slot array; missing buckets
    // stay at the default 0.
    const buckets = new Array<number>(24).fill(0);
    for (const r of rows) {
      const idx = Number(r.h);
      if (idx >= 0 && idx < 24) {
        buckets[idx] = Number(r.max_heat);
      }
    }

    // hourLabels[0] = 23h ago (at the floor of the hour); [23] = current
    // partial hour. UTC throughout (Postgres NOW() returns UTC; we render
    // UTC HH:00 to keep server / client deterministic, ignoring user TZ
    // by design — YAGNI for V1).
    const hourFloorMs =
      Math.floor(windowEnd.getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000;
    const startHourMs = hourFloorMs - 23 * 60 * 60 * 1000;
    const hourLabels = Array.from({ length: 24 }, (_, i) => {
      const d = new Date(startHourMs + i * 60 * 60 * 1000);
      return `${String(d.getUTCHours()).padStart(2, '0')}:00`;
    });

    return {
      buckets,
      hourLabels,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
  }

  /**
   * SP-9 (2026-05-19): Returns the AI tag momentum ranking for the
   * "增速最快" card. Algorithm: 24h-vs-prior-24h frequency delta over
   * `aiTags` (unnest expansion).
   *
   * `growthPct`:
   *   - `prior=0, cur>0` → 9999 sentinel (UI renders "NEW")
   *   - `prior>0`        → `round((cur - prior) / prior * 100)`
   *
   * Ordering (SQL-side, preserved by service): `growthPct DESC, cur DESC, tag ASC`.
   *
   * The `limit` parameter is clamped to `[1, MAX_TRENDING_LIMIT=20]`. The
   * default applies when callers pass `0`, negative, or `NaN`.
   *
   * Why 24h vs prior-24h (not 24h vs 7d): simpler "momentum" signal; at
   * prod's 800-row scale the prior-24h bucket has enough volume to be
   * stable. See spec §0 Q4.
   */
  async getTrendingKeywords(limit: number): Promise<TrendingKeywordsDto> {
    const prisma = getPrisma();
    const windowEnd = new Date();
    const windowStart = new Date(
      windowEnd.getTime() - WINDOW_HOURS * 60 * 60 * 1000,
    );

    const intLimit = Number.isFinite(limit)
      ? Math.floor(limit)
      : DEFAULT_TRENDING_LIMIT;
    const safeLimit = Math.max(
      1,
      Math.min(MAX_TRENDING_LIMIT, intLimit > 0 ? intLimit : DEFAULT_TRENDING_LIMIT),
    );

    type Row = {
      tag: string;
      cur: bigint;
      prior: bigint;
      growth_pct: number;
    };
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      WITH unnested AS (
        SELECT unnest("aiTags") AS tag, "publishedAt"
        FROM hot_news
        WHERE status = 'VISIBLE'
          AND "publishedAt" >= NOW() - INTERVAL '48 hours'
          AND array_length("aiTags", 1) > 0
      ),
      buckets AS (
        SELECT
          tag,
          COUNT(*) FILTER (WHERE "publishedAt" >= NOW() - INTERVAL '24 hours')::bigint AS cur,
          COUNT(*) FILTER (WHERE "publishedAt" <  NOW() - INTERVAL '24 hours')::bigint AS prior
        FROM unnested
        GROUP BY tag
      )
      SELECT tag, cur, prior,
        CASE
          WHEN prior = 0 AND cur > 0 THEN 9999
          WHEN prior > 0 THEN ROUND(((cur::float - prior) / prior) * 100)::int
          ELSE 0
        END AS growth_pct
      FROM buckets
      WHERE cur > 0
      ORDER BY growth_pct DESC, cur DESC, tag ASC
      LIMIT ${safeLimit}
    `);

    return {
      items: rows.map((r) => ({
        tag: r.tag,
        label: stripTagLabel(r.tag),
        count24h: Number(r.cur),
        countPrior24h: Number(r.prior),
        growthPct: r.growth_pct,
      })),
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
  }
}

/**
 * SP-9 (2026-05-19): Hare-quota rounding for the platform-distribution
 * percentages. Floor each share, then assign the residual (100 - sum)
 * to the last bucket so the rendered card always sums to exactly 100.
 *
 * Why last bucket (not largest-remainder method): the rows are sorted
 * `count DESC` by SQL, so "last" === "smallest count" — visually the
 * residual lands on the least-noticeable bar, which is the safest UX
 * choice. Largest-remainder is theoretically more "fair" but produces
 * row-order-dependent flicker between deploys when counts are close.
 *
 * Edge cases:
 *   - total === 0 → returns []
 *   - single platform → returns [{ ..., pct: 100 }]
 *   - all platforms perfectly divisible → residual = 0, no-op
 */
function distributePct(
  counts: Array<{
    platform: 'TWITTER' | 'HACKERNEWS' | 'REDDIT' | 'RSS';
    count: number;
  }>,
  total: number,
): StatsSourcesDto['platforms'] {
  if (total === 0 || counts.length === 0) return [];
  const floored = counts.map((c) => ({
    ...c,
    pct: Math.floor((c.count / total) * 100),
  }));
  const residual = 100 - floored.reduce((s, p) => s + p.pct, 0);
  if (residual !== 0 && floored.length > 0) {
    floored[floored.length - 1]!.pct += residual;
  }
  return floored;
}
