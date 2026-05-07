import { Platform, getPrisma } from '@ai-hot-news/db';
import { FILTER_REASONS, checkRedditQuality } from '@ai-hot-news/utils';

/**
 * SP-5 v3.3 Reddit threshold-bump backfill.
 *
 * Re-evaluates every existing Reddit row against the v3.3 thresholds
 * (ratio>=0.7, score>=10 OR comments>=5) and DELETEs rows that the new
 * thresholds reject. Rows already gone (HIDDEN dropped at ingest in
 * v3.2 onwards is N/A — SP-5 v3.2 stopped writing HIDDEN entirely;
 * everything in DB is VISIBLE).
 *
 * Why DELETE not UPDATE-status:
 *   - SP-5 v3.2 §0.3 baseline: "HIDDEN is dead data, just don't ingest it."
 *   - Worker boot backstop scans `summary IS NULL` for re-summary; we want
 *     these rows out before that scan runs (saves LLM calls).
 *
 * Single-writer contract: stop the worker before running this script
 * (matches SP-4 §10 decision 11 / SP-4.5 cleanup pattern).
 *
 * Idempotent: second run drops 0 (all surviving rows already pass).
 */

export interface CleanupRedditQualityResult {
  scanned: number;
  toDelete: number;
  deleted: number;
  byReason: {
    [FILTER_REASONS.REDDIT_LOW_RATIO]: number;
    [FILTER_REASONS.REDDIT_LOW_ENGAGEMENT]: number;
    missing_interaction_data: number;
  };
  remainingReddit: number;
}

interface RedditInteractionShape {
  score?: number;
  comments?: number;
  redditUpvoteRatio?: number | null;
}

export async function runCleanupRedditQualityV3_3(): Promise<CleanupRedditQualityResult> {
  const prisma = getPrisma();

  const rows = await prisma.hotNews.findMany({
    where: { sourcePlatform: Platform.REDDIT },
    select: { id: true, interactionData: true },
  });

  const byReason = {
    [FILTER_REASONS.REDDIT_LOW_RATIO]: 0,
    [FILTER_REASONS.REDDIT_LOW_ENGAGEMENT]: 0,
    missing_interaction_data: 0,
  };
  const idsToDelete: string[] = [];

  for (const row of rows) {
    const ix = row.interactionData as RedditInteractionShape | null;
    if (!ix || typeof ix.score !== 'number' || typeof ix.comments !== 'number') {
      // Row predates SP-3 or upstream payload was malformed. Be conservative:
      // do NOT delete (treat as "unknown signal"). Count it for visibility.
      byReason.missing_interaction_data += 1;
      continue;
    }

    const verdict = checkRedditQuality({
      upvote_ratio: typeof ix.redditUpvoteRatio === 'number' ? ix.redditUpvoteRatio : null,
      score: ix.score,
      num_comments: ix.comments,
    });

    if (verdict === FILTER_REASONS.REDDIT_LOW_RATIO) {
      byReason[FILTER_REASONS.REDDIT_LOW_RATIO] += 1;
      idsToDelete.push(row.id);
    } else if (verdict === FILTER_REASONS.REDDIT_LOW_ENGAGEMENT) {
      byReason[FILTER_REASONS.REDDIT_LOW_ENGAGEMENT] += 1;
      idsToDelete.push(row.id);
    }
  }

  const result = idsToDelete.length
    ? await prisma.hotNews.deleteMany({ where: { id: { in: idsToDelete } } })
    : { count: 0 };

  const remainingReddit = await prisma.hotNews.count({
    where: { sourcePlatform: Platform.REDDIT },
  });

  return {
    scanned: rows.length,
    toDelete: idsToDelete.length,
    deleted: result.count,
    byReason,
    remainingReddit,
  };
}

async function main(): Promise<void> {
  const stats = await runCleanupRedditQualityV3_3();
  console.log(JSON.stringify(stats, null, 2));
}

const isMainEntry = typeof require !== 'undefined' && require.main === module;
const isTsxEntry = process.argv[1]?.endsWith('cleanup-reddit-quality-v3-3.ts');

if (isMainEntry || isTsxEntry) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(async () => {
      await getPrisma().$disconnect();
      process.exit(0);
    });
}
