import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  hotNews: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};
vi.mock('@ai-hot-news/db', () => ({
  getPrisma: () => mockPrisma,
  ContentStatus: { VISIBLE: 'VISIBLE', HIDDEN: 'HIDDEN', PENDING: 'PENDING' },
}));

const callLlmMock = vi.fn();
vi.mock('./llm-client', () => ({
  callLlm: (...args: unknown[]) => callLlmMock(...args),
}));

import { SummarizeService } from './summarize.service';
import { SummarizeAllVisibleStrategy } from './strategies/summarize-all-visible.strategy';

const goodLlmResponse = JSON.stringify({
  summary: 'OpenAI 今日发布 GPT-5，相比 GPT-4o 在数学推理上提升 30%。模型已开放给 API 用户使用。',
  companies: ['OpenAI'],
  models: ['GPT-5'],
  category: 'Release',
  tech: ['Reasoning'],
});

const baseRow = {
  id: 'cm-1',
  title: 'GPT-5 announced',
  content: 'OpenAI released GPT-5 today.',
  sourcePlatform: 'HACKERNEWS',
  publishedAt: new Date('2026-05-05T00:00:00Z'),
  status: 'VISIBLE',
  interactionData: null,
  heatScore: 100,
};

describe('SummarizeService.run', () => {
  let service: SummarizeService;

  beforeEach(() => {
    service = new SummarizeService(new SummarizeAllVisibleStrategy());
    mockPrisma.hotNews.findUnique.mockReset();
    mockPrisma.hotNews.update.mockReset();
    callLlmMock.mockReset();
  });

  afterEach(() => vi.resetAllMocks());

  it('UPDATEs summary + aiTags when LLM returns valid JSON for VISIBLE row', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    callLlmMock.mockResolvedValue({
      text: goodLlmResponse,
      tokensIn: 200,
      tokensOut: 80,
      durationMs: 1500,
    });
    mockPrisma.hotNews.update.mockResolvedValue({});

    await service.run('cm-1');

    expect(callLlmMock).toHaveBeenCalledTimes(1);
    expect(mockPrisma.hotNews.update).toHaveBeenCalledWith({
      where: { id: 'cm-1' },
      data: expect.objectContaining({
        summary: expect.stringMatching(/OpenAI/),
        aiTags: expect.arrayContaining(['company:OpenAI', 'model:GPT-5', 'category:Release']),
      }),
    });
  });

  it('skips HIDDEN rows without calling LLM or UPDATE', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue({ ...baseRow, status: 'HIDDEN' });

    await service.run('cm-1');

    expect(callLlmMock).not.toHaveBeenCalled();
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
  });

  it('returns silently when row not found', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(null);

    await expect(service.run('missing')).resolves.toBeUndefined();
    expect(callLlmMock).not.toHaveBeenCalled();
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
  });

  it('does NOT update DB when LLM returns invalid JSON (silent skip, no rethrow)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    callLlmMock.mockResolvedValue({
      text: 'sorry I cannot help',
      tokensIn: 50,
      tokensOut: 5,
      durationMs: 500,
    });

    await expect(service.run('cm-1')).resolves.toBeUndefined();
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
  });

  it('rethrows when LLM call itself throws (BullMQ will retry)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    callLlmMock.mockRejectedValue(new Error('OpenRouter 503'));

    await expect(service.run('cm-1')).rejects.toThrow(/OpenRouter 503/);
    expect(mockPrisma.hotNews.update).not.toHaveBeenCalled();
  });

  it('silently skips when prisma.update throws P2025 (row already deleted)', async () => {
    mockPrisma.hotNews.findUnique.mockResolvedValue(baseRow);
    callLlmMock.mockResolvedValue({
      text: goodLlmResponse,
      tokensIn: 200,
      tokensOut: 80,
      durationMs: 1500,
    });
    const p2025 = Object.assign(new Error('not found'), { code: 'P2025' });
    mockPrisma.hotNews.update.mockRejectedValue(p2025);

    await expect(service.run('cm-1')).resolves.toBeUndefined();
  });
});
