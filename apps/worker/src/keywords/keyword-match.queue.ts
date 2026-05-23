import { Provider } from '@nestjs/common';
import { Queue, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';

// SP-16 (2026-05-23): keyword-match BullMQ queue.
// jobId convention: `keyword-match-<hotNewsId>` — one job per HotNews row.
// Producer: SummarizeService after writing summary/titleZh (best-effort
// chained). Boot backstop additionally re-enqueues recent visible rows
// to catch keyword definitions added while worker was down.
//
// Idempotent at multiple layers:
//   - BullMQ jobId dedupe (within wait/active/completed/failed)
//   - KeywordHit @@unique([hotNewsId, keywordId]) P2002 silent skip
//   - HotNews.matchedKeywords array-union write
export const KEYWORD_MATCH_QUEUE_NAME = 'keyword-match';
export const KEYWORD_MATCH_QUEUE = Symbol('KEYWORD_MATCH_QUEUE');

export const keywordMatchQueueProvider: Provider = {
  provide: KEYWORD_MATCH_QUEUE,
  useFactory: (connection: IORedis): Queue =>
    new Queue(KEYWORD_MATCH_QUEUE_NAME, {
      connection: connection as unknown as ConnectionOptions,
    }),
  inject: [REDIS_CONNECTION],
};
