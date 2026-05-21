import Link from 'next/link';
import type { FeedSort } from '@/lib/api';
import { buildNewsUrl, type NewsFilterState } from './search-params';

const SORTS: Array<{ key: FeedSort; label: string }> = [
  { key: 'time', label: '最新' },
  { key: 'heat', label: '综合热度' },
];

// SP-10 (2026-05-21): sort segmented control — 暴露已存在的 ?sort=time|heat
// API 给用户。默认 time（spec §0 Q10 保持 URL 兼容），active=heat 时 URL 含 sort=heat。
export function SortTabs({
  active,
  state,
}: {
  active: FeedSort;
  state: Omit<NewsFilterState, 'sort'>;
}) {
  return (
    <div className="flex gap-1" role="tablist" aria-label="排序方式">
      {SORTS.map(({ key, label }) => {
        const isActive = key === active;
        return (
          <Link
            key={key}
            href={buildNewsUrl({ ...state, sort: key })}
            className={
              'px-2.5 py-1 rounded-md text-[12px] transition-all ' +
              (isActive
                ? 'bg-aurora-soft text-aurora font-semibold'
                : 'text-ink-3 hover:text-ink')
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
