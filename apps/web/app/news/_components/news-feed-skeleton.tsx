// SP-10 PR-C (2026-05-21): placeholder during infinite-scroll loadNext.
// Renders 4 ghost cards (2x2 grid on desktop, 1 col mobile) styled to match
// the real NewsItem glass-card shape — keeps layout from jumping when the
// next page resolves.
export function NewsFeedSkeleton() {
  return (
    <div className="mt-3.5 grid grid-cols-1 md:grid-cols-2 gap-3" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-line bg-white/40 p-5 animate-pulse"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="h-5 w-20 rounded-full bg-aurora-soft/60" />
            <div className="flex gap-1.5">
              <div className="h-5 w-12 rounded-full bg-line" />
              <div className="h-5 w-12 rounded-full bg-line" />
            </div>
          </div>
          <div className="h-4 w-11/12 rounded bg-line mb-2" />
          <div className="h-4 w-3/4 rounded bg-line mb-4" />
          <div className="h-3 w-full rounded bg-line/70 mb-1.5" />
          <div className="h-3 w-5/6 rounded bg-line/70 mb-3.5" />
          <div className="flex gap-1.5">
            <div className="h-4 w-16 rounded-full bg-line/60" />
            <div className="h-4 w-20 rounded-full bg-line/60" />
          </div>
        </div>
      ))}
    </div>
  );
}
