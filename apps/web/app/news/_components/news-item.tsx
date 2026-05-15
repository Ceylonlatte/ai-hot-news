import type { HotNewsListItemDto } from '@ai-hot-news/types';
import { LocalTime } from './local-time';

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
  const displayTitle = item.titleZh ?? item.title;
  const tooltip = item.titleZh && item.titleZh !== item.title ? item.title : undefined;
  return (
    <li className="py-3">
      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={tooltip}
        className="block text-base font-medium text-gray-900 hover:underline"
      >
        {displayTitle}
      </a>
      {item.summary ? (
        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-gray-600 line-clamp-2">
          {item.summary}
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
        <span>{item.author ?? '匿名'}</span>
        <span>·</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badgeCls}`}>
          {label}
        </span>
        <span>·</span>
        <LocalTime iso={item.publishedAt} />
        {item.groupSize > 1 ? (
          <>
            <span>·</span>
            <span
              className="rounded bg-purple-50 px-1.5 py-0.5 text-[11px] font-medium text-purple-700"
              title="同一事件被多个平台同时报道（基于 SP-7 跨平台聚类）"
            >
              🔗 {item.groupSize} 个平台报道
            </span>
          </>
        ) : null}
      </div>
    </li>
  );
}
