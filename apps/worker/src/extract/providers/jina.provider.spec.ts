import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JinaProvider } from './jina.provider';
import {
  QuotaExceededError,
  TransientFetchError,
  PermanentFetchError,
} from './provider.interface';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('JinaProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const provider = new JinaProvider();

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
    delete process.env.JINA_API_KEY;
  });

  it('returns ExtractedArticle on 200 (anonymous)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { content: 'body text', title: 'Title' } }),
    );
    const result = await provider.extract(
      'https://example.com/post',
      new AbortController().signal,
    );
    expect(result).toEqual({ contentText: 'body text', rawHtml: null, title: 'Title' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://r.jina.ai/https://example.com/post',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/json' }),
      }),
    );
  });

  it('sends Authorization header when JINA_API_KEY is set', async () => {
    process.env.JINA_API_KEY = 'jina-test';
    fetchMock.mockResolvedValue(jsonResponse({ data: { content: 'x' } }));
    await provider.extract('https://example.com/x', new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jina-test' }),
      }),
    );
  });

  it('throws QuotaExceededError on 402 / 429', async () => {
    for (const status of [402, 429]) {
      fetchMock.mockResolvedValue(new Response('quota', { status }));
      await expect(
        provider.extract('https://example.com/x', new AbortController().signal),
      ).rejects.toBeInstanceOf(QuotaExceededError);
    }
  });

  it('throws PermanentFetchError on 404 / 410', async () => {
    for (const status of [404, 410]) {
      fetchMock.mockResolvedValue(new Response('gone', { status }));
      await expect(
        provider.extract('https://example.com/x', new AbortController().signal),
      ).rejects.toBeInstanceOf(PermanentFetchError);
    }
  });

  it('throws TransientFetchError on 5xx', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 502 }));
    await expect(
      provider.extract('https://example.com/x', new AbortController().signal),
    ).rejects.toBeInstanceOf(TransientFetchError);
  });
});
