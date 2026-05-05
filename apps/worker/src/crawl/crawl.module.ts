import { Module, OnModuleDestroy, OnApplicationBootstrap, Inject, Logger } from '@nestjs/common';
import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { IngestionService } from './ingestion.service';
import { CrawlScheduler } from './crawl.scheduler';
import { CrawlerFactory } from './crawler.factory';
import { REDDIT_USER_AGENT } from './crawlers/reddit.types';
import {
  CRAWL_WORKER,
  REDIS_CONNECTION,
  createCrawlWorker,
  queueProvider,
  redisProvider,
} from './queue.provider';
import { processCrawlJob, type CrawlJobData } from './crawl.processor';
import { SummarizeModule } from '../summarize/summarize.module';
import { ExtractModule } from '../extract/extract.module';
import { SUMMARY_QUEUE } from '../summarize/summarize.queue';
import { EXTRACT_QUEUE } from '../extract/extract.queue';

@Module({
  imports: [SummarizeModule, ExtractModule],
  providers: [
    redisProvider,
    queueProvider,
    {
      provide: CRAWL_WORKER,
      useFactory: (
        connection: IORedis,
        ingestion: IngestionService,
        factory: CrawlerFactory,
      ): Worker => {
        const worker = createCrawlWorker(
          async (_jobName, jobData) =>
            processCrawlJob(jobData as CrawlJobData, ingestion, factory),
          connection,
        );
        worker.on('failed', (job, err) => {
          new Logger('CrawlWorker').error(
            `Job ${job?.id ?? '<no-id>'} failed: ${err.message}`,
          );
        });
        return worker;
      },
      inject: [REDIS_CONNECTION, IngestionService, CrawlerFactory],
    },
    {
      provide: IngestionService,
      useFactory: (summaryQueue: Queue, extractQueue: Queue) =>
        new IngestionService(summaryQueue, extractQueue),
      inject: [SUMMARY_QUEUE, EXTRACT_QUEUE],
    },
    CrawlerFactory,
    CrawlScheduler,
    {
      provide: REDDIT_USER_AGENT,
      useFactory: () =>
        process.env.REDDIT_USER_AGENT ?? 'ai-hot-news-bot/0.1 (by /u/anonymous)',
    },
  ],
  exports: [IngestionService],
})
export class CrawlModule implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(
    @Inject(CRAWL_WORKER) private readonly worker: Worker,
    @Inject(REDIS_CONNECTION) private readonly redis: IORedis,
  ) {}

  onApplicationBootstrap(): void {
    // Worker auto-starts on construction; this hook documents intent.
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    await this.redis.quit();
  }
}
