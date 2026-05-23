import {
  Inject,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type IORedis from 'ioredis';
import { getPrisma } from '@ai-hot-news/db';
import { REDIS_CONNECTION } from '../crawl/queue.provider';
import { RedisModule } from '../redis/redis.module';
import {
  KEYWORD_MATCH_QUEUE,
  KEYWORD_MATCH_QUEUE_NAME,
  keywordMatchQueueProvider,
} from './keyword-match.queue';
import { KeywordMatchService } from './keyword-match.service';
import {
  processKeywordMatchJob,
  type KeywordMatchJobData,
} from './keyword-match.processor';
import { loadKeywordMatchConfig } from './keyword-match.config';

const KEYWORD_MATCH_WORKER = Symbol('KEYWORD_MATCH_WORKER');

/**
 * SP-16 (2026-05-23): keyword detection module.
 *
 * @Global so SummarizeService (different module) can `@Inject(KEYWORD_MATCH_QUEUE)`
 * without re-importing.
 *
 * Boot backstop (onApplicationBootstrap):
 *   - Clears failed + completed sets first (SP-5 c64fe93+c1886f3 lessons)
 *   - Re-enqueues every VISIBLE row in the last N days (default 30)
 *   - jobId="keyword-match-<id>" dedupes against in-flight jobs
 *   - Idempotent: rows already fully detected stay no-op (UNIQUE constraint)
 *
 * Why scan every visible row on boot (not just rows-without-matches):
 *   - When a user creates a NEW keyword via SP-14, we want past 30d rows
 *     to retroactively show matches. Cheapest implementation = re-enqueue
 *     every row; the service's per-row work is O(N enabled keywords) and
 *     each match either hits a P2002 (already detected) or inserts cheap.
 *   - At prod scale (1400 visible × 1 keyword), full backstop runs in
 *     ~30s on boot, then steady-state hot path takes over.
 */
@Module({
  imports: [RedisModule],
  providers: [
    keywordMatchQueueProvider,
    KeywordMatchService,
    {
      provide: KEYWORD_MATCH_WORKER,
      useFactory: (connection: IORedis, service: KeywordMatchService): Worker => {
        const cfg = loadKeywordMatchConfig();
        return new Worker(
          KEYWORD_MATCH_QUEUE_NAME,
          async (job) =>
            processKeywordMatchJob(job.data as KeywordMatchJobData, service),
          {
            connection: connection as unknown as ConnectionOptions,
            concurrency: cfg.concurrency,
          },
        );
      },
      inject: [REDIS_CONNECTION, KeywordMatchService],
    },
  ],
  exports: [KEYWORD_MATCH_QUEUE, KeywordMatchService],
})
export class KeywordMatchModule implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(KeywordMatchModule.name);

  constructor(
    @Inject(KEYWORD_MATCH_QUEUE) private readonly queue: Queue,
    @Inject(KEYWORD_MATCH_WORKER) private readonly worker: Worker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // SP-5/SP-6 pattern: clear both failed AND completed sets before
    // re-enqueueing. BullMQ jobId dedupe checks both — without clearing,
    // a re-deploy's mass re-enqueue silently no-ops every id.
    const cleanedFailed = await this.queue.clean(0, 0, 'failed');
    const cleanedCompleted = await this.queue.clean(0, 0, 'completed');
    if (cleanedFailed.length > 0 || cleanedCompleted.length > 0) {
      this.logger.log(
        `Boot backstop: cleared ${cleanedFailed.length} failed + ${cleanedCompleted.length} completed jobs`,
      );
    }

    const cfg = loadKeywordMatchConfig();
    const since = new Date(Date.now() - cfg.backstopDays * 86_400_000);

    // Scan ALL recent visible rows, not just rows-without-matches — see
    // class JSDoc for rationale (new-keyword retro-active detection).
    const candidates = await getPrisma().hotNews.findMany({
      where: {
        status: 'VISIBLE',
        publishedAt: { gte: since },
      },
      select: { id: true },
    });

    for (const r of candidates) {
      await this.queue.add(
        'keyword-match',
        { hotNewsId: r.id },
        {
          jobId: `keyword-match-${r.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
    }

    this.logger.log(
      `Boot backstop: re-queued ${candidates.length} candidate rows (window=${cfg.backstopDays}d)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}
