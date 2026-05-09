import { Platform, getPrisma } from '@ai-hot-news/db';
import {
  REDDIT_BUNDLE_ID,
  REDDIT_BUNDLE_URL,
  REDDIT_BUNDLE_NAME,
} from './consolidate-sp5-sources';

/**
 * SP-6 (2026-05-09) source-config migration.
 *
 * Operator decision based on 688-post value-signal analysis: r/ChatGPT and
 * r/StableDiffusion are dropped. r/ChatGPT had 80/98 hot posts on
 * i.redd.it/v.redd.it (memes) and zero HIGH-signal links; r/StableDiffusion
 * is no longer in scope.
 *
 * Effects:
 *   1. Disable individually-enabled r/StableDiffusion and r/ChatGPT rows
 *      (prod historically re-enabled them past the SP-5 v3.2 consolidation
 *      that left them disabled at seed time).
 *   2. Refresh the bundle row's name + url to the SP-6 values
 *      (`AI Subreddit Bundle (12 subs hot)` + ChatGPT removed from URL).
 *      Other bundle fields (enabled / status / crawlInterval) are preserved.
 *
 * Idempotent: re-runs return zero disables and the bundle row only changes
 * when name/url drift from current SP-6 constants.
 *
 * Single-writer contract: stop the worker before running so a bundle URL
 * mid-flight does not race against the update. (Same SOP as SP-4 / SP-5.)
 */

const SP6_DROPPED_SUBS = ['StableDiffusion', 'ChatGPT'];

export interface Sp6SourceMigrationResult {
  redditDisabled: number;
  bundleUpdated: boolean;
  bundlePresent: boolean;
}

export async function runSp6SourceMigrations(): Promise<Sp6SourceMigrationResult> {
  const prisma = getPrisma();

  const disableResult = await prisma.sourceConfig.updateMany({
    where: {
      platform: Platform.REDDIT,
      identifier: { in: SP6_DROPPED_SUBS },
      enabled: true,
    },
    data: { enabled: false },
  });

  const bundle = await prisma.sourceConfig.findUnique({
    where: { id: REDDIT_BUNDLE_ID },
  });

  let bundleUpdated = false;
  if (bundle) {
    const needsUpdate =
      bundle.name !== REDDIT_BUNDLE_NAME || bundle.url !== REDDIT_BUNDLE_URL;
    if (needsUpdate) {
      await prisma.sourceConfig.update({
        where: { id: REDDIT_BUNDLE_ID },
        data: { name: REDDIT_BUNDLE_NAME, url: REDDIT_BUNDLE_URL },
      });
      bundleUpdated = true;
    }
  }

  return {
    redditDisabled: disableResult.count,
    bundleUpdated,
    bundlePresent: bundle != null,
  };
}

async function main(): Promise<void> {
  const stats = await runSp6SourceMigrations();
  console.log(JSON.stringify(stats, null, 2));
}

const isMainEntry = typeof require !== 'undefined' && require.main === module;
const isTsxEntry = process.argv[1]?.endsWith('sp6-source-migrations.ts');

if (isMainEntry || isTsxEntry) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
