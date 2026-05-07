import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateTextMock = vi.fn();
const createOpenAIMock = vi.fn();

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (...args: unknown[]) => createOpenAIMock(...args),
}));

import { callLlm } from './llm-client';

describe('callLlm', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    createOpenAIMock.mockReset();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.SUMMARY_MODEL;
    delete process.env.LLM_BASE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when OPENROUTER_API_KEY is not configured', async () => {
    await expect(callLlm('sys', 'user')).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('uses default model deepseek/deepseek-v3.2 and default OpenRouter baseURL', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const provider = vi.fn().mockReturnValue({ id: 'mocked-model' });
    createOpenAIMock.mockReturnValue(provider);
    generateTextMock.mockResolvedValue({
      text: '{"summary":"x"}',
      usage: { promptTokens: 100, completionTokens: 50 },
    });

    await callLlm('sys', 'user');

    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or-test',
      }),
    );
    expect(provider).toHaveBeenCalledWith('deepseek/deepseek-v3.2');
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'sys',
        prompt: 'user',
        temperature: 0.2,
        maxTokens: 500,
      }),
    );
  });

  it('honors SUMMARY_MODEL + LLM_BASE_URL env overrides', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.SUMMARY_MODEL = 'openai/gpt-4o-mini';
    process.env.LLM_BASE_URL = 'https://api.openai.com/v1';
    const provider = vi.fn().mockReturnValue({ id: 'gpt-4o-mini' });
    createOpenAIMock.mockReturnValue(provider);
    generateTextMock.mockResolvedValue({ text: 'ok', usage: { promptTokens: 1, completionTokens: 1 } });

    await callLlm('s', 'u');

    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.openai.com/v1' }),
    );
    expect(provider).toHaveBeenCalledWith('openai/gpt-4o-mini');
  });

  it('returns text + tokensIn / tokensOut / durationMs', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const provider = vi.fn().mockReturnValue({});
    createOpenAIMock.mockReturnValue(provider);
    generateTextMock.mockResolvedValue({
      text: 'hello',
      usage: { promptTokens: 200, completionTokens: 80 },
    });

    const r = await callLlm('s', 'u');
    expect(r.text).toBe('hello');
    expect(r.tokensIn).toBe(200);
    expect(r.tokensOut).toBe(80);
    expect(typeof r.durationMs).toBe('number');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
});
