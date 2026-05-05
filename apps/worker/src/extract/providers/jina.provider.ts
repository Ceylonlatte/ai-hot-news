import {
  ExtractProvider,
  ExtractedArticle,
  QuotaExceededError,
  TransientFetchError,
  PermanentFetchError,
} from './provider.interface';

export class JinaProvider implements ExtractProvider {
  readonly name = 'jina' as const;

  async extract(url: string, signal: AbortSignal): Promise<ExtractedArticle> {
    const apiKey = process.env.JINA_API_KEY;
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal,
    });

    if (res.status === 402 || res.status === 429) {
      throw new QuotaExceededError('jina');
    }
    if (res.status === 404 || res.status === 410) {
      throw new PermanentFetchError(`jina ${res.status}`);
    }
    if (!res.ok) {
      throw new TransientFetchError(`jina ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      data?: { content?: string; title?: string };
    };
    return {
      contentText: data?.data?.content ?? '',
      rawHtml: null,
      title: data?.data?.title ?? null,
    };
  }
}
