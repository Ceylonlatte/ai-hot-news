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
import { SummarizeService } from './summarize.service';
import {
  SUMMARY_QUEUE,
  SUMMARY_WORKER,
  createSummaryWorker,
  summaryQueueProvider,
} from './summarize.queue';
import { processSummaryJob, type SummaryJobData } from './summarize.processor';
import type { SummarizationStrategy } from './strategies/strategy.interface';
import { SummarizeAllVisibleStrategy } from './strategies/summarize-all-visible.strategy';

const STRATEGY_TOKEN = Symbol('SUMMARIZATION_STRATEGY');

@Module({
  imports: [RedisModule],
  providers: [
    summaryQueueProvider,
    {
      provide: STRATEGY_TOKEN,
      useFactory: (): SummarizationStrategy => new SummarizeAllVisibleStrategy(),
    },
    {
      provide: SummarizeService,
      useFactory: (strategy: SummarizationStrategy) => new SummarizeService(strategy),
      inject: [STRATEGY_TOKEN],
    },
    {
      provide: SUMMARY_WORKER,
      useFactory: (connection: IORedis, service: SummarizeService): Worker => {
        const worker = createSummaryWorker(
          async (_jobName, jobData) =>
            processSummaryJob(jobData as SummaryJobData, service),
          connection,
        );
        worker.on('failed', (job, err) => {
          new Logger('SummaryWorker').error(
            `Job ${job?.id ?? '<no-id>'} failed: ${err.message}`,
          );
        });
        return worker;
      },
      inject: [REDIS_CONNECTION, SummarizeService],
    },
  ],
  exports: [SUMMARY_QUEUE],
})
export class SummarizeModule
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SummarizeModule.name);

  constructor(
    @Inject(SUMMARY_QUEUE) private readonly queue: Queue,
    @Inject(SUMMARY_WORKER) private readonly worker: Worker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // SP-5 v3.3 fix: BullMQ deduplicates queue.add(jobId) by checking the
    // `bull:<queue>:<jobId>` hash key. With removeOnFail: { count: 100 } we
    // keep the last 100 failed jobs around — including their hashes — and
    // any future re-queue with the same jobId silently no-ops. After ops
    // events that mass-clear `summary` to NULL (prompt version bumps,
    // backfills, prod env-key recovery), boot backstop must clear stale
    // failed history first; otherwise rows whose previous attempts went
    // through a transient infra failure stay stuck forever even though the
    // underlying issue is fixed.
    const cleanedFailed = await this.queue.clean(0, 0, 'failed');
    if (cleanedFailed.length > 0) {
      this.logger.log(
        `Boot backstop: cleared ${cleanedFailed.length} stale failed jobs before re-queue`,
      );
    }

    const orphans = await getPrisma().hotNews.findMany({
      where: { status: 'VISIBLE', summary: null },
      select: { id: true },
    });
    for (const r of orphans) {
      await this.queue.add(
        'summarize',
        { hotNewsId: r.id },
        {
          jobId: `summarize-${r.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
    }
    this.logger.log(`Boot backstop: re-queued ${orphans.length} pending summarize jobs`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}
