import type {
  HeatCurveDto,
  HeatHistoryDto,
  HotNewsDetailDto,
  HotNewsListResponseDto,
  StatsSourcesDto,
  StatsTodayDto,
  TopTagsDto,
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

// SP-10 (2026-05-21): optional filter dimensions beyond legacy platforms/sort.
// `range` overrides PLATFORM_WINDOW_HOURS in the API (用户显式 7d 真看 7d).
// `tags` applies multi-tag AND filter via Prisma hasEvery / Postgres @>.
// SP-12 (2026-05-22): `q` overlays pg_trgm trigram similarity search +
// reorders by similarity DESC when set.
export interface ListFilterOptions {
  range?: '1d' | '7d' | '30d';
  tags?: string[];
  q?: string;
}

function buildHotNewsQueryString(
  page: number,
  pageSize: number,
  platforms?: FeedPlatform[],
  sort?: FeedSort,
  options?: ListFilterOptions,
): string {
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
  if (options?.range) {
    qs.set('range', options.range);
  }
  if (options?.tags && options.tags.length > 0) {
    qs.set('tags', options.tags.join(','));
  }
  if (options?.q && options.q.length > 0) {
    qs.set('q', options.q);
  }
  return qs.toString();
}

export function fetchHotNewsList(
  page: number,
  pageSize: number,
  platforms?: FeedPlatform[],
  sort?: FeedSort,
  options?: ListFilterOptions,
): Promise<HotNewsListResponseDto> {
  const qs = buildHotNewsQueryString(page, pageSize, platforms, sort, options);
  return fetchJson<HotNewsListResponseDto>(`/hot-news?${qs}`);
}

// SP-10 PR-C (2026-05-21): client-side fetcher for NewsFeed infinite scroll.
// Hits the Next.js BFF route `/api/hot-news` (defined in app/api/hot-news/route.ts),
// which forwards to the same NestJS API as the SSR path. Going through the
// BFF (vs API_URL) is mandatory in browser context — API_URL is an internal
// docker hostname not reachable from the user agent.
export async function fetchHotNewsListClient(
  page: number,
  pageSize: number,
  platforms?: FeedPlatform[],
  sort?: FeedSort,
  options?: ListFilterOptions,
): Promise<HotNewsListResponseDto> {
  const qs = buildHotNewsQueryString(page, pageSize, platforms, sort, options);
  const res = await fetch(`/api/hot-news?${qs}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new ApiError(res.status, `API ${res.status} (/api/hot-news?${qs})`);
  }
  return (await res.json()) as HotNewsListResponseDto;
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

// SP-12 (2026-05-22): top-N aiTag frequency over a configurable window,
// for /vault tag cloud + future SP-15 keyword monitor suggestions.
// Server clamps days [1,90] and limit [1,50]; we still safe-fence here.
export function fetchTopTags(days = 30, limit = 20): Promise<TopTagsDto> {
  const safeDays = Math.max(1, Math.min(90, Math.floor(days) || 30));
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 20));
  return fetchJson<TopTagsDto>(
    `/stats/top-tags?days=${safeDays}&limit=${safeLimit}`,
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
