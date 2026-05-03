import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { getPrisma, Platform } from '@ai-hot-news/db';
import { CRAWL_QUEUE, CRAWL_QUEUE_NAME, REDIS_CONNECTION } from './queue.provider';

@Injectable()
export class CrawlScheduler implements OnModuleInit {
  private readonly logger = new Logger(CrawlScheduler.name);

  constructor(
    @Inject(CRAWL_QUEUE) private readonly queue: Queue,
    @Inject(REDIS_CONNECTION) private readonly connection: IORedis,
  ) {}

  async onModuleInit(): Promise<void> {
    const oldQueue = new Queue('rss-crawl', {
      connection: this.connection as unknown as ConnectionOptions,
    });
    try {
      await oldQueue.obliterate({ force: true });
      this.logger.log("Old queue 'rss-crawl' obliterated");
    } catch (err) {
      this.logger.warn(`Old queue obliterate skipped: ${(err as Error).message}`);
    } finally {
      await oldQueue.close();
    }

    const sources = await getPrisma().sourceConfig.findMany({
      where: {
        enabled: true,
        platform: { in: [Platform.RSS, Platform.HACKERNEWS, Platform.REDDIT] },
      },
    });

    for (const source of sources) {
      await this.queue.add(
        CRAWL_QUEUE_NAME,
        { sourceConfigId: source.id },
        {
          repeat: { every: source.crawlInterval * 1000 },
          jobId: `crawl-repeat-${source.id}`,
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
        },
      );
      await this.queue.add(
        CRAWL_QUEUE_NAME,
        { sourceConfigId: source.id },
        {
          jobId: `crawl-boot-${source.id}-${Date.now()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: { count: 50 },
        },
      );
    }

    const counts = sources.reduce<Record<string, number>>((acc, s) => {
      acc[s.platform] = (acc[s.platform] ?? 0) + 1;
      return acc;
    }, {});
    this.logger.log(
      `Registered ${sources.length} enabled sources: ` +
        Object.entries(counts)
          .map(([p, n]) => `${n} ${p}`)
          .join(', '),
    );
  }
}
