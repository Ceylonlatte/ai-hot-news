import type { FeedPlatform, FeedSort } from '@/lib/api';
import type { Route } from 'next';
import type { FeedTab } from './feed-tabs';

// SP-10 (2026-05-21): centralized search-params parser + URL builder for
// /news. Pure functions only — RSC components import these to normalize
// URL state into typed values before passing to fetchers / client children.
//
// Design contract:
// - URL is the single source of truth for filter state (spec §0 Q15 / Q22)
// - All values default to sensible safe choices when query string omitted
// - Unknown values are silently coerced to defaults (forgiving frontend)

export type FeedRange = '1d' | '7d' | '30d';

const ALLOWED_RANGES: ReadonlyArray<FeedRange> = ['1d', '7d', '30d'];
const ALLOWED_SORTS: ReadonlyArray<FeedSort> = ['time', 'heat'];

/** Default time range — "今天" 心智，路径 A 决策 (spec §0 Q2). */
export const DEFAULT_RANGE: FeedRange = '1d';

/** Default sort — 'time' keeps SP-9 / SP-11 / 已 prod URL 兼容 (spec §0 Q10). */
export const DEFAULT_SORT: FeedSort = 'time';

export function parseRange(raw: string | undefined): FeedRange {
  if (typeof raw !== 'string') return DEFAULT_RANGE;
  const v = raw.trim().toLowerCase();
  return (ALLOWED_RANGES as readonly string[]).includes(v)
    ? (v as FeedRange)
    : DEFAULT_RANGE;
}

export function parseSort(raw: string | undefined): FeedSort {
  if (typeof raw !== 'string') return DEFAULT_SORT;
  const v = raw.trim().toLowerCase();
  return (ALLOWED_SORTS as readonly string[]).includes(v)
    ? (v as FeedSort)
    : DEFAULT_SORT;
}

/** Parse `?tags=a,b,c` into `['a', 'b', 'c']`. Trims, drops empties,
 *  preserves order. Returns empty array (NOT undefined) so consumers can
 *  always `.includes(...)` without null check. */
export function parseTags(raw: string | undefined): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** State driving the /news URL — all 4 dims. */
export interface NewsFilterState {
  tab: FeedTab;
  range: FeedRange;
  sort: FeedSort;
  tags: string[];
}

/** Build a typed-route compatible href object for `/news`. Returns a
 *  `Route` because `typedRoutes: true` in next.config rejects raw
 *  template strings with dynamic segments. Empty / default values are
 *  intentionally written into the URL only when non-default — keeps the
 *  URL terse for the "common case" (community + 1d + time + no tags). */
export function buildNewsUrl(state: Partial<NewsFilterState>): Route {
  const qs = new URLSearchParams();
  if (state.tab && state.tab !== 'community') qs.set('tab', state.tab);
  if (state.range && state.range !== DEFAULT_RANGE) qs.set('range', state.range);
  if (state.sort && state.sort !== DEFAULT_SORT) qs.set('sort', state.sort);
  if (state.tags && state.tags.length > 0) qs.set('tags', state.tags.join(','));
  const search = qs.toString();
  return (search ? `/news?${search}` : '/news') as Route;
}

/** Toggle a tag in the current state — returns the new tags array.
 *  Used by category-chips and clickable NewsItem tag links.
 *  - present → removed
 *  - absent  → appended at the end
 *  - case-sensitive match (must exactly equal the existing tag)
 */
export function toggleTag(current: string[], tag: string): string[] {
  if (current.includes(tag)) return current.filter((t) => t !== tag);
  return [...current, tag];
}

/** Map of platforms per FeedTab (mirrors apps/web/app/news/page.tsx) —
 *  exported so range-tabs / category-chips can build URLs that preserve
 *  the active tab on transition. */
export const TAB_PLATFORMS: Record<FeedTab, FeedPlatform[]> = {
  community: ['HACKERNEWS', 'REDDIT'],
  media: ['RSS'],
};
