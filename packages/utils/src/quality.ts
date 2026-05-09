export const FILTER_REASONS = {
  REDDIT_LOW_RATIO: 'reddit_low_ratio',
  REDDIT_LOW_ENGAGEMENT: 'reddit_low_engagement',
  HN_LOW_ENGAGEMENT: 'hn_low_engagement',
  TITLE_TOO_SHORT: 'title_too_short',
  // SP-6 (2026-05-09): replaces engagement-based filtering on Reddit.
  // See `checkRedditDomainSignal` below for rationale.
  REDDIT_LOW_SIGNAL_LINK: 'reddit_low_signal_link',
  REDDIT_TINY_SELFPOST: 'reddit_tiny_selfpost',
} as const;
export type FilterReason = (typeof FILTER_REASONS)[keyof typeof FILTER_REASONS];

// SP-6 (2026-05-09): SP-5 v3.3 raised these thresholds (5/2/0.5 → 10/5/0.7)
// to fight memes, but empirical analysis of 688 hot posts across 7 AI subs
// found engagement is *anti*-correlated with content value on Reddit —
// the highest-engagement posts (s=13103, s=8376, s=5870…) are pure memes
// hosted on i.redd.it / v.redd.it, while substantive items (paper releases,
// lab blogs, GitHub PRs) often have low score on first crawl. Engagement
// is now a noise-floor only; meaningful quality is governed by
// `checkRedditDomainSignal` (HIGH bypass / LOW reject).
const REDDIT_LOW_RATIO_THRESHOLD = 0.5;
const REDDIT_LOW_SCORE = 5;
const REDDIT_LOW_COMMENTS = 2;
const HN_LOW_SCORE = 20;
const HN_LOW_DESCENDANTS = 5;
// SP-5 v3.5 (2026-05-08): HN top-N pass-through. Posts ranked within HN's
// own /topstories.json top 20 are admitted regardless of raw score —
// HN's ranking algorithm already encodes community consensus, and a 60min
// crawler interval was missing posts that grew score from <20 to >=20
// inside the polling gap. Top 20 stays in place 4-12 hours, so a 60min
// poll catches them with high probability.
const HN_PASS_THROUGH_TOP_N = 20;
const TITLE_MIN_LENGTH = 5;

export interface RedditQualityInput {
  upvote_ratio: number | null;
  score: number;
  num_comments: number;
}

export interface HnQualityInput {
  score: number | null;
  descendants: number | null;
  /**
   * SP-5 v3.5: 1-based position in HN's /topstories.json (or ask/show
   * equivalents). When the post is within `HN_PASS_THROUGH_TOP_N` (top 20),
   * the engagement threshold is bypassed — HN's own ranking is treated as
   * authoritative. Optional for back-compat; legacy callers without the
   * field fall through to the score/descendants check.
   */
  position?: number | null;
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
  if (
    typeof item.position === 'number' &&
    item.position >= 1 &&
    item.position <= HN_PASS_THROUGH_TOP_N
  ) {
    return null;
  }
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

// SP-6 (2026-05-09): Reddit content-value classification by out-bound link.
//
// Empirical foundation (data: 688 hot posts × 7 AI-native subreddits, 2026-05-09):
//   - 34% of hot posts link to LOW domains (i.redd.it / v.redd.it / imgur /
//     youtube / x.com / cross-post reddit.com) — these are essentially 100%
//     meme/screenshot/reaction-video. r/ChatGPT alone has 80/98 hot posts
//     in this bucket.
//   - 3.5% link to HIGH domains (arxiv, huggingface, github, lab blogs,
//     major press) — every sampled item was high-signal (paper/release/
//     announcement).
//   - The remaining ~60% (self-posts and uncurated outbound) fall through
//     to existing keyword + engagement gates.
//
// Domain catalogue is intentionally hand-curated (small, high-precision)
// rather than data-driven (which would let recency drift the list). Add new
// domains as they appear with substantive content — DO NOT add aggregator
// hubs (techcrunch sub-paths, news.ycombinator.com itself, etc.) which would
// create cycles.

const HIGH_VALUE_DOMAINS: ReadonlySet<string> = new Set([
  // Papers / preprints
  'arxiv.org',
  'openreview.net',
  'alphaxiv.org',
  'papers.cool',
  // Model & code hubs
  'huggingface.co',
  'hf.co',
  'github.com',
  'kaggle.com',
  'modelscope.cn',
  // First-party labs & companies
  'openai.com',
  'anthropic.com',
  'deepmind.google',
  'deepmind.com',
  'research.google',
  'ai.googleblog.com',
  'blog.google',
  'ai.meta.com',
  'research.ibm.com',
  'microsoft.com',
  'azure.microsoft.com',
  'deepseek.com',
  'mistral.ai',
  'x.ai',
  'qwenlm.github.io',
  // Tech press (substantive AI/tech reporting only)
  'nytimes.com',
  'wsj.com',
  'theverge.com',
  'arstechnica.com',
  'wired.com',
  'cnbc.com',
  'bloomberg.com',
  'reuters.com',
  'ft.com',
  'theinformation.com',
  // Benchmarks / leaderboards
  'lmarena.ai',
  'livebench.ai',
  'swebench.com',
  'artificialanalysis.ai',
]);

// LOW domains: meme/screenshot/short-video/cross-post hosts. Match exactly
// or as a parent suffix.
const LOW_VALUE_DOMAINS: ReadonlySet<string> = new Set([
  'redd.it',
  'i.redd.it',
  'v.redd.it',
  'preview.redd.it',
  'imgur.com',
  'i.imgur.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'reddit.com', // self-cross-posts back into reddit (not the API host itself)
]);

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function matchesDomain(host: string, registry: ReadonlySet<string>): boolean {
  if (registry.has(host)) return true;
  for (const d of registry) {
    if (host.endsWith('.' + d)) return true;
  }
  return false;
}

export function checkRedditDomainSignal(
  externalUrl: string | null,
): 'high' | 'low' | null {
  if (!externalUrl) return null;
  const host = hostOf(externalUrl);
  if (!host) return null;
  if (matchesDomain(host, HIGH_VALUE_DOMAINS)) return 'high';
  if (matchesDomain(host, LOW_VALUE_DOMAINS)) return 'low';
  return null;
}
