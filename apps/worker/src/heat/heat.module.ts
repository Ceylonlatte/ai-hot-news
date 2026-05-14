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
import { HeatService } from './heat.service';
import { HeatCron } from './heat.cron';
import {
  HEAT_QUEUE,
  HEAT_WORKER,
  createHeatWorker,
  heatQueueProvider,
} from './heat.queue';
import { processHeatJob, type HeatJobData } from './heat.processor';
import { processHeatRefreshJob } from './heat.cron.processor';
import { loadHeatConfig } from './heat.config';

const HEAT_CONFIG_TOKEN = Symbol('HEAT_CONFIG');

@Module({
  imports: [RedisModule],
  providers: [
    heatQueueProvider,
    {
      provide: HEAT_CONFIG_TOKEN,
      useFactory: () => loadHeatConfig(),
    },
    {
      provide: HeatService,
      useFactory: (cfg: ReturnType<typeof loadHeatConfig>) => new HeatService(cfg),
      inject: [HEAT_CONFIG_TOKEN],
    },
    HeatCron,
    {
      provide: HEAT_WORKER,
      useFactory: (
        connection: IORedis,
        service: HeatService,
        cfg: ReturnType<typeof loadHeatConfig>,
      ): Worker => {
        const worker = createHeatWorker(
          async (jobName, jobData) => {
            if (jobName === 'heat-refresh') {
              await processHeatRefreshJob(cfg);
              return;
            }
            await processHeatJob(jobData as HeatJobData, service);
          },
          connection,
        );
        worker.on('failed', (job, err) => {
          new Logger('HeatWorker').error(
            `Job ${job?.id ?? '<no-id>'} failed: ${err.message}`,
          );
        });
        return worker;
      },
      inject: [REDIS_CONNECTION, HeatService, HEAT_CONFIG_TOKEN],
    },
  ],
  exports: [HEAT_QUEUE],
})
export class HeatModule implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HeatModule.name);

  constructor(
    @Inject(HEAT_QUEUE) private readonly queue: Queue,
    @Inject(HEAT_WORKER) private readonly worker: Worker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // SP-5 lessons applied: BullMQ jobId dedupe checks both failed AND
    // completed sets. Without clearing both, mass re-queue events (e.g.
    // worker restart after a `UPDATE heatScore=0` rebuild) would silently
    // no-op for IDs whose jobId hash is still in either set.
    const cleanedFailed = await this.queue.clean(0, 0, 'failed');
    const cleanedCompleted = await this.queue.clean(0, 0, 'completed');
    if (cleanedFailed.length > 0 || cleanedCompleted.length > 0) {
      this.logger.log(
        `Boot backstop: cleared ${cleanedFailed.length} failed + ${cleanedCompleted.length} completed jobs`,
      );
    }

    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const orphans = await getPrisma().hotNews.findMany({
      where: {
        status: 'VISIBLE',
        sourcePlatform: { not: 'RSS' },
        publishedAt: { gte: since },
        heatScore: 0,
      },
      select: { id: true },
    });

    for (const r of orphans) {
      await this.queue.add(
        'heat',
        { hotNewsId: r.id },
        {
          jobId: `heat-${r.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
    }
    this.logger.log(
      `Boot backstop: re-queued ${orphans.length} pending heat jobs`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}
