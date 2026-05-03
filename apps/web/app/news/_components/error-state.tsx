export function ErrorState({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        暂时无法加载内容，请稍后再试。
        <pre className="mt-2 whitespace-pre-wrap text-xs text-red-500">{message}</pre>
      </div>
    </main>
  );
}
