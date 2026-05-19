import { type NextRequest } from 'next/server';
import { proxyToApi } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return proxyToApi(req, '/stats/sources');
}
