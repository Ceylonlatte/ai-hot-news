import type { HotNewsListItemDto } from '@ai-hot-news/types';

const TIME_FMT = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const PLATFORM_LABEL: Record<string, string> = {
  RSS: 'RSS',
  HACKERNEWS: 'HN',
  REDDIT: 'Reddit',
  TWITTER: 'X',
};

const PLATFORM_BADGE_CLASS: Record<string, string> = {
  RSS:        'bg-blue-50 text-blue-700',
  HACKERNEWS: 'bg-orange-50 text-orange-700',
  REDDIT:     'bg-red-50 text-red-700',
  TWITTER:    'bg-gray-100 text-gray-700',
};

export function NewsItem({ item }: { item: HotNewsListItemDto }) {
  const label = PLATFORM_LABEL[item.sourcePlatform] ?? item.sourcePlatform;
  const badgeCls = PLATFORM_BADGE_CLASS[item.sourcePlatform] ?? 'bg-gray-100 text-gray-700';
  return (
    <li className="py-3">
      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-base font-medium text-gray-900 hover:underline"
      >
        {item.title}
      </a>
      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
        <span>{item.author ?? '匿名'}</span>
        <span>·</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badgeCls}`}>
          {label}
        </span>
        <span>·</span>
        <span>{TIME_FMT.format(new Date(item.publishedAt))}</span>
      </div>
    </li>
  );
}
