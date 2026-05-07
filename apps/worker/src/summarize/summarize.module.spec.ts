import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue, Worker } from 'bullmq';

const mockPrisma = {
  hotNews: { findMany: vi.fn() },
};
vi.mock('@ai-hot-news/db', () => ({
  getPrisma: () => mockPrisma,
  ContentStatus: { VISIBLE: 'VISIBLE', HIDDEN: 'HIDDEN', PENDING: 'PENDING' },
}));

import { SummarizeModule } from './summarize.module';

describe('SummarizeModule.onApplicationBootstrap (boot backstop)', () => {
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

  it('queries WHERE status=VISIBLE AND summary IS NULL', async () => {
    mockPrisma.hotNews.findMany.mockResolvedValue([]);
    const m = new SummarizeModule(queue as unknown as Queue, worker as unknown as Worker);

    await m.onApplicationBootstrap();

    expect(mockPrisma.hotNews.findMany).toHaveBeenCalledWith({
      where: { status: 'VISIBLE', summary: null },
      select: { id: true },
    });
  });

  it('re-queues every orphan row with jobId="summarize-<id>"', async () => {
    mockPrisma.hotNews.findMany.mockResolvedValue([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);
    const m = new SummarizeModule(queue as unknown as Queue, worker as unknown as Worker);

    await m.onApplicationBootstrap();

    expect(queue.add).toHaveBeenCalledTimes(3);
    expect(queue.add).toHaveBeenCalledWith(
      'summarize',
      { hotNewsId: 'a' },
      expect.objectContaining({
        jobId: 'summarize-a',
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'summarize',
      { hotNewsId: 'c' },
      expect.objectContaining({ jobId: 'summarize-c' }),
    );
  });

  it('clears stale failed jobs BEFORE re-queueing (SP-5 v3.3 regression: BullMQ jobId dedupe)', async () => {
    queue.clean.mockResolvedValue(['summarize-stale-1', 'summarize-stale-2']);
    mockPrisma.hotNews.findMany.mockResolvedValue([{ id: 'fresh' }]);
    const m = new SummarizeModule(queue as unknown as Queue, worker as unknown as Worker);

    await m.onApplicationBootstrap();

    expect(queue.clean).toHaveBeenCalledWith(0, 0, 'failed');
    const cleanCallOrder = queue.clean.mock.invocationCallOrder[0]!;
    const firstAddCallOrder = queue.add.mock.invocationCallOrder[0]!;
    expect(cleanCallOrder).toBeLessThan(firstAddCallOrder);
  });

  it('still works when no failed jobs exist (clean returns empty)', async () => {
    queue.clean.mockResolvedValue([]);
    mockPrisma.hotNews.findMany.mockResolvedValue([{ id: 'a' }]);
    const m = new SummarizeModule(queue as unknown as Queue, worker as unknown as Worker);

    await expect(m.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('closes worker on module destroy', async () => {
    const m = new SummarizeModule(queue as unknown as Queue, worker as unknown as Worker);
    await m.onModuleDestroy();
    expect(worker.close).toHaveBeenCalledTimes(1);
  });
});
