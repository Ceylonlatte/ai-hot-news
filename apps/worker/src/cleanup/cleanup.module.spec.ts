import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Queue, Worker } from 'bullmq';

vi.mock('@ai-hot-news/db', () => ({
  cleanupAged: vi.fn(),
}));

import { CleanupModule } from './cleanup.module';

describe('CleanupModule.onApplicationBootstrap (boot backstop)', () => {
  let queue: { clean: ReturnType<typeof vi.fn> };
  let worker: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    queue = {
      clean: vi.fn().mockResolvedValue([]),
    };
    worker = { close: vi.fn().mockResolvedValue(undefined) };
  });

  afterEach(() => vi.resetAllMocks());

  it('clears both failed AND completed sets (SP-5 c64fe93 + c1886f3 pattern)', async () => {
    const m = new CleanupModule(queue as unknown as Queue, worker as unknown as Worker);
    await m.onApplicationBootstrap();
    expect(queue.clean).toHaveBeenCalledTimes(2);
    expect(queue.clean).toHaveBeenCalledWith(0, 0, 'failed');
    expect(queue.clean).toHaveBeenCalledWith(0, 0, 'completed');
  });

  it('is no-op friendly (clean returns []) — does not throw or warn', async () => {
    const m = new CleanupModule(queue as unknown as Queue, worker as unknown as Worker);
    await expect(m.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('closes worker on module destroy', async () => {
    const m = new CleanupModule(queue as unknown as Queue, worker as unknown as Worker);
    await m.onModuleDestroy();
    expect(worker.close).toHaveBeenCalledTimes(1);
  });
});
