import type { HotNewsListItemDto } from '@ai-hot-news/types';
import { Glass, HeatBadge, Pill, Tag } from '@ai-hot-news/ui';
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

/** SP-7-E (2026-05-16): build the "byline" prefix shown before the
 *  platform badge. For Reddit rows we surface `r/<sub>` instead of the
 *  Reddit username — the user is browsing by sub value, not by user.
 *  HN / RSS / X behavior is unchanged. */
function formatByline(
  platform: string,
  author: string | null,
  subreddit: string | null,
): string {
  if (platform === 'REDDIT' && subreddit) return `r/${subreddit}`;
  return author ?? '匿名';
}

export function NewsItem({ item }: { item: HotNewsListItemDto }) {
  const displayTitle = item.titleZh ?? item.title;
  const tooltip = item.titleZh && item.titleZh !== item.title ? item.title : undefined;
  const crossPlatformBadge = formatCrossPlatformBadge(item.groupSize, item.groupPlatforms);
  const hasMembers = item.groupMembers.length > 0;
  const byline = formatByline(item.sourcePlatform, item.author, item.subreddit);

  return (
    <Glass variant="hover" as="article">
      <div className="p-5 flex gap-4">
        <div className="flex-shrink-0 pt-0.5">
          <HeatBadge score={item.heatScore} level={item.heatLevel} />
        </div>
        <div className="flex-1 min-w-0">
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={tooltip}
            className="block text-base font-medium text-ink hover:text-aurora transition-colors"
          >
            {displayTitle}
          </a>
          {item.summary ? (
            <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink-2 line-clamp-2">
              {item.summary}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            <span
              className={
                item.sourcePlatform === 'REDDIT' && item.subreddit
                  ? 'font-medium text-aurora'
                  : ''
              }
              title={
                item.sourcePlatform === 'REDDIT' && item.author
                  ? `posted by ${item.author}`
                  : undefined
              }
            >
              {byline}
            </span>
            <span>·</span>
            <Pill platform={item.sourcePlatform} />
            <span>·</span>
            <LocalTime iso={item.publishedAt} />
            {crossPlatformBadge ? (
              <>
                <span>·</span>
                <span
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-aurora-soft text-aurora"
                  title="同一事件在多个来源被同时报道（基于 SP-7 跨平台聚类）"
                >
                  {crossPlatformBadge}
                </span>
              </>
            ) : null}
          </div>
          {item.aiTags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.aiTags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          ) : null}
          {hasMembers ? (
            <details className="mt-3 group">
              <summary className="cursor-pointer text-xs text-aurora hover:opacity-80 select-none list-none flex items-center gap-1">
                <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                <span>查看同组其它 {item.groupMembers.length} 篇</span>
              </summary>
              <ul className="mt-2 ml-4 space-y-2 border-l border-aurora-soft pl-3">
                {item.groupMembers.map((m) => {
                  const mTitle = m.titleZh ?? m.title;
                  const mTooltip = m.titleZh && m.titleZh !== m.title ? m.title : undefined;
                  const mByline = formatByline(m.sourcePlatform, m.author, m.subreddit);
                  return (
                    <li key={m.id} className="text-xs">
                      <a
                        href={m.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={mTooltip}
                        className="text-ink-2 hover:text-aurora transition-colors"
                      >
                        {mTitle}
                      </a>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-3">
                        <span
                          className={
                            m.sourcePlatform === 'REDDIT' && m.subreddit
                              ? 'font-medium text-aurora'
                              : ''
                          }
                          title={
                            m.sourcePlatform === 'REDDIT' && m.author
                              ? `posted by ${m.author}`
                              : undefined
                          }
                        >
                          {mByline}
                        </span>
                        <span>·</span>
                        <Pill platform={m.sourcePlatform} />
                        <span>·</span>
                        <LocalTime iso={m.publishedAt} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </Glass>
  );
}
