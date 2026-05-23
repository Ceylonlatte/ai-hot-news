import {
  Inject,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';
import { RedisModule } from '../redis/redis.module';
import { CrawlModule } from '../crawl/crawl.module';
import { IngestionService } from '../crawl/ingestion.service';
import {
  KEYWORD_SEARCH_QUEUE,
  KEYWORD_SEARCH_QUEUE_NAME,
  keywordSearchQueueProvider,
} from './keyword-search.queue';
import { KeywordSearchService } from './keyword-search.service';
import {
  processKeywordSearchJob,
  type KeywordSearchJobData,
} from './keyword-search.processor';
import { KeywordSearchCron } from './keyword-search.cron';
import { loadKeywordSearchConfig } from './keyword-search.config';

const KEYWORD_SEARCH_WORKER = Symbol('KEYWORD_SEARCH_WORKER');

/**
 * SP-16.5 (2026-05-23): keyword-search feeder module.
 *
 * Imports CrawlModule to inject IngestionService — the search results
 * fan into the SAME ingest pipeline as RSS / HN top / Reddit hot
 * crawlers, picking up dedupe, summary push, heat push, extract push,
 * and SP-16 keyword-match push for free.
 *
 * No boot backstop here — unlike SP-5/6/16 we don't want to mass-search
 * every monitor on each worker restart. The 5-minute cron will pick up
 * due rows on the first tick after deploy, which is gentler on the
 * upstream search APIs.
 */
@Module({
  imports: [RedisModule, CrawlModule, ScheduleModule.forRoot()],
  providers: [
    keywordSearchQueueProvider,
    KeywordSearchService,
    KeywordSearchCron,
    {
      provide: KEYWORD_SEARCH_WORKER,
      useFactory: (
        connection: IORedis,
        service: KeywordSearchService,
      ): Worker => {
        const cfg = loadKeywordSearchConfig();
        return new Worker(
          KEYWORD_SEARCH_QUEUE_NAME,
          async (job) =>
            processKeywordSearchJob(job.data as KeywordSearchJobData, service),
          {
            connection: connection as unknown as ConnectionOptions,
            concurrency: cfg.concurrency,
          },
        );
      },
      inject: [REDIS_CONNECTION, KeywordSearchService],
    },
  ],
  exports: [KEYWORD_SEARCH_QUEUE, KeywordSearchService],
})
export class KeywordSearchModule
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(KeywordSearchModule.name);

  constructor(
    @Inject(KEYWORD_SEARCH_QUEUE) private readonly queue: Queue,
    @Inject(KEYWORD_SEARCH_WORKER) private readonly worker: Worker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // SP-5/SP-6/SP-16 pattern: clear failed AND completed sets so a
    // re-deploy can re-enqueue the same jobId without BullMQ silently
    // dropping it. Cron will start filling immediately at the next 5min tick.
    const cleanedFailed = await this.queue.clean(0, 0, 'failed');
    const cleanedCompleted = await this.queue.clean(0, 0, 'completed');
    this.logger.log(
      `Boot: cleared ${cleanedFailed.length} failed + ${cleanedCompleted.length} completed jobs; ` +
        `cron will pick due monitors on next tick`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}

// Re-export IngestionService injection token so future modules don't have
// to import CrawlModule transitively.
export { IngestionService };
