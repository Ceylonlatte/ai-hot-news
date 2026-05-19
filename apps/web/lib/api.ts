import type {
  HeatCurveDto,
  HotNewsListResponseDto,
  StatsSourcesDto,
  StatsTodayDto,
  TrendingKeywordsDto,
} from '@ai-hot-news/types';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const FETCH_TIMEOUT_MS = 10_000;

export type FeedPlatform = 'HACKERNEWS' | 'REDDIT' | 'RSS';
export type FeedSort = 'time' | 'heat';

// Shared SSR fetch helper. All callers go through this so timeout / cache
// / error-shape stays in one place. `cache: 'no-store'` per SP-9 spec §0
// Q8 — we want fresh stats on every router refresh.
async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status} (${path}): ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

export function fetchHotNewsList(
  page: number,
  pageSize: number,
  platforms?: FeedPlatform[],
  sort?: FeedSort,
): Promise<HotNewsListResponseDto> {
  const qs = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (platforms && platforms.length > 0) {
    qs.set('platforms', platforms.join(','));
  }
  if (sort) {
    qs.set('sort', sort);
  }
  return fetchJson<HotNewsListResponseDto>(`/hot-news?${qs.toString()}`);
}

// SP-9 (2026-05-19): dashboard stat fetchers, called in parallel from the
// HomePage RSC via Promise.all.

export function fetchStatsToday(): Promise<StatsTodayDto> {
  return fetchJson<StatsTodayDto>('/stats/today');
}

export function fetchStatsSources(): Promise<StatsSourcesDto> {
  return fetchJson<StatsSourcesDto>('/stats/sources');
}

export function fetchHeatCurve(): Promise<HeatCurveDto> {
  return fetchJson<HeatCurveDto>('/stats/heat-curve');
}

export function fetchTrendingKeywords(
  limit = 8,
): Promise<TrendingKeywordsDto> {
  const safe = Math.max(1, Math.min(20, Math.floor(limit) || 8));
  return fetchJson<TrendingKeywordsDto>(
    `/stats/trending-keywords?limit=${safe}`,
  );
}
