import { stripHtml } from '@ai-hot-news/utils';
import type { RawCrawledItem } from '@ai-hot-news/types';
import type { Crawler } from './crawler.interface';
import type { RedditListingResponse, RedditPost } from './reddit.types';

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
    return {
      title: p.title,
      contentText: isSelfPost ? stripHtml(selftextHtml || p.title) : p.title,
      rawHtml: isSelfPost && selftextHtml ? selftextHtml : null,
      sourceUrl: `https://www.reddit.com/r/${subreddit}/comments/${p.id}`,
      author: p.author && p.author !== '[deleted]' ? p.author : null,
      publishedAt: p.created_utc ? new Date(p.created_utc * 1000) : null,
      interactionData: {
        score: p.score ?? 0,
        comments: p.num_comments ?? 0,
        externalUrl: isSelfPost ? null : (p.url ?? null),
        redditId: p.id,
        redditSubreddit: subreddit,
        redditUpvoteRatio: p.upvote_ratio ?? null,
      },
    };
  }

  private timeoutMs(): number {
    const raw = parseInt(process.env.REDDIT_FETCH_TIMEOUT_MS ?? '15000', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 15000;
  }
}
