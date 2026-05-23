import { NextResponse, type NextRequest } from 'next/server';
import { proxyToApi } from '@/lib/proxy';

// SP-13 BFF: POST /api/auth/logout → upstream POST /auth/logout
// SP-15: when the request is a browser <form> POST (Accept: text/html),
// rewrite the JSON response into a 302 redirect to '/' so the sidebar
// logout button feels native. Set-Cookie headers from the upstream are
// preserved on the redirect response so the cookie gets cleared.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const apiRes = await proxyToApi(req, '/auth/logout');

  const acceptsHtml = (req.headers.get('accept') ?? '').includes('text/html');
  if (!acceptsHtml) return apiRes;

  // SP-15: must NOT use `new URL('/', req.url)` — when the Next.js server
  // runs inside docker behind cloudflared, `req.url` resolves to the
  // internal host (e.g. https://0.0.0.0:3000) which the user-agent can't
  // follow. Instead, build the absolute Location from the public Host
  // header (preserved by cloudflared). Fall back to '/' as a path-only
  // redirect — most browsers accept it, even though RFC 7231 §7.1.2 says
  // "absolute" is preferred.
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const homeUrl = host ? `${proto}://${host}/` : '/';
  const redirect = NextResponse.redirect(homeUrl, { status: 303 });
  // Preserve Set-Cookie (multiple values possible — `getSetCookie` is the
  // multi-value-safe accessor; fall back to single `get` for older runtimes).
  const setCookies =
    typeof apiRes.headers.getSetCookie === 'function'
      ? apiRes.headers.getSetCookie()
      : [apiRes.headers.get('set-cookie')].filter(
          (v): v is string => typeof v === 'string',
        );
  for (const cookie of setCookies) {
    redirect.headers.append('set-cookie', cookie);
  }
  return redirect;
}
