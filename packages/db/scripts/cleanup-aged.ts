import { cleanupAged } from '@ai-hot-news/db';

/**
 * SP-10.5 (2026-05-21): one-shot entrypoint for prod first-run, called via
 * `scripts/run-prod-oneshot.sh packages/db scripts/cleanup-aged.ts`.
 *
 * Reads CLEANUP_HOT_NEWS_DAYS / CLEANUP_HEAT_HISTORY_DAYS from env (same vars
 * the worker daily cron honors). Pass `--dry-run` to just count without
 * deleting.
 *
 * The actual logic lives in `packages/db/src/cleanup-aged.ts` so the worker
 * module can import the same function via the package name. This file is
 * intentionally thin — just env parsing + CLI args + main()/process.exit.
 */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const hotNewsDays = parseInt(process.env.CLEANUP_HOT_NEWS_DAYS ?? '30', 10);
  const heatHistoryDays = parseInt(process.env.CLEANUP_HEAT_HISTORY_DAYS ?? '7', 10);

  console.log(
    `[cleanup-aged] mode=${dryRun ? 'dry-run' : 'execute'} hot_news_days=${hotNewsDays} heat_history_days=${heatHistoryDays}`,
  );

  const result = await cleanupAged({ hotNewsDays, heatHistoryDays, dryRun });
  console.log(JSON.stringify(result, null, 2));
}

const isMainEntry = typeof require !== 'undefined' && require.main === module;
const isTsxEntry = process.argv[1]?.endsWith('cleanup-aged.ts');

if (isMainEntry || isTsxEntry) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
