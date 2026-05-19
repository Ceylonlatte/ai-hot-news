import type { Platform } from './enums.js';

export interface RawCrawledItem {
  title: string;
  contentText: string;
  rawHtml: string | null;
  sourceUrl: string;
  author: string | null;
  publishedAt: Date | null;
  /**
   * Platform-specific interaction data (likes, comments, score, external URL, etc.).
   * Forwarded by IngestionService into `HotNews.interactionData` (Json column).
   *
   * Cross-platform field name conventions (see SP-2 spec §4.2):
   * - Common (any platform): `score`, `comments`, `externalUrl`
   * - HN-specific: `hnId`, `hnPosition` (1-based rank in topstories.json, SP-5 v3.5)
   * - Reddit-specific (SP-3): `redditId`, `redditSubreddit`
   * - Twitter-specific (SP-22): `twTweetId`, `twReposts`
   *
   * Use `null` (not `undefined`) when a platform produces no interaction data; omit
   * when the crawler hasn't been updated to populate it.
   */
  interactionData?: Record<string, unknown> | null;
  /**
   * SP-4: Quality / boilerplate filter verdict. When set, IngestionService writes
   * `HotNews.status='HIDDEN'` and persists this string to `HotNews.filterReason`.
   *
   * Set by the platform-specific crawler in `toRaw()` via `checkRedditQuality` /
   * `checkHnQuality` from `@ai-hot-news/utils`. RSS crawler leaves it `undefined`
   * and IngestionService runs `checkUniversalQuality` as a fallback.
   *
   * Known values (extend `FILTER_REASONS` in `quality.ts` to add more):
   *   `reddit_low_ratio` | `reddit_low_engagement` | `reddit_low_signal_link` |
   *   `reddit_tiny_selfpost` | `hn_low_engagement` | `title_too_short`
   */
  filterReason?: string | null;
  /**
   * SP-5.5 (2026-05-09): Crawler-set positive content-value signal. When `true`,
   * IngestionService bypasses the `matchesAiTopic` keyword gate — the crawler
   * has already classified this item as substantive (e.g. Reddit link-post to
   * arxiv.org / huggingface.co / openai.com / major tech press).
   *
   * Set by `reddit.crawler.toRaw()` via `checkRedditDomainSignal`. Other
   * crawlers leave it `undefined` (treated as `false`).
   */
  trustedSource?: boolean;
}

export interface HotNewsListItemDto {
  id: string;
  title: string;
  /**
   * SP-5 v3.3: AI-translated Chinese title (10-30 chars). Null when the
   * worker has not yet processed the row, when LLM omitted the field, or for
   * pre-v3.3 rows. UI falls back to `title` when null.
   */
  titleZh: string | null;
  /**
   * SP-5: AI-generated Chinese summary. v3.4+ writes a single coherent
   * paragraph (50-80 chars typical). The LLM may occasionally elect to
   * use a single `\n` to split two genuinely independent dimensions (fact
   * vs counter-evidence); UI should keep `whitespace-pre-line` to render
   * that case. Null while the worker has not yet processed the row.
   */
  summary: string | null;
  /**
   * SP-5: 4-dimension prefix-encoded tags from controlled taxonomy
   * (`company:` / `model:` / `category:` / `tech:`). Empty array when the
   * worker has not yet processed the row, or when the LLM produced no
   * recognizable tags.
   */
  aiTags: string[];
  sourceUrl: string;
  sourcePlatform: Platform;
  author: string | null;
  publishedAt: string;
  crawledAt: string;
  /**
   * SP-6 (2026-05-09): Heat score 0-100 (V1 caps at 0-72.5; reaches 0-100
   * once SP-7's crossPlatformScore lands). Always 0 for RSS rows (excluded
   * from heat ranking; see HotNewsService heat-sort path). DTO type allows
   * null for forward-compat: if V2 schema makes the column nullable to
   * distinguish "uncomputed" vs "computed=0", DTO needn't change.
   */
  heatScore: number | null;
  /**
   * SP-6 (2026-05-09): Categorical heat tier from NTILE(20)→4-way bucket
   * over the 48h non-RSS VISIBLE window. BURST=top 5% / HOT=next 15% /
   * NORMAL=next 30% / LOW=bottom 50%. Recalculated globally on the
   * 30-min cron; single-row writes do NOT refresh heatLevel (see spec
   * §3.1 weak-consistency trade-off). Frontend uses for color coding
   * (Aurora SP-8 / Dashboard SP-9).
   */
  heatLevel: 'BURST' | 'HOT' | 'NORMAL' | 'LOW' | null;
  /**
   * SP-7 (2026-05-08): Cross-platform group identifier assigned by the
   * embed worker (`apps/worker/src/embed/group.service.ts`) when this
   * row's embedding has cosine ≥ 0.85 (or ≥ 0.78 with a `+0.07` tag
   * boost) against another row within the last 7d. Null for singletons
   * and for rows the worker hasn't processed yet. Form: `grp-<base36>`.
   */
  groupId: string | null;
  /**
   * SP-7: Total VISIBLE members in the same cross-platform group. `1` for
   * singleton rows (groupId === null) and for groups of size 1. Used by
   * `news-item.tsx` to render the `🔗 N 篇` count in the cross-platform
   * badge when > 1.
   */
  groupSize: number;
  /**
   * SP-7-C (2026-05-15): Per-platform breakdown of the group's VISIBLE
   * members, e.g. `{ REDDIT: 10, HACKERNEWS: 2 }` means 10 Reddit rows +
   * 2 HN rows in this group. Empty object `{}` for singletons.
   *
   * Sum of values always equals `groupSize` (both come from the same
   * `groupBy(['groupId', 'sourcePlatform'])` query so they cannot drift).
   *
   * Why needed: the original v3 badge displayed "🔗 N 个平台报道", but the
   * project only has 4 Platform enum values total (RSS/HN/Reddit/Twitter),
   * so "12 个平台" was misleading — it meant "12 articles". This field
   * lets the UI render the truthful "🔗 12 篇 · Reddit 10 / HN 2" form.
   */
  groupPlatforms: Partial<Record<Platform, number>>;
  /**
   * SP-7-D (2026-05-16): When `?groupMode=fold` (default), the API
   * collapses same-group rows into a single representative entry on
   * the list and ships every other VISIBLE member of the group in this
   * array, sorted ascending by `publishedAt` (oldest first — useful for
   * UI to show the originating story before the cross-platform echoes).
   *
   * Empty `[]` when:
   *   - row is a singleton (groupId === null), OR
   *   - `?groupMode=expand` is in effect, OR
   *   - the row IS the only member of its group on this page (size 1).
   *
   * Note: the representative row is NOT duplicated in this array; the
   * full group set on the UI is `[item, ...item.groupMembers]`.
   */
  groupMembers: GroupMemberDto[];
  /**
   * SP-7-E (2026-05-16): For `sourcePlatform === 'REDDIT'`, the
   * subreddit name (without the `r/` prefix). Surfaced as a separate
   * field rather than buried in `interactionData` so the list UI can
   * render it without parsing JSON every row.
   *
   * Why this exists: the user wants to spot which subreddit produced
   * the most valuable items at a glance, but the platform badge alone
   * just says "Reddit" — opaque across r/LocalLLaMA (technical depth)
   * vs r/agi (news aggregator) vs r/ClaudeAI (product-specific). The
   * UI uses this to render `r/<name>` in the author slot for Reddit
   * rows.
   *
   * `null` for any non-Reddit row, AND for legacy Reddit rows whose
   * crawler predates SP-3 (the `interactionData.redditSubreddit`
   * write-path). `null` is also the value during the brief
   * pre-summary window where ingestion has the row but the worker
   * has not yet refreshed `interactionData` — but since
   * `redditSubreddit` is set on initial INSERT (not after summary),
   * this case is effectively unreachable in practice.
   */
  subreddit: string | null;
}

/**
 * SP-7-D: Slim companion of `HotNewsListItemDto` shipped inside the
 * representative row's `groupMembers[]`. Carries just enough fields
 * for an inline `<details>` disclosure to render a clickable list of
 * sibling articles. Drops fields that the UI never needs at the
 * disclosure layer (heat / aiTags / crawledAt / etc.) to keep list
 * responses small.
 */
export interface GroupMemberDto {
  id: string;
  title: string;
  titleZh: string | null;
  sourceUrl: string;
  sourcePlatform: Platform;
  author: string | null;
  publishedAt: string;
  /**
   * SP-7-E (2026-05-16): Same semantics as
   * `HotNewsListItemDto.subreddit` — present so the disclosure UI can
   * render `r/<sub>` for each grouped Reddit member without fetching
   * the row separately. `null` for non-Reddit and legacy rows.
   */
  subreddit: string | null;
}

export interface HotNewsListResponseDto {
  items: HotNewsListItemDto[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * SP-9 (2026-05-19): "Today" 4-card stats for the Dashboard HomePage. All
 * counters cover the last 24 hours (NOW() - INTERVAL '24 hours' .. NOW()).
 *
 * - `aggregateCount`: total VISIBLE rows ingested in window
 * - `burstCount`: VISIBLE rows with `heatLevel='BURST'` in window
 * - `taggedCount`: VISIBLE rows where `array_length(aiTags) > 0` in window.
 *   **SP-14 contract**: when KeywordMonitor lands, this field will be
 *   reinterpreted as "user-monitored keyword hits"; DTO field name stays
 *   stable so the Web card requires zero re-render-side change.
 * - `sourceCount`: enabled SourceConfig rows that ingested at least one
 *   VISIBLE row in window. Defensive: "covered today" not just "configured".
 */
export interface StatsTodayDto {
  aggregateCount: number;
  burstCount: number;
  taggedCount: number;
  sourceCount: number;
  /** ISO timestamp of window start (24h before windowEnd) */
  windowStart: string;
  /** ISO timestamp of window end (now()) */
  windowEnd: string;
}

/**
 * SP-9 (2026-05-19): Per-platform breakdown for the "信源分布" card.
 *
 * `platforms[]` items are sorted by `count DESC`. Percentages sum to
 * exactly 100 via the hare-quota residual-to-last-bucket assignment
 * (see StatsService.getSources implementation); single-platform input
 * returns one row with `pct: 100`. Empty input returns `platforms: []`.
 *
 * RSS IS included here (coverage signal, not heat).
 */
export interface StatsSourcesDto {
  platforms: Array<{
    platform: 'TWITTER' | 'HACKERNEWS' | 'REDDIT' | 'RSS';
    count: number;
    /** 0-100 integer; sum across all entries === 100 (residual assigned to last bucket) */
    pct: number;
  }>;
  /** Total VISIBLE rows in 24h across all platforms (basis for pct) */
  total: number;
  windowStart: string;
  windowEnd: string;
}
