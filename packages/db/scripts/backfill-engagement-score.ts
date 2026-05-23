import { getPrisma } from '@ai-hot-news/db';

/**
 * SP-6 follow-up (2026-05-23): backfill engagementScore for all visible
 * non-RSS rows.
 *
 * Context: SP-6 HeatCron only refreshes rows with publishedAt > NOW-48h.
 * After the `add_engagement_score` migration the column defaults to 0 for
 * every existing row. Without backfill, rows older than 48h would forever
 * show engagementScore=0, so `?sort=heat&range=7d` would put them at the
 * bottom — defeating the entire point of the patch.
 *
 * This script reads every visible non-RSS row in the 30d window (matches
 * SP-10.5 L3 TTL ceiling) and recomputes engagementScore from the same
 * formula as `computeHeatScore`. heatScore is NOT touched.
 *
 * Idempotent: re-running over the same rows produces identical results.
 * Safe to run with worker still up — only writes engagementScore, never
 * conflicts with HeatCron's heatScore writes (last-writer-wins on the
 * single column).
 *
 * The formula has to be inlined here (not imported from
 * apps/worker/src/heat/heat.service.ts) for the same SP-7-A reason:
 * packages/db scripts must not import worker source — worker image only
 * has `dist/`, no `src/`. So we duplicate the engagement-only branch of
 * computeHeatScore as a pure local function. If the worker formula ever
 * changes, both must be updated (single search-string anchor:
 * `engagementScore = interaction * 0.35`).
 */

import type { Platform } from '@ai-hot-news/db';

const SOURCE_WEIGHTS: Record<Platform, number> = {
  // V1: all sources weight 0.5 (per SP-6 spec §0 Q6). Refine via DB-driven
  // sourceConfig.weight if the worker formula ever does so. For backfill
  // we assume the same single-weight-per-platform model.
  TWITTER: 0.5,
  HACKERNEWS: 0.5,
  REDDIT: 0.5,
  RSS: 0.5,
};

// SP-6 spec §3.2 interaction signal caps (per platform).
const INTERACTION_MAX = {
  HN: 500,
  REDDIT: 5000,
  TWITTER: 100000,
};

function interactionSignal(
  platform: Platform,
  interaction: Record<string, unknown> | null,
): number {
  if (interaction == null) return 0;
  switch (platform) {
    case 'HACKERNEWS': {
      const score = Number((interaction.score as number | undefined) ?? 0);
      const comments = Number((interaction.comments as number | undefined) ?? 0);
      const combined = score + comments * 2;
      return (Math.log10(combined + 1) / Math.log10(INTERACTION_MAX.HN + 1)) * 100;
    }
    case 'REDDIT': {
      const score = Number((interaction.score as number | undefined) ?? 0);
      const comments = Number((interaction.comments as number | undefined) ?? 0);
      const ratio = Math.max(
        0.5,
        Number((interaction.redditUpvoteRatio as number | undefined) ?? 1),
      );
      const combined = (score + comments * 2) * ratio;
      return (Math.log10(combined + 1) / Math.log10(INTERACTION_MAX.REDDIT + 1)) * 100;
    }
    case 'TWITTER': {
      const likes = Number((interaction.twLikes as number | undefined) ?? 0);
      const retweets = Number((interaction.twReposts as number | undefined) ?? 0);
      const replies = Number((interaction.twReplies as number | undefined) ?? 0);
      const combined = likes + retweets * 3 + replies * 2;
      return (Math.log10(combined + 1) / Math.log10(INTERACTION_MAX.TWITTER + 1)) * 100;
    }
    default:
      return 0;
  }
}

function computeEngagementScore(
  platform: Platform,
  interaction: Record<string, unknown> | null,
  sourceWeight: number,
): number {
  if (platform === 'RSS') return 0;
  const interactionScore = interactionSignal(platform, interaction);
  const sourceScore = sourceWeight * 100;
  // V1: SP-7 cross-platform score still 0; aligns with worker.
  const crossPlatformScore = 0;
  return (
    interactionScore * 0.35 + sourceScore * 0.25 + crossPlatformScore * 0.15
  );
}

export interface BackfillResult {
  scanned: number;
  updated: number;
  skipped_rss: number;
  unchanged: number;
}

export async function backfillEngagementScore(): Promise<BackfillResult> {
  const prisma = getPrisma();

  // 30d window matches SP-10.5 L3 TTL — rows older than that will be
  // cleaned anyway, no point computing for them.
  const cutoff = new Date(Date.now() - 30 * 86_400_000);

  const rows = await prisma.hotNews.findMany({
    where: {
      status: 'VISIBLE',
      publishedAt: { gte: cutoff },
    },
    select: {
      id: true,
      sourcePlatform: true,
      interactionData: true,
      engagementScore: true,
    },
  });

  console.log(`[backfill-engagement] scanned ${rows.length} VISIBLE rows (30d window)`);

  let updated = 0;
  let skippedRss = 0;
  let unchanged = 0;

  for (const row of rows) {
    if (row.sourcePlatform === 'RSS') {
      skippedRss += 1;
      continue;
    }
    const interaction =
      row.interactionData != null &&
      typeof row.interactionData === 'object' &&
      !Array.isArray(row.interactionData)
        ? (row.interactionData as Record<string, unknown>)
        : null;
    const weight = SOURCE_WEIGHTS[row.sourcePlatform];
    const next = computeEngagementScore(row.sourcePlatform, interaction, weight);
    // Avoid pointless writes when the value is already exact (rerun cheap).
    if (Math.abs(next - row.engagementScore) < 0.0001) {
      unchanged += 1;
      continue;
    }
    await prisma.hotNews.update({
      where: { id: row.id },
      data: { engagementScore: next },
    });
    updated += 1;
  }

  return {
    scanned: rows.length,
    updated,
    skipped_rss: skippedRss,
    unchanged,
  };
}

async function main(): Promise<void> {
  const result = await backfillEngagementScore();
  console.log(JSON.stringify(result, null, 2));
}

const isMainEntry = typeof require !== 'undefined' && require.main === module;
const isTsxEntry = process.argv[1]?.endsWith('backfill-engagement-score.ts');

if (isMainEntry || isTsxEntry) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
