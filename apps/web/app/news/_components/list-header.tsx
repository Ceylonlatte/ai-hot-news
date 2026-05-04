import { LocalTime } from './local-time';

export function ListHeader({
  total,
  latestCrawledAt,
}: {
  total: number;
  latestCrawledAt: string | undefined;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
      共 <span className="font-semibold">{total}</span> 条 · 最近抓取于{' '}
      {latestCrawledAt ? <LocalTime iso={latestCrawledAt} /> : '尚无数据'}
    </div>
  );
}
