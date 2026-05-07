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
  let queue: { add: ReturnType<typeof vi.fn> };
  let worker: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    queue = { add: vi.fn().mockResolvedValue(undefined) };
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

  it('closes worker on module destroy', async () => {
    const m = new SummarizeModule(queue as unknown as Queue, worker as unknown as Worker);
    await m.onModuleDestroy();
    expect(worker.close).toHaveBeenCalledTimes(1);
  });
});
