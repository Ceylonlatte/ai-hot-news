import { type NextRequest } from 'next/server';
import { proxyToApi } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

// SP-11 BFF fix (2026-05-19): pairs with /api/hot-news/[id]/route.ts.
// `?hours=24|48|72` is forwarded verbatim by proxyToApi via the request
// query string; upstream NestJS clamps invalid values to 48.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToApi(req, `/hot-news/${encodeURIComponent(id)}/heat-history`);
}
