import type { HotNewsListResponseDto } from '@ai-hot-news/types';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const FETCH_TIMEOUT_MS = 10_000;

export async function fetchHotNewsList(
  page: number,
  pageSize: number,
): Promise<HotNewsListResponseDto> {
  const res = await fetch(`${API_URL}/hot-news?page=${page}&pageSize=${pageSize}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as HotNewsListResponseDto;
}
