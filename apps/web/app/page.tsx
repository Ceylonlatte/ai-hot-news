import {
  CountUp,
  Glass,
  HeatBadge,
  HeatCurve,
  PageHeader,
  Pill,
} from '@ai-hot-news/ui';
import {
  fetchHeatCurve,
  fetchHotNewsList,
  fetchStatsSources,
  fetchStatsToday,
  fetchTrendingKeywords,
} from '@/lib/api';
import type { Platform } from '@ai-hot-news/types';

export const dynamic = 'force-dynamic';

// SP-9 (2026-05-19): RSC HomePage. Replaces SP-8 mockup. Drives 6 cards
// from 4 stats endpoints + 1 reuse of /hot-news?sort=heat&pageSize=6.
// All 5 fetches happen in parallel via Promise.all; service-side they're
// independent so this latches the slowest one at < 100ms p95 typical.

const PLATFORM_COLOR: Record<Platform, string> = {
  HACKERNEWS: '#14131a',
  REDDIT: '#7e57f5',
  RSS: '#5a5763',
  TWITTER: '#7e57f5',
};

// Stat card colors mirror the Aurora HTML mockup palette cycle:
// purple / ink / purple / muted (one accent per quadrant).
const STAT_COLORS = ['#7e57f5', '#14131a', '#7e57f5', '#5a5763'];

export default async function HomePage() {
  const [today, sources, heatCurve, trending, hotList] = await Promise.all([
    fetchStatsToday(),
    fetchStatsSources(),
    fetchHeatCurve(),
    fetchTrendingKeywords(5),
    fetchHotNewsList(1, 6, undefined, 'heat'),
  ]);

  const stats: Array<{
    l: string;
    v: number;
    d: string;
    icon: string;
  }> = [
    { l: '今日聚合', v: today.aggregateCount, d: '过去 24 小时', icon: '📥' },
    { l: '爆发事件', v: today.burstCount, d: '过去 24 小时', icon: '🔥' },
    {
      l: '标签覆盖',
      v: today.taggedCount,
      d: '已打 AI 标签 · 等 SP-14 接通用户监控',
      icon: '🎯',
    },
    {
      l: '活跃信源',
      v: today.sourceCount,
      d: today.sourceCount > 0 ? '今日有抓取' : '今日空载',
      icon: '🌐',
    },
  ];

  const todayLabel = new Date(today.windowEnd)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '.');
  const subText = `过去 24 小时已聚合 ${today.aggregateCount.toLocaleString('en-US')} 条内容 · ${today.burstCount} 个爆发事件 · ${today.taggedCount} 个 AI 标签覆盖`;

  return (
    <>
      <div className="px-9 pt-7 pb-3">
        <PageHeader
          kicker={`Today · ${todayLabel}`}
          title="今天的"
          gradTitle="AI 信号潮汐"
          sub={subText}
          action={
            <button
              type="button"
              disabled
              title="等 SP-21 AI 日报上线"
              className="px-5 py-2.5 rounded-full text-white text-[13px] font-semibold flex items-center gap-2 cursor-not-allowed opacity-60"
              style={{
                background: 'var(--grad)',
                boxShadow: '0 4px 16px rgba(20,19,26,0.21)',
              }}
            >
              ✨ 生成今日日报
            </button>
          }
        />
      </div>
      <div className="flex-1 overflow-auto px-9 pb-9">
        {/* Stats — 4 cards driven by /stats/today */}
        <div className="grid grid-cols-4 gap-3.5 mb-6">
          {stats.map((s, i) => (
            <Glass
              key={s.l}
              variant="hover"
              className="fade-up"
              style={{ animationDelay: `${i * 0.08}s` }}
            >
              <div className="px-5 py-4">
                <div className="flex justify-between items-center mb-3.5">
                  <span className="text-[12px] text-ink-2 font-medium">{s.l}</span>
                  <span className="text-[18px]" aria-hidden="true">{s.icon}</span>
                </div>
                <div
                  className="font-bold leading-none"
                  style={{ fontSize: 36, letterSpacing: '-0.03em', color: STAT_COLORS[i] }}
                >
                  <CountUp value={s.v} />
                </div>
                <div className="text-[11px] text-ink-3 mt-2">{s.d}</div>
              </div>
            </Glass>
          ))}
        </div>

        <div className="grid gap-5" style={{ gridTemplateColumns: '1.7fr 1fr' }}>
          {/* Hot list — reuses /hot-news?sort=heat&groupMode=fold (SP-7 default) */}
          <div>
            <div className="flex justify-between items-center mb-3.5">
              <h2 className="text-[20px] font-bold tracking-tight">🌊 热度榜单</h2>
              <a href="/news" className="text-[13px] text-aurora font-medium">
                查看全部 →
              </a>
            </div>
            <div className="flex flex-col gap-2.5">
              {hotList.items.length === 0 ? (
                <Glass>
                  <div className="px-5 py-6 text-[13px] text-ink-3 text-center">
                    过去 24 小时暂无热点
                  </div>
                </Glass>
              ) : (
                hotList.items.map((n, i) => {
                  // Show cross-platform badges using groupPlatforms keys + sourcePlatform fallback.
                  const platformsToShow: Platform[] = Array.from(
                    new Set<Platform>([
                      n.sourcePlatform,
                      ...(Object.keys(n.groupPlatforms) as Platform[]),
                    ]),
                  );
                  return (
                    <Glass
                      key={n.id}
                      variant="hover"
                      className="fade-up"
                      style={{ animationDelay: `${i * 0.05}s` }}
                    >
                      <div
                        className="flex gap-3.5 items-center"
                        style={{ padding: '16px 18px' }}
                      >
                        <div
                          className="font-extrabold leading-none text-ink"
                          style={{
                            width: 36,
                            fontSize: 28,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] font-semibold mb-1.5 truncate">
                            {n.titleZh ?? n.title}
                          </div>
                          <div className="flex gap-1.5 items-center flex-wrap">
                            {platformsToShow.map((p) => (
                              <Pill key={p} platform={p} />
                            ))}
                            <span className="text-[11px] text-ink-3">
                              · {relativeTime(n.publishedAt)}
                            </span>
                          </div>
                        </div>
                        {n.heatScore != null && n.heatLevel != null ? (
                          <HeatBadge
                            score={Math.round(n.heatScore)}
                            level={n.heatLevel}
                          />
                        ) : null}
                      </div>
                    </Glass>
                  );
                })
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-4">
            {/* Trending — /stats/trending-keywords */}
            <Glass className="fade-up" style={{ animationDelay: '0.2s' }}>
              <div className="px-5 py-4">
                <div className="flex items-center justify-between mb-3.5">
                  <h3 className="text-[15px] font-bold tracking-tight">📈 增速最快</h3>
                  <span className="text-[10px] text-ink-3 font-mono">过去 24 小时</span>
                </div>
                {trending.items.length === 0 ? (
                  <div className="text-[12px] text-ink-3 py-3">暂无足够数据</div>
                ) : (
                  trending.items.map((k, i) => {
                    const color = i % 2 === 0 ? '#7e57f5' : '#14131a';
                    const isNew = k.growthPct >= 9999;
                    // Bar width: NEW pegs to 100; positive growth scales to fit;
                    // negative growth bars hidden (set to 0 width) since the
                    // card emphasizes "rising" tags.
                    const widthPct = isNew
                      ? 100
                      : k.growthPct <= 0
                        ? 0
                        : Math.min(k.growthPct / 3.5, 100);
                    return (
                      <div
                        key={k.tag}
                        className="py-2 flex items-center gap-3 fade-up"
                        style={{ animationDelay: `${0.3 + i * 0.05}s` }}
                      >
                        <span className="text-[11px] text-ink-3 w-[18px]">
                          #{i + 1}
                        </span>
                        <span className="flex-1 text-[13px] font-medium truncate">
                          {k.label}
                        </span>
                        <div className="flex-[1.2] h-[5px] bg-aurora-soft rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full fill-bar"
                            style={{
                              width: `${widthPct}%`,
                              background: color,
                              animationDelay: `${0.5 + i * 0.08}s`,
                            }}
                          />
                        </div>
                        <span
                          className="font-mono text-[12px] font-bold text-right"
                          style={{ width: 54, color }}
                        >
                          {isNew
                            ? 'NEW'
                            : `${k.growthPct >= 0 ? '+' : ''}${k.growthPct}%`}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </Glass>

            {/* Source distribution — /stats/sources */}
            <Glass className="fade-up" style={{ animationDelay: '0.3s' }}>
              <div className="px-5 py-4">
                <h3 className="text-[15px] font-bold tracking-tight mb-3.5">
                  🌐 信源分布
                </h3>
                {sources.platforms.length === 0 ? (
                  <div className="text-[12px] text-ink-3 py-3">暂无数据</div>
                ) : (
                  sources.platforms.map((s, i) => {
                    const platform = s.platform as Platform;
                    const color = PLATFORM_COLOR[platform];
                    return (
                      <div key={s.platform} className="mb-3">
                        <div className="flex justify-between items-center mb-1.5">
                          <Pill platform={platform} />
                          <span className="font-mono text-[11px] text-ink-2 font-semibold">
                            {s.pct}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-aurora-soft/60 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full fill-bar"
                            style={{
                              width: `${s.pct}%`,
                              background: `linear-gradient(90deg, ${color}, ${color}aa)`,
                              animationDelay: `${0.4 + i * 0.08}s`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Glass>

            {/* My alerts — placeholder until SP-17 lands */}
            <Glass className="fade-up" style={{ animationDelay: '0.4s' }}>
              <div className="px-5 py-4">
                <div className="flex justify-between items-center mb-3.5">
                  <h3 className="text-[15px] font-bold tracking-tight">🔔 我的提醒</h3>
                  <span className="text-[10px] text-ink-3 font-mono">
                    等 SP-17 接通
                  </span>
                </div>
                <div className="text-[12px] text-ink-3 py-6 text-center">
                  关键词监控功能即将上线
                  <div className="mt-3 flex justify-center">
                    <button
                      type="button"
                      disabled
                      className="px-3 py-1.5 text-[11px] rounded-full border border-line text-ink-3 cursor-not-allowed opacity-60"
                    >
                      管理监控
                    </button>
                  </div>
                </div>
              </div>
            </Glass>
          </div>
        </div>

        {/* Heat curve — /stats/heat-curve */}
        <Glass className="fade-up mt-5" style={{ animationDelay: '0.5s' }}>
          <div className="px-6 py-5">
            <div className="flex justify-between items-baseline mb-4">
              <h3 className="text-[16px] font-bold tracking-tight">🌊 今日热度波形</h3>
              <span className="font-mono text-[11px] text-ink-3">
                每小时聚合 · 24 小时
              </span>
            </div>
            <HeatCurve data={heatCurve.buckets} labels={heatCurve.hourLabels} />
          </div>
        </Glass>
      </div>
    </>
  );
}

// Lightweight relative-time formatter for the hot list time chip. Avoids
// pulling in a full i18n lib for a single use site. Mirrors the SP-8 mockup
// strings (`N 分钟前 / N 小时前 / N 天前`).
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `${Math.max(1, min)} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}
