import type { HotNewsListItemDto } from '@ai-hot-news/types';
import { LocalTime } from './local-time';

const PLATFORM_LABEL: Record<string, string> = {
  RSS: 'RSS',
  HACKERNEWS: 'HN',
  REDDIT: 'Reddit',
  TWITTER: 'X',
};

/** Build the cross-platform badge label, e.g. "🔗 12 篇 · Reddit 10 / HN 2".
 *  Falls back to "🔗 N 篇" when only one platform contributed (this can happen
 *  when SP-7 grouped multiple posts from the same platform — most often Reddit
 *  cross-subreddit reposts). Returns null when there's nothing to render
 *  (singleton / size <= 1). */
function formatCrossPlatformBadge(
  groupSize: number,
  groupPlatforms: Partial<Record<string, number>>,
): string | null {
  if (groupSize <= 1) return null;
  const entries = Object.entries(groupPlatforms)
    .filter((kv): kv is [string, number] => typeof kv[1] === 'number' && kv[1] > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length <= 1) {
    return `🔗 ${groupSize} 篇相关报道`;
  }
  const breakdown = entries
    .map(([p, n]) => `${PLATFORM_LABEL[p] ?? p} ${n}`)
    .join(' / ');
  return `🔗 ${groupSize} 篇 · ${breakdown}`;
}

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
  const crossPlatformBadge = formatCrossPlatformBadge(item.groupSize, item.groupPlatforms);
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
        {crossPlatformBadge ? (
          <>
            <span>·</span>
            <span
              className="rounded bg-purple-50 px-1.5 py-0.5 text-[11px] font-medium text-purple-700"
              title="同一事件在多个来源被同时报道（基于 SP-7 跨平台聚类）"
            >
              {crossPlatformBadge}
            </span>
          </>
        ) : null}
      </div>
    </li>
  );
}
