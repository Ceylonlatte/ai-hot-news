import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadKeywordSearchConfig,
  FREQUENCY_INTERVAL_MS,
} from './keyword-search.config';

const ENV_KEYS = [
  'KEYWORD_SEARCH_CRON_INTERVAL_MIN',
  'KEYWORD_SEARCH_CONCURRENCY',
  'KEYWORD_SEARCH_MAX_HITS',
  'KEYWORD_SEARCH_REDDIT_SLEEP_MS',
  'KEYWORD_SEARCH_USER_AGENT',
] as const;

describe('loadKeywordSearchConfig', () => {
  let backup: Record<string, string | undefined>;

  beforeEach(() => {
    backup = {};
    for (const k of ENV_KEYS) {
      backup[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (backup[k] === undefined) delete process.env[k];
      else process.env[k] = backup[k];
    }
  });

  it('defaults are sane for prod', () => {
    const cfg = loadKeywordSearchConfig();
    expect(cfg.cronIntervalMin).toBe(5);
    expect(cfg.concurrency).toBe(1);
    expect(cfg.maxHitsPerPlatform).toBe(50);
    expect(cfg.redditMinSleepMs).toBe(6_500);
    expect(cfg.userAgent).toMatch(/ai-hot-news-bot/);
  });

  it('honors numeric env overrides', () => {
    process.env.KEYWORD_SEARCH_CRON_INTERVAL_MIN = '10';
    process.env.KEYWORD_SEARCH_CONCURRENCY = '4';
    process.env.KEYWORD_SEARCH_MAX_HITS = '20';
    process.env.KEYWORD_SEARCH_REDDIT_SLEEP_MS = '8000';
    const cfg = loadKeywordSearchConfig();
    expect(cfg.cronIntervalMin).toBe(10);
    expect(cfg.concurrency).toBe(4);
    expect(cfg.maxHitsPerPlatform).toBe(20);
    expect(cfg.redditMinSleepMs).toBe(8000);
  });

  it('falls back on invalid values', () => {
    process.env.KEYWORD_SEARCH_CRON_INTERVAL_MIN = '-1';
    process.env.KEYWORD_SEARCH_MAX_HITS = 'NaN';
    const cfg = loadKeywordSearchConfig();
    expect(cfg.cronIntervalMin).toBe(5);
    expect(cfg.maxHitsPerPlatform).toBe(50);
  });

  it('userAgent override', () => {
    process.env.KEYWORD_SEARCH_USER_AGENT = 'custom/1.0';
    expect(loadKeywordSearchConfig().userAgent).toBe('custom/1.0');
  });
});

describe('FREQUENCY_INTERVAL_MS', () => {
  it('M15 = 15 min, M30 = 30 min, H1 = 60 min, D1 = 24 hr', () => {
    expect(FREQUENCY_INTERVAL_MS.M15).toBe(15 * 60 * 1000);
    expect(FREQUENCY_INTERVAL_MS.M30).toBe(30 * 60 * 1000);
    expect(FREQUENCY_INTERVAL_MS.H1).toBe(60 * 60 * 1000);
    expect(FREQUENCY_INTERVAL_MS.D1).toBe(24 * 60 * 60 * 1000);
  });
});
