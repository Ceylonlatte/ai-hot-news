import { type NextRequest } from 'next/server';
import { proxyToApi } from '@/lib/proxy';

// SP-15 PR-B BFF: GET /api/keywords/:id/hits?limit&offset
// proxyToApi auto-appends req.nextUrl.searchParams to the apiPath — we
// MUST NOT also append `req.nextUrl.search` here or the upstream sees
// `?limit=3?limit=3` and NestJS @Query parses "3?limit=3" → NaN.
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToApi(req, `/keywords/${encodeURIComponent(id)}/hits`);
}
