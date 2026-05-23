import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import type { KeywordMonitorDto } from '@ai-hot-news/types';
import { Glass, PageHeader } from '@ai-hot-news/ui';
import { getCurrentUser } from '@/lib/auth';
import { fetchKeywordHits } from '@/lib/keywords-server';
import { ApiError } from '@/lib/api';
import { NewsItem } from '../../news/_components/news-item';

// SP-15 PR-B (2026-05-23): per-keyword hits view.
//
// Server-rendered page that joins KeywordHit × HotNews and shows newest
// hits first, paginated via ?page=N (50 per page). Each card reuses the
// shared NewsItem component so the layout is consistent with /news and
// /vault.
//
// Pagination uses simple Prev/Next links rather than infinite scroll —
// keyword views are bounded (a single monitor caps at ~hundreds of hits
// in practice) and SEO doesn't matter here (auth-gated), so the simpler
// pattern is fine.

const PAGE_SIZE = 50;

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '关键词命中 · AI Hot News',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}

export default async function KeywordHitsPage({
  params,
  searchParams,
}: PageProps) {
  const user = await getCurrentUser();
  if (!user) {
    const { id } = await params;
    redirect(`/login?next=/keywords/${encodeURIComponent(id)}` as Route);
  }

  const { id } = await params;
  const { page: pageRaw } = await searchParams;
  const page = parsePage(pageRaw);
  const offset = (page - 1) * PAGE_SIZE;

  let data;
  try {
    data = await fetchKeywordHits(id, PAGE_SIZE, offset);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const monitor = data.monitor;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <PageHeader
        kicker="Keyword Hits"
        title={monitor.keyword}
        sub={`累计命中 ${monitor.hitCount} 条 · 监控频率 ${frequencyLabel(monitor.monitorFrequency)} · ${platformsLabel(monitor.platforms)}`}
        action={
          <Link
            href={'/keywords' as Route}
            className="text-[12px] text-ink-3 hover:text-ink underline-offset-2 hover:underline"
          >
            ← 返回监控列表
          </Link>
        }
      />

      <div className="mt-4 space-y-3">
        <MonitorMeta monitor={monitor} />

        {data.items.length === 0 ? (
          <Glass className="px-6 py-12 text-center">
            <div className="text-[14px] font-semibold text-ink mb-1.5">
              暂无命中记录
            </div>
            <div className="text-[12px] text-ink-3">
              SP-16.5 cron 每 5 分钟扫一次平台搜索 API；新创建 / 启用的关键词
              下一个 tick 就会有数据。
            </div>
          </Glass>
        ) : (
          <>
            <div className="text-[11px] text-ink-3 font-mono">
              显示 {offset + 1}-{offset + data.items.length} / 共 {data.total} 条 · 按命中时间倒序
            </div>
            <ul className="space-y-3">
              {data.items.map((item) => (
                <li key={item.id}>
                  <NewsItem item={item} />
                </li>
              ))}
            </ul>

            {totalPages > 1 ? (
              <Pager
                id={id}
                page={page}
                totalPages={totalPages}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function MonitorMeta({ monitor }: { monitor: KeywordMonitorDto }) {
  return (
    <Glass className="px-4 py-3 flex flex-wrap items-center gap-3 text-[12px]">
      <span className="text-ink-3">配置：</span>
      {monitor.synonyms.length > 0 ? (
        <span>
          <span className="text-ink-3">同义词</span>{' '}
          <span className="text-ink font-medium">
            {monitor.synonyms.join(' · ')}
          </span>
        </span>
      ) : null}
      {monitor.excludeWords.length > 0 ? (
        <span>
          <span className="text-ink-3">排除</span>{' '}
          <span className="text-ink font-medium">
            −{monitor.excludeWords.join(' · −')}
          </span>
        </span>
      ) : null}
      <span>
        <span className="text-ink-3">推送</span>{' '}
        <span className="text-ink font-medium">
          {monitor.notifyChannels.join(' · ')}
        </span>
      </span>
      {monitor.lastSearchedAt ? (
        <span className="ml-auto text-[11px] text-ink-3 font-mono">
          上次搜索 {relativeTime(monitor.lastSearchedAt)}
        </span>
      ) : null}
    </Glass>
  );
}

function Pager({
  id,
  page,
  totalPages,
}: {
  id: string;
  page: number;
  totalPages: number;
}) {
  const prevHref = page > 1
    ? (`/keywords/${id}${page - 1 === 1 ? '' : `?page=${page - 1}`}` as Route)
    : null;
  const nextHref = page < totalPages
    ? (`/keywords/${id}?page=${page + 1}` as Route)
    : null;

  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      {prevHref ? (
        <Link
          href={prevHref}
          className="px-3 py-1.5 rounded-lg text-[12px] text-ink-2 bg-white/60 border border-line-2 hover:bg-white"
        >
          ← 上一页
        </Link>
      ) : (
        <span className="px-3 py-1.5 rounded-lg text-[12px] text-ink-3 bg-white/30 border border-line-2 opacity-50">
          ← 上一页
        </span>
      )}
      <span className="text-[11px] text-ink-3 font-mono">
        {page} / {totalPages}
      </span>
      {nextHref ? (
        <Link
          href={nextHref}
          className="px-3 py-1.5 rounded-lg text-[12px] text-ink-2 bg-white/60 border border-line-2 hover:bg-white"
        >
          下一页 →
        </Link>
      ) : (
        <span className="px-3 py-1.5 rounded-lg text-[12px] text-ink-3 bg-white/30 border border-line-2 opacity-50">
          下一页 →
        </span>
      )}
    </div>
  );
}

function parsePage(raw: string | undefined): number {
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function frequencyLabel(f: string): string {
  switch (f) {
    case 'M15': return '15 分钟';
    case 'M30': return '30 分钟';
    case 'H1': return '1 小时';
    case 'D1': return '每天';
    default: return f;
  }
}

function platformsLabel(platforms: string[]): string {
  return platforms.length === 0 ? '全平台' : `${platforms.join(' / ')}`;
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const ms = now - t;
  if (ms < 60_000) return '刚刚';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
  return `${Math.floor(ms / 86_400_000)} 天前`;
}
