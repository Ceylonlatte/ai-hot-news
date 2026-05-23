import { Logger } from '@nestjs/common';
import type {
  KeywordSearchResult,
  KeywordSearchService,
} from './keyword-search.service';

const logger = new Logger('KeywordSearchProcessor');

export interface KeywordSearchJobData {
  monitorId: string;
  /** Cosmetic — surfaces in BullMQ ops view + worker logs. */
  keyword?: string;
}

/**
 * SP-16.5 (2026-05-23): BullMQ consumer — calls service for one monitor.
 *
 * Service is responsible for advancing lastSearchedAt; the processor
 * only logs the outcome. If the service throws (network down etc.),
 * propagate so BullMQ retries with backoff.
 */
export async function processKeywordSearchJob(
  job: KeywordSearchJobData,
  service: KeywordSearchService,
): Promise<KeywordSearchResult> {
  const result = await service.runForKeyword(job.monitorId);
  if (result.notFound) {
    logger.warn(`monitorId=${job.monitorId} not found, skipping`);
    return result;
  }
  if (result.disabled) {
    logger.log(
      `monitorId=${job.monitorId} (${job.keyword ?? '?'}) disabled mid-flight, skipping`,
    );
    return result;
  }
  logger.log(
    `monitorId=${job.monitorId} keyword="${job.keyword ?? '?'}" ` +
      `platforms=[${result.platforms.join(',')}] ` +
      `fetched=${result.fetched} inserted=${result.inserted} ` +
      `excludedDropped=${result.skippedExcluded}`,
  );
  return result;
}
