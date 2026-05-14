export interface HeatConfig {
  decayTauHours: number;
  cronIntervalMin: number;
  batchSize: number;
  concurrency: number;
  maxHn: number;
  maxReddit: number;
  maxTwitter: number;
}

const DEFAULTS: HeatConfig = {
  decayTauHours: 48,
  cronIntervalMin: 30,
  batchSize: 500,
  concurrency: 2,
  maxHn: 500,
  maxReddit: 5000,
  maxTwitter: 100000,
};

function readPositiveInt(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback;
  const n = Number(envValue);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function readPositiveNumber(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback;
  const n = Number(envValue);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function loadHeatConfig(): HeatConfig {
  return {
    decayTauHours: readPositiveNumber(process.env.HEAT_DECAY_TAU_HOURS, DEFAULTS.decayTauHours),
    cronIntervalMin: readPositiveInt(process.env.HEAT_CRON_INTERVAL_MIN, DEFAULTS.cronIntervalMin),
    batchSize: readPositiveInt(process.env.HEAT_BATCH_SIZE, DEFAULTS.batchSize),
    concurrency: readPositiveInt(process.env.HEAT_CONCURRENCY, DEFAULTS.concurrency),
    maxHn: readPositiveInt(process.env.INTERACTION_MAX_HN, DEFAULTS.maxHn),
    maxReddit: readPositiveInt(process.env.INTERACTION_MAX_REDDIT, DEFAULTS.maxReddit),
    maxTwitter: readPositiveInt(process.env.INTERACTION_MAX_TWITTER, DEFAULTS.maxTwitter),
  };
}
