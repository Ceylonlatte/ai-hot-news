import Link from 'next/link';

export function Pagination({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const prev = Math.max(1, page - 1);
  const next = Math.min(totalPages, page + 1);

  const baseClass = 'rounded border border-gray-300 px-3 py-1 text-sm';
  const disabledClass = 'pointer-events-none opacity-40';

  return (
    <div className="mt-6 flex items-center justify-center gap-3 text-sm text-gray-700">
      <Link
        href={`/news?page=${prev}`}
        className={`${baseClass} ${page <= 1 ? disabledClass : ''}`}
      >
        上一页
      </Link>
      <span>
        第 {page} / {totalPages} 页
      </span>
      <Link
        href={`/news?page=${next}`}
        className={`${baseClass} ${page >= totalPages ? disabledClass : ''}`}
      >
        下一页
      </Link>
    </div>
  );
}
