import 'server-only';
import { cookies } from 'next/headers';
import type { KeywordListResponseDto } from '@ai-hot-news/types';
import { ApiError } from './api';

// SP-15 (2026-05-23): RSC-only keyword fetcher. Forwards ahn_session cookie
// to upstream so JwtAuthGuard authenticates the request. Caller MUST have
// already validated `getCurrentUser()` and redirected to /login on null;
// this helper does NOT swallow 401s — it throws ApiError(401) so the page
// can render an "Unauthorized" state if the user's token expired between
// the auth check and this fetch.
//
// `server-only` import ensures any accidental client-component import
// breaks the build, not just runtime — same pattern as next/headers.

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const FETCH_TIMEOUT_MS = 10_000;
const AUTH_COOKIE = 'ahn_session';

export async function fetchKeywordsList(): Promise<KeywordListResponseDto> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  const headers = new Headers();
  if (token) headers.set('cookie', `${AUTH_COOKIE}=${token}`);

  const res = await fetch(`${API_URL}/keywords`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(
      res.status,
      `API ${res.status} (/keywords): ${body || res.statusText}`,
    );
  }
  return (await res.json()) as KeywordListResponseDto;
}
