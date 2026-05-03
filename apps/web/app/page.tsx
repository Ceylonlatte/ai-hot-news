import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold">AI Hot News</h1>
        <p className="mt-2 text-gray-600">SP-1 placeholder · v0.0.2</p>
        <p className="mt-1 text-xs text-gray-400">
          实际 UI 在 P4 / SP-8 起按 Aurora 设计稿落地
        </p>
        <Link href="/news" className="mt-4 inline-block text-blue-600 underline">
          → 查看热点列表
        </Link>
      </div>
    </main>
  );
}
