import { Glass } from '@ai-hot-news/ui';
import { LocalTime } from './local-time';

export function ListHeader({
  total,
  latestCrawledAt,
}: {
  total: number;
  latestCrawledAt: string | undefined;
}) {
  return (
    <Glass variant="soft">
      <div className="px-4 py-3 text-sm text-ink-2">
        共 <span className="font-semibold text-ink">{total}</span> 条 · 最近抓取于{' '}
        {latestCrawledAt ? <LocalTime iso={latestCrawledAt} /> : '尚无数据'}
      </div>
    </Glass>
  );
}
