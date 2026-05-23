import { NextResponse, type NextRequest } from 'next/server';

// SP-9 / SP-11 BFF fix (2026-05-19): cloudflared tunnel ingresses
// `${DOMAIN}/*` into the Next.js web container only, so any external
// caller hitting `/api/*` MUST be served by a Route Handler in this
// package. The SSR fetchers in `lib/api.ts` go straight to
// `API_URL=http://api:3001` over the Docker internal network and never
// touch these handlers — but `curl` from outside, future client
// components, and the deploy smoke step all hit Next.js first and need
// these proxies to round-trip the JSON.
//
// Keep the proxies thin (no logging, no auth, no body transformation):
// status, content-type, and body are forwarded verbatim from upstream.
// SSR layer already handles error UX; the BFF is just a transport.

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Forward an incoming Next.js request to the NestJS API and return its
 * response verbatim (status + body + content-type), with `cache: 'no-store'`
 * and a 10s timeout. Query string from `req` is preserved automatically.
 *
 * @param req     incoming NextRequest (used only for the query string)
 * @param apiPath upstream path beginning with '/' (e.g. '/stats/today',
 *                '/hot-news/abc123/heat-history')
 */
export async function proxyToApi(
  req: NextRequest,
  apiPath: string,
): Promise<NextResponse> {
  const qs = req.nextUrl.searchParams.toString();
  const upstream = `${API_URL}${apiPath}${qs ? `?${qs}` : ''}`;

  // SP-13 (2026-05-23): forward incoming Cookie header upstream so
  // /api/auth/me and other guarded endpoints can read the JWT cookie.
  // No filtering — cookie-parser on the API side only consumes ahn_session,
  // any unknown cookie is ignored.
  const forwardCookies = req.headers.get('cookie');
  const forwardMethod = req.method.toUpperCase();
  const init: RequestInit = {
    method: forwardMethod,
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: forwardCookies ? { cookie: forwardCookies } : undefined,
  };
  // SP-13: forward body for POST/PUT/PATCH/DELETE (login / logout / future
  // keyword CRUD). GET / HEAD skip body.
  if (!['GET', 'HEAD'].includes(forwardMethod)) {
    const body = await req.text();
    if (body) {
      init.body = body;
      const contentType = req.headers.get('content-type');
      init.headers = {
        ...(init.headers as Record<string, string> | undefined),
        ...(contentType ? { 'content-type': contentType } : {}),
      };
    }
  }

  let res: Response;
  try {
    res = await fetch(upstream, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upstream fetch failed';
    return NextResponse.json(
      { error: 'Bad Gateway', detail: message },
      { status: 502 },
    );
  }

  const body = await res.text();
  // SP-13: forward Set-Cookie from upstream so /api/auth/login's session
  // cookie reaches the browser. Without this the cookie would terminate
  // at the Next.js BFF.
  const headers: Record<string, string> = {
    'content-type': res.headers.get('content-type') ?? 'application/json',
    'cache-control': 'no-store',
  };
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    headers['set-cookie'] = setCookie;
  }
  return new NextResponse(body, {
    status: res.status,
    headers,
  });
}
