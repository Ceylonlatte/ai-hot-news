import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { getPrisma, Platform } from '@ai-hot-news/db';
import { CRAWL_QUEUE, CRAWL_QUEUE_NAME } from './queue.provider';

@Injectable()
export class CrawlScheduler implements OnModuleInit {
  private readonly logger = new Logger(CrawlScheduler.name);

  constructor(@Inject(CRAWL_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    const sources = await getPrisma().sourceConfig.findMany({
      where: { platform: Platform.RSS, enabled: true },
    });

    for (const source of sources) {
      await this.queue.add(
        CRAWL_QUEUE_NAME,
        { sourceConfigId: source.id },
        {
          repeat: { every: source.crawlInterval * 1000 },
          jobId: `rss-crawl:${source.id}`,
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
        },
      );

      // Boot backfill: enqueue an immediate one-shot run with a unique jobId.
      await this.queue.add(
        CRAWL_QUEUE_NAME,
        { sourceConfigId: source.id },
        {
          jobId: `rss-crawl:boot:${source.id}:${Date.now()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: { count: 50 },
        },
      );
    }

    this.logger.log(`Registered ${sources.length} RSS sources`);
  }
}
