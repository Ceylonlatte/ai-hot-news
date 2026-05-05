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
import { SummarizeModule } from '../summarize/summarize.module';
import { ExtractService } from './extract.service';
import {
  EXTRACT_QUEUE,
  EXTRACT_WORKER,
  createExtractWorker,
  extractQueueProvider,
} from './extract.queue';
import { processExtractJob, type ExtractJobData } from './extract.processor';
import { FirecrawlProvider } from './providers/firecrawl.provider';
import { JinaProvider } from './providers/jina.provider';
import { ExtractChain } from './providers/chain';

@Module({
  imports: [RedisModule, SummarizeModule],
  providers: [
    extractQueueProvider,
    {
      provide: ExtractChain,
      useFactory: () => new ExtractChain([new FirecrawlProvider(), new JinaProvider()]),
    },
    ExtractService,
    {
      provide: EXTRACT_WORKER,
      useFactory: (connection: IORedis, service: ExtractService): Worker => {
        const worker = createExtractWorker(
          async (_jobName, jobData) =>
            processExtractJob(jobData as ExtractJobData, service),
          connection,
        );
        worker.on('failed', (job, err) => {
          new Logger('ExtractWorker').error(
            `Job ${job?.id ?? '<no-id>'} failed: ${err.message}`,
          );
        });
        return worker;
      },
      inject: [REDIS_CONNECTION, ExtractService],
    },
  ],
  exports: [EXTRACT_QUEUE],
})
export class ExtractModule
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ExtractModule.name);

  constructor(
    @Inject(EXTRACT_QUEUE) private readonly queue: Queue,
    @Inject(EXTRACT_WORKER) private readonly worker: Worker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const orphans = await getPrisma().hotNews.findMany({
      where: { extractStatus: 'PENDING' },
      select: { id: true },
    });
    for (const r of orphans) {
      await this.queue.add(
        'extract',
        { hotNewsId: r.id },
        {
          jobId: `extract-${r.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
    }
    this.logger.log(`Boot backstop: re-queued ${orphans.length} PENDING extract jobs`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}
