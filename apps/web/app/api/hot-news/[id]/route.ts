import { type NextRequest } from 'next/server';
import { proxyToApi } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

// SP-11 BFF fix (2026-05-19): `/api/hot-news/:id` was missing — only the
// list route existed. SSR detail page rendered fine via internal API_URL,
// but external curl / future client components got Next.js 404.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToApi(req, `/hot-news/${encodeURIComponent(id)}`);
}
