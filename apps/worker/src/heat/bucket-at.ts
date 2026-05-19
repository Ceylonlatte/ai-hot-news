/**
 * Round a Date down to the nearest 30-minute boundary in UTC.
 *
 * Used by SP-11 heat_history to anchor each snapshot to :00 or :30. The
 * SP-6 heat cron fires every 30min so the bucket grid is identical to the
 * cron grid; UPSERT on (hotNewsId, bucketAt) guarantees idempotence even
 * if a tick is retried.
 *
 * @example
 *   computeBucketAt(2026-05-19T14:14:59Z) // → 2026-05-19T14:00:00.000Z
 *   computeBucketAt(2026-05-19T14:45:30Z) // → 2026-05-19T14:30:00.000Z
 */
export function computeBucketAt(date: Date): Date {
  const d = new Date(date.getTime());
  d.setUTCSeconds(0, 0);
  const minutes = d.getUTCMinutes();
  d.setUTCMinutes(minutes < 30 ? 0 : 30);
  return d;
}
