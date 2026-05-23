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
 *  Falls back to "🔗 N 篇" when only one platform contributed. */
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

function formatByline(
  platform: string,
  author: string | null,
  subreddit: string | null,
): string {
  if (platform === 'REDDIT' && subreddit) return `r/${subreddit}`;
  return author ?? '匿名';
}

/** 同组归并出去重后的平台列表（包含 leader 自己）。
 *  设计稿 header 行展示 "Twitter HackerNews Reddit" 多个平台 Pill，对真数据用 groupPlatforms 还原。 */
function collectPlatforms(item: HotNewsListItemDto): Array<'HACKERNEWS' | 'REDDIT' | 'RSS' | 'TWITTER'> {
  const out = new Set<string>([item.sourcePlatform]);
  for (const k of Object.keys(item.groupPlatforms)) out.add(k);
  // 保持设计稿顺序：X (TWITTER) → HN → REDDIT → RSS
  const order: ReadonlyArray<'TWITTER' | 'HACKERNEWS' | 'REDDIT' | 'RSS'> = [
    'TWITTER',
    'HACKERNEWS',
    'REDDIT',
    'RSS',
  ];
  return order.filter((p) => out.has(p));
}

export function NewsItem({ item }: { item: HotNewsListItemDto }) {
  const displayTitle = item.titleZh ?? item.title;
  const tooltip = item.titleZh && item.titleZh !== item.title ? item.title : undefined;
  const crossPlatformBadge = formatCrossPlatformBadge(item.groupSize, item.groupPlatforms);
  const hasMembers = item.groupMembers.length > 0;
  const byline = formatByline(item.sourcePlatform, item.author, item.subreddit);
  const platforms = collectPlatforms(item);

  return (
    <Glass variant="hover" as="article">
      <div className="px-5 py-5 md:px-6 md:py-5">
        {/* header 行：HeatBadge 胶囊 + 多平台 Pill */}
        <div className="flex justify-between items-center gap-3 mb-3.5">
          <div className="shrink-0">
            <HeatBadge score={item.heatScore} level={item.heatLevel} />
          </div>
          <div className="flex gap-1.5 flex-wrap justify-end min-w-0">
            {platforms.map((p) => (
              <Pill key={p} platform={p} />
            ))}
          </div>
        </div>

        {/* 标题 */}
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={tooltip}
          className="block text-base md:text-[15px] font-semibold leading-snug text-ink hover:text-aurora transition-colors mb-2"
        >
          {displayTitle}
        </a>

        {/* summary */}
        {item.summary ? (
          <p className="text-[13px] leading-relaxed text-ink-2 whitespace-pre-line line-clamp-3 mb-3.5">
            {item.summary}
          </p>
        ) : null}

        {/* tags（多色轮用 + 跨平台 badge + 命中关键词高亮）
            SP-10: aiTags 可点击 → /news?tags=<tag>
            SP-15 PR-B: matchedKeywords 渲染为紫色高亮 chip ("⌖ Claude") 让用户在 feed
            流里一眼看出"这条命中了我的 X 关键词"。chip 也可点击跳 /keywords，方便从
            feed 反查监控配置。
        */}
        {item.aiTags.length > 0 ||
        crossPlatformBadge ||
        item.matchedKeywords.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mb-3.5">
            {item.matchedKeywords.map((kw) => (
              <a
                key={`matched-${kw}`}
                href="/keywords"
                title={`命中你的监控关键词：${kw}`}
                className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
                style={{ background: 'var(--grad)' }}
                data-testid="matched-keyword-chip"
              >
                <span aria-hidden="true">⌖</span>
                {kw}
              </a>
            ))}
            {item.aiTags.map((tag, i) => (
              <Tag
                key={tag}
                index={i}
                href={`/news?tags=${encodeURIComponent(tag)}`}
                title={`筛选 ${tag}`}
              >
                {tag}
              </Tag>
            ))}
            {crossPlatformBadge ? (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-aurora-soft text-aurora border border-aurora/15"
                title="同一事件在多个来源被同时报道（基于 SP-7 跨平台聚类）"
              >
                {crossPlatformBadge}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* footer：byline + 时间 */}
        <div className="flex justify-between items-center pt-3 border-t border-line text-[11px] text-ink-3">
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
          <LocalTime iso={item.publishedAt} />
        </div>

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
    </Glass>
  );
}
