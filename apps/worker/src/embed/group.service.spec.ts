import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  hotNews: { findUnique: vi.fn(), update: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
};

vi.mock('@ai-hot-news/db', async (orig) => {
  const actual = await orig<typeof import('@ai-hot-news/db')>();
  return {
    ...actual,
    getPrisma: () => mockPrisma,
  };
});

import { GroupService, COSINE_THRESHOLD } from './group.service';

beforeEach(() => {
  mockPrisma.hotNews.findUnique.mockReset();
  mockPrisma.hotNews.update.mockReset().mockResolvedValue({});
  mockPrisma.$queryRaw.mockReset();
  mockPrisma.$transaction.mockClear();
});

describe('GroupService.assignGroup', () => {
  const svc = new GroupService();

  it('returns null when target row missing', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce(null);
    const r = await svc.assignGroup('missing');
    expect(r.groupId).toBeNull();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns null when no candidates within 7d window', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({ aiTags: [] });
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);
    const r = await svc.assignGroup('lonely');
    expect(r.groupId).toBeNull();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns null when best candidate score below threshold and no tag boost', async () => {
    // v3 threshold = 0.55; an unrelated-AI pair sits around 0.40-0.50 cosine.
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({ aiTags: ['company:openai'] });
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'a', groupId: null, aiTags: ['company:anthropic'], cosine: 0.5 },
    ]);
    const r = await svc.assignGroup('me');
    expect(r.groupId).toBeNull();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('applies tag boost (+0.10) to push cosine 0.48 over threshold (0.55)', async () => {
    // v3: cosine 0.48 alone < 0.55, but +0.10 for shared company:openai tag
    // gives score 0.58 > 0.55 → join group.
    expect(0.48 + 0.10).toBeGreaterThanOrEqual(COSINE_THRESHOLD);
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({
      aiTags: ['company:openai', 'model:gpt-5'],
    });
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'a', groupId: null, aiTags: ['company:openai'], cosine: 0.48 },
    ]);
    const r = await svc.assignGroup('me');
    expect(r.groupId).toMatch(/^grp-/);
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
  });

  it('does NOT apply tag boost when shared tag is not company:/model: prefixed', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({ aiTags: ['tech:rag', 'category:Release'] });
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'a', groupId: null, aiTags: ['tech:rag', 'category:Release'], cosine: 0.48 },
    ]);
    const r = await svc.assignGroup('me');
    expect(r.groupId).toBeNull();
  });

  it('reuses existing groupId when best candidate already in a group', async () => {
    // v3: same-event cross-lingual cosine ~0.70, well above 0.55 threshold.
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({ aiTags: [] });
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'a', groupId: 'grp-existing-xyz', aiTags: [], cosine: 0.7 },
    ]);
    const r = await svc.assignGroup('me');
    expect(r.groupId).toBe('grp-existing-xyz');
    const ops = mockPrisma.$transaction.mock.calls[0]![0] as unknown[];
    expect(ops.length).toBe(1);
  });

  it('promotes singleton candidate to new group + propagates groupId to both rows in one transaction', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({ aiTags: [] });
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'singleton', groupId: null, aiTags: [], cosine: 0.75 },
    ]);
    const r = await svc.assignGroup('me');
    expect(r.groupId).toMatch(/^grp-/);
    const ops = mockPrisma.$transaction.mock.calls[0]![0] as unknown[];
    expect(ops.length).toBe(2);
  });
});
