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

  const homeUrl = new URL('/', req.url);
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
