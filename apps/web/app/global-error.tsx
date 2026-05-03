'use client';

// App Router global error boundary. Without this Next.js 15.5 + standalone output
// falls back to a Pages-Router-style /_error which transitively imports <Html>
// from pages/_document and crashes the static generation step (issue
// vercel/next.js#83784, #77261).
//
// Aurora visual polish lands in SP-8 — keep this minimal but valid (must render
// its own <html>/<body> because it replaces the root layout when the root
// boundary fires).
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
          <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
            <h1 className="text-2xl font-bold">出错了</h1>
            <p className="mt-2 text-gray-600">应用遇到了一个意外错误</p>
            <button
              type="button"
              onClick={reset}
              className="mt-4 inline-block rounded border border-blue-600 px-3 py-1 text-blue-600 hover:bg-blue-50"
            >
              重试
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
