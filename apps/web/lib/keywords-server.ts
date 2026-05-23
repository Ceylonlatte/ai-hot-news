import 'server-only';
import { cookies } from 'next/headers';
import type {
  KeywordHitsResponseDto,
  KeywordListResponseDto,
} from '@ai-hot-news/types';
import { ApiError } from './api';

// SP-15 (2026-05-23): RSC-only keyword fetchers. Forwards ahn_session
// cookie to upstream so JwtAuthGuard authenticates the request. Callers
// MUST have already validated `getCurrentUser()` and redirected on null.
//
// `server-only` import ensures accidental client-component import breaks
// the build, not just runtime — same guard pattern as next/headers.

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const FETCH_TIMEOUT_MS = 10_000;
const AUTH_COOKIE = 'ahn_session';

async function authedFetchJson<T>(path: string): Promise<T> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const headers = new Headers();
  if (token) headers.set('cookie', `${AUTH_COOKIE}=${token}`);

  const res = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers,
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

export function fetchKeywordsList(): Promise<KeywordListResponseDto> {
  return authedFetchJson<KeywordListResponseDto>('/keywords');
}

/** SP-15 PR-B: paginated hits for one monitor (newest hit first). */
export function fetchKeywordHits(
  id: string,
  limit = 50,
  offset = 0,
): Promise<KeywordHitsResponseDto> {
  return authedFetchJson<KeywordHitsResponseDto>(
    `/keywords/${encodeURIComponent(id)}/hits?limit=${limit}&offset=${offset}`,
  );
}
