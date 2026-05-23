import { type NextRequest } from 'next/server';
import { proxyToApi } from '@/lib/proxy';

// SP-13 BFF: GET /api/auth/me → upstream GET /auth/me
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return proxyToApi(req, '/auth/me');
}
