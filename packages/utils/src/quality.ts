export const FILTER_REASONS = {
  REDDIT_LOW_RATIO: 'reddit_low_ratio',
  REDDIT_LOW_ENGAGEMENT: 'reddit_low_engagement',
  HN_LOW_ENGAGEMENT: 'hn_low_engagement',
  TITLE_TOO_SHORT: 'title_too_short',
} as const;
export type FilterReason = (typeof FILTER_REASONS)[keyof typeof FILTER_REASONS];

const REDDIT_LOW_RATIO_THRESHOLD = 0.5;
const REDDIT_LOW_SCORE = 5;
const REDDIT_LOW_COMMENTS = 2;
const HN_LOW_SCORE = 5;
const HN_LOW_DESCENDANTS = 2;
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
