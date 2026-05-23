import { type NextRequest } from 'next/server';
import { proxyToApi } from '@/lib/proxy';

// SP-15 PR-B BFF: GET /api/keywords/:id/hits?limit&offset
// Forwards query string + cookie to upstream NestJS so JwtAuthGuard
// authenticates. Pagination params are passed through verbatim — the
// upstream controller does the clamp/validation.
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const qs = req.nextUrl.search;
  return proxyToApi(req, `/keywords/${encodeURIComponent(id)}/hits${qs}`);
}
