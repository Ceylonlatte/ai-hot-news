import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  hotNews: { findUnique: vi.fn() },
  $executeRaw: vi.fn(),
};
vi.mock('@ai-hot-news/db', async (orig) => {
  const actual = await orig<typeof import('@ai-hot-news/db')>();
  return { ...actual, getPrisma: () => mockPrisma };
});

const callEmbedMock = vi.fn();
vi.mock('./embed-client', () => ({
  callEmbed: (...args: unknown[]) => callEmbedMock(...args),
}));

import { EmbedService } from './embed.service';
import type { GroupService } from './group.service';

beforeEach(() => {
  mockPrisma.hotNews.findUnique.mockReset();
  mockPrisma.$executeRaw.mockReset().mockResolvedValue(1);
  callEmbedMock.mockReset();
});

afterEach(() => vi.resetAllMocks());

describe('EmbedService.run', () => {
  function makeService(): {
    svc: EmbedService;
    groupService: GroupService;
    llmUsage: { record: ReturnType<typeof vi.fn> };
  } {
    const groupService = {
      assignGroup: vi.fn().mockResolvedValue({ groupId: null, cosine: 0 }),
    } as unknown as GroupService;
    const llmUsage = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new EmbedService(
      groupService,
      llmUsage as unknown as import('../llm-usage/llm-usage.service').LlmUsageService,
    );
    return { svc, groupService, llmUsage };
  }

  it('skips when row not found', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce(null);
    const { svc } = makeService();
    await svc.run('missing');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(callEmbedMock).not.toHaveBeenCalled();
  });

  it('skips when status !== VISIBLE', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({
      id: 'a',
      title: 'x',
      titleZh: null,
      summary: 'y',
      status: 'HIDDEN',
    });
    const { svc } = makeService();
    await svc.run('a');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(callEmbedMock).not.toHaveBeenCalled();
  });

  it('skips when summary is null (defense-in-depth even if boot backstop scan filters)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({
      id: 'a',
      title: 'x',
      titleZh: null,
      summary: null,
      status: 'VISIBLE',
    });
    const { svc } = makeService();
    await svc.run('a');
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(callEmbedMock).not.toHaveBeenCalled();
  });

  it('uses titleZh + summary for embed input + persists vector + calls assignGroup', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({
      id: 'a',
      title: 'Anthropic raises X',
      titleZh: 'Anthropic 融资 X',
      summary: '中文摘要',
      status: 'VISIBLE',
    });
    const vec = Array.from({ length: 2048 }, () => 0.1);
    callEmbedMock.mockResolvedValueOnce({ vector: vec, tokensIn: 30, durationMs: 200 });
    const { svc, groupService } = makeService();
    (groupService.assignGroup as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      groupId: 'grp-xyz',
      cosine: 0.91,
    });

    await svc.run('a');

    expect(callEmbedMock).toHaveBeenCalledWith('Anthropic 融资 X\n中文摘要');
    expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
    expect(groupService.assignGroup).toHaveBeenCalledWith('a');
  });

  it('falls back to title (English) when titleZh is null', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({
      id: 'a',
      title: 'Plain title',
      titleZh: null,
      summary: 'sum',
      status: 'VISIBLE',
    });
    const vec = Array.from({ length: 2048 }, () => 0);
    callEmbedMock.mockResolvedValueOnce({ vector: vec, tokensIn: 5, durationMs: 10 });
    const { svc } = makeService();
    await svc.run('a');
    expect(callEmbedMock).toHaveBeenCalledWith('Plain title\nsum');
  });

  it('rethrows when callEmbed throws (BullMQ retries)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValueOnce({
      id: 'a',
      title: 't',
      titleZh: null,
      summary: 's',
      status: 'VISIBLE',
    });
    callEmbedMock.mockRejectedValueOnce(new Error('OpenRouter 503'));
    const { svc } = makeService();
    await expect(svc.run('a')).rejects.toThrow(/OpenRouter 503/);
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });
});
