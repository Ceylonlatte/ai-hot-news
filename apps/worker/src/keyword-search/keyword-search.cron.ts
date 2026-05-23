import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Inject } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { getPrisma } from '@ai-hot-news/db';
import {
  FREQUENCY_INTERVAL_MS,
  loadKeywordSearchConfig,
} from './keyword-search.config';
import {
  KEYWORD_SEARCH_QUEUE,
  KEYWORD_SEARCH_QUEUE_NAME,
} from './keyword-search.queue';

/**
 * SP-16.5 (2026-05-23): keyword-search scheduler.
 *
 * Runs every 5 minutes (configurable). For each enabled monitor whose
 * lastSearchedAt + monitorFrequency interval has elapsed, enqueue a
 * `keyword-search-<monitorId>` job. BullMQ jobId dedupe makes
 * "re-enqueue while previous run is still in flight" a silent no-op.
 *
 * Why pull-from-table over BullMQ repeatable jobs: re-using BullMQ's
 * native scheduler requires re-registering one job per keyword on every
 * monitor mutation (enable toggle, create, delete, frequency change),
 * and forgotten cleanup leaves orphan repeating jobs forever. A single
 * cron + table scan is simpler and self-healing.
 */
@Injectable()
export class KeywordSearchCron {
  private readonly logger = new Logger(KeywordSearchCron.name);

  constructor(@Inject(KEYWORD_SEARCH_QUEUE) private readonly queue: Queue) {}

  // Run every 5 minutes by default. The @Cron decorator is static so we
  // can't read env here — operators who need a different cadence should
  // override at deploy time by setting KEYWORD_SEARCH_CRON_INTERVAL_MIN
  // AND adjusting this expression to match (e.g. '*/1 * * * *' for 1min).
  @Cron('*/5 * * * *')
  async tick(): Promise<void> {
    const config = loadKeywordSearchConfig();
    const now = new Date();

    const prisma = getPrisma();
    const candidates = await prisma.keywordMonitor.findMany({
      where: { enabled: true },
      select: {
        id: true,
        keyword: true,
        monitorFrequency: true,
        lastSearchedAt: true,
      },
      // Oldest-first so newly-created monitors (null) get priority.
      orderBy: [{ lastSearchedAt: { sort: 'asc', nulls: 'first' } }],
    });

    const due = candidates.filter((c) => isDue(c, now));
    if (due.length === 0) {
      this.logger.debug(
        `tick: 0 due of ${candidates.length} enabled monitors (interval=${config.cronIntervalMin}m)`,
      );
      return;
    }

    for (const monitor of due) {
      await this.queue.add(
        KEYWORD_SEARCH_QUEUE_NAME,
        { monitorId: monitor.id, keyword: monitor.keyword },
        {
          jobId: `keyword-search-${monitor.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
    }
    this.logger.log(
      `tick: enqueued ${due.length}/${candidates.length} monitors`,
    );
  }
}

interface DueCheck {
  monitorFrequency: 'M15' | 'M30' | 'H1' | 'D1';
  lastSearchedAt: Date | null;
}

export function isDue(monitor: DueCheck, now: Date): boolean {
  if (monitor.lastSearchedAt === null) return true;
  const interval = FREQUENCY_INTERVAL_MS[monitor.monitorFrequency];
  return now.getTime() - monitor.lastSearchedAt.getTime() >= interval;
}
