import { Glass } from '@ai-hot-news/ui';

export function EmptyState() {
  return (
    <Glass variant="soft">
      <div className="px-6 py-12 text-center">
        <div className="text-base text-ink-2 mb-2">还没有数据</div>
        <p className="text-xs text-ink-3">
          worker 正在抓取，稍后刷新看看
        </p>
      </div>
    </Glass>
  );
}
