import { describe, expect, it, vi } from 'vitest';
import { processEmbedJob } from './embed.processor';
import type { EmbedService } from './embed.service';

describe('processEmbedJob', () => {
  it('forwards hotNewsId to service.run', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const service = { run } as unknown as EmbedService;

    await processEmbedJob({ hotNewsId: 'cm-abc' }, service);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('cm-abc');
  });

  it('rethrows when service.run throws (so BullMQ retries)', async () => {
    const run = vi.fn().mockRejectedValue(new Error('openai down'));
    const service = { run } as unknown as EmbedService;

    await expect(processEmbedJob({ hotNewsId: 'cm-xyz' }, service)).rejects.toThrow(/openai down/);
  });
});
