import { type NextRequest } from 'next/server';
import { proxyToApi } from '@/lib/proxy';

// SP-13 BFF: POST /api/auth/logout → upstream POST /auth/logout
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return proxyToApi(req, '/auth/logout');
}
