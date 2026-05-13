import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Platform, getPrisma } from '@ai-hot-news/db';
import {
  REDDIT_BUNDLE_ID,
  REDDIT_BUNDLE_NAME,
  REDDIT_BUNDLE_URL,
} from './consolidate-sp5-sources';
import { runSp5_5SourceMigrations } from './sp5-5-source-migrations';

const prisma = getPrisma();

const ALL_SUBS = [
  'LocalLLaMA',
  'MachineLearning',
  'artificial',
  'OpenAI',
  'ChatGPT',
  'ClaudeAI',
  'singularity',
  'StableDiffusion',
];

const STALE_BUNDLE_URL = 'https://www.reddit.com/r/ChatGPT+OpenAI+stale/hot.json';
const STALE_BUNDLE_NAME = 'AI Subreddit Bundle (13 subs hot)';

async function reset() {
  await prisma.sourceConfig.deleteMany({
    where: {
      OR: [
        { id: REDDIT_BUNDLE_ID },
        { platform: Platform.REDDIT, identifier: { in: ALL_SUBS } },
      ],
    },
  });

  for (const identifier of ALL_SUBS) {
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

  await prisma.sourceConfig.create({
    data: {
      id: REDDIT_BUNDLE_ID,
      platform: Platform.REDDIT,
      name: STALE_BUNDLE_NAME,
      identifier: null,
      url: STALE_BUNDLE_URL,
      enabled: true,
      crawlInterval: 7200,
      status: 'NORMAL',
    },
  });
}

describe('sp5-5-source-migrations', () => {
  beforeEach(reset);

  afterAll(async () => {
    await prisma.sourceConfig.deleteMany({
      where: {
        OR: [
          { id: REDDIT_BUNDLE_ID },
          { platform: Platform.REDDIT, identifier: { in: ALL_SUBS } },
        ],
      },
    });
    await prisma.$disconnect();
  });

  it('disables ONLY r/StableDiffusion and r/ChatGPT (other 6 stay enabled)', async () => {
    const result = await runSp5_5SourceMigrations();

    expect(result.redditDisabled).toBe(2);

    const subs = await prisma.sourceConfig.findMany({
      where: { platform: Platform.REDDIT, identifier: { in: ALL_SUBS } },
      select: { identifier: true, enabled: true },
    });
    const enabledMap = Object.fromEntries(
      subs.map((s) => [s.identifier, s.enabled]),
    );
    expect(enabledMap.StableDiffusion).toBe(false);
    expect(enabledMap.ChatGPT).toBe(false);
    // The other six remain operator-enabled.
    expect(enabledMap.LocalLLaMA).toBe(true);
    expect(enabledMap.MachineLearning).toBe(true);
    expect(enabledMap.artificial).toBe(true);
    expect(enabledMap.OpenAI).toBe(true);
    expect(enabledMap.ClaudeAI).toBe(true);
    expect(enabledMap.singularity).toBe(true);
  });

  it('refreshes bundle name + url to the SP-5.5 12-sub values', async () => {
    const result = await runSp5_5SourceMigrations();

    expect(result.bundlePresent).toBe(true);
    expect(result.bundleUpdated).toBe(true);

    const bundle = await prisma.sourceConfig.findUniqueOrThrow({
      where: { id: REDDIT_BUNDLE_ID },
    });
    expect(bundle.name).toBe(REDDIT_BUNDLE_NAME);
    expect(bundle.url).toBe(REDDIT_BUNDLE_URL);
    expect(bundle.url).not.toContain('ChatGPT+');
    expect(bundle.url).toContain('/r/OpenAI+singularity+');
  });

  it('preserves bundle runtime fields (enabled / status / crawlInterval)', async () => {
    await prisma.sourceConfig.update({
      where: { id: REDDIT_BUNDLE_ID },
      data: { enabled: false, status: 'FAILED', crawlInterval: 7200 },
    });

    await runSp5_5SourceMigrations();

    const bundle = await prisma.sourceConfig.findUniqueOrThrow({
      where: { id: REDDIT_BUNDLE_ID },
    });
    expect(bundle.enabled).toBe(false);
    expect(bundle.status).toBe('FAILED');
    expect(bundle.crawlInterval).toBe(7200);
  });

  it('is idempotent: second run disables 0 and bundle stays put', async () => {
    await runSp5_5SourceMigrations();
    const second = await runSp5_5SourceMigrations();

    expect(second.redditDisabled).toBe(0);
    expect(second.bundleUpdated).toBe(false);
  });

  it('returns bundlePresent=false (and bundleUpdated=false) when bundle row missing', async () => {
    await prisma.sourceConfig.delete({ where: { id: REDDIT_BUNDLE_ID } });

    const result = await runSp5_5SourceMigrations();
    expect(result.bundlePresent).toBe(false);
    expect(result.bundleUpdated).toBe(false);
    // Disable still works on individual rows.
    expect(result.redditDisabled).toBe(2);
  });

  it('does NOT touch hot_news rows', async () => {
    const before = await prisma.hotNews.count();
    await runSp5_5SourceMigrations();
    const after = await prisma.hotNews.count();
    expect(after).toBe(before);
  });
});
