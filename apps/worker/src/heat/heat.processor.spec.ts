import { describe, expect, it, vi } from 'vitest';
import { processHeatJob } from './heat.processor';

describe('processHeatJob', () => {
  it('calls service.run with the hotNewsId from job data', async () => {
    const service = { run: vi.fn().mockResolvedValue(undefined) };
    await processHeatJob(
      { hotNewsId: 'h1' },
      service as unknown as { run: (id: string) => Promise<void> },
    );
    expect(service.run).toHaveBeenCalledWith('h1');
  });

  it('throws if hotNewsId is missing (BullMQ marks job failed)', async () => {
    const service = { run: vi.fn() };
    await expect(
      processHeatJob(
        {} as unknown as { hotNewsId: string },
        service as unknown as { run: (id: string) => Promise<void> },
      ),
    ).rejects.toThrow(/hotNewsId required/);
  });
});
