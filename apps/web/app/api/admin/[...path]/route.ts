import { type NextRequest } from 'next/server';
import { proxyToApi } from '@/lib/proxy';

// SP-19 PR-B BFF (2026-05-24): catch-all proxy for /api/admin/*.
// Forwards every GET request under /api/admin/<...> to the upstream
// NestJS /admin/<...> endpoint. JwtAuthGuard + role-check happens
// upstream; BFF stays a thin transport.
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const upstreamPath = '/admin/' + path.map(encodeURIComponent).join('/');
  return proxyToApi(req, upstreamPath);
}
