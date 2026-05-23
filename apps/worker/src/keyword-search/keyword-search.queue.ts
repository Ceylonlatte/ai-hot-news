import { Provider } from '@nestjs/common';
import { Queue, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';

// SP-16.5 (2026-05-23): keyword-search BullMQ queue.
//
// jobId convention: `keyword-search-<monitorId>`. Cron-only producer; one
// job per due monitor per cron tick. BullMQ dedupes if a previous run is
// still in flight (cron picks a row whose lastSearchedAt is already old
// enough; the previous job either completed and updated lastSearchedAt
// — so this tick won't re-queue it — or is still running and BullMQ
// silently skips the duplicate enqueue).
export const KEYWORD_SEARCH_QUEUE_NAME = 'keyword-search';
export const KEYWORD_SEARCH_QUEUE = Symbol('KEYWORD_SEARCH_QUEUE');

export const keywordSearchQueueProvider: Provider = {
  provide: KEYWORD_SEARCH_QUEUE,
  useFactory: (connection: IORedis): Queue =>
    new Queue(KEYWORD_SEARCH_QUEUE_NAME, {
      connection: connection as unknown as ConnectionOptions,
    }),
  inject: [REDIS_CONNECTION],
};
