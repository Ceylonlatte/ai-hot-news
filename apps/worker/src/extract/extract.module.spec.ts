import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Queue, Worker } from 'bullmq';
import { ExtractModule } from './extract.module';

const mockPrisma = {
  hotNews: { findMany: vi.fn() },
};
vi.mock('@ai-hot-news/db', () => ({ getPrisma: () => mockPrisma }));

describe('ExtractModule.onApplicationBootstrap (boot backstop)', () => {
  let queue: { add: ReturnType<typeof vi.fn> };
  let worker: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    queue = { add: vi.fn().mockResolvedValue(undefined) };
    worker = { close: vi.fn().mockResolvedValue(undefined) };
    mockPrisma.hotNews.findMany.mockReset();
  });

  afterEach(() => vi.resetAllMocks());

  it('re-queues every PENDING row with jobId="extract-<id>"', async () => {
    mockPrisma.hotNews.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const m = new ExtractModule(queue as unknown as Queue, worker as unknown as Worker);

    await m.onApplicationBootstrap();

    expect(queue.add).toHaveBeenCalledTimes(3);
    expect(queue.add).toHaveBeenCalledWith(
      'extract',
      { hotNewsId: 'a' },
      expect.objectContaining({ jobId: 'extract-a' }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'extract',
      { hotNewsId: 'b' },
      expect.objectContaining({ jobId: 'extract-b' }),
    );
  });

  it('queries WHERE extractStatus=PENDING (does not pick up FAILED)', async () => {
    mockPrisma.hotNews.findMany.mockResolvedValue([]);
    const m = new ExtractModule(queue as unknown as Queue, worker as unknown as Worker);

    await m.onApplicationBootstrap();

    expect(mockPrisma.hotNews.findMany).toHaveBeenCalledWith({
      where: { extractStatus: 'PENDING' },
      select: { id: true },
    });
  });

  it('closes worker on module destroy', async () => {
    const m = new ExtractModule(queue as unknown as Queue, worker as unknown as Worker);
    await m.onModuleDestroy();
    expect(worker.close).toHaveBeenCalledTimes(1);
  });
});
