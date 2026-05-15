import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callEmbed } from './embed-client';

beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.EMBED_MODEL;
  delete process.env.EMBED_DIM;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.EMBED_MODEL;
  delete process.env.EMBED_DIM;
});

describe('callEmbed (OpenRouter, SP-7-A v3 — Nemotron 2048-d)', () => {
  it('throws when OPENROUTER_API_KEY not configured', async () => {
    await expect(callEmbed('hello')).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('returns vector + tokensIn on 200 OK', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const vec = Array.from({ length: 2048 }, (_, i) => i * 0.001);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: [{ embedding: vec }], usage: { prompt_tokens: 42 } }),
      }),
    );
    const r = await callEmbed('Anthropic 推出 Claude 4.5');
    expect(r.vector).toHaveLength(2048);
    expect(r.tokensIn).toBe(42);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('targets the OpenRouter embeddings endpoint with bearer auth + attribution headers', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const vec = Array.from({ length: 2048 }, () => 0);
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

  it('uses default model nvidia/llama-nemotron-embed-vl-1b-v2:free when EMBED_MODEL unset', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const vec = Array.from({ length: 2048 }, () => 0);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: vec }], usage: { prompt_tokens: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await callEmbed('x');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe('nvidia/llama-nemotron-embed-vl-1b-v2:free');
  });

  it('honors EMBED_MODEL env override', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.EMBED_MODEL = 'baai/bge-m3';
    process.env.EMBED_DIM = '1024';
    const vec = Array.from({ length: 1024 }, () => 0);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: vec }], usage: { prompt_tokens: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await callEmbed('x');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe('baai/bge-m3');
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

  it('throws when returned vector dim mismatches expected (default 2048)', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: [{ embedding: [0.1, 0.2] }], usage: { prompt_tokens: 1 } }),
      }),
    );
    await expect(callEmbed('x')).rejects.toThrow(/invalid vector .*expected 2048/);
  });
});
