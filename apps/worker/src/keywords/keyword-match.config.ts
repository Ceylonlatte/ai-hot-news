export interface KeywordMatchConfig {
  /** BullMQ Worker concurrency. Default 2; one row can match all keywords
   *  in <50ms (substring), so concurrency is mainly to amortize DB I/O. */
  concurrency: number;
  /** Boot backstop scan window (days). Matches SP-10.5 hot_news TTL upper
   *  bound — older rows are already pruned. Default 30. */
  backstopDays: number;
}

const DEFAULTS: KeywordMatchConfig = {
  concurrency: 2,
  backstopDays: 30,
};

function readPositiveInt(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback;
  const n = Number(envValue);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function loadKeywordMatchConfig(): KeywordMatchConfig {
  return {
    concurrency: readPositiveInt(
      process.env.KEYWORD_MATCH_CONCURRENCY,
      DEFAULTS.concurrency,
    ),
    backstopDays: readPositiveInt(
      process.env.KEYWORD_MATCH_BACKSTOP_DAYS,
      DEFAULTS.backstopDays,
    ),
  };
}
