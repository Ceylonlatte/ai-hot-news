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
   * SP-15 PR-B (2026-05-23): keywords the SP-16 detection worker matched
   * for this row. Renders as 紫色高亮 chip on NewsItem so users see
   * "this card hit your X monitor" while browsing /news /vault /keywords/[id].
   * Empty array when nothing matched (most rows pre-SP-16 / post-disable).
   */
  matchedKeywords: string[];
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
 * SP-9 (2026-05-19): 24h heat curve bucketed by hour for the "今日热度波形"
 * card. Always returns exactly 24 buckets, oldest first. `buckets[23]` is
 * the current (partial) hour — UI is expected to render its label as "现在"
 * rather than the literal time.
 *
 * Each bucket is `MAX(heatScore)` over VISIBLE non-RSS rows ingested in
 * that hour. Empty hour buckets return 0 (LEFT JOIN against
 * `generate_series(0,23)`). RSS is excluded per SP-6 §0 Q1/Q2 contract
 * (RSS does not participate in heat ranking).
 */
export interface HeatCurveDto {
  /** Length-24 array of MAX(heatScore) per hourly bucket, oldest first */
  buckets: number[];
  /** Length-24 array of "HH:00" labels matching buckets, oldest first (UTC) */
  hourLabels: string[];
  windowStart: string;
  windowEnd: string;
}

/**
 * SP-9 (2026-05-19): AI tag momentum ranking for the "增速最快" card.
 * Computed as `24h-vs-prior-24h` frequency delta over `aiTags`. The raw
 * tag is prefix-encoded (`company:openai` / `model:claude-4` / etc); the
 * `label` is the human-readable form derived by `stripTagLabel` from
 * `@ai-hot-news/utils`.
 *
 * `growthPct` semantics:
 *   - `prior === 0 && cur > 0` → `9999` (NEW sentinel; UI renders "NEW")
 *   - `prior > 0` → `round((cur - prior) / prior * 100)`
 *   - `prior > 0 && cur === prior` → `0`
 *   - `prior > 0 && cur < prior` → negative integer
 *
 * Returned sorted by `growthPct DESC`, then `count24h DESC` (tiebreaker),
 * then `tag ASC`. Caller controls slice via `?limit=N` (default 8, max 20).
 */
export interface TrendingKeywordsDto {
  items: Array<{
    /** Raw prefix-encoded tag from `aiTags` array (e.g. `company:openai`) */
    tag: string;
    /** Human-readable label derived from `tag` (e.g. `OpenAI`) */
    label: string;
    count24h: number;
    countPrior24h: number;
    /** See JSDoc above; `9999` is the NEW sentinel */
    growthPct: number;
  }>;
  windowStart: string;
  windowEnd: string;
}

/**
 * SP-14 (2026-05-23): keyword monitor CRUD.
 *
 * Single-user V1: all rows belong to the seeded admin user (usr-admin).
 * Multi-user follow-up swaps to per-request user lookup via JwtPayload.sub.
 *
 * monitorFrequency: see Prisma `MonitorFrequency` enum — PRD §5.3 四档。
 * triggerRules: SP-17 notification service reads this to decide whether
 * a keyword hit warrants a push. V1 shape pinned here so the worker side
 * (SP-16/17) can rely on it; future SP-X may extend.
 */
export type MonitorFrequency = 'M15' | 'M30' | 'H1' | 'D1';

export type NotifyChannel = 'site' | 'email' | 'feishu' | 'dingtalk' | 'telegram' | 'webhook';

export interface KeywordTriggerRules {
  /** Minimum number of hits within the monitor's frequency window to trigger. */
  minCount?: number;
  /** Only trigger when a hit's hot_news.heatScore is at least this. */
  minHeatScore?: number;
  /** Trigger when hit rate grows by at least this percent vs prior window. */
  growthRatePct?: number;
}

export interface KeywordMonitorDto {
  id: string;
  keyword: string;
  synonyms: string[];
  excludeWords: string[];
  /** Empty = all platforms. Otherwise valid Platform enum strings. */
  platforms: string[];
  monitorFrequency: MonitorFrequency;
  /** Null = trigger on any hit. */
  triggerRules: KeywordTriggerRules | null;
  notifyChannels: NotifyChannel[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  /** SP-15: total KeywordHit count for this monitor. Always present on
   *  list/get responses; recomputed on every read via Prisma _count. */
  hitCount: number;
  /** SP-16.5: ISO timestamp of last keyword-search feeder run. Null until
   *  cron picks the row up for the first time. UI shows "刚刚" / "5 分钟前"
   *  etc. so users see the monitor is alive. */
  lastSearchedAt: string | null;
}

export interface CreateKeywordDto {
  keyword: string;
  synonyms?: string[];
  excludeWords?: string[];
  platforms?: string[];
  monitorFrequency?: MonitorFrequency;
  triggerRules?: KeywordTriggerRules | null;
  notifyChannels?: NotifyChannel[];
  enabled?: boolean;
}

/** PATCH — all fields optional. `keyword` itself can be renamed (will
 *  re-check the UNIQUE(userId, keyword) constraint). */
export type UpdateKeywordDto = Partial<CreateKeywordDto>;

export interface KeywordListResponseDto {
  items: KeywordMonitorDto[];
  total: number;
}

/**
 * SP-15 PR-B (2026-05-23): GET /keywords/:id/hits payload.
 *
 * One row per KeywordHit, augmented with the joined HotNews fields needed
 * by NewsItem. We re-use HotNewsListItemDto so the UI's existing card
 * component renders unchanged — group/related fields are zero-stubbed
 * (singleton presentation) since this is a per-keyword view, not the
 * cross-platform feed.
 *
 * `hitAt` is the moment SP-16 wrote the KeywordHit row; usually within
 * a few seconds of `crawledAt` for search-feeder-sourced rows, or hours
 * later for backstop-detected ones. Renders as "命中于" badge on the card.
 */
export interface KeywordHitItemDto extends HotNewsListItemDto {
  /** UTC ISO timestamp when SP-16 detection wrote the KeywordHit row. */
  hitAt: string;
}

export interface KeywordHitsResponseDto {
  /** The monitor metadata so the page header doesn't need a second request. */
  monitor: KeywordMonitorDto;
  items: KeywordHitItemDto[];
  /** Total hit count (matches `monitor.hitCount`; duplicated here for
   *  pagination clients that don't preload the monitor list). */
  total: number;
  /** Pagination echo. */
  limit: number;
  offset: number;
}

/**
 * SP-12 (2026-05-22): top-N aiTag frequency over a configurable window,
 * filtered to controlled namespaces (company / model / category — NOT
 * tech, which is LLM free-form and long-tail noisy). Consumed by:
 *  - /vault tag cloud (search page entry)
 *  - future SP-15 keyword monitor "建议关键词" picker
 */
export interface TopTagDto {
  /** Raw prefix-encoded tag (e.g. `category:OpenSource`, `company:Anthropic`) */
  tag: string;
  /** Number of rows containing this tag in the requested window */
  count: number;
}

export interface TopTagsDto {
  tags: TopTagDto[];
  /** Window size in days (clamped server-side to 1-90) */
  days: number;
  /** How many tags were requested (clamped server-side to 1-50) */
  limit: number;
  windowStart: string;
  windowEnd: string;
}

/**
 * SP-11 (2026-05-19): Slim sibling row attached to `HotNewsDetailDto.relatedItems`.
 *
 * Populated either from the same `groupId` (SP-7 cross-platform merge) or, when
 * the row is a singleton (groupId === null), from any `aiTags` overlap. Five at
 * most, sorted by `heatScore DESC`. Excludes the detail page's own id.
 *
 * Fields are intentionally narrower than `HotNewsListItemDto` — the side
 * column on the detail page only needs title + platform + heat + timestamp.
 * Drop `aiTags`, `summary`, etc. to keep payload small.
 */
export interface HotNewsRelatedDto {
  id: string;
  title: string;
  titleZh: string | null;
  sourcePlatform: Platform;
  heatScore: number | null;
  heatLevel: 'BURST' | 'HOT' | 'NORMAL' | 'LOW' | null;
  publishedAt: string;
}

/**
 * SP-11 (2026-05-19): Detail-page payload for `GET /hot-news/:id`.
 *
 * Differs from `HotNewsListItemDto` in three ways:
 *   1. Includes `content` (full extracted body) and `crawledAt` / `extractStatus`
 *      for the operator-visible footer.
 *   2. Includes `matchedKeywords` (SP-14 user monitor surface; currently
 *      empty array until KeywordMonitor lands but DTO is forward-compat).
 *   3. Attaches `relatedItems[]` (≤5; see HotNewsRelatedDto JSDoc for
 *      selection rules).
 *
 * Drops list-shaped aggregations (`groupSize` / `groupPlatforms` /
 * `groupMembers` / `subreddit`) — the detail page surfaces grouping via
 * `relatedItems[]` instead.
 */
export interface HotNewsDetailDto {
  id: string;
  title: string;
  titleZh: string | null;
  summary: string | null;
  /** Full extracted body (SP-4 article extractor output). May be empty for newly-ingested rows. */
  content: string;
  sourcePlatform: Platform;
  sourceUrl: string;
  author: string | null;
  publishedAt: string;
  crawledAt: string;
  aiTags: string[];
  /** SP-14: monitor-keyword hits. Currently always empty; DTO stable for forward-compat. */
  matchedKeywords: string[];
  heatScore: number | null;
  heatLevel: 'BURST' | 'HOT' | 'NORMAL' | 'LOW' | null;
  groupId: string | null;
  /** SP-4-7 extract status (PENDING / OK / FAILED / etc); null for legacy rows. */
  extractStatus: string | null;
  relatedItems: HotNewsRelatedDto[];
}

/**
 * SP-11 (2026-05-19): One snapshot row from `heat_history`. `bucketAt` is
 * 30-min UTC-aligned (`:00` or `:30`); see worker `computeBucketAt`. The
 * sequence is monotonically increasing in `bucketAt`.
 */
export interface HeatHistoryItemDto {
  /** ISO timestamp, 30-min aligned UTC */
  bucketAt: string;
  heatScore: number;
  heatLevel: 'BURST' | 'HOT' | 'NORMAL' | 'LOW';
}

/**
 * SP-11 (2026-05-19): Time-series payload for `GET /hot-news/:id/heat-history`.
 *
 * `items` covers the last `hours` worth of 30-min buckets the cron has written
 * for this row, ordered ascending by `bucketAt`. May be empty (no cron tick yet
 * after ingestion) and may be shorter than `hours * 2` (row newer than `hours`
 * ago, or missing ticks due to deploy / crash).
 *
 * `hours` is restricted server-side to one of `24 | 48 | 72`; out-of-range
 * input falls back to `48` (`Pipe` semantics — caller cannot trigger 400).
 */
export interface HeatHistoryDto {
  items: HeatHistoryItemDto[];
  windowStart: string;
  windowEnd: string;
  hours: 24 | 48 | 72;
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
