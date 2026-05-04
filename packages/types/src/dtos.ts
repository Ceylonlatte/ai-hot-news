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
   * - HN-specific: `hnId`
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
   *   `reddit_low_ratio` | `reddit_low_engagement` | `hn_low_engagement` | `title_too_short`
   */
  filterReason?: string | null;
}

export interface HotNewsListItemDto {
  id: string;
  title: string;
  sourceUrl: string;
  sourcePlatform: Platform;
  author: string | null;
  publishedAt: string;
  crawledAt: string;
}

export interface HotNewsListResponseDto {
  items: HotNewsListItemDto[];
  page: number;
  pageSize: number;
  total: number;
}
