import { Provider } from '@nestjs/common';
import { Queue, Worker, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';

export const CRAWL_QUEUE_NAME = 'crawl';
export const CRAWL_QUEUE = Symbol('CRAWL_QUEUE');
export const CRAWL_WORKER = Symbol('CRAWL_WORKER');
export const REDIS_CONNECTION = Symbol('REDIS_CONNECTION');

function makeConnection(): IORedis {
  return new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    // Required by BullMQ
    maxRetriesPerRequest: null,
  });
}

export const redisProvider: Provider = {
  provide: REDIS_CONNECTION,
  useFactory: (): IORedis => makeConnection(),
};

export const queueProvider: Provider = {
  provide: CRAWL_QUEUE,
  useFactory: (connection: IORedis): Queue =>
    new Queue(CRAWL_QUEUE_NAME, { connection: connection as unknown as ConnectionOptions }),
  inject: [REDIS_CONNECTION],
};

// Worker is created by a factory that takes the processor function as argument.
export function createCrawlWorker(
  processor: (jobName: string, jobData: unknown) => Promise<void>,
  connection: IORedis,
): Worker {
  return new Worker(
    CRAWL_QUEUE_NAME,
    async (job) => processor(job.name, job.data),
    { connection: connection as unknown as ConnectionOptions, concurrency: 1 },
  );
}
