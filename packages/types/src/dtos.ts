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
}

export interface HotNewsListResponseDto {
  items: HotNewsListItemDto[];
  page: number;
  pageSize: number;
  total: number;
}
