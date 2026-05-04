import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, Platform, ContentStatus } from '../src';
import { runMigrateSp4 } from './migrate-sp4';

const prisma = getPrisma();

const TEST_PREFIX = 'https://lab.sp4.example.com/';

async function cleanup() {
  await prisma.hotNews.deleteMany({
    where: { sourceUrl: { startsWith: TEST_PREFIX } },
  });
  // SP-4 normalize-test rows: legacy form `http://m.example.sp4.example.com/...`
  // becomes canonical `https://example.sp4.example.com/...` after Layer 1.
  // Cover both forms so cleanup is robust to mid-test state.
  await prisma.hotNews.deleteMany({
    where: { sourceUrl: { contains: 'example.sp4.example.com' } },
  });
  await prisma.hotNews.deleteMany({
    where: { sourceUrl: { startsWith: 'https://www.reddit.com/r/SP4Test/' } },
  });
}

describe('migrate-sp4 backfill', () => {
  beforeEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('Layer 1: re-normalizes sourceUrl with the SP-4 rules', async () => {
    await prisma.hotNews.create({
      data: {
        title: 'Some title that is long enough',
        content: 'body',
        sourcePlatform: Platform.RSS,
        sourceUrl: 'http://m.example.sp4.example.com/post-old-url',
        publishedAt: new Date('2026-05-01T00:00:00Z'),
        dedupeHash: '00000000000000000000000000000001',
      },
    });

    const stats = await runMigrateSp4();

    expect(stats.layer1NormalizeUpdated).toBeGreaterThanOrEqual(1);

    const row = await prisma.hotNews.findFirst({
      where: { title: 'Some title that is long enough' },
    });
    expect(row?.sourceUrl).toBe('https://example.sp4.example.com/post-old-url');
  });

  it('Layer 1: collapses two rows that normalize to the same canonical URL (P2002)', async () => {
    await prisma.hotNews.create({
      data: {
        title: 'Same article title here',
        content: 'first body',
        sourcePlatform: Platform.RSS,
        sourceUrl: 'https://example.sp4.example.com/dup-article',
        publishedAt: new Date('2026-04-01T00:00:00Z'),
        dedupeHash: '00000000000000000000000000000010',
      },
    });
    await prisma.hotNews.create({
      data: {
        title: 'Same article title here',
        content: 'second body',
        sourcePlatform: Platform.RSS,
        sourceUrl: 'http://m.example.sp4.example.com/dup-article',
        publishedAt: new Date('2026-04-02T00:00:00Z'),
        dedupeHash: '00000000000000000000000000000011',
      },
    });

    const stats = await runMigrateSp4();

    expect(stats.layer1Collapsed).toBeGreaterThanOrEqual(1);

    const remaining = await prisma.hotNews.findMany({
      where: { sourceUrl: { contains: 'dup-article' } },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.content).toBe('first body');
  });

  it('Layer 2: marks low-ratio reddit rows HIDDEN with reddit_low_ratio', async () => {
    await prisma.hotNews.create({
      data: {
        title: 'Reddit post with bad ratio',
        content: 'body',
        sourcePlatform: Platform.REDDIT,
        sourceUrl: 'https://www.reddit.com/r/SP4Test/comments/lowratio',
        publishedAt: new Date('2026-05-01T00:00:00Z'),
        dedupeHash: '00000000000000000000000000000020',
        status: ContentStatus.VISIBLE,
        interactionData: {
          score: 100,
          comments: 50,
          externalUrl: null,
          redditId: 'lowratio',
          redditSubreddit: 'SP4Test',
          redditUpvoteRatio: 0.4,
        },
      },
    });

    const stats = await runMigrateSp4();

    expect(stats.layer2Hidden.reddit_low_ratio).toBeGreaterThanOrEqual(1);

    const row = await prisma.hotNews.findFirstOrThrow({
      where: { sourceUrl: 'https://www.reddit.com/r/SP4Test/comments/lowratio' },
    });
    expect(row.status).toBe(ContentStatus.HIDDEN);
    expect(row.filterReason).toBe('reddit_low_ratio');
  });

  it('Layer 2: marks short-title rows HIDDEN with title_too_short', async () => {
    await prisma.hotNews.create({
      data: {
        title: 'abc',
        content: 'body',
        sourcePlatform: Platform.RSS,
        sourceUrl: 'https://lab.sp4.example.com/short-title',
        publishedAt: new Date('2026-05-01T00:00:00Z'),
        dedupeHash: '00000000000000000000000000000030',
      },
    });

    const stats = await runMigrateSp4();

    expect(stats.layer2Hidden.title_too_short).toBeGreaterThanOrEqual(1);

    const row = await prisma.hotNews.findFirstOrThrow({
      where: { sourceUrl: 'https://lab.sp4.example.com/short-title' },
    });
    expect(row.status).toBe(ContentStatus.HIDDEN);
    expect(row.filterReason).toBe('title_too_short');
  });

  it('is idempotent: a second run reports zero updates', async () => {
    await prisma.hotNews.create({
      data: {
        title: 'A normal title that survives all checks',
        content: 'body',
        sourcePlatform: Platform.RSS,
        sourceUrl: 'https://lab.sp4.example.com/survivor',
        publishedAt: new Date('2026-05-01T00:00:00Z'),
        dedupeHash: '00000000000000000000000000000040',
      },
    });

    await runMigrateSp4();
    const second = await runMigrateSp4();

    expect(second.layer1NormalizeUpdated).toBe(0);
    expect(second.layer1Collapsed).toBe(0);
    expect(Object.values(second.layer2Hidden)).toEqual([]);
  });

  it('Layer 1: when older row is legacy and newer row is already canonical, OLDER wins', async () => {
    // Older row in legacy form (will normalize to canonical)
    await prisma.hotNews.create({
      data: {
        title: 'Same title for direction test',
        content: 'older body wins',
        sourcePlatform: Platform.RSS,
        sourceUrl: 'http://example.sp4.example.com/direction-test',
        publishedAt: new Date('2026-03-01T00:00:00Z'),
        dedupeHash: '00000000000000000000000000000050',
      },
    });
    // Newer row already in canonical form (will be deleted)
    await prisma.hotNews.create({
      data: {
        title: 'Same title for direction test',
        content: 'newer body deleted',
        sourcePlatform: Platform.RSS,
        sourceUrl: 'https://example.sp4.example.com/direction-test',
        publishedAt: new Date('2026-03-02T00:00:00Z'),
        dedupeHash: '00000000000000000000000000000051',
      },
    });

    const stats = await runMigrateSp4();

    expect(stats.layer1Collapsed).toBeGreaterThanOrEqual(1);

    const remaining = await prisma.hotNews.findMany({
      where: { sourceUrl: { contains: 'direction-test' } },
    });
    expect(remaining).toHaveLength(1);
    // Older publishedAt wins → 'older body wins' content survives
    expect(remaining[0]!.content).toBe('older body wins');
    expect(remaining[0]!.sourceUrl).toBe('https://example.sp4.example.com/direction-test');
  });
});
