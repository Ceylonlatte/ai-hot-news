import {
  ExtractProvider,
  ExtractedArticle,
  QuotaExceededError,
  TransientFetchError,
  PermanentFetchError,
} from './provider.interface';

export class FirecrawlProvider implements ExtractProvider {
  readonly name = 'firecrawl' as const;

  async extract(url: string, signal: AbortSignal): Promise<ExtractedArticle> {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY not configured');

    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'html'],
        onlyMainContent: true,
      }),
      signal,
    });

    if (res.status === 402 || res.status === 429) {
      throw new QuotaExceededError('firecrawl');
    }
    if (res.status === 401 || res.status === 403) {
      throw new PermanentFetchError(`firecrawl auth ${res.status}`);
    }
    if (res.status === 404 || res.status === 410) {
      throw new PermanentFetchError(`firecrawl ${res.status}`);
    }
    if (!res.ok) {
      throw new TransientFetchError(`firecrawl ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      data?: { markdown?: string; html?: string; metadata?: { title?: string } };
    };
    return {
      contentText: data?.data?.markdown ?? '',
      rawHtml: data?.data?.html ?? null,
      title: data?.data?.metadata?.title ?? null,
    };
  }
}
