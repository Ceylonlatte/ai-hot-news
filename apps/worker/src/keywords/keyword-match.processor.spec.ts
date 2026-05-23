import { describe, it, expect, vi } from 'vitest';
import {
  processKeywordMatchJob,
  type KeywordMatchJobData,
} from './keyword-match.processor';
import type { KeywordMatchService } from './keyword-match.service';

function makeService(
  result: Awaited<ReturnType<KeywordMatchService['runForHotNews']>>,
): KeywordMatchService {
  return {
    runForHotNews: vi.fn().mockResolvedValue(result),
  } as unknown as KeywordMatchService;
}

describe('processKeywordMatchJob', () => {
  const job: KeywordMatchJobData = { hotNewsId: 'h1' };

  it('delegates to service.runForHotNews + returns its result', async () => {
    const service = makeService({
      scanned: 5,
      hits: 2,
      skipped: 3,
      notFound: false,
    });
    const result = await processKeywordMatchJob(job, service);
    expect(result).toEqual({ scanned: 5, hits: 2, skipped: 3, notFound: false });
    expect(service.runForHotNews).toHaveBeenCalledWith('h1');
  });

  it('returns notFound result without throwing (row deleted by TTL cleanup)', async () => {
    const service = makeService({
      scanned: 0,
      hits: 0,
      skipped: 0,
      notFound: true,
    });
    await expect(processKeywordMatchJob(job, service)).resolves.toEqual({
      scanned: 0,
      hits: 0,
      skipped: 0,
      notFound: true,
    });
  });

  it('propagates service errors so BullMQ can retry', async () => {
    const service = {
      runForHotNews: vi.fn().mockRejectedValue(new Error('db timeout')),
    } as unknown as KeywordMatchService;
    await expect(processKeywordMatchJob(job, service)).rejects.toThrow(
      'db timeout',
    );
  });
});
