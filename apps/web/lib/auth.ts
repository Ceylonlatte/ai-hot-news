import { cookies, headers } from 'next/headers';

// SP-13 (2026-05-23): server-side auth helpers for RSC.
//
// `getCurrentUser()` reads ahn_session cookie + calls upstream /auth/me
// to validate. Returns the user payload on success, null on 401 (logged
// out / expired). Designed for RSC use — pages/layouts call this to
// gate UI (e.g. "已登录: admin" badge in sidebar).
//
// Why call upstream rather than just decode the JWT here: the API is the
// only authority on the secret. Decoding locally would require sharing
// JWT_SECRET into the Web container, expanding the secret blast radius
// for no real perf win (the call is over docker internal network, ~1ms).

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const COOKIE_NAME = 'ahn_session';

export interface CurrentUser {
  username: string;
  role: 'ADMIN';
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  // Forward the JWT to the API as a Cookie header. Use a raw fetch
  // (not the SSR fetchJson helper) because we expect 401 on missing /
  // invalid tokens and want to handle that quietly, not throw.
  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    const body = (await res.json()) as { user: CurrentUser };
    return body.user;
  } catch {
    // Network / timeout / parse error — treat as logged out (fail-safe).
    return null;
  }
}

/** RSC helper: read current path from middleware-set header (same trick
 *  as layout.tsx) — useful for "next=<path>" redirects in /login flow. */
export async function getRequestPath(): Promise<string> {
  const h = await headers();
  return h.get('x-pathname') ?? '/';
}
