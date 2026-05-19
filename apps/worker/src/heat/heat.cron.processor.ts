import { Logger } from '@nestjs/common';
import { getPrisma, type Platform } from '@ai-hot-news/db';
import { computeHeatScore } from './heat.service';
import type { HeatConfig } from './heat.config';
import { computeBucketAt } from './bucket-at';

const logger = new Logger('HeatCronProcessor');

const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function processHeatRefreshJob(cfg: HeatConfig): Promise<void> {
  const prisma = getPrisma();
  const now = new Date();
  const since = new Date(now.getTime() - RECENT_WINDOW_MS);

  const rows = await prisma.hotNews.findMany({
    where: {
      status: 'VISIBLE',
      sourcePlatform: { not: 'RSS' as Platform },
      publishedAt: { gte: since },
    },
    select: {
      id: true,
      sourcePlatform: true,
      publishedAt: true,
      interactionData: true,
    },
  });

  if (rows.length === 0) {
    logger.log('Cron: no candidate rows in 48h window — skip');
    return;
  }

  const sourceConfigs = await prisma.sourceConfig.findMany({
    where: { enabled: true },
    select: { platform: true, weight: true },
  });
  const weightByPlatform = new Map<Platform, number>(
    sourceConfigs.map((s) => [s.platform, s.weight]),
  );

  let updated = 0;
  for (const row of rows) {
    const weight = weightByPlatform.get(row.sourcePlatform) ?? 0.5;
    const score = computeHeatScore(row, weight, now, cfg);
    await prisma.hotNews.update({
      where: { id: row.id },
      data: { heatScore: score },
    });
    updated += 1;
  }

  // NTILE(20) percentile re-rank: bucket 1 (top 5%) = BURST,
  // buckets 2-4 (next 15%) = HOT, buckets 5-10 (next 30%) = NORMAL,
  // buckets 11-20 (bottom 50%) = LOW. Spec §3.1.
  const sql = `
    WITH ranked AS (
      SELECT id, NTILE(20) OVER (ORDER BY "heatScore" DESC) AS bucket
      FROM hot_news
      WHERE status = 'VISIBLE'
        AND "sourcePlatform" != 'RSS'
        AND "publishedAt" > now() - interval '48 hours'
    )
    UPDATE hot_news h
    SET "heatLevel" = (CASE
      WHEN r.bucket = 1                  THEN 'BURST'
      WHEN r.bucket BETWEEN 2 AND 4      THEN 'HOT'
      WHEN r.bucket BETWEEN 5 AND 10     THEN 'NORMAL'
      ELSE                                    'LOW'
    END)::"HeatLevel"
    FROM ranked r
    WHERE h.id = r.id
  `;
  await prisma.$executeRawUnsafe(sql);

  // SP-11 — snapshot the current (heatScore, heatLevel) for every row in
  // the same 48h cohort, keyed on the 30-min bucket nearest to `now`.
  // UPSERT on (hotNewsId, bucketAt) keeps this idempotent across retries
  // or boundary-straddling ticks. Failures here must not propagate — the
  // detail page is non-critical relative to keeping heat refresh green.
  const bucketAt = computeBucketAt(now);
  const historySql = `
    INSERT INTO heat_history ("id", "hotNewsId", "bucketAt", "heatScore", "heatLevel")
    SELECT
      gen_random_uuid()::text,
      h.id,
      $1::timestamp,
      h."heatScore",
      h."heatLevel"
    FROM hot_news h
    WHERE h.status = 'VISIBLE'
      AND h."sourcePlatform" != 'RSS'
      AND h."publishedAt" > now() - interval '48 hours'
    ON CONFLICT ("hotNewsId", "bucketAt")
    DO UPDATE SET
      "heatScore" = EXCLUDED."heatScore",
      "heatLevel" = EXCLUDED."heatLevel"
  `;
  let historyWritten = false;
  try {
    await prisma.$executeRawUnsafe(historySql, bucketAt.toISOString());
    historyWritten = true;
  } catch (err) {
    logger.error(
      `Cron: heat_history upsert failed at bucket ${bucketAt.toISOString()}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  logger.log(
    `Cron: updated ${updated} heatScore values + recomputed heatLevel via NTILE(20)` +
      ` + heat_history ${historyWritten ? 'upserted' : 'SKIPPED (see error above)'} @ ${bucketAt.toISOString()}`,
  );
}
