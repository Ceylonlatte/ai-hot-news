import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callEmbed } from './embed-client';

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.EMBED_MODEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  delete process.env.EMBED_MODEL;
});

describe('callEmbed', () => {
  it('throws when OPENAI_API_KEY not configured', async () => {
    await expect(callEmbed('hello')).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it('returns vector + tokensIn on 200 OK', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
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

  it('uses default model text-embedding-3-small when EMBED_MODEL unset', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const vec = Array.from({ length: 1536 }, () => 0);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: vec }], usage: { prompt_tokens: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await callEmbed('x');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe('text-embedding-3-small');
  });

  it('honors EMBED_MODEL env override', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.EMBED_MODEL = 'text-embedding-3-large';
    const vec = Array.from({ length: 1536 }, () => 0);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: vec }], usage: { prompt_tokens: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await callEmbed('x');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe('text-embedding-3-large');
  });

  it('throws on non-2xx response', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve('rate limited'),
      }),
    );
    await expect(callEmbed('x')).rejects.toThrow(/429/);
  });

  it('throws when returned vector length != 1536', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
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
