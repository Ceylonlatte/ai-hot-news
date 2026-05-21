import { Logger } from '@nestjs/common';
import { cleanupAged, type CleanupAgedResult } from '@ai-hot-news/db';
import type { CleanupConfig } from './cleanup.config';

const logger = new Logger('CleanupCronProcessor');

/**
 * SP-10.5 (2026-05-21): consumed by the BullMQ `cleanup-aged` repeat job
 * (registered by CleanupCron). Delegates entirely to the pure function
 * `cleanupAged` exported from packages/db so the same code path runs
 * during prod first-run (`scripts/run-prod-oneshot.sh`) and from the
 * daily cron.
 *
 * Throws are propagated to the BullMQ worker which logs to `failed`;
 * the next 24h run automatically retries (DELETE is idempotent).
 */
export async function processCleanupAgedJob(
  cfg: CleanupConfig,
): Promise<CleanupAgedResult> {
  const result = await cleanupAged({
    hotNewsDays: cfg.hotNewsDays,
    heatHistoryDays: cfg.heatHistoryDays,
  });
  logger.log(
    `Cleanup: deleted=${result.hotNewsDeleted} hot_news, ` +
      `=${result.heatHistoryCascaded} heat_history (cascade), ` +
      `=${result.heatHistoryAged} heat_history (aged-snapshot)`,
  );
  return result;
}
