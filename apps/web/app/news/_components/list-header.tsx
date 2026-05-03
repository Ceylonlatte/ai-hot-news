const TIME_FMT = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'short',
  timeStyle: 'short',
});

export function ListHeader({
  total,
  latestCrawledAt,
}: {
  total: number;
  latestCrawledAt: string | undefined;
}) {
  const latest = latestCrawledAt ? TIME_FMT.format(new Date(latestCrawledAt)) : '尚无数据';
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
      共 <span className="font-semibold">{total}</span> 条 · 最近抓取于 {latest}
    </div>
  );
}
