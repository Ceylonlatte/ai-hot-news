'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import type { HotNewsListResponseDto } from '@ai-hot-news/types';
import {
  fetchHotNewsListClient,
  type FeedPlatform,
  type FeedSort,
} from '@/lib/api';
import { NewsItem } from './news-item';
import { NewsFeedSkeleton } from './news-feed-skeleton';
import { ListHeader } from './list-header';
import type { FeedRange } from './search-params';

// SP-10 PR-C (2026-05-21): infinite-scroll list shell.
//
// Architecture:
//   /news/page.tsx (RSC) SSR's the first page → passes initialData to this
//   component → IntersectionObserver on a bottom sentinel triggers
//   fetchHotNewsListClient for page 2, 3, ... until total reached.
//
// State machine kept minimal — `pages` is the accumulated list of responses
// (preserving total/page metadata), `loading` blocks concurrent IO fires,
// `done` retires the observer.
//
// rootMargin '600px 0px' triggers loadNext while the user is ~3 cards away
// from the bottom, so cards appear before scrolling halts.

interface NewsFeedProps {
  initialData: HotNewsListResponseDto;
  platforms: FeedPlatform[];
  range: FeedRange;
  sort: FeedSort;
  tags: string[];
}

// Map "current range → URL of next range up" for the end-of-feed link
// "看更早 →". 30d falls through to /vault (SP-12 search will pick this up).
const NEXT_RANGE_URL: Record<FeedRange, string> = {
  '1d': '/news?range=7d',
  '7d': '/news?range=30d',
  '30d': '/vault',
};

const NEXT_RANGE_LABEL: Record<FeedRange, string> = {
  '1d': '看近 7 天',
  '7d': '看近 30 天',
  '30d': '去内容库搜索',
};

export function NewsFeed({
  initialData,
  platforms,
  range,
  sort,
  tags,
}: NewsFeedProps) {
  const [pages, setPages] = useState<HotNewsListResponseDto[]>([initialData]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(
    initialData.items.length === 0 || initialData.items.length >= initialData.total,
  );
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Use a ref guard for in-flight requests to prevent IO double-trigger when
  // the sentinel rapidly enters/exits viewport during fast scrolls.
  const inflightRef = useRef(false);

  const loadNext = useCallback(async () => {
    if (inflightRef.current || done) return;
    inflightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const nextPage = pages.length + 1;
      const data = await fetchHotNewsListClient(
        nextPage,
        initialData.pageSize,
        platforms,
        sort,
        { range, tags },
      );
      // Compute the new pagination state from the closure-captured `pages`
      // (deps already retrigger loadNext when pages.length changes), THEN
      // dispatch the two state updates separately. We deliberately avoid
      // computing `done` inside the setPages updater because React 18's
      // strict-mode double-invokes setState updaters to detect side effects,
      // and nested setDone() / loaded re-derivation inside the updater
      // confuses that contract (observed: vitest StrictMode-like behavior
      // throws reading .items.length on a second pass).
      const updatedPages = [...pages, data];
      const totalLoaded = updatedPages.reduce((n, p) => n + p.items.length, 0);
      setPages(updatedPages);
      if (data.items.length === 0 || totalLoaded >= data.total) {
        setDone(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      inflightRef.current = false;
      setLoading(false);
    }
  }, [pages, initialData.pageSize, platforms, sort, range, tags, done]);

  useEffect(() => {
    if (done) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          void loadNext();
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [done, loadNext]);

  const items = pages.flatMap((p) => p.items);
  const total = pages[0]?.total ?? 0;
  const latestCrawledAt = items[0]?.crawledAt;

  return (
    <>
      <ListHeader total={total} latestCrawledAt={latestCrawledAt} />
      <div className="mt-3.5 grid grid-cols-1 md:grid-cols-2 gap-3 fade-up">
        {items.map((item) => (
          <NewsItem key={item.id} item={item} />
        ))}
      </div>

      {loading ? <NewsFeedSkeleton /> : null}

      {error ? (
        <div className="mt-6 text-center text-sm text-red-600">
          加载失败：{error}{' '}
          <button
            type="button"
            onClick={() => void loadNext()}
            className="underline text-aurora ml-2"
          >
            重试
          </button>
        </div>
      ) : null}

      {done ? (
        <div className="mt-6 text-center text-sm text-ink-3">
          已加载全部 {total} 条
          <Link
            href={NEXT_RANGE_URL[range] as Route}
            className="ml-2 text-aurora hover:underline"
          >
            {NEXT_RANGE_LABEL[range]} →
          </Link>
        </div>
      ) : (
        // The IntersectionObserver targets this sentinel; 1px tall so it
        // doesn't disturb layout. rootMargin pulls the trigger 600px before
        // the sentinel enters the viewport.
        <div ref={sentinelRef} className="h-px mt-6" aria-hidden="true" />
      )}
    </>
  );
}
