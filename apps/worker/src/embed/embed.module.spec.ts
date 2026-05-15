import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue, Worker } from 'bullmq';

const mockQueryRawUnsafe = vi.fn();
vi.mock('@ai-hot-news/db', async (orig) => {
  const actual = await orig<typeof import('@ai-hot-news/db')>();
  return {
    ...actual,
    getPrisma: () => ({ $queryRawUnsafe: mockQueryRawUnsafe }),
  };
});

import { EmbedModule } from './embed.module';

describe('EmbedModule.onApplicationBootstrap (boot backstop)', () => {
  let queue: { add: ReturnType<typeof vi.fn>; clean: ReturnType<typeof vi.fn> };
  let worker: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    queue = {
      add: vi.fn().mockResolvedValue(undefined),
      clean: vi.fn().mockResolvedValue([]),
    };
    worker = { close: vi.fn().mockResolvedValue(undefined) };
    mockQueryRawUnsafe.mockReset();
  });

  afterEach(() => vi.resetAllMocks());

  it('queries summary IS NOT NULL AND embedding IS NULL VISIBLE rows via raw SQL', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);
    const m = new EmbedModule(queue as unknown as Queue, worker as unknown as Worker);
    await m.onApplicationBootstrap();
    expect(mockQueryRawUnsafe).toHaveBeenCalledOnce();
    const sql = mockQueryRawUnsafe.mock.calls[0]![0] as string;
    expect(sql).toMatch(/embedding IS NULL/);
    expect(sql).toMatch(/summary IS NOT NULL/);
    expect(sql).toMatch(/status='VISIBLE'/);
  });

  it('clears stale failed AND completed jobs BEFORE re-queueing', async () => {
    queue.clean.mockResolvedValue(['embed-stale-1', 'embed-stale-2']);
    mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 'fresh' }]);
    const m = new EmbedModule(queue as unknown as Queue, worker as unknown as Worker);
    await m.onApplicationBootstrap();
    expect(queue.clean).toHaveBeenCalledWith(0, 0, 'failed');
    expect(queue.clean).toHaveBeenCalledWith(0, 0, 'completed');
    const lastCleanOrder =
      queue.clean.mock.invocationCallOrder[queue.clean.mock.invocationCallOrder.length - 1]!;
    const firstAddCallOrder = queue.add.mock.invocationCallOrder[0]!;
    expect(lastCleanOrder).toBeLessThan(firstAddCallOrder);
  });

  it('re-queues every orphan with jobId="embed-<id>"', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    const m = new EmbedModule(queue as unknown as Queue, worker as unknown as Worker);
    await m.onApplicationBootstrap();
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenNthCalledWith(
      1,
      'embed',
      { hotNewsId: 'a' },
      expect.objectContaining({ jobId: 'embed-a', attempts: 3 }),
    );
    expect(queue.add).toHaveBeenNthCalledWith(
      2,
      'embed',
      { hotNewsId: 'b' },
      expect.objectContaining({ jobId: 'embed-b' }),
    );
  });

  it('still works when no orphans', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);
    const m = new EmbedModule(queue as unknown as Queue, worker as unknown as Worker);
    await expect(m.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('closes worker on module destroy', async () => {
    const m = new EmbedModule(queue as unknown as Queue, worker as unknown as Worker);
    await m.onModuleDestroy();
    expect(worker.close).toHaveBeenCalledOnce();
  });
});
