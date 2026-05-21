import Link from 'next/link';
import { buildNewsUrl, type FeedRange, type NewsFilterState } from './search-params';

const RANGES: Array<{ key: FeedRange; label: string }> = [
  { key: '1d', label: '今天' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
];

// SP-10 (2026-05-21): time-window segmented control. URL 是 single source of
// truth (spec §0 Q15) — 每个 chip 是个 prefetch <Link>，点击触发 Next 15 client
// navigation 重新 SSR /news page。与 RangeTabs 并存的其它 filter dim（tab/sort/tags）
// 必须保留在 URL 上不丢，因此每个 href 都用 buildNewsUrl 重组完整状态。
export function RangeTabs({
  active,
  state,
}: {
  active: FeedRange;
  state: Omit<NewsFilterState, 'range'>;
}) {
  return (
    <div className="flex gap-1.5" role="tablist" aria-label="时间范围">
      {RANGES.map(({ key, label }) => {
        const isActive = key === active;
        return (
          <Link
            key={key}
            href={buildNewsUrl({ ...state, range: key })}
            className={
              'px-3 py-1 rounded-full text-[12px] transition-all ' +
              (isActive
                ? 'text-white font-semibold shadow-sm'
                : 'text-ink-2 hover:text-ink bg-white/55 border border-white/70')
            }
            style={
              isActive
                ? { background: 'var(--grad)', boxShadow: '0 2px 8px rgba(126,87,245,0.3)' }
                : undefined
            }
            aria-current={isActive ? 'page' : undefined}
            role="tab"
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
