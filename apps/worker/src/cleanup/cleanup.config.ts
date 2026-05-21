export interface CleanupConfig {
  /** hot_news.publishedAt 早于 NOW - this days → DELETE。默认 30。 */
  hotNewsDays: number;
  /** heat_history.bucketAt 早于 NOW - this days → DELETE。默认 7。 */
  heatHistoryDays: number;
  /** Daily cron 触发时刻（UTC hour）。默认 3 = 03:00 UTC = 11:00 AM CST。 */
  cronHourUtc: number;
}

const DEFAULTS: CleanupConfig = {
  hotNewsDays: 30,
  heatHistoryDays: 7,
  cronHourUtc: 3,
};

function readPositiveInt(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback;
  const n = Number(envValue);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function readHour(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback;
  const n = Number(envValue);
  // Allow 0 explicitly (midnight UTC); only reject NaN / out-of-range.
  if (!Number.isFinite(n) || n < 0 || n > 23) return fallback;
  return Math.floor(n);
}

export function loadCleanupConfig(): CleanupConfig {
  return {
    hotNewsDays: readPositiveInt(process.env.CLEANUP_HOT_NEWS_DAYS, DEFAULTS.hotNewsDays),
    heatHistoryDays: readPositiveInt(
      process.env.CLEANUP_HEAT_HISTORY_DAYS,
      DEFAULTS.heatHistoryDays,
    ),
    cronHourUtc: readHour(process.env.CLEANUP_CRON_HOUR_UTC, DEFAULTS.cronHourUtc),
  };
}
