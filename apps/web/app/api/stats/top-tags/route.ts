import { type NextRequest } from 'next/server';
import { proxyToApi } from '@/lib/proxy';

// SP-12 (2026-05-22): BFF proxy for /stats/top-tags so external callers
// + future client components hitting the Next.js container can reach the
// NestJS /stats/top-tags endpoint.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return proxyToApi(req, '/stats/top-tags');
}
