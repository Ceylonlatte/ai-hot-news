import { Provider } from '@nestjs/common';
import { Queue, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { REDIS_CONNECTION } from '../crawl/queue.provider';

export const CLEANUP_QUEUE_NAME = 'cleanup';
export const CLEANUP_QUEUE = Symbol('CLEANUP_QUEUE');

export const cleanupQueueProvider: Provider = {
  provide: CLEANUP_QUEUE,
  useFactory: (connection: IORedis): Queue =>
    new Queue(CLEANUP_QUEUE_NAME, {
      connection: connection as unknown as ConnectionOptions,
    }),
  inject: [REDIS_CONNECTION],
};
