import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  hotNews: {
    groupBy: vi.fn(),
    deleteMany: vi.fn(),
  },
};

vi.mock('@ai-hot-news/db', async (orig) => {
  const actual = await orig<typeof import('@ai-hot-news/db')>();
  return { ...actual, getPrisma: () => mockPrisma };
});

import { runWipeNonRss } from './wipe-hot-news-non-rss-sp7';

beforeEach(() => {
  mockPrisma.hotNews.groupBy.mockReset();
  mockPrisma.hotNews.deleteMany.mockReset();
});

describe('runWipeNonRss', () => {
  it('deletes only sourcePlatform != RSS rows and reports per-platform tallies', async () => {
    mockPrisma.hotNews.groupBy.mockResolvedValueOnce([
      { sourcePlatform: 'HACKERNEWS', _count: { _all: 238 } },
      { sourcePlatform: 'REDDIT', _count: { _all: 1150 } },
      { sourcePlatform: 'RSS', _count: { _all: 57 } },
    ]);
    mockPrisma.hotNews.deleteMany.mockResolvedValueOnce({ count: 238 + 1150 });
    mockPrisma.hotNews.groupBy.mockResolvedValueOnce([
      { sourcePlatform: 'RSS', _count: { _all: 57 } },
    ]);

    const r = await runWipeNonRss();

    expect(mockPrisma.hotNews.deleteMany).toHaveBeenCalledWith({
      where: { sourcePlatform: { not: 'RSS' } },
    });
    expect(r.before).toEqual({ total: 1445, rss: 57, nonRss: 1388 });
    expect(r.deleted).toBe(1388);
    expect(r.after).toEqual({ total: 57, rss: 57, nonRss: 0 });
    expect(r.platforms).toEqual({
      HACKERNEWS: 238,
      REDDIT: 1150,
      RSS: 57,
    });
  });

  it('handles empty table cleanly', async () => {
    mockPrisma.hotNews.groupBy.mockResolvedValueOnce([]);
    mockPrisma.hotNews.deleteMany.mockResolvedValueOnce({ count: 0 });
    mockPrisma.hotNews.groupBy.mockResolvedValueOnce([]);

    const r = await runWipeNonRss();
    expect(r).toEqual({
      before: { total: 0, rss: 0, nonRss: 0 },
      deleted: 0,
      after: { total: 0, rss: 0, nonRss: 0 },
      platforms: {},
    });
  });

  it('handles RSS-only table (nothing to delete)', async () => {
    mockPrisma.hotNews.groupBy.mockResolvedValueOnce([
      { sourcePlatform: 'RSS', _count: { _all: 12 } },
    ]);
    mockPrisma.hotNews.deleteMany.mockResolvedValueOnce({ count: 0 });
    mockPrisma.hotNews.groupBy.mockResolvedValueOnce([
      { sourcePlatform: 'RSS', _count: { _all: 12 } },
    ]);

    const r = await runWipeNonRss();
    expect(r.before).toEqual({ total: 12, rss: 12, nonRss: 0 });
    expect(r.deleted).toBe(0);
    expect(r.after).toEqual({ total: 12, rss: 12, nonRss: 0 });
  });
});
