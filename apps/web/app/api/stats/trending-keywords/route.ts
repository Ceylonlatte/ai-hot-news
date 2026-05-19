import { type NextRequest } from 'next/server';
import { proxyToApi } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

// SP-9 BFF fix (2026-05-19): `?limit=N` is forwarded verbatim via the
// request query string; upstream NestJS clamps to 1..20.
export async function GET(req: NextRequest) {
  return proxyToApi(req, '/stats/trending-keywords');
}
