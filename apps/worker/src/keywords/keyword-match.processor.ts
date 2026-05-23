import { Logger } from '@nestjs/common';
import type { KeywordMatchService, MatchResult } from './keyword-match.service';

const logger = new Logger('KeywordMatchProcessor');

export interface KeywordMatchJobData {
  hotNewsId: string;
}

/**
 * SP-16 (2026-05-23): BullMQ job consumer — calls service for one row.
 *
 * Errors propagate so BullMQ retries via attempts/backoff. The service
 * is itself idempotent (UNIQUE constraint + array union) so retries are
 * safe.
 */
export async function processKeywordMatchJob(
  job: KeywordMatchJobData,
  service: KeywordMatchService,
): Promise<MatchResult> {
  const result = await service.runForHotNews(job.hotNewsId);
  if (result.notFound) {
    // Row was deleted between job enqueue and processing (e.g. cleanup
    // cron). Log + return silently — no retry needed.
    logger.warn(`hotNewsId=${job.hotNewsId} not found, skipping`);
    return result;
  }
  if (result.hits > 0) {
    logger.log(
      `hotNewsId=${job.hotNewsId} scanned=${result.scanned} hits=${result.hits} skipped=${result.skipped}`,
    );
  }
  return result;
}
