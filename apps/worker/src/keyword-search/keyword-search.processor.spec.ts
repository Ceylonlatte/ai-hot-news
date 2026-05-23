import { describe, it, expect, vi } from 'vitest';
import {
  processKeywordSearchJob,
  type KeywordSearchJobData,
} from './keyword-search.processor';
import type {
  KeywordSearchResult,
  KeywordSearchService,
} from './keyword-search.service';

function makeService(result: KeywordSearchResult): KeywordSearchService {
  return {
    runForKeyword: vi.fn().mockResolvedValue(result),
  } as unknown as KeywordSearchService;
}

describe('processKeywordSearchJob', () => {
  const job: KeywordSearchJobData = { monitorId: 'k1', keyword: 'Claude' };

  it('delegates to service.runForKeyword + returns result', async () => {
    const service = makeService({
      notFound: false,
      platforms: ['HACKERNEWS', 'REDDIT'],
      fetched: 5,
      inserted: 2,
      skippedExcluded: 1,
    });
    const result = await processKeywordSearchJob(job, service);
    expect(result.fetched).toBe(5);
    expect(service.runForKeyword).toHaveBeenCalledWith('k1');
  });

  it('returns notFound without throwing', async () => {
    const service = makeService({
      notFound: true,
      platforms: [],
      fetched: 0,
      inserted: 0,
      skippedExcluded: 0,
    });
    await expect(processKeywordSearchJob(job, service)).resolves.toMatchObject({
      notFound: true,
    });
  });

  it('returns disabled gracefully (no throw)', async () => {
    const service = makeService({
      notFound: false,
      platforms: [],
      fetched: 0,
      inserted: 0,
      skippedExcluded: 0,
      disabled: true,
    });
    await expect(processKeywordSearchJob(job, service)).resolves.toMatchObject({
      disabled: true,
    });
  });

  it('propagates service errors so BullMQ retries', async () => {
    const service = {
      runForKeyword: vi.fn().mockRejectedValue(new Error('db down')),
    } as unknown as KeywordSearchService;
    await expect(processKeywordSearchJob(job, service)).rejects.toThrow(
      'db down',
    );
  });
});
