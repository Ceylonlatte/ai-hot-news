import { describe, expect, it } from 'vitest';
import { computeBucketAt } from './bucket-at';

// SP-11 §3.1 — heat_history bucket alignment.
// Each cron tick (every 30min) writes a snapshot row keyed at the most
// recent :00 or :30 boundary. UPSERT on (hotNewsId, bucketAt) guarantees
// idempotence if a tick is retried or two ticks happen to straddle the
// same boundary.

describe('computeBucketAt — 30-minute UTC alignment', () => {
  // Use Date.UTC so we are immune to host TZ.
  const at = (y: number, m: number, d: number, h: number, min: number, s = 0) =>
    new Date(Date.UTC(y, m - 1, d, h, min, s));

  it('rounds 14:00:01 down to 14:00:00', () => {
    expect(computeBucketAt(at(2026, 5, 19, 14, 0, 1))).toEqual(at(2026, 5, 19, 14, 0));
  });

  it('rounds 14:14:59 down to 14:00:00', () => {
    expect(computeBucketAt(at(2026, 5, 19, 14, 14, 59))).toEqual(at(2026, 5, 19, 14, 0));
  });

  it('rounds 14:29:59 down to 14:00:00 (just before half-hour)', () => {
    expect(computeBucketAt(at(2026, 5, 19, 14, 29, 59))).toEqual(at(2026, 5, 19, 14, 0));
  });

  it('rounds 14:30:00 exactly to 14:30:00', () => {
    expect(computeBucketAt(at(2026, 5, 19, 14, 30, 0))).toEqual(at(2026, 5, 19, 14, 30));
  });

  it('rounds 14:44:59 down to 14:30:00', () => {
    expect(computeBucketAt(at(2026, 5, 19, 14, 44, 59))).toEqual(at(2026, 5, 19, 14, 30));
  });

  it('rounds 14:59:59 down to 14:30:00 (just before next hour)', () => {
    expect(computeBucketAt(at(2026, 5, 19, 14, 59, 59))).toEqual(at(2026, 5, 19, 14, 30));
  });

  it('clears milliseconds + seconds', () => {
    const d = new Date(Date.UTC(2026, 4, 19, 14, 25, 12, 678));
    const out = computeBucketAt(d);
    expect(out.getUTCSeconds()).toBe(0);
    expect(out.getUTCMilliseconds()).toBe(0);
    expect(out.getUTCMinutes()).toBe(0);
  });

  it('does not mutate the input Date', () => {
    const input = at(2026, 5, 19, 14, 45, 30);
    const inputCopy = new Date(input.getTime());
    computeBucketAt(input);
    expect(input.getTime()).toBe(inputCopy.getTime());
  });
});
