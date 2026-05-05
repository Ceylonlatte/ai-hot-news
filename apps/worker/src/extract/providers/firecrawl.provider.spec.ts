import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirecrawlProvider } from './firecrawl.provider';
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

describe('FirecrawlProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const provider = new FirecrawlProvider();

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = 'fc-test';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
    delete process.env.FIRECRAWL_API_KEY;
  });

  it('returns ExtractedArticle on 200', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          markdown: '# Hello\n\nworld'.repeat(50),
          html: '<h1>Hello</h1>',
          metadata: { title: 'Hello' },
        },
      }),
    );

    const result = await provider.extract(
      'https://example.com/post',
      new AbortController().signal,
    );

    expect(result.contentText).toMatch(/^# Hello/);
    expect(result.rawHtml).toBe('<h1>Hello</h1>');
    expect(result.title).toBe('Hello');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v1/scrape',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer fc-test',
          'Content-Type': 'application/json',
        }),
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      url: 'https://example.com/post',
      formats: ['markdown', 'html'],
      onlyMainContent: true,
    });
  });

  it('throws QuotaExceededError on 402', async () => {
    fetchMock.mockResolvedValue(new Response('payment required', { status: 402 }));
    await expect(
      provider.extract('https://example.com/x', new AbortController().signal),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('throws QuotaExceededError on 429 (rate limit treated as quota for fallback purposes)', async () => {
    fetchMock.mockResolvedValue(new Response('rate', { status: 429 }));
    await expect(
      provider.extract('https://example.com/x', new AbortController().signal),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('throws PermanentFetchError on 401 / 403 / 404 / 410', async () => {
    for (const status of [401, 403, 404, 410]) {
      fetchMock.mockResolvedValue(new Response('nope', { status }));
      await expect(
        provider.extract('https://example.com/x', new AbortController().signal),
      ).rejects.toBeInstanceOf(PermanentFetchError);
    }
  });

  it('throws TransientFetchError on 5xx', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 503 }));
    await expect(
      provider.extract('https://example.com/x', new AbortController().signal),
    ).rejects.toBeInstanceOf(TransientFetchError);
  });

  it('throws when FIRECRAWL_API_KEY not set', async () => {
    delete process.env.FIRECRAWL_API_KEY;
    await expect(
      provider.extract('https://example.com/x', new AbortController().signal),
    ).rejects.toThrow(/FIRECRAWL_API_KEY/);
  });
});
