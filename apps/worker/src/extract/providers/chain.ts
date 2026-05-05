import {
  ExtractProvider,
  ExtractedArticle,
  PermanentFetchError,
  TransientFetchError,
} from './provider.interface';

const MIN_CONTENT_LENGTH = 200;
const TOTAL_TIMEOUT_MS = 45_000;

export interface ChainResult {
  result: ExtractedArticle;
  usedProvider: 'firecrawl' | 'jina';
}

export class ExtractChain {
  constructor(private readonly providers: ExtractProvider[]) {}

  async extract(url: string): Promise<ChainResult> {
    const signal = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
    let lastErr: Error | null = null;

    for (const p of this.providers) {
      try {
        const result = await p.extract(url, signal);
        if (
          !result.contentText ||
          result.contentText.length < MIN_CONTENT_LENGTH
        ) {
          lastErr = new TransientFetchError(
            `${p.name} content too short (${result.contentText?.length ?? 0} chars)`,
          );
          continue;
        }
        return { result, usedProvider: p.name };
      } catch (err) {
        lastErr = err as Error;
        if (err instanceof PermanentFetchError) throw err;
      }
    }
    throw lastErr ?? new TransientFetchError('All providers failed');
  }
}
