import {
  Module,
  OnModuleDestroy,
  OnApplicationBootstrap,
  Inject,
  Logger,
} from '@nestjs/common';
import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { getPrisma } from '@ai-hot-news/db';
import { REDIS_CONNECTION } from '../crawl/queue.provider';
import { RedisModule } from '../redis/redis.module';
import { EmbedService } from './embed.service';
import { GroupService } from './group.service';
import { LlmUsageService } from '../llm-usage/llm-usage.service';
import {
  EMBED_QUEUE,
  EMBED_WORKER,
  createEmbedWorker,
  embedQueueProvider,
} from './embed.queue';
import { processEmbedJob, type EmbedJobData } from './embed.processor';

@Module({
  imports: [RedisModule],
  providers: [
    embedQueueProvider,
    GroupService,
    {
      provide: EmbedService,
      useFactory: (gs: GroupService, llmUsage: LlmUsageService) =>
        new EmbedService(gs, llmUsage),
      // SP-19 PR-A: LlmUsageService comes from @Global LlmUsageModule
      // registered in worker.module.ts
      inject: [GroupService, LlmUsageService],
    },
    {
      provide: EMBED_WORKER,
      useFactory: (connection: IORedis, service: EmbedService): Worker => {
        const worker = createEmbedWorker(
          async (_jobName, jobData) =>
            processEmbedJob(jobData as EmbedJobData, service),
          connection,
        );
        worker.on('failed', (job, err) => {
          new Logger('EmbedWorker').error(
            `Job ${job?.id ?? '<no-id>'} failed: ${err.message}`,
          );
        });
        return worker;
      },
      inject: [REDIS_CONNECTION, EmbedService],
    },
  ],
  exports: [EMBED_QUEUE],
})
export class EmbedModule implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EmbedModule.name);

  constructor(
    @Inject(EMBED_QUEUE) private readonly queue: Queue,
    @Inject(EMBED_WORKER) private readonly worker: Worker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Same BullMQ jobId dedupe trap as SummarizeModule (see SP-5 v3.3 / v3.5
    // fix): the `bull:<queue>:<jobId>` hash survives in BOTH the `failed` and
    // `completed` zsets (capped by removeOnFail / removeOnComplete: count=100).
    // Without clearing both, ops events that mass-clear `embedding` to NULL
    // (re-embed after prompt v bump, etc.) silently re-queue rows whose jobId
    // is still in either set, leaving them stuck.
    const cleanedFailed = await this.queue.clean(0, 0, 'failed');
    const cleanedCompleted = await this.queue.clean(0, 0, 'completed');
    if (cleanedFailed.length > 0 || cleanedCompleted.length > 0) {
      this.logger.log(
        `Boot backstop: cleared ${cleanedFailed.length} failed + ${cleanedCompleted.length} completed jobs before re-queue`,
      );
    }

    // Scan rows that have a summary but no embedding. Prisma's
    // Unsupported("vector") column can't be projected, so query existence
    // via raw SQL.
    const orphans = await getPrisma().$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM hot_news WHERE status='VISIBLE' AND summary IS NOT NULL AND embedding IS NULL`,
    );
    for (const r of orphans) {
      await this.queue.add(
        'embed',
        { hotNewsId: r.id },
        {
          jobId: `embed-${r.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
    }
    this.logger.log(`Boot backstop: re-queued ${orphans.length} pending embed jobs`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}
