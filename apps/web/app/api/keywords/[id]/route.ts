import { type NextRequest } from 'next/server';
import { proxyToApi } from '@/lib/proxy';

// SP-14 BFF: /keywords/:id get + patch + delete.
// Next 15: params is a Promise — await before reading id.
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToApi(req, `/keywords/${encodeURIComponent(id)}`);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToApi(req, `/keywords/${encodeURIComponent(id)}`);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToApi(req, `/keywords/${encodeURIComponent(id)}`);
}
