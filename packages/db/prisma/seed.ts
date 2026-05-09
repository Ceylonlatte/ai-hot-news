import { getPrisma } from '@ai-hot-news/db';

const prisma = getPrisma();

// Reddit bundle identity for SP-5 v3.2 (SP-6 dropped r/ChatGPT 2026-05-09).
//
// These four constants are the source of truth for the prod migration script
// (`packages/db/scripts/consolidate-sp5-sources.ts`). They are duplicated here
// rather than imported because the api Docker image does not COPY
// `packages/db/scripts/` (only the worker image does — see
// `apps/worker/Dockerfile` line 54), and the api image is what runs
// `prisma db seed` during deploy.
//
// `consolidate-sp5-sources.spec.ts` and `seed.consts.spec.ts` lock these
// values to the same literals so the duplication cannot drift silently.
const REDDIT_BUNDLE_ID = 'reddit-ai-bundle-v1';
const REDDIT_BUNDLE_URL =
  'https://www.reddit.com/r/OpenAI+singularity+ArtificialInteligence+artificial+ClaudeAI+PromptEngineering+AI_Agents+vibecoding+LLMDevs+cursor+agi+LangChain/hot.json?limit=100&raw_json=1';
const REDDIT_BUNDLE_NAME = 'AI Subreddit Bundle (12 subs hot)';
const REDDIT_INTERVAL_BUNDLE = 7200;

interface RssCandidate {
  name: string;
  url: string;
  enabled: boolean;
}

interface HnCandidate {
  name: string;
  identifier: 'top' | 'ask' | 'show';
  enabled: boolean;
  crawlInterval: number;
}

interface RedditCandidate {
  name: string;
  identifier: string | null;
  url: string | null;
  enabled: boolean;
  crawlInterval: number;
}

const rssCandidates: RssCandidate[] = [
  { name: 'OpenAI News',           url: 'https://openai.com/news/rss.xml',                                                                  enabled: true },
  { name: 'Anthropic News',        url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml',          enabled: true },
  { name: 'Google Research Blog',  url: 'https://research.google/blog/rss/',                                                                enabled: true },
  { name: 'Google DeepMind Blog', url: 'https://deepmind.google/blog/rss.xml',                                                              enabled: true },
  { name: 'Cursor Blog',           url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_cursor.xml',                  enabled: true },
  { name: 'Claude Blog',           url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_claude.xml',                  enabled: true },
  { name: 'Claude Code Changelog', url: 'https://code.claude.com/docs/en/changelog/rss.xml',                                                enabled: true },
];

const hnCandidates: HnCandidate[] = [
  { name: 'HackerNews Top',  identifier: 'top',  enabled: true, crawlInterval: 3600  },
  { name: 'HackerNews Ask',  identifier: 'ask',  enabled: true, crawlInterval: 14400 },
  { name: 'HackerNews Show', identifier: 'show', enabled: true, crawlInterval: 14400 },
];

// SP-6 (2026-05-09): r/ChatGPT and r/StableDiffusion removed from
// candidates — operator decision based on 688-post value-signal analysis.
// r/ChatGPT had 80/98 hot posts on i.redd.it/v.redd.it (memes) and zero
// HIGH-signal links; r/StableDiffusion is no longer in scope. Existing prod
// rows are disabled (not deleted) by `consolidate-sp5-sources.ts` for
// historical traceability.
const redditCandidates: RedditCandidate[] = [
  { name: 'r/LocalLLaMA',       identifier: 'LocalLLaMA',       url: null, enabled: false, crawlInterval: 3600 },
  { name: 'r/MachineLearning',  identifier: 'MachineLearning',  url: null, enabled: false, crawlInterval: 3600 },
  { name: 'r/artificial',       identifier: 'artificial',       url: null, enabled: false, crawlInterval: 3600 },
  { name: 'r/OpenAI',           identifier: 'OpenAI',           url: null, enabled: false, crawlInterval: 3600 },
  { name: 'r/singularity',      identifier: 'singularity',      url: null, enabled: false, crawlInterval: 3600 },
  { name: 'r/ClaudeAI',         identifier: 'ClaudeAI',         url: null, enabled: false, crawlInterval: 3600 },
  {
    name: REDDIT_BUNDLE_NAME,
    identifier: null,
    url: REDDIT_BUNDLE_URL,
    enabled: true,
    crawlInterval: REDDIT_INTERVAL_BUNDLE,
  },
];

async function seedRss() {
  for (const c of rssCandidates) {
    const existing = await prisma.sourceConfig.findFirst({
      where: { platform: 'RSS', name: c.name },
    });
    if (existing) {
      // Preserve runtime fields (enabled / status) on re-run so operator
      // overrides and crawler-set FAILED/LIMITED flags are not reverted.
      await prisma.sourceConfig.update({
        where: { id: existing.id },
        data: {
          url: c.url,
          crawlInterval: 86400,
        },
      });
    } else {
      await prisma.sourceConfig.create({
        data: {
          platform: 'RSS',
          name: c.name,
          url: c.url,
          enabled: c.enabled,
          crawlInterval: 86400,
        },
      });
    }
    console.log(`seeded RSS: ${c.name} (enabled=${c.enabled}, url=${c.url})`);
  }
}

async function seedHn() {
  for (const c of hnCandidates) {
    const existing = await prisma.sourceConfig.findFirst({
      where: { platform: 'HACKERNEWS', identifier: c.identifier },
    });
    if (existing) {
      // Preserve runtime fields (enabled / status) on re-run so operator
      // overrides and crawler-set FAILED/LIMITED flags are not reverted.
      await prisma.sourceConfig.update({
        where: { id: existing.id },
        data: {
          name: c.name,
          crawlInterval: c.crawlInterval,
        },
      });
    } else {
      await prisma.sourceConfig.create({
        data: {
          platform: 'HACKERNEWS',
          name: c.name,
          url: null,
          identifier: c.identifier,
          enabled: c.enabled,
          crawlInterval: c.crawlInterval,
        },
      });
    }
    console.log(`seeded HN: ${c.name} (identifier=${c.identifier}, enabled=${c.enabled})`);
  }
}

async function seedReddit() {
  for (const c of redditCandidates) {
    const existing = c.identifier
      ? await prisma.sourceConfig.findFirst({
          where: { platform: 'REDDIT', identifier: c.identifier },
        })
      : await prisma.sourceConfig.findUnique({
          where: { id: REDDIT_BUNDLE_ID },
        });
    if (existing) {
      // Preserve runtime fields (enabled / status) on re-run so operator
      // overrides and crawler-set FAILED/LIMITED flags are not reverted.
      // identifier is included so a legacy bundle row with a stale identifier
      // can be repaired by re-running seed.
      await prisma.sourceConfig.update({
        where: { id: existing.id },
        data: {
          name: c.name,
          url: c.url,
          identifier: c.identifier,
          crawlInterval: c.crawlInterval,
        },
      });
    } else {
      await prisma.sourceConfig.create({
        data: {
          ...(c.identifier === null ? { id: REDDIT_BUNDLE_ID } : {}),
          platform: 'REDDIT',
          name: c.name,
          url: c.url,
          identifier: c.identifier,
          enabled: c.enabled,
          crawlInterval: c.crawlInterval,
        },
      });
    }
    console.log(`seeded Reddit: ${c.name} (identifier=${c.identifier}, enabled=${c.enabled})`);
  }
}

async function main() {
  await seedRss();
  await seedHn();
  await seedReddit();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
