import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Platform, getPrisma } from '@ai-hot-news/db';
import { REDDIT_BUNDLE_ID, consolidateSp5Sources } from './consolidate-sp5-sources';

const prisma = getPrisma();

const OLD_REDDIT_SUBS = [
  'LocalLLaMA',
  'MachineLearning',
  'artificial',
  'OpenAI',
  'ChatGPT',
  'ClaudeAI',
  'singularity',
  'StableDiffusion',
];

async function resetSources() {
  await prisma.sourceConfig.deleteMany({
    where: {
      OR: [
        { id: REDDIT_BUNDLE_ID },
        { platform: Platform.REDDIT, identifier: { in: OLD_REDDIT_SUBS } },
        { platform: Platform.HACKERNEWS, identifier: { in: ['top', 'ask', 'show'] } },
      ],
    },
  });

  for (const identifier of OLD_REDDIT_SUBS) {
    await prisma.sourceConfig.create({
      data: {
        platform: Platform.REDDIT,
        name: `r/${identifier}`,
        identifier,
        url: null,
        enabled: true,
        crawlInterval: 3600,
      },
    });
  }

  for (const [identifier, interval] of [
    ['top', 900],
    ['ask', 1800],
    ['show', 1800],
  ] as const) {
    await prisma.sourceConfig.create({
      data: {
        platform: Platform.HACKERNEWS,
        name: `HackerNews ${identifier}`,
        identifier,
        url: null,
        enabled: true,
        crawlInterval: interval,
      },
    });
  }
}

describe('consolidate-sp5-sources', () => {
  beforeEach(resetSources);

  afterAll(async () => {
    await prisma.sourceConfig.deleteMany({ where: { id: REDDIT_BUNDLE_ID } });
    await prisma.$disconnect();
  });

  it('disables old Reddit sources, creates bundle, and updates HN intervals', async () => {
    const result = await consolidateSp5Sources();

    expect(result.reddit.disabled).toBe(8);
    expect(result.reddit.inserted).toBe(true);
    expect(result.hackernewsIntervalsUpdated).toBe(3);

    const oldSources = await prisma.sourceConfig.findMany({
      where: { platform: Platform.REDDIT, identifier: { in: OLD_REDDIT_SUBS } },
      select: { enabled: true },
    });
    expect(oldSources.every((s) => s.enabled === false)).toBe(true);

    const bundle = await prisma.sourceConfig.findUniqueOrThrow({
      where: { id: REDDIT_BUNDLE_ID },
    });
    expect(bundle.enabled).toBe(true);
    expect(bundle.crawlInterval).toBe(7200);
    // SP-6: ChatGPT removed from bundle; URL now begins with /r/OpenAI+...
    expect(bundle.url).toContain('/r/OpenAI+singularity+');
    expect(bundle.url).not.toContain('ChatGPT+');
    expect(bundle.name).toBe('AI Subreddit Bundle (12 subs hot)');

    const hn = await prisma.sourceConfig.findMany({
      where: { platform: Platform.HACKERNEWS },
      select: { identifier: true, crawlInterval: true },
    });
    expect(Object.fromEntries(hn.map((s) => [s.identifier, s.crawlInterval]))).toMatchObject({
      top: 3600,
      ask: 14400,
      show: 14400,
    });
  });

  it('is idempotent on repeated runs', async () => {
    await consolidateSp5Sources();
    const second = await consolidateSp5Sources();

    expect(second.reddit.disabled).toBe(0);
    expect(second.reddit.inserted).toBe(false);

    const bundles = await prisma.sourceConfig.count({ where: { id: REDDIT_BUNDLE_ID } });
    expect(bundles).toBe(1);
  });

  it('preserves runtime fields (enabled / status) on re-run', async () => {
    await consolidateSp5Sources();

    await prisma.sourceConfig.update({
      where: { id: REDDIT_BUNDLE_ID },
      data: { enabled: false, status: 'FAILED' },
    });

    const second = await consolidateSp5Sources();
    expect(second.reddit.inserted).toBe(false);

    const bundle = await prisma.sourceConfig.findUniqueOrThrow({
      where: { id: REDDIT_BUNDLE_ID },
    });
    expect(bundle.enabled).toBe(false);
    expect(bundle.status).toBe('FAILED');
    expect(bundle.crawlInterval).toBe(7200);
  });
});
