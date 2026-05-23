import { type NextRequest } from 'next/server';
import { proxyToApi } from '@/lib/proxy';

// SP-13 BFF: POST /api/auth/login → upstream POST /auth/login
// proxyToApi forwards method/body/cookies + relays Set-Cookie back.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return proxyToApi(req, '/auth/login');
}
