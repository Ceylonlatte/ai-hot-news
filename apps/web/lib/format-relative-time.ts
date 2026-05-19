/**
 * SP-11 (2026-05-19): Format an ISO timestamp as a short relative
 * description ("5 minutes ago", "2 hours ago", "3 days ago").
 *
 * Used by the detail page hero so the user sees recency at a glance
 * before the precise UTC stamp. Uses Intl.RelativeTimeFormat — no extra
 * runtime dependency (works in Node 22 SSR + modern browsers).
 *
 * `now` parameter is injectable for deterministic tests; production
 * callers can omit it.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;

  const diffSec = Math.round((now.getTime() - then.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const abs = Math.abs(diffSec);

  if (abs < 60) return rtf.format(-diffSec, 'second');
  if (abs < 3600) return rtf.format(-Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(-Math.round(diffSec / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(-Math.round(diffSec / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(-Math.round(diffSec / (86400 * 30)), 'month');
  return rtf.format(-Math.round(diffSec / (86400 * 365)), 'year');
}
