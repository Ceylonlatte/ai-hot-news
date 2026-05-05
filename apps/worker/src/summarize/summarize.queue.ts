import { Provider } from '@nestjs/common';
import { Queue, ConnectionOptions } from 'bullmq';
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
