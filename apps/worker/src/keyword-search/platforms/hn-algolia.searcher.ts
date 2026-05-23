import { Logger } from '@nestjs/common';
import type { RawCrawledItem } from '@ai-hot-news/types';

// SP-16.5 (2026-05-23): HN Algolia search client.
//
// API: https://hn.algolia.com/api
// Free, no key required. tags=story restricts to story posts (not comments
// or polls). `hitsPerPage` ≤ 1000. We default to 50 — covers PRD §5.3
// example "30分钟内出现超过 10 条相关内容" with headroom.
//
// Why search_by_date instead of search: search ranks by Algolia's
// proprietary relevance score, search_by_date ranks by time desc. For
// monitoring "show me what's new on Claude Code", recency wins; relevance
// scoring would re-surface old highly-upvoted threads on every tick.

const HN_ALGOLIA_ENDPOINT = 'https://hn.algolia.com/api/v1/search_by_date';

const logger = new Logger('HnAlgoliaSearcher');

interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  author: string | null;
  story_text: string | null;
  created_at: string;
  created_at_i: number;
  points: number | null;
  num_comments: number | null;
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
  nbHits: number;
}

export interface HnAlgoliaSearchOptions {
  query: string;
  maxHits: number;
  userAgent: string;
  /** Optional UNIX seconds; only return stories created at or after this. */
  sinceUnixSeconds?: number;
  /** Network timeout per request (ms). */
  timeoutMs?: number;
}

export async function searchHnAlgolia(
  opts: HnAlgoliaSearchOptions,
): Promise<RawCrawledItem[]> {
  const url = new URL(HN_ALGOLIA_ENDPOINT);
  url.searchParams.set('query', opts.query);
  url.searchParams.set('tags', 'story');
  url.searchParams.set('hitsPerPage', String(opts.maxHits));
  if (opts.sinceUnixSeconds !== undefined) {
    // Algolia numericFilters: created_at_i>=<unix>
    url.searchParams.set(
      'numericFilters',
      `created_at_i>=${opts.sinceUnixSeconds}`,
    );
  }

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    headers: { 'User-Agent': opts.userAgent },
  });
  if (!res.ok) {
    throw new Error(
      `HN Algolia ${res.status} ${res.statusText} for query="${opts.query}"`,
    );
  }
  const data = (await res.json()) as AlgoliaResponse;
  if (!Array.isArray(data?.hits)) {
    throw new Error(
      `HN Algolia returned non-array hits for "${opts.query}": ${JSON.stringify(data).slice(0, 200)}`,
    );
  }

  logger.log(
    `query="${opts.query}" got ${data.hits.length}/${data.nbHits ?? '?'} hits`,
  );

  const items: RawCrawledItem[] = [];
  for (const hit of data.hits) {
    if (!hit.title || !hit.objectID) continue;
    items.push(toRawItem(hit));
  }
  return items;
}

function toRawItem(hit: AlgoliaHit): RawCrawledItem {
  // Self-post when story_text is set + url is empty; otherwise it's a
  // link-post and our ingest pipeline will treat it as such (SP-4 extract
  // chain will pull the externalUrl content into content).
  const isSelfPost = !hit.url && !!hit.story_text;
  return {
    title: hit.title ?? '(untitled)',
    contentText: isSelfPost ? hit.story_text! : (hit.title ?? ''),
    rawHtml: isSelfPost ? hit.story_text : null,
    // Canonical URL is always the HN item page — matches what the regular
    // HN top-list crawler emits, so dedupe collapses cleanly.
    sourceUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    author: hit.author,
    publishedAt: hit.created_at_i
      ? new Date(hit.created_at_i * 1000)
      : hit.created_at
        ? new Date(hit.created_at)
        : null,
    interactionData: {
      score: hit.points ?? 0,
      comments: hit.num_comments ?? 0,
      externalUrl: hit.url ?? null,
      hnId: Number(hit.objectID),
      // No hnPosition — search results don't have a top-list rank.
      hnPosition: null,
      source: 'search', // mark provenance for ops log
    },
    // SP-16.5: keyword-search hits skip the AI-keyword gate. User has
    // already declared intent by registering the keyword; the
    // platform-side query is the gate.
    trustedSource: true,
    // No quality filterReason — let universal title check run.
  };
}
