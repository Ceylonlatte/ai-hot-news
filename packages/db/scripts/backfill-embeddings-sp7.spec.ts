import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  hotNews: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $queryRawUnsafe: vi.fn(),
  $queryRaw: vi.fn(),
  $executeRawUnsafe: vi.fn(),
  $executeRaw: vi.fn(),
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
};

vi.mock('@ai-hot-news/db', async (orig) => {
  const actual = await orig<typeof import('@ai-hot-news/db')>();
  return {
    ...actual,
    getPrisma: () => mockPrisma,
  };
});

import { backfillEmbeddings } from './backfill-embeddings-sp7';

beforeEach(() => {
  mockPrisma.hotNews.findUnique.mockReset();
  mockPrisma.hotNews.update.mockReset().mockResolvedValue({});
  mockPrisma.$queryRawUnsafe.mockReset();
  mockPrisma.$queryRaw.mockReset();
  mockPrisma.$executeRawUnsafe.mockReset().mockResolvedValue(1);
  mockPrisma.$executeRaw.mockReset().mockResolvedValue(1);
  mockPrisma.$transaction
    .mockReset()
    .mockImplementation(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
});

afterEach(() => vi.resetAllMocks());

function vec(): number[] {
  return Array.from({ length: 2048 }, () => 0.05);
}

describe('backfillEmbeddings', () => {
  it('queries only VISIBLE + summary != NULL + embedding IS NULL via raw SQL', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);
    const embedFn = vi.fn();
    const assignGroupFn = vi.fn();

    const stats = await backfillEmbeddings({ embedFn, assignGroupFn, batchSize: 10 });

    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalled();
    const sql = mockPrisma.$queryRawUnsafe.mock.calls[0]![0] as string;
    expect(sql).toMatch(/status='VISIBLE'/);
    expect(sql).toMatch(/summary IS NOT NULL/);
    expect(sql).toMatch(/embedding IS NULL/);
    expect(stats.scanned).toBe(0);
    expect(stats.embedded).toBe(0);
    expect(embedFn).not.toHaveBeenCalled();
  });

  it('uses titleZh ?? title for embed input + persists vector + calls assignGroupFn', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { id: 'a', title: 'EN title', titleZh: '中文标题', summary: '中文摘要' },
    ]);
    const embedFn = vi.fn(async () => ({ vector: vec(), tokensIn: 30, durationMs: 1 }));
    const assignGroupFn = vi.fn().mockResolvedValue({ groupId: null, cosine: 0 });

    const stats = await backfillEmbeddings({ embedFn, assignGroupFn, batchSize: 10 });

    expect(embedFn).toHaveBeenCalledTimes(1);
    expect(embedFn.mock.calls[0]![0]).toBe('中文标题\n中文摘要');
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledOnce();
    // first arg is the SQL template; second is the vector literal; third the id
    const call = mockPrisma.$executeRawUnsafe.mock.calls[0]!;
    expect(call[0]).toMatch(/UPDATE hot_news SET embedding/);
    expect(call[2]).toBe('a');
    expect(assignGroupFn).toHaveBeenCalledWith('a');
    expect(stats.embedded).toBe(1);
    expect(stats.scanned).toBe(1);
  });

  it('falls back to title (English) when titleZh is null', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { id: 'b', title: 'Plain title', titleZh: null, summary: 'sum' },
    ]);
    const embedFn = vi.fn(async () => ({ vector: vec(), tokensIn: 5, durationMs: 1 }));
    const assignGroupFn = vi.fn().mockResolvedValue({ groupId: null, cosine: 0 });

    await backfillEmbeddings({ embedFn, assignGroupFn, batchSize: 10 });

    expect(embedFn.mock.calls[0]![0]).toBe('Plain title\nsum');
  });

  it('counts distinct groupsFormed once per group id and queries multiPlatformGroups when seenGroups > 0', async () => {
    mockPrisma.$queryRawUnsafe
      .mockResolvedValueOnce([
        { id: 'x', title: 't', titleZh: null, summary: 's' },
        { id: 'y', title: 't', titleZh: null, summary: 's' },
        { id: 'z', title: 't', titleZh: null, summary: 's' },
      ])
      .mockResolvedValueOnce([{ count: 1n }]);
    const embedFn = vi.fn(async () => ({ vector: vec(), tokensIn: 1, durationMs: 1 }));
    const assignGroupFn = vi
      .fn()
      .mockResolvedValueOnce({ groupId: null, cosine: 0 })
      .mockResolvedValueOnce({ groupId: 'grp-shared', cosine: 0.91 })
      .mockResolvedValueOnce({ groupId: 'grp-shared', cosine: 0.92 });

    const stats = await backfillEmbeddings({ embedFn, assignGroupFn, batchSize: 10 });

    expect(stats.scanned).toBe(3);
    expect(stats.embedded).toBe(3);
    expect(stats.groupsFormed).toBe(1);
    expect(stats.multiPlatformGroups).toBe(1);
  });

  it('skips multiPlatformGroups query when no groups were formed', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { id: 'a', title: 't', titleZh: null, summary: 's' },
    ]);
    const embedFn = vi.fn(async () => ({ vector: vec(), tokensIn: 1, durationMs: 1 }));
    const assignGroupFn = vi.fn().mockResolvedValue({ groupId: null, cosine: 0 });

    await backfillEmbeddings({ embedFn, assignGroupFn, batchSize: 10 });

    // only the initial scan query, no multi-platform follow-up
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('reports $0 cost on free Nemotron path (no OPENAI_API_KEY set)', async () => {
    delete process.env.OPENAI_API_KEY;
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { id: 'a', title: 't', titleZh: null, summary: 's' },
    ]);
    const embedFn = vi.fn(async () => ({ vector: vec(), tokensIn: 1_000_000, durationMs: 1 }));
    const assignGroupFn = vi.fn().mockResolvedValue({ groupId: null, cosine: 0 });

    const stats = await backfillEmbeddings({ embedFn, assignGroupFn, batchSize: 10 });

    expect(stats.totalTokens).toBe(1_000_000);
    expect(stats.costUsd).toBe('$0.0000 (Nemotron free)');
  });

  it('falls back to OpenAI v3-small pricing when OPENAI_API_KEY is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    try {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        { id: 'a', title: 't', titleZh: null, summary: 's' },
      ]);
      const embedFn = vi.fn(async () => ({ vector: vec(), tokensIn: 1_000_000, durationMs: 1 }));
      const assignGroupFn = vi.fn().mockResolvedValue({ groupId: null, cosine: 0 });

      const stats = await backfillEmbeddings({ embedFn, assignGroupFn, batchSize: 10 });

      expect(stats.totalTokens).toBe(1_000_000);
      expect(stats.costUsd).toBe('$0.0200');
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('records failed count when embedFn rejects, keeps processing the rest', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { id: 'fail', title: 't', titleZh: null, summary: 's' },
      { id: 'ok', title: 't', titleZh: null, summary: 's' },
    ]);
    const embedFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('OpenRouter 503'))
      .mockResolvedValueOnce({ vector: vec(), tokensIn: 10, durationMs: 1 });
    const assignGroupFn = vi.fn().mockResolvedValue({ groupId: null, cosine: 0 });

    const stats = await backfillEmbeddings({ embedFn, assignGroupFn, batchSize: 10 });

    expect(stats.scanned).toBe(2);
    expect(stats.embedded).toBe(1);
    expect(stats.failed).toBe(1);
  });
});
