import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Glass, HeatBadge, HeatCurve, PageHeader, Pill, Tag } from '@ai-hot-news/ui';
import type { HotNewsDetailDto, HotNewsRelatedDto, HeatHistoryDto, Platform } from '@ai-hot-news/types';
import { ApiError, fetchHeatHistory, fetchHotNewsDetail } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { LocalTime } from '../_components/local-time';

export const dynamic = 'force-dynamic';

// SP-11 (2026-05-19): Detail page RSC.
// - Two parallel fetches via Promise.all (detail + heat-history)
// - 404 → Next notFound() boundary
// - Heat history failure is non-fatal — empty array, sparkline shows
//   "暂无数据" rather than failing the whole page
// - Visual: same Aurora glass / fade-up / Pill / HeatBadge / HeatCurve
//   atoms the HomePage (SP-9) uses, no new ui surface

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function NewsDetailPage({ params }: PageProps) {
  const { id } = await params;

  const detailPromise = fetchHotNewsDetail(id);
  const historyPromise = fetchHeatHistory(id, 48).catch<HeatHistoryDto>(() => ({
    items: [],
    windowStart: '',
    windowEnd: '',
    hours: 48,
  }));

  let detail: HotNewsDetailDto;
  try {
    detail = await detailPromise;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const history = await historyPromise;

  const relativeTime = formatRelativeTime(detail.publishedAt);

  return (
    <>
      <div className="px-9 pt-7 pb-3">
        <PageHeader
          kicker={`Hot News · ${detail.sourcePlatform}`}
          title={detail.titleZh ?? detail.title}
          gradTitle=""
          sub={detail.title}
          action={
            <Link
              href="/news"
              className="text-[13px] text-aurora font-semibold inline-flex items-center gap-1.5"
            >
              ← 返回热点流
            </Link>
          }
        />
      </div>

      <div className="flex-1 overflow-auto px-9 pb-9">
        {/* Hero meta strip */}
        <Glass className="fade-up mb-5">
          <div className="px-5 py-4 flex flex-wrap items-center gap-3">
            <Pill platform={detail.sourcePlatform as Platform} />
            {detail.heatLevel ? (
              <HeatBadge level={detail.heatLevel} score={detail.heatScore ?? null} />
            ) : null}
            <span className="text-[12px] text-ink-3">
              {relativeTime} · <LocalTime iso={detail.publishedAt} />
            </span>
            {detail.author ? (
              <span className="text-[12px] text-ink-3">作者 {detail.author}</span>
            ) : null}
            <a
              href={detail.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="ml-auto text-[12px] text-aurora font-medium inline-flex items-center gap-1"
            >
              查看原文 ↗
            </a>
          </div>
        </Glass>

        {/* Main two-column grid */}
        <div className="grid gap-5" style={{ gridTemplateColumns: '1.7fr 1fr' }}>
          <div className="flex flex-col gap-4">
            {/* Summary */}
            {detail.summary ? (
              <Glass className="fade-up" style={{ animationDelay: '0.05s' }}>
                <div className="px-5 py-4">
                  <h3 className="text-[15px] font-bold tracking-tight mb-2">
                    📝 AI 摘要
                  </h3>
                  <p className="text-[14px] leading-relaxed text-ink-2 whitespace-pre-line">
                    {detail.summary}
                  </p>
                </div>
              </Glass>
            ) : null}

            {/* Content */}
            {detail.content && detail.content.trim().length > 0 ? (
              <Glass className="fade-up" style={{ animationDelay: '0.1s' }}>
                <div className="px-5 py-4">
                  <h3 className="text-[15px] font-bold tracking-tight mb-2">
                    📄 全文
                  </h3>
                  <div className="text-[13px] leading-relaxed text-ink-2 whitespace-pre-line max-h-[60vh] overflow-auto pr-2">
                    {detail.content}
                  </div>
                </div>
              </Glass>
            ) : null}

            {/* AI tags */}
            {detail.aiTags.length > 0 ? (
              <Glass className="fade-up" style={{ animationDelay: '0.15s' }}>
                <div className="px-5 py-4">
                  <h3 className="text-[15px] font-bold tracking-tight mb-3">
                    🏷️ AI 标签
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {detail.aiTags.map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </div>
                </div>
              </Glass>
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            {/* Heat curve */}
            <Glass className="fade-up" style={{ animationDelay: '0.1s' }}>
              <div className="px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[15px] font-bold tracking-tight">
                    📈 48h 热度
                  </h3>
                  <span className="text-[10px] text-ink-3 font-mono">
                    每 30min 一个 bucket
                  </span>
                </div>
                {history.items.length === 0 ? (
                  <div className="text-[12px] text-ink-3 py-3">
                    暂无足够数据 · 等 cron 写入第一帧
                  </div>
                ) : (
                  <HeatCurve
                    data={history.items.map((b) => b.heatScore)}
                    labels={['48h 前', '36h', '24h', '12h', '现在']}
                    maxY={100}
                    height={120}
                  />
                )}
              </div>
            </Glass>

            {/* Related items */}
            <Glass className="fade-up" style={{ animationDelay: '0.15s' }}>
              <div className="px-5 py-4">
                <h3 className="text-[15px] font-bold tracking-tight mb-3">
                  🔗 相关报道
                </h3>
                {detail.relatedItems.length === 0 ? (
                  <div className="text-[12px] text-ink-3 py-3">
                    暂无 · groupId 与 aiTag 都未命中
                  </div>
                ) : (
                  detail.relatedItems.map((r, i) => (
                    <RelatedRow key={r.id} item={r} index={i} />
                  ))
                )}
              </div>
            </Glass>

            {/* Operational footer */}
            <Glass className="fade-up" style={{ animationDelay: '0.2s' }}>
              <div className="px-5 py-3">
                <div className="grid grid-cols-2 gap-2 text-[11px] text-ink-3">
                  <div>
                    抓取于 <LocalTime iso={detail.crawledAt} />
                  </div>
                  <div>
                    Extract <span className="font-mono">{detail.extractStatus ?? 'n/a'}</span>
                  </div>
                  <div className="col-span-2 break-all">
                    Group <span className="font-mono">{detail.groupId ?? 'singleton'}</span>
                  </div>
                </div>
              </div>
            </Glass>
          </div>
        </div>
      </div>
    </>
  );
}

function RelatedRow({ item, index }: { item: HotNewsRelatedDto; index: number }) {
  return (
    <Link
      href={{ pathname: `/news/${item.id}` }}
      className="block py-2 fade-up"
      style={{ animationDelay: `${0.25 + index * 0.05}s` }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] text-ink-3 w-[18px]">#{index + 1}</span>
        <Pill platform={item.sourcePlatform as Platform} />
        {item.heatLevel ? (
          <HeatBadge level={item.heatLevel} score={item.heatScore ?? null} />
        ) : null}
      </div>
      <div className="text-[13px] text-ink-2 font-medium leading-snug ml-[26px]">
        {item.titleZh ?? item.title}
      </div>
    </Link>
  );
}
