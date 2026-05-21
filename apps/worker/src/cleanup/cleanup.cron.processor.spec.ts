import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted: mock factory captures these refs before module init.
const { cleanupAgedMock } = vi.hoisted(() => ({
  cleanupAgedMock: vi.fn(),
}));

vi.mock('@ai-hot-news/db', () => ({
  cleanupAged: cleanupAgedMock,
}));

import { processCleanupAgedJob } from './cleanup.cron.processor';
import type { CleanupConfig } from './cleanup.config';

const CFG: CleanupConfig = {
  hotNewsDays: 30,
  heatHistoryDays: 7,
  cronHourUtc: 3,
};

describe('processCleanupAgedJob', () => {
  beforeEach(() => {
    cleanupAgedMock.mockReset();
  });

  afterEach(() => vi.resetAllMocks());

  it('forwards config days to cleanupAged()', async () => {
    cleanupAgedMock.mockResolvedValueOnce({
      hotNewsDeleted: 5,
      heatHistoryCascaded: 12,
      heatHistoryAged: 3,
    });
    await processCleanupAgedJob(CFG);
    expect(cleanupAgedMock).toHaveBeenCalledTimes(1);
    expect(cleanupAgedMock).toHaveBeenCalledWith({
      hotNewsDays: 30,
      heatHistoryDays: 7,
    });
  });

  it('does NOT pass dryRun (cron always executes for real)', async () => {
    cleanupAgedMock.mockResolvedValueOnce({
      hotNewsDeleted: 0,
      heatHistoryCascaded: 0,
      heatHistoryAged: 0,
    });
    await processCleanupAgedJob(CFG);
    const args = cleanupAgedMock.mock.calls[0]![0]!;
    expect(args.dryRun).toBeUndefined();
  });

  it('returns cleanupAged result verbatim for worker bookkeeping', async () => {
    const expected = {
      hotNewsDeleted: 7,
      heatHistoryCascaded: 21,
      heatHistoryAged: 4,
    };
    cleanupAgedMock.mockResolvedValueOnce(expected);
    const result = await processCleanupAgedJob(CFG);
    expect(result).toEqual(expected);
  });

  it('propagates cleanupAged errors (BullMQ will retry next 24h)', async () => {
    cleanupAgedMock.mockRejectedValueOnce(new Error('postgres connection lost'));
    await expect(processCleanupAgedJob(CFG)).rejects.toThrow(
      'postgres connection lost',
    );
  });

  it('honors custom config days (admin can shorten TTL for experiments)', async () => {
    const customCfg: CleanupConfig = {
      hotNewsDays: 14,
      heatHistoryDays: 3,
      cronHourUtc: 0,
    };
    cleanupAgedMock.mockResolvedValueOnce({
      hotNewsDeleted: 0,
      heatHistoryCascaded: 0,
      heatHistoryAged: 0,
    });
    await processCleanupAgedJob(customCfg);
    expect(cleanupAgedMock).toHaveBeenCalledWith({
      hotNewsDays: 14,
      heatHistoryDays: 3,
    });
  });
});
