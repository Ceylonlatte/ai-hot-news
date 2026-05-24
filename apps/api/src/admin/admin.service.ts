import { Injectable, Logger } from '@nestjs/common';
import { getPrisma, Prisma } from '@ai-hot-news/db';
import type {
  AdminContentPoolDto,
  AdminDbSizeDto,
  AdminFeederDto,
  AdminHealthDto,
  AdminKeywordStatsDto,
  AdminLlmCostDto,
} from '@ai-hot-news/types';
import { promises as fs } from 'node:fs';

// SP-19 PR-B (2026-05-24): admin ops dashboard data backend.
//
// Aggregations target the actual tables: hot_news, keyword_monitors,
// keyword_hits, llm_usage. Each method targets ≤200ms on V1 scale
// (a few thousand rows). Indices already exist for the time-series
// scans (createdAt DESC + composite indexes from SP-19 PR-A).

// Frequency interval (ms) — mirrors apps/worker/src/keyword-search/keyword-search.config.ts.
// Duplicated here (instead of importing) because the api package can't
// take a dep on the worker package; promote to @ai-hot-news/types if
// a third caller appears.
const FREQUENCY_INTERVAL_MS: Record<string, number> = {
  M15: 15 * 60 * 1000,
  M30: 30 * 60 * 1000,
  H1: 60 * 60 * 1000,
  D1: 24 * 60 * 60 * 1000,
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  /** Service health composite. */
  async health(): Promise<AdminHealthDto> {
    const prisma = getPrisma();
    const now = new Date();

    // Worker writes /tmp/worker-alive every 30s (LivenessService). API
    // and worker share the same volume in compose; missing file = worker
    // never started, stale mtime > 2 min = worker hung.
    const livenessPath =
      process.env.WORKER_LIVENESS_PATH ?? '/tmp/worker-alive';
    let workerHeartbeatAt: string | null = null;
    let workerHeartbeatStaleSec: number | null = null;
    try {
      const st = await fs.stat(livenessPath);
      workerHeartbeatAt = st.mtime.toISOString();
      workerHeartbeatStaleSec = Math.floor(
        (now.getTime() - st.mtimeMs) / 1000,
      );
    } catch {
      // file missing — leave nulls
    }

    // Cron tick proxies: most-recent timestamp written by each worker job.
    const [keywordTick, heatTick, cleanupTick] = await Promise.all([
      // SP-16.5 feeder updates lastSearchedAt every successful run.
      prisma.keywordMonitor.findFirst({
        select: { lastSearchedAt: true },
        orderBy: { lastSearchedAt: 'desc' },
      }),
      // SP-6 heat cron writes a heat_history row each tick.
      prisma.heatHistory.findFirst({
        select: { bucketAt: true },
        orderBy: { bucketAt: 'desc' },
      }),
      // SP-10.5 cleanup deletes oldest rows; we infer last run from the
      // gap between oldest hot_news row and now (rough but free).
      // Skipping for V1 — UI shows null until SP-10.5 emits a marker row.
      Promise.resolve(null as null),
    ]);

    return {
      workerHeartbeatAt,
      workerHeartbeatStaleSec,
      apiOk: true,
      lastSearchTickAt: keywordTick?.lastSearchedAt?.toISOString() ?? null,
      lastHeatTickAt: heatTick?.bucketAt.toISOString() ?? null,
      lastCleanupAt: cleanupTick,
      serverTime: now.toISOString(),
    };
  }

  /** hot_news 行数 + 24h 增长曲线 + 来源/平台分布。 */
  async contentPool(): Promise<AdminContentPoolDto> {
    const prisma = getPrisma();
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * HOUR_MS);

    const [totalVisible, totalHidden, bySourceRows, byPlatformRows, growthRows] =
      await Promise.all([
        prisma.hotNews.count({ where: { status: 'VISIBLE' } }),
        prisma.hotNews.count({ where: { status: 'HIDDEN' } }),
        // bySource: interactionData JSON 字段判别 search vs 常规
        prisma.$queryRaw<Array<{ source: string | null; count: bigint }>>`
          SELECT
            COALESCE("interactionData"->>'source', 'crawler') AS source,
            COUNT(*)::bigint AS count
          FROM "hot_news"
          WHERE status = 'VISIBLE'
          GROUP BY source
          ORDER BY count DESC
        `,
        prisma.hotNews.groupBy({
          by: ['sourcePlatform'],
          where: { status: 'VISIBLE' },
          _count: { _all: true },
          orderBy: { _count: { id: 'desc' } },
        }),
        // 24h hourly growth — date_trunc to hour, fill gaps in code below.
        prisma.$queryRaw<Array<{ hour: Date; count: bigint }>>`
          SELECT
            date_trunc('hour', "crawledAt") AS hour,
            COUNT(*)::bigint AS count
          FROM "hot_news"
          WHERE "crawledAt" >= ${since24h}
          GROUP BY hour
          ORDER BY hour ASC
        `,
      ]);

    const growthMap = new Map(
      growthRows.map((r) => [r.hour.toISOString(), Number(r.count)]),
    );
    const growth24h: AdminContentPoolDto['growth24h'] = [];
    for (let i = 23; i >= 0; i -= 1) {
      const t = new Date(now.getTime() - i * HOUR_MS);
      t.setMinutes(0, 0, 0);
      const iso = t.toISOString();
      growth24h.push({ hour: iso, count: growthMap.get(iso) ?? 0 });
    }

    return {
      totalVisible,
      totalHidden,
      bySource: bySourceRows.map((r) => ({
        source: r.source ?? 'crawler',
        count: Number(r.count),
      })),
      byPlatform: byPlatformRows.map((r) => ({
        platform: r.sourcePlatform,
        count: r._count._all,
      })),
      growth24h,
    };
  }

  /** Search feeder per-keyword status + 24h hit count. */
  async feeder(): Promise<AdminFeederDto> {
    const prisma = getPrisma();
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * HOUR_MS);

    const [monitors, hits24h] = await Promise.all([
      prisma.keywordMonitor.findMany({
        select: {
          id: true,
          keyword: true,
          enabled: true,
          monitorFrequency: true,
          lastSearchedAt: true,
        },
        orderBy: [{ enabled: 'desc' }, { keyword: 'asc' }],
      }),
      prisma.keywordHit.count({ where: { hitAt: { gte: since24h } } }),
    ]);

    return {
      monitors: monitors.map((m) => {
        const lastSearchedAt = m.lastSearchedAt?.toISOString() ?? null;
        const minutesSinceLastSearch =
          m.lastSearchedAt === null
            ? null
            : Math.floor(
                (now.getTime() - m.lastSearchedAt.getTime()) / 60_000,
              );
        const intervalMs = FREQUENCY_INTERVAL_MS[m.monitorFrequency] ?? HOUR_MS;
        const isOverdue =
          m.enabled &&
          (m.lastSearchedAt === null ||
            now.getTime() - m.lastSearchedAt.getTime() > intervalMs * 1.5);
        return {
          id: m.id,
          keyword: m.keyword,
          enabled: m.enabled,
          monitorFrequency: m.monitorFrequency,
          lastSearchedAt,
          minutesSinceLastSearch,
          isOverdue,
        };
      }),
      hits24h,
    };
  }

  /** Per-keyword hit total + 24h delta + match rate against visible pool. */
  async keywordStats(): Promise<AdminKeywordStatsDto> {
    const prisma = getPrisma();
    const since24h = new Date(Date.now() - 24 * HOUR_MS);

    const [monitors, totalVisible, hits24hRows] = await Promise.all([
      prisma.keywordMonitor.findMany({
        select: { id: true, keyword: true, enabled: true },
      }),
      prisma.hotNews.count({ where: { status: 'VISIBLE' } }),
      prisma.keywordHit.groupBy({
        by: ['keywordId'],
        where: { hitAt: { gte: since24h } },
        _count: { _all: true },
      }),
    ]);

    const totalsByKeywordId = new Map(
      (
        await prisma.keywordHit.groupBy({
          by: ['keywordId'],
          _count: { _all: true },
        })
      ).map((r) => [r.keywordId, r._count._all]),
    );
    const recentByKeywordId = new Map(
      hits24hRows.map((r) => [r.keywordId, r._count._all]),
    );

    return {
      items: monitors
        .map((m) => {
          const total = totalsByKeywordId.get(m.id) ?? 0;
          const recent = recentByKeywordId.get(m.id) ?? 0;
          const matchRatePct =
            totalVisible === 0
              ? 0
              : Math.round((total / totalVisible) * 1000) / 10;
          return {
            keyword: m.keyword,
            enabled: m.enabled,
            hitCountTotal: total,
            hitCount24h: recent,
            matchRatePct,
          };
        })
        .sort((a, b) => b.hitCountTotal - a.hitCountTotal),
    };
  }

  /** Per-table row count + on-disk size. */
  async dbSize(): Promise<AdminDbSizeDto> {
    const prisma = getPrisma();
    // Table list: keep in sync with schema.prisma. Order matches "user value":
    // largest interaction surfaces first.
    const tableNames = [
      'hot_news',
      'keyword_hits',
      'keyword_monitors',
      'heat_history',
      'llm_usage',
      'notifications',
      'users',
      'source_configs',
    ] as const;

    const rows = await prisma.$queryRaw<
      Array<{ name: string; row_count: bigint; bytes: bigint; size_pretty: string }>
    >(
      Prisma.sql`
        SELECT
          c.relname::text AS name,
          c.reltuples::bigint AS row_count,
          pg_total_relation_size(c.oid)::bigint AS bytes,
          pg_size_pretty(pg_total_relation_size(c.oid)) AS size_pretty
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname = ANY(${tableNames as unknown as string[]})
        ORDER BY pg_total_relation_size(c.oid) DESC
      `,
    );

    return {
      tables: rows.map((r) => ({
        name: r.name,
        rowCount: Number(r.row_count),
        bytes: Number(r.bytes),
        sizePretty: r.size_pretty,
      })),
    };
  }

  /** LLM cost across 24h / 7d / 30d windows, broken down by model. */
  async llmCost(): Promise<AdminLlmCostDto> {
    const prisma = getPrisma();
    const now = new Date();
    const windows = [
      { label: '24h', since: new Date(now.getTime() - DAY_MS) },
      { label: '7d', since: new Date(now.getTime() - 7 * DAY_MS) },
      { label: '30d', since: new Date(now.getTime() - 30 * DAY_MS) },
    ];

    const results = await Promise.all(
      windows.map(async (w) => {
        const rows = await prisma.llmUsage.groupBy({
          by: ['operation', 'model'],
          where: { createdAt: { gte: w.since } },
          _count: { _all: true },
          _sum: {
            tokensIn: true,
            tokensOut: true,
            costUsd: true,
          },
        });
        const byModel = rows.map((r) => {
          const costUsd =
            r._sum.costUsd === null ? null : Number(r._sum.costUsd);
          return {
            operation: r.operation,
            model: r.model,
            calls: r._count._all,
            tokensIn: r._sum.tokensIn ?? 0,
            tokensOut: r._sum.tokensOut ?? 0,
            costUsd,
            unpriced: r._sum.costUsd === null && (r._count._all ?? 0) > 0,
          };
        });
        const totalCalls = byModel.reduce((s, m) => s + m.calls, 0);
        const totalTokensIn = byModel.reduce((s, m) => s + m.tokensIn, 0);
        const totalTokensOut = byModel.reduce((s, m) => s + m.tokensOut, 0);
        const pricedCosts = byModel
          .map((m) => m.costUsd)
          .filter((c): c is number => c !== null);
        const totalCostUsd =
          pricedCosts.length === 0
            ? null
            : pricedCosts.reduce((s, c) => s + c, 0);
        return {
          label: w.label,
          totalCalls,
          totalTokensIn,
          totalTokensOut,
          totalCostUsd,
          byModel,
        };
      }),
    );

    return { windows: results };
  }
}
