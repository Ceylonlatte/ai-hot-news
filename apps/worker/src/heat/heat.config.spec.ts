import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadHeatConfig } from './heat.config';

describe('loadHeatConfig', () => {
  const orig = { ...process.env };

  beforeEach(() => {
    delete process.env.HEAT_DECAY_TAU_HOURS;
    delete process.env.HEAT_CRON_INTERVAL_MIN;
    delete process.env.HEAT_BATCH_SIZE;
    delete process.env.HEAT_CONCURRENCY;
    delete process.env.INTERACTION_MAX_HN;
    delete process.env.INTERACTION_MAX_REDDIT;
    delete process.env.INTERACTION_MAX_TWITTER;
  });

  afterEach(() => {
    process.env = { ...orig };
  });

  it('returns documented defaults when env is empty', () => {
    const cfg = loadHeatConfig();
    expect(cfg).toEqual({
      decayTauHours: 48,
      cronIntervalMin: 30,
      batchSize: 500,
      concurrency: 2,
      maxHn: 500,
      maxReddit: 5000,
      maxTwitter: 100000,
    });
  });

  it('reads HEAT_DECAY_TAU_HOURS from env', () => {
    process.env.HEAT_DECAY_TAU_HOURS = '24';
    expect(loadHeatConfig().decayTauHours).toBe(24);
  });

  it('reads INTERACTION_MAX_REDDIT from env', () => {
    process.env.INTERACTION_MAX_REDDIT = '8000';
    expect(loadHeatConfig().maxReddit).toBe(8000);
  });

  it('falls back to default when env value is invalid (NaN)', () => {
    process.env.HEAT_CONCURRENCY = 'not-a-number';
    expect(loadHeatConfig().concurrency).toBe(2);
  });

  it('falls back to default when env value is zero or negative', () => {
    process.env.HEAT_BATCH_SIZE = '0';
    expect(loadHeatConfig().batchSize).toBe(500);
    process.env.HEAT_BATCH_SIZE = '-1';
    expect(loadHeatConfig().batchSize).toBe(500);
  });
});
