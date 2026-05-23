// SP-16.5 (2026-05-23): config for the keyword-search feeder.

import type { MonitorFrequency } from '@ai-hot-news/types';

export interface KeywordSearchConfig {
  /** Cron interval (minutes). Defaults to 5; can drop to 1 for tighter
   *  scheduling but Reddit rate-limit makes 5+ saner. */
  cronIntervalMin: number;
  /** Worker concurrency. Reddit rate-limit (10/min IP) forces us to keep
   *  this at 1 so two keyword jobs never race on Reddit at the same
   *  second. HN Algolia handles parallel fine but the wins are tiny. */
  concurrency: number;
  /** Per-platform max results requested per search. HN Algolia hard cap is
   *  1000 / page; Reddit caps at 100. Default 50 — keeps payloads small
   *  + Reddit-compatible without paging. */
  maxHitsPerPlatform: number;
  /** Sleep between Reddit search calls (ms) to stay under 10 req/min. */
  redditMinSleepMs: number;
  /** User-Agent header for both platforms (Reddit REQUIRES non-default UA;
   *  HN Algolia is friendlier but we send for parity + identifying us in
   *  ops logs). */
  userAgent: string;
}

const DEFAULTS: KeywordSearchConfig = {
  cronIntervalMin: 5,
  concurrency: 1,
  maxHitsPerPlatform: 50,
  redditMinSleepMs: 6_500,
  userAgent: 'ai-hot-news-bot/0.1 (+https://hotnews.shinpeionline.top)',
};

function readPositiveInt(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback;
  const n = Number(envValue);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function loadKeywordSearchConfig(): KeywordSearchConfig {
  return {
    cronIntervalMin: readPositiveInt(
      process.env.KEYWORD_SEARCH_CRON_INTERVAL_MIN,
      DEFAULTS.cronIntervalMin,
    ),
    concurrency: readPositiveInt(
      process.env.KEYWORD_SEARCH_CONCURRENCY,
      DEFAULTS.concurrency,
    ),
    maxHitsPerPlatform: readPositiveInt(
      process.env.KEYWORD_SEARCH_MAX_HITS,
      DEFAULTS.maxHitsPerPlatform,
    ),
    redditMinSleepMs: readPositiveInt(
      process.env.KEYWORD_SEARCH_REDDIT_SLEEP_MS,
      DEFAULTS.redditMinSleepMs,
    ),
    userAgent: process.env.KEYWORD_SEARCH_USER_AGENT ?? DEFAULTS.userAgent,
  };
}

/**
 * Frequency → minimum interval (ms) the cron should wait before re-searching
 * the same keyword. PRD §5.3 four tiers, semantics matching SP-14 enum.
 */
export const FREQUENCY_INTERVAL_MS: Record<MonitorFrequency, number> = {
  M15: 15 * 60 * 1000,
  M30: 30 * 60 * 1000,
  H1: 60 * 60 * 1000,
  D1: 24 * 60 * 60 * 1000,
};
