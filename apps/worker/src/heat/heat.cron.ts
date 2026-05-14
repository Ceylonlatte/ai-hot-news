import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { HEAT_QUEUE } from './heat.queue';
import { loadHeatConfig } from './heat.config';

const REPEAT_JOB_NAME = 'heat-refresh';

@Injectable()
export class HeatCron implements OnModuleInit {
  private readonly logger = new Logger(HeatCron.name);

  constructor(@Inject(HEAT_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    const cfg = loadHeatConfig();
    const everyMs = cfg.cronIntervalMin * 60 * 1000;

    // Strip any prior registration so changing HEAT_CRON_INTERVAL_MIN between
    // deploys doesn't leave two repeat jobs racing.
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
        repeat: { every: everyMs },
        jobId: REPEAT_JOB_NAME,
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 10 },
      },
    );
    this.logger.log(
      `Cron registered: ${REPEAT_JOB_NAME} every ${cfg.cronIntervalMin}min`,
    );
  }
}
