import type {
  HeatCurveDto,
  HeatHistoryDto,
  HotNewsDetailDto,
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
//
// SP-11 (2026-05-19): the detail page RSC needs to convert upstream 404s
// into Next's `notFound()` helper, so the thrown Error gets a `.status`
// property that the caller can inspect. Other status codes still throw
// with the same string shape as before.
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(
      res.status,
      `API ${res.status} (${path}): ${body || res.statusText}`,
    );
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

// SP-11 (2026-05-19): detail page fetchers.

export function fetchHotNewsDetail(id: string): Promise<HotNewsDetailDto> {
  return fetchJson<HotNewsDetailDto>(`/hot-news/${encodeURIComponent(id)}`);
}

export function fetchHeatHistory(
  id: string,
  hours: 24 | 48 | 72 = 48,
): Promise<HeatHistoryDto> {
  return fetchJson<HeatHistoryDto>(
    `/hot-news/${encodeURIComponent(id)}/heat-history?hours=${hours}`,
  );
}
