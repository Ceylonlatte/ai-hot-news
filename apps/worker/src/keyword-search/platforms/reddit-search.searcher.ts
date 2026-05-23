import { Logger } from '@nestjs/common';
import type { RawCrawledItem } from '@ai-hot-news/types';

// SP-16.5 (2026-05-23): Reddit search client (no auth).
//
// API: https://www.reddit.com/search.json (public, no OAuth)
// Rate limit: 10 req/min/IP without auth (Reddit doc). Caller is
// responsible for serializing calls — see redditMinSleepMs in config.
//
// We use sort=new + t=week to bias toward fresh content. The "best"
// default sort would re-surface old highly-upvoted threads on every
// poll, exact same problem as HN Algolia relevance — recency wins for
// monitoring.

const REDDIT_SEARCH_ENDPOINT = 'https://www.reddit.com/search.json';

const logger = new Logger('RedditSearcher');

interface RedditListingChild {
  kind: string;
  data: {
    id: string;
    title: string;
    selftext: string;
    selftext_html: string | null;
    url: string;
    permalink: string;
    author: string;
    created_utc: number;
    score: number;
    num_comments: number;
    subreddit: string;
    subreddit_name_prefixed: string;
    over_18: boolean;
    is_self: boolean;
    domain: string;
  };
}

interface RedditListing {
  kind: 'Listing';
  data: {
    children: RedditListingChild[];
    after: string | null;
  };
}

export interface RedditSearchOptions {
  query: string;
  maxHits: number;
  userAgent: string;
  /** "hour" | "day" | "week" | "month" | "year" | "all" */
  timeWindow?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
  timeoutMs?: number;
}

export async function searchReddit(
  opts: RedditSearchOptions,
): Promise<RawCrawledItem[]> {
  const url = new URL(REDDIT_SEARCH_ENDPOINT);
  url.searchParams.set('q', opts.query);
  url.searchParams.set('limit', String(opts.maxHits));
  url.searchParams.set('sort', 'new');
  url.searchParams.set('t', opts.timeWindow ?? 'week');
  url.searchParams.set('include_over_18', 'off');
  url.searchParams.set('type', 'link');

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    headers: {
      'User-Agent': opts.userAgent,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(
      `Reddit search ${res.status} ${res.statusText} for query="${opts.query}"`,
    );
  }
  const data = (await res.json()) as RedditListing;
  const children = data?.data?.children;
  if (!Array.isArray(children)) {
    throw new Error(
      `Reddit search returned malformed response for "${opts.query}": ${JSON.stringify(data).slice(0, 200)}`,
    );
  }

  logger.log(`query="${opts.query}" got ${children.length} hits`);

  const items: RawCrawledItem[] = [];
  for (const child of children) {
    if (child.kind !== 't3') continue; // t3 = link/post
    if (child.data.over_18) continue;
    if (!child.data.title) continue;
    items.push(toRawItem(child));
  }
  return items;
}

function toRawItem(child: RedditListingChild): RawCrawledItem {
  const d = child.data;
  const isSelfPost = d.is_self;
  const content = isSelfPost ? (d.selftext ?? '') : d.title;
  return {
    title: d.title,
    contentText: content,
    rawHtml: isSelfPost ? d.selftext_html : null,
    // Canonical URL is the Reddit thread (matches reddit.crawler.ts to
    // collapse dedupe). External link, if present, lives in interactionData.
    sourceUrl: `https://www.reddit.com${d.permalink}`,
    author: d.author ?? null,
    publishedAt: d.created_utc ? new Date(d.created_utc * 1000) : null,
    interactionData: {
      score: d.score ?? 0,
      num_comments: d.num_comments ?? 0,
      subreddit: d.subreddit ?? null,
      domain: d.domain ?? null,
      externalUrl: isSelfPost ? null : d.url,
      redditId: d.id,
      source: 'search',
    },
    trustedSource: true,
  };
}
