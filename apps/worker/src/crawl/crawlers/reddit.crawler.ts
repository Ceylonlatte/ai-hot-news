import {
  stripHtml,
  checkRedditQuality,
  checkRedditDomainSignal,
  FILTER_REASONS,
  type FilterReason,
} from '@ai-hot-news/utils';
import type { RawCrawledItem } from '@ai-hot-news/types';
import type { Crawler } from './crawler.interface';
import type { RedditListingResponse, RedditPost } from './reddit.types';

// SP-5.5 (2026-05-09): a self-post with effectively no body text is almost
// always a one-line vent / question / meme caption. Threshold tuned to
// drop "idk help" / "is this normal" / single-emoji posts while keeping
// bench reports / setup logs / discussions that wrote *anything*.
const TINY_SELFPOST_MIN_CHARS = 50;

const HOT_LIMIT = 25;

export interface RedditSource {
  id: string;
  url: string | null;
  identifier: string | null;
}

export class RedditCrawler implements Crawler {
  constructor(
    private readonly source: RedditSource,
    private readonly userAgent: string,
  ) {}

  async fetch(): Promise<RawCrawledItem[]> {
    const url = this.resolveUrl();
    const subredditHint = this.source.identifier;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(this.timeoutMs()),
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'application/json',
      },
    });

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after') ?? 'unknown';
      throw new Error(
        `Reddit rate-limited (429) for ${url}, Retry-After=${retryAfter}`,
      );
    }
    if (!res.ok) {
      throw new Error(`Reddit fetch ${res.status} ${res.statusText} for ${url}`);
    }

    const data = (await res.json()) as RedditListingResponse;
    if (data?.kind !== 'Listing' || !Array.isArray(data?.data?.children)) {
      throw new Error(
        `Reddit ${url} response not a Listing: ${JSON.stringify(data).slice(0, 100)}`,
      );
    }

    return data.data.children
      .map((c) => c.data)
      .filter(this.isValidPost)
      .map((p) => this.toRaw(p, subredditHint));
  }

  private resolveUrl(): string {
    if (this.source.url && this.source.url.trim().length > 0) {
      return this.source.url;
    }
    if (!this.source.identifier) {
      throw new Error(
        `Reddit SourceConfig ${this.source.id} missing both url and identifier`,
      );
    }
    return `https://www.reddit.com/r/${this.source.identifier}/hot.json?limit=${HOT_LIMIT}&raw_json=1`;
  }

  private isValidPost = (p: RedditPost): boolean => {
    if (!p) return false;
    if (p.stickied) return false;
    if (p.over_18) return false;
    if (!p.title) return false;
    if (!p.id) return false;
    return true;
  };

  private toRaw(p: RedditPost, subredditHint: string | null): RawCrawledItem {
    const isSelfPost = !!p.is_self;
    const selftextHtml = (p.selftext_html ?? '').trim();
    const subreddit = subredditHint ?? p.subreddit ?? 'unknown';
    const externalUrl = isSelfPost ? null : (p.url ?? null);
    const contentText = isSelfPost ? stripHtml(selftextHtml || p.title) : p.title;

    // SP-5.5 (2026-05-09): content-value pipeline. Order matters and supersedes
    // engagement-based rules — see `quality.ts` for empirical justification.
    //
    //   1. HIGH-domain link (arxiv / huggingface / github / lab blogs / press)
    //      → trustedSource=true, filterReason=null. Bypasses the keyword and
    //      engagement gates downstream. Catches paper/release/announcement
    //      links that are inherently substantive but may have low first-crawl
    //      score.
    //   2. LOW-domain link (i.redd.it / v.redd.it / imgur / youtube / x.com /
    //      cross-post reddit.com) → reddit_low_signal_link. Drops memes and
    //      reaction videos regardless of engagement — viral memes routinely
    //      score 5000+.
    //   3. Tiny self-post (<50 chars body) → reddit_tiny_selfpost. Drops
    //      one-line vents / help requests where the title is the entire signal.
    //   4. Otherwise → SP-3/SP-4 engagement check (rolled back to 5/2/0.5
    //      noise floor — engagement is no longer the primary signal).
    const domainSignal = checkRedditDomainSignal(externalUrl);
    let filterReason: FilterReason | null = null;
    let trustedSource = false;
    if (domainSignal === 'high') {
      trustedSource = true;
    } else if (domainSignal === 'low') {
      filterReason = FILTER_REASONS.REDDIT_LOW_SIGNAL_LINK;
    } else if (
      isSelfPost &&
      stripHtml(selftextHtml).trim().length < TINY_SELFPOST_MIN_CHARS
    ) {
      filterReason = FILTER_REASONS.REDDIT_TINY_SELFPOST;
    } else {
      filterReason = checkRedditQuality({
        upvote_ratio: p.upvote_ratio ?? null,
        score: p.score ?? 0,
        num_comments: p.num_comments ?? 0,
      });
    }

    return {
      title: p.title,
      contentText,
      rawHtml: isSelfPost && selftextHtml ? selftextHtml : null,
      sourceUrl: `https://www.reddit.com/r/${subreddit}/comments/${p.id}`,
      author: p.author && p.author !== '[deleted]' ? p.author : null,
      publishedAt: p.created_utc ? new Date(p.created_utc * 1000) : null,
      interactionData: {
        score: p.score ?? 0,
        comments: p.num_comments ?? 0,
        externalUrl,
        redditId: p.id,
        redditSubreddit: subreddit,
        redditUpvoteRatio: p.upvote_ratio ?? null,
      },
      filterReason,
      trustedSource,
    };
  }

  private timeoutMs(): number {
    const raw = parseInt(process.env.REDDIT_FETCH_TIMEOUT_MS ?? '15000', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 15000;
  }
}
