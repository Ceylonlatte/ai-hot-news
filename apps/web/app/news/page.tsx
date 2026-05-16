import { PageHeader } from '@ai-hot-news/ui';
import { fetchHotNewsList, type FeedPlatform } from '@/lib/api';
import { ListHeader } from './_components/list-header';
import { NewsItem } from './_components/news-item';
import { Pagination } from './_components/pagination';
import { EmptyState } from './_components/empty-state';
import { ErrorState } from './_components/error-state';
import { FeedTabs, parseTab, type FeedTab } from './_components/feed-tabs';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ page?: string; tab?: string }>;
}

const TAB_PLATFORMS: Record<FeedTab, FeedPlatform[]> = {
  community: ['HACKERNEWS', 'REDDIT'],
  media: ['RSS'],
};

export default async function NewsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const parsed = parseInt(sp.page ?? '1', 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const pageSize = 20;
  const tab = parseTab(sp.tab);
  const platforms = TAB_PLATFORMS[tab];

  let data;
  let errorMessage: string | null = null;
  try {
    data = await fetchHotNewsList(page, pageSize, platforms);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Unknown error';
  }

  return (
    <>
      <PageHeader
        title="News"
        subtitle="HN / Reddit / RSS 跨平台聚合 · SP-6 heatScore 排序"
      />
      <FeedTabs active={tab} />
      {errorMessage ? (
        <ErrorState message={errorMessage} />
      ) : data && data.items.length === 0 ? (
        <EmptyState />
      ) : data ? (
        <>
          <ListHeader total={data.total} latestCrawledAt={data.items[0]?.crawledAt} />
          <div className="mt-4 space-y-3 fade-up">
            {data.items.map((item) => (
              <NewsItem key={item.id} item={item} />
            ))}
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} tab={tab} />
        </>
      ) : null}
    </>
  );
}
