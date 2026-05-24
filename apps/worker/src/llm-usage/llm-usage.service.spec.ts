import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPrisma = {
  llmUsage: {
    create: vi.fn().mockResolvedValue({}),
  },
};
vi.mock('@ai-hot-news/db', async (orig) => {
  const actual = await orig<typeof import('@ai-hot-news/db')>();
  return { ...actual, getPrisma: () => mockPrisma };
});

import { LlmUsageService } from './llm-usage.service';

describe('LlmUsageService.record', () => {
  let service: LlmUsageService;

  beforeEach(() => {
    mockPrisma.llmUsage.create.mockReset().mockResolvedValue({});
    service = new LlmUsageService();
  });

  it('persists summarize call with cost computed via pricing table', async () => {
    await service.record({
      operation: 'summarize',
      model: 'deepseek/deepseek-v3.2',
      hotNewsId: 'h1',
      tokensIn: 200,
      tokensOut: 80,
      durationMs: 1500,
    });
    expect(mockPrisma.llmUsage.create).toHaveBeenCalledTimes(1);
    const data = mockPrisma.llmUsage.create.mock.calls[0]![0]!.data;
    expect(data.operation).toBe('summarize');
    expect(data.model).toBe('deepseek/deepseek-v3.2');
    expect(data.hotNewsId).toBe('h1');
    expect(data.tokensIn).toBe(200);
    expect(data.tokensOut).toBe(80);
    expect(data.durationMs).toBe(1500);
    // (200/1M)*0.27 + (80/1M)*1.10 = 0.000054 + 0.000088 = 0.000142
    expect(data.costUsd).toBeCloseTo(0.000142, 6);
  });

  it('persists embed call with tokensOut=0 default', async () => {
    await service.record({
      operation: 'embed',
      model: 'openai/text-embedding-3-small',
      hotNewsId: 'h2',
      tokensIn: 30,
      // omit tokensOut
      durationMs: 200,
    });
    const data = mockPrisma.llmUsage.create.mock.calls[0]![0]!.data;
    expect(data.tokensOut).toBe(0);
  });

  it('persists with costUsd=null when model is not in pricing table', async () => {
    await service.record({
      operation: 'summarize',
      model: 'unknown/experimental-model',
      hotNewsId: 'h3',
      tokensIn: 100,
      tokensOut: 50,
      durationMs: 300,
    });
    const data = mockPrisma.llmUsage.create.mock.calls[0]![0]!.data;
    expect(data.model).toBe('unknown/experimental-model');
    expect(data.costUsd).toBeNull();
  });

  it('accepts hotNewsId=null for system-level operations', async () => {
    await service.record({
      operation: 'daily-report',
      model: 'deepseek/deepseek-v3.2',
      tokensIn: 5000,
      tokensOut: 2000,
      durationMs: 10000,
    });
    const data = mockPrisma.llmUsage.create.mock.calls[0]![0]!.data;
    expect(data.hotNewsId).toBeNull();
  });

  it('fire-and-forget: never throws when DB fails', async () => {
    mockPrisma.llmUsage.create.mockRejectedValueOnce(
      new Error('connection lost'),
    );
    await expect(
      service.record({
        operation: 'summarize',
        model: 'deepseek/deepseek-v3.2',
        tokensIn: 100,
        tokensOut: 50,
        durationMs: 100,
      }),
    ).resolves.toBeUndefined();
  });
});
