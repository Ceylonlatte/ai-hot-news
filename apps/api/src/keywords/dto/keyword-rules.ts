/**
 * SP-14 (2026-05-23): shared constants for KeywordMonitor DTO validation.
 *
 * Centralized so service-side defenses (idempotent retries on duplicate-
 * keyword PATCH, etc.) and the eventual SP-15 web client form share the
 * same numbers — drift detection via packages/types if either side
 * drifts the literal values.
 */

export const KEYWORD_MAX_LENGTH = 100;
export const SYNONYMS_MAX_COUNT = 10;
export const SYNONYM_MAX_LENGTH = 100;
export const EXCLUDE_WORDS_MAX_COUNT = 10;
export const EXCLUDE_WORD_MAX_LENGTH = 100;

export const ALLOWED_PLATFORMS = ['HACKERNEWS', 'REDDIT', 'RSS', 'TWITTER'] as const;
export type AllowedPlatform = (typeof ALLOWED_PLATFORMS)[number];

export const ALLOWED_FREQUENCIES = ['M15', 'M30', 'H1', 'D1'] as const;
export type AllowedFrequency = (typeof ALLOWED_FREQUENCIES)[number];

export const ALLOWED_CHANNELS = [
  'site',
  'email',
  'feishu',
  'dingtalk',
  'telegram',
  'webhook',
] as const;
export type AllowedChannel = (typeof ALLOWED_CHANNELS)[number];
