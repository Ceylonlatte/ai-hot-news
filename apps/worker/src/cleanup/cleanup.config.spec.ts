import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadCleanupConfig } from './cleanup.config';

describe('loadCleanupConfig', () => {
  const ENV_KEYS = ['CLEANUP_HOT_NEWS_DAYS', 'CLEANUP_HEAT_HISTORY_DAYS', 'CLEANUP_CRON_HOUR_UTC'];
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

  it('returns defaults when env vars are unset (30 / 7 / 3)', () => {
    const cfg = loadCleanupConfig();
    expect(cfg.hotNewsDays).toBe(30);
    expect(cfg.heatHistoryDays).toBe(7);
    expect(cfg.cronHourUtc).toBe(3);
  });

  it('honors custom env values', () => {
    process.env.CLEANUP_HOT_NEWS_DAYS = '60';
    process.env.CLEANUP_HEAT_HISTORY_DAYS = '14';
    process.env.CLEANUP_CRON_HOUR_UTC = '0';
    const cfg = loadCleanupConfig();
    expect(cfg.hotNewsDays).toBe(60);
    expect(cfg.heatHistoryDays).toBe(14);
    expect(cfg.cronHourUtc).toBe(0); // allowed: 0 = midnight UTC
  });

  it('rejects invalid (negative / NaN / >23 hour) and falls back to defaults', () => {
    process.env.CLEANUP_HOT_NEWS_DAYS = '-5';
    process.env.CLEANUP_HEAT_HISTORY_DAYS = 'not-a-number';
    process.env.CLEANUP_CRON_HOUR_UTC = '24'; // out of range
    const cfg = loadCleanupConfig();
    expect(cfg.hotNewsDays).toBe(30);
    expect(cfg.heatHistoryDays).toBe(7);
    expect(cfg.cronHourUtc).toBe(3);
  });

  it('floors fractional day values', () => {
    process.env.CLEANUP_HOT_NEWS_DAYS = '30.7';
    const cfg = loadCleanupConfig();
    expect(cfg.hotNewsDays).toBe(30);
  });

  it('mixed env: partial override falls back to defaults for the rest', () => {
    process.env.CLEANUP_CRON_HOUR_UTC = '12';
    const cfg = loadCleanupConfig();
    expect(cfg.hotNewsDays).toBe(30);
    expect(cfg.heatHistoryDays).toBe(7);
    expect(cfg.cronHourUtc).toBe(12);
  });
});
