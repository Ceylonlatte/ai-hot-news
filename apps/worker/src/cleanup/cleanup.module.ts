import {
  Inject,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';
import { RedisModule } from '../redis/redis.module';
import {
  CLEANUP_QUEUE,
  CLEANUP_QUEUE_NAME,
  cleanupQueueProvider,
} from './cleanup.queue';
import { CleanupCron } from './cleanup.cron';
import { processCleanupAgedJob } from './cleanup.cron.processor';
import { loadCleanupConfig } from './cleanup.config';

const CLEANUP_WORKER = Symbol('CLEANUP_WORKER');

@Module({
  imports: [RedisModule],
  providers: [
    cleanupQueueProvider,
    CleanupCron,
    {
      provide: CLEANUP_WORKER,
      useFactory: (connection: IORedis): Worker =>
        new Worker(
          CLEANUP_QUEUE_NAME,
          async (_job) => {
            const cfg = loadCleanupConfig();
            await processCleanupAgedJob(cfg);
          },
          {
            connection: connection as unknown as ConnectionOptions,
            concurrency: 1,
          },
        ),
      inject: [REDIS_CONNECTION],
    },
  ],
  exports: [CLEANUP_QUEUE],
})
export class CleanupModule implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CleanupModule.name);

  constructor(
    @Inject(CLEANUP_QUEUE) private readonly queue: Queue,
    @Inject(CLEANUP_WORKER) private readonly worker: Worker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // SP-5 c64fe93 + c1886f3 lessons applied: BullMQ jobId dedupe checks both
    // failed AND completed sets. CleanupCron always uses jobId='cleanup-aged'
    // (single repeatable job), so without clearing both sets a worker restart
    // could silently no-op the re-registration. Clearing is cheap (zero-cost
    // when sets are empty) and idempotent.
    const cleanedFailed = await this.queue.clean(0, 0, 'failed');
    const cleanedCompleted = await this.queue.clean(0, 0, 'completed');
    if (cleanedFailed.length > 0 || cleanedCompleted.length > 0) {
      this.logger.log(
        `Boot backstop: cleared ${cleanedFailed.length} failed + ${cleanedCompleted.length} completed jobs`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}
