export const FILTER_REASONS = {
  REDDIT_LOW_RATIO: 'reddit_low_ratio',
  REDDIT_LOW_ENGAGEMENT: 'reddit_low_engagement',
  HN_LOW_ENGAGEMENT: 'hn_low_engagement',
  TITLE_TOO_SHORT: 'title_too_short',
} as const;
export type FilterReason = (typeof FILTER_REASONS)[keyof typeof FILTER_REASONS];

// SP-5 v3.3 (2026-05-07): bumped Reddit thresholds to filter:
//   - "伸手党/求助帖" (score=1, comments=2, ratio=1.00) — passed ratio<0.5 and
//     engagement (comments>=2). Now: needs score>=10 OR comments>=5.
//   - "标题党/钓鱼帖" (e.g. score=0, comments=151, ratio=0.50) — passed strict
//     ratio<0.5. Now: ratio<0.7 dropped (high comments + 50/50 split is noise).
// Previous thresholds (SP-3 baseline): ratio=0.5, score=5, comments=2.
const REDDIT_LOW_RATIO_THRESHOLD = 0.7;
const REDDIT_LOW_SCORE = 10;
const REDDIT_LOW_COMMENTS = 5;
const HN_LOW_SCORE = 20;
const HN_LOW_DESCENDANTS = 5;
const TITLE_MIN_LENGTH = 5;

export interface RedditQualityInput {
  upvote_ratio: number | null;
  score: number;
  num_comments: number;
}

export interface HnQualityInput {
  score: number | null;
  descendants: number | null;
}

export interface UniversalQualityInput {
  title: string;
}

export function checkRedditQuality(post: RedditQualityInput): FilterReason | null {
  // upvote_ratio is null for cold posts (<3 votes); skip the ratio rule in that case.
  if (typeof post.upvote_ratio === 'number' && post.upvote_ratio < REDDIT_LOW_RATIO_THRESHOLD) {
    return FILTER_REASONS.REDDIT_LOW_RATIO;
  }
  if (post.score < REDDIT_LOW_SCORE && post.num_comments < REDDIT_LOW_COMMENTS) {
    return FILTER_REASONS.REDDIT_LOW_ENGAGEMENT;
  }
  return null;
}

export function checkHnQuality(item: HnQualityInput): FilterReason | null {
  const score = item.score ?? 0;
  const descendants = item.descendants ?? 0;
  if (score < HN_LOW_SCORE && descendants < HN_LOW_DESCENDANTS) {
    return FILTER_REASONS.HN_LOW_ENGAGEMENT;
  }
  return null;
}

export function checkUniversalQuality(item: UniversalQualityInput): FilterReason | null {
  const t = (item.title ?? '').trim();
  if (t.length < TITLE_MIN_LENGTH) {
    return FILTER_REASONS.TITLE_TOO_SHORT;
  }
  return null;
}
