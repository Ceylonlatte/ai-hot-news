import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'web',
    version: '0.0.1',
    uptime: process.uptime(),
  });
}
