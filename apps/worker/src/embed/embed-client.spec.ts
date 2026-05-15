import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callEmbed } from './embed-client';

beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.EMBED_MODEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.EMBED_MODEL;
});

describe('callEmbed (OpenRouter, SP-7-A v2)', () => {
  it('throws when OPENROUTER_API_KEY not configured', async () => {
    await expect(callEmbed('hello')).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('returns vector + tokensIn on 200 OK', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const vec = Array.from({ length: 1536 }, (_, i) => i * 0.001);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: [{ embedding: vec }], usage: { prompt_tokens: 42 } }),
      }),
    );
    const r = await callEmbed('Anthropic 推出 Claude 4.5');
    expect(r.vector).toHaveLength(1536);
    expect(r.tokensIn).toBe(42);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('targets the OpenRouter embeddings endpoint with bearer auth + attribution headers', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const vec = Array.from({ length: 1536 }, () => 0);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: vec }], usage: { prompt_tokens: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await callEmbed('x');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-or-test');
    expect(headers['HTTP-Referer']).toMatch(/ai-hot-news/);
    expect(headers['X-OpenRouter-Title']).toBe('ai-hot-news');
  });

  it('uses default model openai/text-embedding-3-small when EMBED_MODEL unset', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const vec = Array.from({ length: 1536 }, () => 0);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: vec }], usage: { prompt_tokens: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await callEmbed('x');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe('openai/text-embedding-3-small');
  });

  it('honors EMBED_MODEL env override', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.EMBED_MODEL = 'openai/text-embedding-3-large';
    const vec = Array.from({ length: 1536 }, () => 0);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: vec }], usage: { prompt_tokens: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await callEmbed('x');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe('openai/text-embedding-3-large');
  });

  it('throws on non-2xx response', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve('rate limited'),
      }),
    );
    await expect(callEmbed('x')).rejects.toThrow(/OpenRouter embeddings 429/);
  });

  it('throws when returned vector length != 1536', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: [{ embedding: [0.1, 0.2] }], usage: { prompt_tokens: 1 } }),
      }),
    );
    await expect(callEmbed('x')).rejects.toThrow(/invalid vector/);
  });
});
