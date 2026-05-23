import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadKeywordMatchConfig } from './keyword-match.config';

const ENV_KEYS = ['KEYWORD_MATCH_CONCURRENCY', 'KEYWORD_MATCH_BACKSTOP_DAYS'] as const;

describe('loadKeywordMatchConfig', () => {
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

  it('defaults concurrency=2, backstopDays=30', () => {
    const cfg = loadKeywordMatchConfig();
    expect(cfg.concurrency).toBe(2);
    expect(cfg.backstopDays).toBe(30);
  });

  it('honors KEYWORD_MATCH_CONCURRENCY override', () => {
    process.env.KEYWORD_MATCH_CONCURRENCY = '8';
    expect(loadKeywordMatchConfig().concurrency).toBe(8);
  });

  it('honors KEYWORD_MATCH_BACKSTOP_DAYS override', () => {
    process.env.KEYWORD_MATCH_BACKSTOP_DAYS = '7';
    expect(loadKeywordMatchConfig().backstopDays).toBe(7);
  });

  it('falls back to defaults on invalid env', () => {
    process.env.KEYWORD_MATCH_CONCURRENCY = '-1';
    process.env.KEYWORD_MATCH_BACKSTOP_DAYS = 'NaN';
    const cfg = loadKeywordMatchConfig();
    expect(cfg.concurrency).toBe(2);
    expect(cfg.backstopDays).toBe(30);
  });

  it('floors fractional values', () => {
    process.env.KEYWORD_MATCH_BACKSTOP_DAYS = '14.7';
    expect(loadKeywordMatchConfig().backstopDays).toBe(14);
  });
});
