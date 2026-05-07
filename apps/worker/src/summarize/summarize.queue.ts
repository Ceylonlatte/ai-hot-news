import { Provider } from '@nestjs/common';
import { Queue, Worker, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';

export const SUMMARY_QUEUE_NAME = 'summary';
export const SUMMARY_QUEUE = Symbol('SUMMARY_QUEUE');

export const summaryQueueProvider: Provider = {
  provide: SUMMARY_QUEUE,
  useFactory: (connection: IORedis): Queue =>
    new Queue(SUMMARY_QUEUE_NAME, {
      connection: connection as unknown as ConnectionOptions,
    }),
  inject: [REDIS_CONNECTION],
};

export const SUMMARY_WORKER = Symbol('SUMMARY_WORKER');

export function createSummaryWorker(
  processor: (jobName: string, jobData: unknown) => Promise<void>,
  connection: IORedis,
): Worker {
  const concurrency = parseInt(process.env.SUMMARY_CONCURRENCY ?? '3', 10);
  return new Worker(
    SUMMARY_QUEUE_NAME,
    async (job) => processor(job.name, job.data),
    {
      connection: connection as unknown as ConnectionOptions,
      concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 3,
    },
  );
}
