import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma, Platform } from '@ai-hot-news/db';
import { backfillEmbeddings } from './backfill-embeddings-sp7';

const prisma = getPrisma();

const URL_PREFIX = 'https://sp7-backfill-test.example.com/';
const ID_PREFIX = 'sp7-test-';

async function cleanup() {
  await prisma.hotNews.deleteMany({
    where: { sourceUrl: { startsWith: URL_PREFIX } },
  });
}

beforeEach(cleanup);
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

function fakeVec(): number[] {
  return Array.from({ length: 1536 }, () => 0.05);
}

describe('backfillEmbeddings', () => {
  it('scans only rows with summary != NULL, status=VISIBLE, and embedding IS NULL', async () => {
    await prisma.hotNews.createMany({
      data: [
        // candidate ✓
        {
          id: ID_PREFIX + 'a',
          title: 't1',
          content: 'c',
          sourcePlatform: Platform.HACKERNEWS,
          sourceUrl: URL_PREFIX + '1',
          publishedAt: new Date(),
          dedupeHash: ID_PREFIX + 'h1',
          summary: '中文摘要',
          titleZh: '中文标题',
          status: 'VISIBLE',
        },
        // no summary → excluded
        {
          id: ID_PREFIX + 'b',
          title: 't2',
          content: 'c',
          sourcePlatform: Platform.HACKERNEWS,
          sourceUrl: URL_PREFIX + '2',
          publishedAt: new Date(),
          dedupeHash: ID_PREFIX + 'h2',
          summary: null,
          status: 'VISIBLE',
        },
        // HIDDEN → excluded
        {
          id: ID_PREFIX + 'c',
          title: 't3',
          content: 'c',
          sourcePlatform: Platform.HACKERNEWS,
          sourceUrl: URL_PREFIX + '3',
          publishedAt: new Date(),
          dedupeHash: ID_PREFIX + 'h3',
          summary: 'sum',
          status: 'HIDDEN',
          filterReason: 'test',
        },
      ],
    });

    const embedFn = vi.fn(async () => ({
      vector: fakeVec(),
      tokensIn: 30,
      durationMs: 1,
    }));
    const assignGroupFn = vi.fn().mockResolvedValue({ groupId: null, cosine: 0 });

    const stats = await backfillEmbeddings({
      embedFn,
      assignGroupFn,
      batchSize: 10,
    });

    expect(stats.scanned).toBe(1);
    expect(stats.embedded).toBe(1);
    expect(stats.failed).toBe(0);
    expect(assignGroupFn).toHaveBeenCalledWith(ID_PREFIX + 'a');
    expect(embedFn).toHaveBeenCalledTimes(1);
    // embed input should be `titleZh\nsummary`
    expect(embedFn.mock.calls[0]![0]).toBe('中文标题\n中文摘要');
  });

  it('counts distinct groupsFormed once per group id', async () => {
    await prisma.hotNews.createMany({
      data: [
        {
          id: ID_PREFIX + 'x',
          title: 't',
          content: 'c',
          sourcePlatform: Platform.HACKERNEWS,
          sourceUrl: URL_PREFIX + 'x',
          publishedAt: new Date(),
          dedupeHash: ID_PREFIX + 'hx',
          summary: 's',
          status: 'VISIBLE',
        },
        {
          id: ID_PREFIX + 'y',
          title: 't',
          content: 'c',
          sourcePlatform: Platform.REDDIT,
          sourceUrl: URL_PREFIX + 'y',
          publishedAt: new Date(),
          dedupeHash: ID_PREFIX + 'hy',
          summary: 's',
          status: 'VISIBLE',
        },
      ],
    });

    const embedFn = vi.fn(async () => ({ vector: fakeVec(), tokensIn: 5, durationMs: 1 }));
    const assignGroupFn = vi
      .fn()
      .mockResolvedValueOnce({ groupId: null, cosine: 0 })
      .mockResolvedValueOnce({ groupId: 'grp-shared', cosine: 0.91 });

    const stats = await backfillEmbeddings({
      embedFn,
      assignGroupFn,
      batchSize: 10,
    });
    expect(stats.scanned).toBe(2);
    expect(stats.embedded).toBe(2);
    expect(stats.groupsFormed).toBe(1);
  });

  it('is idempotent: re-running after rows have embedding finds scanned=0', async () => {
    await prisma.hotNews.create({
      data: {
        id: ID_PREFIX + 'z',
        title: 't',
        content: 'c',
        sourcePlatform: Platform.HACKERNEWS,
        sourceUrl: URL_PREFIX + 'z',
        publishedAt: new Date(),
        dedupeHash: ID_PREFIX + 'hz',
        summary: 's',
        status: 'VISIBLE',
      },
    });
    const literal = `[${Array.from({ length: 1536 }, () => 0).join(',')}]`;
    await prisma.$executeRawUnsafe(
      `UPDATE hot_news SET embedding = $1::vector(1536) WHERE id = $2`,
      literal,
      ID_PREFIX + 'z',
    );

    const embedFn = vi.fn();
    const assignGroupFn = vi.fn();
    const stats = await backfillEmbeddings({
      embedFn,
      assignGroupFn,
      batchSize: 10,
    });
    expect(stats.scanned).toBe(0);
    expect(embedFn).not.toHaveBeenCalled();
  });

  it('reports cost in dollars based on totalTokens (0.02 per 1M)', async () => {
    await prisma.hotNews.create({
      data: {
        id: ID_PREFIX + 'cost',
        title: 't',
        content: 'c',
        sourcePlatform: Platform.HACKERNEWS,
        sourceUrl: URL_PREFIX + 'cost',
        publishedAt: new Date(),
        dedupeHash: ID_PREFIX + 'hcost',
        summary: 's',
        status: 'VISIBLE',
      },
    });
    const embedFn = vi.fn(async () => ({
      vector: fakeVec(),
      tokensIn: 1_000_000, // exactly $0.02
      durationMs: 1,
    }));
    const assignGroupFn = vi.fn().mockResolvedValue({ groupId: null, cosine: 0 });
    const stats = await backfillEmbeddings({
      embedFn,
      assignGroupFn,
      batchSize: 10,
    });
    expect(stats.totalTokens).toBe(1_000_000);
    expect(stats.costUsd).toBe('$0.0200');
  });

  it('records failed count when embedFn rejects, and keeps embedding the rest', async () => {
    await prisma.hotNews.createMany({
      data: [
        {
          id: ID_PREFIX + 'fail',
          title: 't',
          content: 'c',
          sourcePlatform: Platform.HACKERNEWS,
          sourceUrl: URL_PREFIX + 'fail',
          publishedAt: new Date(),
          dedupeHash: ID_PREFIX + 'hfail',
          summary: 's',
          status: 'VISIBLE',
        },
        {
          id: ID_PREFIX + 'ok',
          title: 't',
          content: 'c',
          sourcePlatform: Platform.HACKERNEWS,
          sourceUrl: URL_PREFIX + 'ok',
          publishedAt: new Date(Date.now() - 1000), // ordered first via ORDER BY publishedAt DESC, but stable
          dedupeHash: ID_PREFIX + 'hok',
          summary: 's',
          status: 'VISIBLE',
        },
      ],
    });
    const embedFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('OpenAI 503'))
      .mockResolvedValueOnce({ vector: fakeVec(), tokensIn: 10, durationMs: 1 });
    const assignGroupFn = vi.fn().mockResolvedValue({ groupId: null, cosine: 0 });

    const stats = await backfillEmbeddings({
      embedFn,
      assignGroupFn,
      batchSize: 10,
    });
    expect(stats.scanned).toBe(2);
    expect(stats.embedded).toBe(1);
    expect(stats.failed).toBe(1);
  });
});
