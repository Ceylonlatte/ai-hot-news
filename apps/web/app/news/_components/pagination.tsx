import Link from 'next/link';
import type { FeedTab } from './feed-tabs';

export function Pagination({
  page,
  pageSize,
  total,
  tab,
}: {
  page: number;
  pageSize: number;
  total: number;
  tab: FeedTab;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);

  const baseClass =
    'rounded border border-line px-3 py-1 text-sm text-ink hover:text-aurora transition-colors';
  const disabledClass = 'pointer-events-none opacity-40';

  const link = (p: number) => ({ pathname: '/news' as const, query: { tab, page: p } });

  return (
    <div className="mt-6 flex items-center justify-center gap-3 text-sm text-ink-2">
      <Link href={link(prev)} className={`${baseClass} ${page <= 1 ? disabledClass : ''}`}>
        上一页
      </Link>
      <span>
        第 {page} / {totalPages} 页
      </span>
      <Link href={link(next)} className={`${baseClass} ${page >= totalPages ? disabledClass : ''}`}>
        下一页
      </Link>
    </div>
  );
}
