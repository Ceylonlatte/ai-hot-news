import { Provider } from '@nestjs/common';
import { Queue, Worker, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';

export const EMBED_QUEUE_NAME = 'embed';
export const EMBED_QUEUE = Symbol('EMBED_QUEUE');

export const embedQueueProvider: Provider = {
  provide: EMBED_QUEUE,
  useFactory: (connection: IORedis): Queue =>
    new Queue(EMBED_QUEUE_NAME, {
      connection: connection as unknown as ConnectionOptions,
    }),
  inject: [REDIS_CONNECTION],
};

export const EMBED_WORKER = Symbol('EMBED_WORKER');

export function createEmbedWorker(
  processor: (jobName: string, jobData: unknown) => Promise<void>,
  connection: IORedis,
): Worker {
  const parsed = parseInt(process.env.EMBED_CONCURRENCY ?? '2', 10);
  const concurrency = Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
  return new Worker(
    EMBED_QUEUE_NAME,
    async (job) => processor(job.name, job.data),
    {
      connection: connection as unknown as ConnectionOptions,
      concurrency,
    },
  );
}
