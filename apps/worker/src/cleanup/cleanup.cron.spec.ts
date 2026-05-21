import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Queue } from 'bullmq';
import { CleanupCron } from './cleanup.cron';

describe('CleanupCron.onModuleInit', () => {
  let queue: {
    add: ReturnType<typeof vi.fn>;
    getRepeatableJobs: ReturnType<typeof vi.fn>;
    removeRepeatableByKey: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    queue = {
      add: vi.fn().mockResolvedValue(undefined),
      getRepeatableJobs: vi.fn().mockResolvedValue([]),
      removeRepeatableByKey: vi.fn().mockResolvedValue(undefined),
    };
    vi.useFakeTimers();
    // Pin "now" to 2026-05-21 10:00:00 UTC for deterministic delay math.
    vi.setSystemTime(new Date('2026-05-21T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CLEANUP_CRON_HOUR_UTC;
  });

  it('registers cleanup-aged repeat job with 24h every + jobId fingerprint', async () => {
    const cron = new CleanupCron(queue as unknown as Queue);
    await cron.onModuleInit();

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, _data, opts] = queue.add.mock.calls[0]!;
    expect(name).toBe('cleanup-aged');
    expect(opts.jobId).toBe('cleanup-aged');
    expect(opts.repeat).toEqual({ every: 86_400_000, immediately: false });
  });

  it('delay anchors first run to next 03:00 UTC when now < target', async () => {
    // now = 10:00 UTC, target = 03:00 UTC. First run is tomorrow 03:00 UTC.
    // → delay = 17h
    const cron = new CleanupCron(queue as unknown as Queue);
    await cron.onModuleInit();
    const opts = queue.add.mock.calls[0]![2]!;
    const seventeenHours = 17 * 3_600_000;
    // Allow ±1 minute slack to accommodate test execution wall time.
    expect(opts.delay).toBeGreaterThan(seventeenHours - 60_000);
    expect(opts.delay).toBeLessThan(seventeenHours + 60_000);
  });

  it('delay anchors to tomorrow when now > target hour', async () => {
    // now = 10:00 UTC, target = 5:00 UTC. Target already passed; first run is
    // tomorrow at 5:00 UTC → delay = 19h.
    process.env.CLEANUP_CRON_HOUR_UTC = '5';
    const cron = new CleanupCron(queue as unknown as Queue);
    await cron.onModuleInit();
    const opts = queue.add.mock.calls[0]![2]!;
    expect(opts.delay).toBeGreaterThan(18 * 3_600_000);
    expect(opts.delay).toBeLessThan(20 * 3_600_000);
  });

  it('removes stale repeatable job before registering (idempotent across deploys)', async () => {
    queue.getRepeatableJobs.mockResolvedValue([
      { name: 'cleanup-aged', key: 'stale-repeat-key-1' },
      { name: 'heat-refresh', key: 'unrelated-key' },
    ]);
    const cron = new CleanupCron(queue as unknown as Queue);
    await cron.onModuleInit();

    expect(queue.removeRepeatableByKey).toHaveBeenCalledTimes(1);
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('stale-repeat-key-1');
  });

  it('honors custom CLEANUP_CRON_HOUR_UTC=0 (midnight UTC) — must not fall back to default', async () => {
    process.env.CLEANUP_CRON_HOUR_UTC = '0';
    const cron = new CleanupCron(queue as unknown as Queue);
    await cron.onModuleInit();
    const opts = queue.add.mock.calls[0]![2]!;
    // now = 10:00, target = 0:00 already passed → tomorrow 0:00 = 14h
    expect(opts.delay).toBeGreaterThan(13 * 3_600_000);
    expect(opts.delay).toBeLessThan(15 * 3_600_000);
  });
});
