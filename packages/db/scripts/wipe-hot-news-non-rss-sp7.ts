import { getPrisma, Platform } from '@ai-hot-news/db';

export interface WipeResult {
  before: { total: number; rss: number; nonRss: number };
  deleted: number;
  after: { total: number; rss: number; nonRss: number };
  platforms: Record<string, number>;
}

/**
 * SP-7-A v3 one-shot wipe: delete every `hot_news` row whose
 * `sourcePlatform != 'RSS'`. RSS rows are preserved because:
 *
 * 1. Their `crawledAt` extends out to a 7-day window (SP-4.5 ingest cutoff),
 *    so wiping them would discard 100+ rows that we could not refetch
 *    today (most RSS feeds only serve the latest 20-50 items).
 * 2. They are stable text (no `extractStatus` / `interactionData` churn),
 *    so the SP-7 v3 backfill will re-embed them cleanly via the boot
 *    backstop without needing any one-shot recovery.
 *
 * Non-RSS rows (HackerNews / Reddit / future Twitter) get re-crawled by
 * the 48h hot-window crawlers within minutes after worker restart, so
 * losing the historical ones is expected (user explicitly acked this
 * trade-off for a clean v3 reset).
 *
 * SOP (prod):
 *   1. `docker compose stop worker` (prod-access.mdc rule: single-writer).
 *   2. Run this script via `scripts/run-prod-oneshot.sh`.
 *   3. (Optional) `redis-cli` keyspace clean of `bull:summary` /
 *      `bull:extract` / `bull:heat` / `bull:embed` to drop in-flight
 *      jobs pointing to now-deleted ids.
 *   4. `docker compose start worker` — boot backstop catches up from
 *      empty hot_news + crawl cron repopulates.
 */
export async function runWipeNonRss(): Promise<WipeResult> {
  const prisma = getPrisma();

  const platformGroups = await prisma.hotNews.groupBy({
    by: ['sourcePlatform'],
    _count: { _all: true },
  });
  const platforms = Object.fromEntries(
    platformGroups.map((g) => [g.sourcePlatform, g._count._all]),
  );
  const total = platformGroups.reduce((s, g) => s + g._count._all, 0);
  const rss = platforms[Platform.RSS] ?? 0;
  const nonRss = total - rss;
  const before = { total, rss, nonRss };
  console.log(
    `[wipe-non-rss-sp7] Before: total=${total}, rss=${rss}, non-rss=${nonRss}`,
  );
  console.log(`[wipe-non-rss-sp7] By platform: ${JSON.stringify(platforms)}`);

  const result = await prisma.hotNews.deleteMany({
    where: { sourcePlatform: { not: Platform.RSS } },
  });

  const afterPlatformGroups = await prisma.hotNews.groupBy({
    by: ['sourcePlatform'],
    _count: { _all: true },
  });
  const afterTotal = afterPlatformGroups.reduce(
    (s, g) => s + g._count._all,
    0,
  );
  const afterRss =
    afterPlatformGroups.find((g) => g.sourcePlatform === Platform.RSS)?._count
      ._all ?? 0;
  const afterNonRss = afterTotal - afterRss;
  const after = { total: afterTotal, rss: afterRss, nonRss: afterNonRss };
  console.log(
    `[wipe-non-rss-sp7] Deleted ${result.count} rows; after: total=${afterTotal}, rss=${afterRss}, non-rss=${afterNonRss}`,
  );

  return { before, deleted: result.count, after, platforms };
}

async function main(): Promise<void> {
  const stats = await runWipeNonRss();
  console.log(JSON.stringify(stats, null, 2));
}

const isMainEntry =
  typeof require !== 'undefined' && require.main === module;
const isTsxEntry = process.argv[1]?.endsWith('wipe-hot-news-non-rss-sp7.ts');

if (isMainEntry || isTsxEntry) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
