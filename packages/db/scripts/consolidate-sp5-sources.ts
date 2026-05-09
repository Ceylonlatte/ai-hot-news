import { Platform, getPrisma } from '@ai-hot-news/db';

const prisma = getPrisma();

const REDDIT_OLD_SUBS = [
  'LocalLLaMA',
  'MachineLearning',
  'artificial',
  'OpenAI',
  'ChatGPT',
  'ClaudeAI',
  'singularity',
  'StableDiffusion',
];

export const REDDIT_BUNDLE_ID = 'reddit-ai-bundle-v1';
// SP-5.5 (2026-05-09): r/ChatGPT removed from bundle. 80/98 of its hot posts
// are i.redd.it / v.redd.it memes (data: 688-post sample) and 0 link to
// any HIGH-signal domain — same-shaped value loss as r/StableDiffusion
// which was already absent from the bundle. Bundle is now 12 subs.
export const REDDIT_BUNDLE_URL =
  'https://www.reddit.com/r/OpenAI+singularity+ArtificialInteligence+artificial+ClaudeAI+PromptEngineering+AI_Agents+vibecoding+LLMDevs+cursor+agi+LangChain/hot.json?limit=100&raw_json=1';
export const REDDIT_BUNDLE_NAME = 'AI Subreddit Bundle (12 subs hot)';

const HN_INTERVAL_TOP = 3600;
const HN_INTERVAL_ASK_SHOW = 14400;
export const REDDIT_INTERVAL_BUNDLE = 7200;

export interface ConsolidateResult {
  reddit: { disabled: number; inserted: boolean };
  hackernewsIntervalsUpdated: number;
}

export async function consolidateSp5Sources(): Promise<ConsolidateResult> {
  const redditDisabled = await prisma.sourceConfig.updateMany({
    where: { platform: Platform.REDDIT, identifier: { in: REDDIT_OLD_SUBS }, enabled: true },
    data: { enabled: false },
  });

  const existing = await prisma.sourceConfig.findUnique({
    where: { id: REDDIT_BUNDLE_ID },
  });

  let redditInserted = false;
  if (!existing) {
    await prisma.sourceConfig.create({
      data: {
        id: REDDIT_BUNDLE_ID,
        platform: Platform.REDDIT,
        name: REDDIT_BUNDLE_NAME,
        identifier: null,
        url: REDDIT_BUNDLE_URL,
        enabled: true,
        crawlInterval: REDDIT_INTERVAL_BUNDLE,
        status: 'NORMAL',
      },
    });
    redditInserted = true;
  } else {
    // Preserve runtime fields (enabled / status) on re-run so operator-driven
    // disables or crawler-set FAILED/LIMITED flags don't get silently reverted.
    // name + url ARE refreshed so SP-5.5 bundle changes propagate on next deploy.
    await prisma.sourceConfig.update({
      where: { id: REDDIT_BUNDLE_ID },
      data: {
        name: REDDIT_BUNDLE_NAME,
        identifier: null,
        url: REDDIT_BUNDLE_URL,
        crawlInterval: REDDIT_INTERVAL_BUNDLE,
      },
    });
  }

  const hnTop = await prisma.sourceConfig.updateMany({
    where: { platform: Platform.HACKERNEWS, identifier: 'top' },
    data: { crawlInterval: HN_INTERVAL_TOP },
  });
  const hnAskShow = await prisma.sourceConfig.updateMany({
    where: { platform: Platform.HACKERNEWS, identifier: { in: ['ask', 'show'] } },
    data: { crawlInterval: HN_INTERVAL_ASK_SHOW },
  });

  return {
    reddit: { disabled: redditDisabled.count, inserted: redditInserted },
    hackernewsIntervalsUpdated: hnTop.count + hnAskShow.count,
  };
}

async function main(): Promise<void> {
  const result = await consolidateSp5Sources();
  console.log(JSON.stringify(result, null, 2));
}

const isMainEntry =
  typeof require !== 'undefined' && require.main === module;
const isTsxEntry = process.argv[1]?.endsWith('consolidate-sp5-sources.ts');

if (isMainEntry || isTsxEntry) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
