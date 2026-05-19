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

  let res: Response;
  try {
    res = await fetch(upstream, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upstream fetch failed';
    return NextResponse.json(
      { error: 'Bad Gateway', detail: message },
      { status: 502 },
    );
  }

  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });
}
