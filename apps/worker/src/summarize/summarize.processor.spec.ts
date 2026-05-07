import { describe, it, expect, vi } from 'vitest';
import { processSummaryJob } from './summarize.processor';
import type { SummarizeService } from './summarize.service';

describe('processSummaryJob', () => {
  it('forwards hotNewsId to service.run', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const service = { run } as unknown as SummarizeService;

    await processSummaryJob({ hotNewsId: 'cm123' }, service);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('cm123');
  });

  it('rethrows when service.run throws (so BullMQ retries)', async () => {
    const run = vi.fn().mockRejectedValue(new Error('llm down'));
    const service = { run } as unknown as SummarizeService;

    await expect(processSummaryJob({ hotNewsId: 'cm456' }, service)).rejects.toThrow(/llm down/);
  });
});
