import { Logger } from '@nestjs/common';
import { getPrisma, type Platform } from '@ai-hot-news/db';
import { computeHeatScore } from './heat.service';
import type { HeatConfig } from './heat.config';

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

  logger.log(
    `Cron: updated ${updated} heatScore values + recomputed heatLevel via NTILE(20)`,
  );
}
