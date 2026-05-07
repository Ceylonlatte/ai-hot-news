import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, Platform } from '@ai-hot-news/db';
import { runCleanupAntibotExtracted } from './cleanup-antibot-extracted';

const prisma = getPrisma();

const TEST_URL_PREFIX = 'https://sp4-7-antibot-cleanup.example.com/';

async function cleanup() {
  await prisma.hotNews.deleteMany({
    where: { sourceUrl: { startsWith: TEST_URL_PREFIX } },
  });
}

interface SeedShape {
  slug: string;
  title?: string;
  content: string;
  extractStatus?: string;
}

async function seed({ slug, title, content, extractStatus = 'EXTRACTED' }: SeedShape) {
  return prisma.hotNews.create({
    data: {
      title: title ?? `Original Title for ${slug}`,
      content,
      sourcePlatform: Platform.REDDIT,
      sourceUrl: TEST_URL_PREFIX + slug,
      publishedAt: new Date(),
      dedupeHash: `sp4-7-antibot-${slug}`,
      summary: 'old polluted summary',
      titleZh: 'old polluted titleZh',
      aiTags: ['stale:tag'],
      extractStatus,
      extractAttempts: 1,
    },
  });
}

describe('cleanup-antibot-extracted', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('resets a Reddit-block-page row to title-only state', async () => {
    await seed({
      slug: 'reddit-block',
      title: 'AI alignment paper review',
      content:
        "You've been blocked by network security.\n\nTo continue, log in to your Reddit account or use your developer token to access the API.",
    });

    const stats = await runCleanupAntibotExtracted();

    expect(stats.matched).toBeGreaterThanOrEqual(1);
    expect(stats.reset).toBeGreaterThanOrEqual(1);
    const row = await prisma.hotNews.findUniqueOrThrow({
      where: { sourceUrl: TEST_URL_PREFIX + 'reddit-block' },
    });
    expect(row.content).toBe('AI alignment paper review');
    expect(row.summary).toBeNull();
    expect(row.titleZh).toBeNull();
    expect(row.aiTags).toEqual([]);
    expect(row.extractStatus).toBe('FAILED');
    expect(row.extractAttempts).toBe(3);
    expect(row.rawHtml).toBeNull();
  });

  it('resets a Cloudflare-challenge row', async () => {
    await seed({
      slug: 'cf-challenge',
      title: 'Reading list',
      content: 'Just a moment... Checking your browser before accessing the site.',
    });

    await runCleanupAntibotExtracted();

    const row = await prisma.hotNews.findUniqueOrThrow({
      where: { sourceUrl: TEST_URL_PREFIX + 'cf-challenge' },
    });
    expect(row.content).toBe('Reading list');
    expect(row.extractStatus).toBe('FAILED');
  });

  it('does NOT touch a normal long article that happens to mention captcha', async () => {
    const longArticle =
      'In this benchmark we evaluate captcha-solving accuracy of multiple vision LLMs across 12 categories. ' +
      'a'.repeat(800);
    await seed({
      slug: 'long-article',
      title: 'Vision LLM benchmark',
      content: longArticle,
    });

    await runCleanupAntibotExtracted();

    const row = await prisma.hotNews.findUniqueOrThrow({
      where: { sourceUrl: TEST_URL_PREFIX + 'long-article' },
    });
    expect(row.content.length).toBeGreaterThan(800);
    expect(row.summary).toBe('old polluted summary');
    expect(row.extractStatus).toBe('EXTRACTED');
  });

  it('does NOT touch rows whose extractStatus is not EXTRACTED', async () => {
    await seed({
      slug: 'pending-with-block',
      title: 't',
      content: "You've been blocked by network security",
      extractStatus: 'PENDING',
    });

    await runCleanupAntibotExtracted();

    const row = await prisma.hotNews.findUniqueOrThrow({
      where: { sourceUrl: TEST_URL_PREFIX + 'pending-with-block' },
    });
    expect(row.extractStatus).toBe('PENDING');
    expect(row.extractAttempts).toBe(1);
  });

  it('idempotent: second run resets nothing more', async () => {
    await seed({
      slug: 'idem-cf',
      title: 't',
      content: 'Just a moment...',
    });

    const first = await runCleanupAntibotExtracted();
    expect(first.matched).toBeGreaterThanOrEqual(1);

    const second = await runCleanupAntibotExtracted();
    expect(second.matched).toBe(0);
    expect(second.reset).toBe(0);
  });
});
