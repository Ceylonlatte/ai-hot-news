import { type NextRequest } from 'next/server';
import { proxyToApi } from '@/lib/proxy';

// SP-14 BFF: /keywords list + create.
// proxyToApi handles Cookie + Set-Cookie forwarding for JWT auth.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return proxyToApi(req, '/keywords');
}

export async function POST(req: NextRequest) {
  return proxyToApi(req, '/keywords');
}
