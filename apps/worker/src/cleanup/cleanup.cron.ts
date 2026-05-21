import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CLEANUP_QUEUE } from './cleanup.queue';
import { loadCleanupConfig } from './cleanup.config';

const REPEAT_JOB_NAME = 'cleanup-aged';
const DAY_MS = 86_400_000;

@Injectable()
export class CleanupCron implements OnModuleInit {
  private readonly logger = new Logger(CleanupCron.name);

  constructor(@Inject(CLEANUP_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    const cfg = loadCleanupConfig();
    // BullMQ `repeat.every` is simple periodic, not a cron expression.
    // Anchor the first run at the next occurrence of `cronHourUtc:00 UTC`,
    // then 24h periodic from there. Long-term drift < 1min/year — acceptable
    // for a daily housekeeping job.
    const now = new Date();
    const todayAtTarget = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      cfg.cronHourUtc,
      0,
      0,
      0,
    );
    const firstRunMs =
      now.getTime() < todayAtTarget
        ? todayAtTarget
        : todayAtTarget + DAY_MS;
    const delay = firstRunMs - now.getTime();

    // Strip any prior registration so changing CLEANUP_CRON_HOUR_UTC between
    // deploys doesn't leave two repeat jobs racing (mirrors HeatCron pattern).
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      if (job.name === REPEAT_JOB_NAME) {
        await this.queue.removeRepeatableByKey(job.key);
      }
    }

    await this.queue.add(
      REPEAT_JOB_NAME,
      {},
      {
        repeat: { every: DAY_MS, immediately: false },
        delay,
        jobId: REPEAT_JOB_NAME,
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 5 },
      },
    );
    this.logger.log(
      `Cron registered: ${REPEAT_JOB_NAME} daily @ ${cfg.cronHourUtc}:00 UTC (first run in ${Math.round(delay / 3_600_000)}h)`,
    );
  }
}
