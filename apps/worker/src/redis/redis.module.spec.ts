import { afterEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { RedisModule } from './redis.module';
import { SummarizeModule } from '../summarize/summarize.module';
import { SUMMARY_QUEUE } from '../summarize/summarize.queue';
import { HeatModule } from '../heat/heat.module';
import { HEAT_QUEUE } from '../heat/heat.queue';
import { REDIS_CONNECTION } from '../crawl/queue.provider';

vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      quit: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    })),
  };
});

vi.mock('bullmq', async () => {
  const actual = await vi.importActual<typeof import('bullmq')>('bullmq');
  return {
    ...actual,
    Queue: vi.fn().mockImplementation(() => ({
      add: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('RedisModule wiring (regression for SP-4.7 DI miss)', () => {
  afterEach(() => vi.clearAllMocks());

  it('SummarizeModule resolves SUMMARY_QUEUE through RedisModule', async () => {
    const ref = await Test.createTestingModule({
      imports: [SummarizeModule],
    }).compile();

    const queue = ref.get(SUMMARY_QUEUE);
    const conn = ref.get(REDIS_CONNECTION);

    expect(queue).toBeDefined();
    expect(conn).toBeDefined();

    await ref.close();
  });

  it('HeatModule resolves HEAT_QUEUE through RedisModule (SP-6 regression)', async () => {
    const ref = await Test.createTestingModule({
      imports: [HeatModule],
    }).compile();

    const queue = ref.get(HEAT_QUEUE);
    const conn = ref.get(REDIS_CONNECTION);

    expect(queue).toBeDefined();
    expect(conn).toBeDefined();

    await ref.close();
  });

  it('RedisModule alone exports REDIS_CONNECTION', async () => {
    const ref = await Test.createTestingModule({
      imports: [RedisModule],
    }).compile();

    expect(ref.get(REDIS_CONNECTION)).toBeDefined();
    await ref.close();
  });
});
