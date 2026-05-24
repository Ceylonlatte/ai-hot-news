import 'server-only';
import { cookies } from 'next/headers';
import type {
  AdminContentPoolDto,
  AdminDbSizeDto,
  AdminFeederDto,
  AdminHealthDto,
  AdminKeywordStatsDto,
  AdminLlmCostDto,
} from '@ai-hot-news/types';
import { ApiError } from './api';

// SP-19 PR-B (2026-05-24): RSC-only fetchers for /admin page.
//
// Server-side fetch with ahn_session cookie forwarded to upstream;
// caller MUST validate getCurrentUser() first and ensure role=ADMIN.
//
// `server-only` import ensures any accidental client-component import
// breaks the build, not just runtime — same guard pattern as next/headers.

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

export const fetchAdminHealth = (): Promise<AdminHealthDto> =>
  authedFetchJson('/admin/health');

export const fetchAdminContentPool = (): Promise<AdminContentPoolDto> =>
  authedFetchJson('/admin/content-pool');

export const fetchAdminFeeder = (): Promise<AdminFeederDto> =>
  authedFetchJson('/admin/feeder');

export const fetchAdminKeywordStats = (): Promise<AdminKeywordStatsDto> =>
  authedFetchJson('/admin/keyword-stats');

export const fetchAdminDbSize = (): Promise<AdminDbSizeDto> =>
  authedFetchJson('/admin/db-size');

export const fetchAdminLlmCost = (): Promise<AdminLlmCostDto> =>
  authedFetchJson('/admin/llm-cost');
