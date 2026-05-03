import Link from 'next/link';

// Custom not-found page (App Router). Without this Next.js falls back to
// generating a Pages-Router-era /_error which imports <Html> and fails the
// `next build` static generation step (see issue thread under Next 15.5.x).
// Keeping the markup minimal — Aurora visual polish lands in SP-8 anyway.
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">页面未找到</h1>
        <p className="mt-2 text-gray-600">请检查链接是否正确</p>
        <Link href="/" className="mt-4 inline-block text-blue-600 underline">
          ← 返回首页
        </Link>
      </div>
    </main>
  );
}
