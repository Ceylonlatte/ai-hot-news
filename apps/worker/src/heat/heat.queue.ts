import { Provider } from '@nestjs/common';
import { Queue, Worker, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';
import { loadHeatConfig } from './heat.config';

export const HEAT_QUEUE_NAME = 'heat';
export const HEAT_QUEUE = Symbol('HEAT_QUEUE');

export const heatQueueProvider: Provider = {
  provide: HEAT_QUEUE,
  useFactory: (connection: IORedis): Queue =>
    new Queue(HEAT_QUEUE_NAME, {
      connection: connection as unknown as ConnectionOptions,
    }),
  inject: [REDIS_CONNECTION],
};

export const HEAT_WORKER = Symbol('HEAT_WORKER');

export function createHeatWorker(
  processor: (jobName: string, jobData: unknown) => Promise<void>,
  connection: IORedis,
): Worker {
  const cfg = loadHeatConfig();
  return new Worker(
    HEAT_QUEUE_NAME,
    async (job) => processor(job.name, job.data),
    {
      connection: connection as unknown as ConnectionOptions,
      concurrency: cfg.concurrency,
    },
  );
}
