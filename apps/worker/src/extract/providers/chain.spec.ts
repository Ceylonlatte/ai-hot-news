import { describe, expect, it, vi } from 'vitest';
import { ExtractChain } from './chain';
import {
  ExtractProvider,
  ExtractedArticle,
  QuotaExceededError,
  TransientFetchError,
  PermanentFetchError,
} from './provider.interface';

function fakeProvider(
  name: 'firecrawl' | 'jina',
  impl: () => Promise<ExtractedArticle>,
): ExtractProvider {
  return { name, extract: vi.fn(impl) as ExtractProvider['extract'] };
}

const longText = 'a'.repeat(500);

describe('ExtractChain', () => {
  it('returns first provider success without calling second', async () => {
    const second = vi.fn();
    const chain = new ExtractChain([
      fakeProvider('firecrawl', async () => ({
        contentText: longText,
        rawHtml: null,
      })),
      { name: 'jina', extract: second },
    ]);

    const out = await chain.extract('https://example.com');

    expect(out.usedProvider).toBe('firecrawl');
    expect(out.result.contentText).toBe(longText);
    expect(second).not.toHaveBeenCalled();
  });

  it('falls back to second provider on QuotaExceededError', async () => {
    const chain = new ExtractChain([
      fakeProvider('firecrawl', async () => {
        throw new QuotaExceededError('firecrawl');
      }),
      fakeProvider('jina', async () => ({
        contentText: longText,
        rawHtml: null,
      })),
    ]);

    const out = await chain.extract('https://example.com');

    expect(out.usedProvider).toBe('jina');
  });

  it('falls back to second provider on TransientFetchError', async () => {
    const chain = new ExtractChain([
      fakeProvider('firecrawl', async () => {
        throw new TransientFetchError('boom');
      }),
      fakeProvider('jina', async () => ({
        contentText: longText,
        rawHtml: null,
      })),
    ]);

    const out = await chain.extract('https://example.com');
    expect(out.usedProvider).toBe('jina');
  });

  it('throws PermanentFetchError immediately, does NOT try second provider', async () => {
    const second = vi.fn();
    const chain = new ExtractChain([
      fakeProvider('firecrawl', async () => {
        throw new PermanentFetchError('404');
      }),
      { name: 'jina', extract: second },
    ]);

    await expect(chain.extract('https://example.com')).rejects.toBeInstanceOf(
      PermanentFetchError,
    );
    expect(second).not.toHaveBeenCalled();
  });

  it('falls back when first provider returns content shorter than 200 chars', async () => {
    const chain = new ExtractChain([
      fakeProvider('firecrawl', async () => ({
        contentText: 'too short',
        rawHtml: null,
      })),
      fakeProvider('jina', async () => ({
        contentText: longText,
        rawHtml: null,
      })),
    ]);

    const out = await chain.extract('https://example.com');
    expect(out.usedProvider).toBe('jina');
  });

  it('throws last error when all providers fail', async () => {
    const chain = new ExtractChain([
      fakeProvider('firecrawl', async () => {
        throw new QuotaExceededError('firecrawl');
      }),
      fakeProvider('jina', async () => {
        throw new QuotaExceededError('jina');
      }),
    ]);

    await expect(chain.extract('https://example.com')).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
  });
});
