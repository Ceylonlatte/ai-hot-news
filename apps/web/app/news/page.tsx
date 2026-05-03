import { fetchHotNewsList } from '@/lib/api';
import { ListHeader } from './_components/list-header';
import { NewsItem } from './_components/news-item';
import { Pagination } from './_components/pagination';
import { EmptyState } from './_components/empty-state';
import { ErrorState } from './_components/error-state';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function NewsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const parsed = parseInt(sp.page ?? '1', 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const pageSize = 20;

  let data;
  try {
    data = await fetchHotNewsList(page, pageSize);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : 'Unknown error'} />;
  }

  if (data.items.length === 0) {
    return <EmptyState />;
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <ListHeader total={data.total} latestCrawledAt={data.items[0]?.crawledAt} />
      <ul className="mt-4 divide-y divide-gray-200">
        {data.items.map((item) => (
          <NewsItem key={item.id} item={item} />
        ))}
      </ul>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
    </main>
  );
}
