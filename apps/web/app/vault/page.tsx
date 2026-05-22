import { PageHeader } from '@ai-hot-news/ui';
import { fetchHotNewsList, fetchTopTags, type FeedPlatform } from '@/lib/api';
import { NewsFeed } from '../news/_components/news-feed';
import { EmptyState } from '../news/_components/empty-state';
import { ErrorState } from '../news/_components/error-state';
import {
  parseSort,
  parseTags,
  type FeedRange,
} from '../news/_components/search-params';
import { SearchInput } from './_components/search-input';
import { TagCloud } from './_components/tag-cloud';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    tags?: string;
    range?: string;
    sort?: string;
  }>;
}

// SP-12 (2026-05-22): vault search page.
//
// Differences from /news:
//   - default range = '30d' (vs /news 1d) — "回看库" mental model
//   - default platforms = ALL (vs /news community/media tabs)
//   - tag cloud shown when q is empty (search-engine entry UX)
//   - SearchInput always visible; result list reuses <NewsFeed>
const PAGE_SIZE = 20;
const VAULT_PLATFORMS: FeedPlatform[] = ['HACKERNEWS', 'REDDIT', 'RSS'];

function parseVaultRange(raw: string | undefined): FeedRange {
  // Same allowed values as /news, just different default.
  if (raw === '1d' || raw === '7d' || raw === '30d') return raw;
  return '30d';
}

export default async function VaultPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const tags = parseTags(sp.tags);
  const range = parseVaultRange(sp.range);
  const sort = parseSort(sp.sort);

  // 并行：搜索结果 + 推荐标签云（哪怕 q 非空也 fetch，因为 selectedTags 显示需要 — 但
  // UI 上仅在 q 为空时渲染 cloud。仍然双 fetch 是因为 Promise.all 比串行快 ~80ms，
  // 而 tagCloud 调用本身 < 30ms，没必要 conditional fetch）
  let data;
  let topTags;
  let errorMessage: string | null = null;
  try {
    [data, topTags] = await Promise.all([
      fetchHotNewsList(1, PAGE_SIZE, VAULT_PLATFORMS, sort, { range, tags, q: q || undefined }),
      fetchTopTags(30, 20),
    ]);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Unknown error';
  }

  // Page header sub: communicate the state ("搜索 / 浏览 / 标签筛选")
  const subText = data
    ? q
      ? `${data.total} 条命中 "${q}" · ${range === '30d' ? '近 30 天' : range === '7d' ? '近 7 天' : '近 24 小时'}`
      : tags.length > 0
        ? `${data.total} 条 · 标签筛选中 (${tags.length})`
        : `${data.total} 条 · 内容库 (近 30 天全平台)`
    : '搜索 · 浏览 · 标签筛选';

  return (
    <>
      <div className="px-9 pt-7 pb-3">
        <PageHeader kicker="Vault" title="内容库" sub={subText} />
        <SearchInput initialQ={q} />
        {/* Tag cloud only renders when there's no active search query — UX
            principle: searching is "I know what I want", browsing is "show
            me what's hot". The two modes don't need to share screen real
            estate. The cloud reappears once q is cleared. */}
        {!q && topTags ? <TagCloud tags={topTags.tags} selectedTags={tags} /> : null}
      </div>
      <div className="flex-1 overflow-auto px-9 pb-9">
        {errorMessage ? (
          <ErrorState message={errorMessage} />
        ) : data && data.items.length === 0 ? (
          <EmptyState />
        ) : data ? (
          <NewsFeed
            initialData={data}
            platforms={VAULT_PLATFORMS}
            range={range}
            sort={sort}
            tags={tags}
            q={q || undefined}
          />
        ) : null}
      </div>
    </>
  );
}
