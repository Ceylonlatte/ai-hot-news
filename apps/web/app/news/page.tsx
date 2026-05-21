import { PageHeader } from '@ai-hot-news/ui';
import { fetchHotNewsList } from '@/lib/api';
import { NewsFeed } from './_components/news-feed';
import { EmptyState } from './_components/empty-state';
import { ErrorState } from './_components/error-state';
import { FeedTabs, parseTab } from './_components/feed-tabs';
import { RangeTabs } from './_components/range-tabs';
import { SortTabs } from './_components/sort-tabs';
import { CategoryChips } from './_components/category-chips';
import {
  parseRange,
  parseSort,
  parseTags,
  TAB_PLATFORMS,
} from './_components/search-params';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    tab?: string;
    range?: string;
    sort?: string;
    tags?: string;
  }>;
}

// SP-10 PR-C (2026-05-21): RSC fetches the FIRST page only; the client
// `<NewsFeed>` takes the response as initialData and loads subsequent pages
// via IntersectionObserver. SSR keeps SEO + LCP healthy; client takes over
// for "infinite" experience.
const PAGE_SIZE = 20;

export default async function NewsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const range = parseRange(sp.range);
  const sort = parseSort(sp.sort);
  const tags = parseTags(sp.tags);
  const platforms = TAB_PLATFORMS[tab];

  let data;
  let errorMessage: string | null = null;
  try {
    data = await fetchHotNewsList(1, PAGE_SIZE, platforms, sort, { range, tags });
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Unknown error';
  }

  // State without the dim being controlled by each tab component — used to
  // build "switch only this one dim" hrefs (e.g. RangeTabs URLs preserve
  // tab + sort + tags, only swap range).
  const filterStateForRange = { tab, sort, tags };
  const filterStateForSort = { tab, range, tags };
  const filterStateForTags = { tab, range, sort };

  return (
    <>
      <div className="px-9 pt-7 pb-3">
        <PageHeader
          kicker="Hot Feed"
          title="热点流"
          sub={
            data
              ? `${data.total} 条精选热点 · 实时聚合 4 个平台`
              : 'HN / Reddit / RSS 跨平台聚合 · SP-6 heatScore 排序'
          }
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <FeedTabs active={tab} />
            <RangeTabs active={range} state={filterStateForRange} />
          </div>
          <SortTabs active={sort} state={filterStateForSort} />
        </div>
        <div className="mt-3">
          <CategoryChips selectedTags={tags} state={filterStateForTags} />
        </div>
      </div>
      <div className="flex-1 overflow-auto px-9 pb-9">
        {errorMessage ? (
          <ErrorState message={errorMessage} />
        ) : data && data.items.length === 0 ? (
          <EmptyState />
        ) : data ? (
          <NewsFeed
            initialData={data}
            platforms={platforms}
            range={range}
            sort={sort}
            tags={tags}
          />
        ) : null}
      </div>
    </>
  );
}
