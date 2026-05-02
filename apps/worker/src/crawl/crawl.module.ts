import { Module, OnModuleDestroy, OnApplicationBootstrap, Inject, Logger } from '@nestjs/common';
import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { IngestionService } from './ingestion.service';
import { CrawlScheduler } from './crawl.scheduler';
import {
  CRAWL_QUEUE,
  CRAWL_WORKER,
  REDIS_CONNECTION,
  createCrawlWorker,
  queueProvider,
  redisProvider,
} from './queue.provider';
import { processCrawlJob, type CrawlJobData } from './crawl.processor';

@Module({
  providers: [
    redisProvider,
    queueProvider,
    {
      provide: CRAWL_WORKER,
      useFactory: (connection: IORedis, ingestion: IngestionService): Worker => {
        const worker = createCrawlWorker(
          async (_jobName, jobData) =>
            processCrawlJob(jobData as CrawlJobData, ingestion),
          connection,
        );
        worker.on('failed', (job, err) => {
          new Logger('CrawlWorker').error(
            `Job ${job?.id ?? '<no-id>'} failed: ${err.message}`,
          );
        });
        return worker;
      },
      inject: [REDIS_CONNECTION, IngestionService],
    },
    IngestionService,
    CrawlScheduler,
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
