import { NextResponse, type NextRequest } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const FETCH_TIMEOUT_MS = 10_000;

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString();
  const upstream = `${API_URL}/hot-news${qs ? `?${qs}` : ''}`;

  let res: Response;
  try {
    res = await fetch(upstream, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upstream fetch failed';
    return NextResponse.json({ error: 'Bad Gateway', detail: message }, { status: 502 });
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
