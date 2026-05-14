import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue, Worker } from 'bullmq';

const mockPrisma = {
  hotNews: { findMany: vi.fn() },
};
vi.mock('@ai-hot-news/db', () => ({
  getPrisma: () => mockPrisma,
}));

import { HeatModule } from './heat.module';

describe('HeatModule.onApplicationBootstrap (boot backstop)', () => {
  let queue: { add: ReturnType<typeof vi.fn>; clean: ReturnType<typeof vi.fn> };
  let worker: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    queue = {
      add: vi.fn().mockResolvedValue(undefined),
      clean: vi.fn().mockResolvedValue([]),
    };
    worker = { close: vi.fn().mockResolvedValue(undefined) };
    mockPrisma.hotNews.findMany.mockReset();
  });

  afterEach(() => vi.resetAllMocks());

  it('queries WHERE status=VISIBLE AND sourcePlatform != RSS AND publishedAt > now-48h AND heatScore=0', async () => {
    mockPrisma.hotNews.findMany.mockResolvedValue([]);
    const m = new HeatModule(queue as unknown as Queue, worker as unknown as Worker);

    await m.onApplicationBootstrap();

    const findArgs = mockPrisma.hotNews.findMany.mock.calls[0]![0]!;
    expect(findArgs.where.status).toBe('VISIBLE');
    expect(findArgs.where.sourcePlatform).toEqual({ not: 'RSS' });
    expect(findArgs.where.publishedAt.gte).toBeInstanceOf(Date);
    expect(findArgs.where.heatScore).toBe(0);
    expect(findArgs.select).toEqual({ id: true });
  });

  it('re-queues every orphan row with jobId="heat-<id>"', async () => {
    mockPrisma.hotNews.findMany.mockResolvedValue([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);
    const m = new HeatModule(queue as unknown as Queue, worker as unknown as Worker);

    await m.onApplicationBootstrap();

    expect(queue.add).toHaveBeenCalledTimes(3);
    expect(queue.add).toHaveBeenCalledWith(
      'heat',
      { hotNewsId: 'a' },
      expect.objectContaining({ jobId: 'heat-a' }),
    );
  });

  it('clears stale failed AND completed jobs BEFORE re-queueing (SP-5 lessons applied)', async () => {
    queue.clean.mockResolvedValue(['heat-stale-1']);
    mockPrisma.hotNews.findMany.mockResolvedValue([{ id: 'fresh' }]);
    const m = new HeatModule(queue as unknown as Queue, worker as unknown as Worker);

    await m.onApplicationBootstrap();

    expect(queue.clean).toHaveBeenCalledWith(0, 0, 'failed');
    expect(queue.clean).toHaveBeenCalledWith(0, 0, 'completed');
    const lastCleanOrder =
      queue.clean.mock.invocationCallOrder[queue.clean.mock.invocationCallOrder.length - 1]!;
    const firstAddOrder = queue.add.mock.invocationCallOrder[0]!;
    expect(lastCleanOrder).toBeLessThan(firstAddOrder);
  });

  it('closes worker on module destroy', async () => {
    const m = new HeatModule(queue as unknown as Queue, worker as unknown as Worker);
    await m.onModuleDestroy();
    expect(worker.close).toHaveBeenCalledTimes(1);
  });
});
