import { Provider } from '@nestjs/common';
import { Queue, Worker, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';

export const EXTRACT_QUEUE_NAME = 'extract';
export const EXTRACT_QUEUE = Symbol('EXTRACT_QUEUE');
export const EXTRACT_WORKER = Symbol('EXTRACT_WORKER');

export const extractQueueProvider: Provider = {
  provide: EXTRACT_QUEUE,
  useFactory: (connection: IORedis): Queue =>
    new Queue(EXTRACT_QUEUE_NAME, {
      connection: connection as unknown as ConnectionOptions,
    }),
  inject: [REDIS_CONNECTION],
};

export function createExtractWorker(
  processor: (jobName: string, jobData: unknown) => Promise<void>,
  connection: IORedis,
): Worker {
  const concurrency = parseInt(process.env.EXTRACT_CONCURRENCY ?? '2', 10);
  return new Worker(
    EXTRACT_QUEUE_NAME,
    async (job) => processor(job.name, job.data),
    {
      connection: connection as unknown as ConnectionOptions,
      concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 2,
    },
  );
}
