import { Glass, PageHeader, Pill, HeatBadge } from '@ai-hot-news/ui';
import { MockupBanner } from './_components/MockupBanner';

type Platform = 'HACKERNEWS' | 'REDDIT' | 'RSS' | 'TWITTER';

const TOP_NEWS: Array<{
  id: number;
  title: string;
  platforms: Platform[];
  time: string;
  heat: number;
  level: 'BURST' | 'HOT' | 'NORMAL';
}> = [
  { id: 1, title: 'Claude 4 发布：Anthropic 推出最强编程模型',     platforms: ['TWITTER', 'HACKERNEWS', 'REDDIT'], time: '23 分钟前', heat: 96, level: 'BURST' },
  { id: 2, title: 'OpenAI o3 API 价格大幅下降 80%',                 platforms: ['TWITTER', 'RSS'],                  time: '1 小时前',   heat: 91, level: 'BURST' },
  { id: 3, title: 'Cursor 0.50：内置 AI Security Review 功能',     platforms: ['HACKERNEWS', 'REDDIT', 'TWITTER'], time: '2 小时前',   heat: 88, level: 'HOT' },
  { id: 4, title: 'llama.cpp 支持在 MacBook M4 上运行 70B 模型',    platforms: ['HACKERNEWS', 'REDDIT'],            time: '3 小时前',   heat: 84, level: 'HOT' },
  { id: 5, title: 'Gemini 2.5 Pro 多模态评测：视频理解超越 GPT-4V', platforms: ['RSS', 'TWITTER'],                  time: '4 小时前',   heat: 79, level: 'HOT' },
  { id: 6, title: 'LangGraph 1.0 发布：生产级 Agent 工作流编排',    platforms: ['HACKERNEWS', 'TWITTER'],           time: '5 小时前',   heat: 76, level: 'HOT' },
];

const TRENDING_KEYWORDS = [
  { kw: 'Vibe Coding', g: 320, c: '#14131a' },
  { kw: 'Claude 4',    g: 280, c: '#7e57f5' },
  { kw: 'AI Agent',    g: 145, c: '#5a5763' },
  { kw: 'Local LLM',   g: 98,  c: '#7e57f5' },
  { kw: 'Cursor',      g: 87,  c: '#7e57f5' },
];

const SOURCE_DISTRIBUTION: Array<{ platform: Platform; pct: number }> = [
  { platform: 'TWITTER',    pct: 42 },
  { platform: 'HACKERNEWS', pct: 28 },
  { platform: 'REDDIT',     pct: 21 },
  { platform: 'RSS',        pct: 9 },
];

const ALERTS = [
  { kw: 'OpenAI',      hits: 384, last: '2 分钟前' },
  { kw: 'Claude Code', hits: 127, last: '5 分钟前' },
  { kw: 'Cursor',      hits: 156, last: '15 分钟前' },
];

const PLATFORM_COLOR: Record<Platform, string> = {
  HACKERNEWS: '#14131a',
  REDDIT:     '#7e57f5',
  RSS:        '#5a5763',
  TWITTER:    '#7e57f5',
};

const STATS = [
  { l: '今日聚合',   v: '2,847', d: '较昨日 ↑ 23%',  icon: '📥', c: '#7e57f5' },
  { l: '爆发事件',   v: '7',     d: '过去 24 小时',  icon: '🔥', c: '#14131a' },
  { l: '关键词命中', v: '1,203', d: '6 个监控中',    icon: '🎯', c: '#7e57f5' },
  { l: '信源覆盖',   v: '4',     d: '全部在线',      icon: '🌐', c: '#5a5763' },
];

const HEAT_CURVE = [12, 18, 24, 31, 28, 45, 67, 89, 94, 78, 56, 43, 38, 51, 76, 92, 87, 74, 62, 55, 48, 39, 44, 58];

function HeatCurve() {
  const w = 1000;
  const h = 120;
  const max = 100;
  const pts = HEAT_CURVE.map((v, i) => `${i * (w / (HEAT_CURVE.length - 1))},${h - (v / max) * h * 0.85 - h * 0.075}`);
  return (
    <div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="hc-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#7e57f5" />
            <stop offset="50%" stopColor="#a584ff" />
            <stop offset="100%" stopColor="#7e57f5" />
          </linearGradient>
          <linearGradient id="hc-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#7e57f5" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#7e57f5" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`M${pts[0]} ${pts.slice(1).join(' ')} L${w},${h} L0,${h} Z`} fill="url(#hc-fill)" />
        <polyline points={pts.join(' ')} fill="none" stroke="url(#hc-line)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => {
          if (i % 4 !== 0) return null;
          const [x, y] = p.split(',');
          return <circle key={i} cx={x} cy={y} r="3" fill="#fff" stroke="#7e57f5" strokeWidth="1.5" />;
        })}
      </svg>
      <div className="flex justify-between mt-2 font-mono">
        {['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '现在'].map((t, i) => (
          <span key={t} className={`text-[10px] ${i === 6 ? 'text-ink font-semibold' : 'text-ink-3'}`}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function MiniSpark({ data, color = '#7e57f5', w = 60, h = 28 }: { data: number[]; color?: string; w?: number; h?: number }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const pts = data
    .map((v, i) => `${i * (w / (data.length - 1))},${h - ((v - min) / (max - min || 1)) * h * 0.85 - h * 0.075}`)
    .join(' ');
  const last = pts.split(' ').pop()!.split(',');
  return (
    <svg width={w} height={h}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  );
}

export default function HomePage() {
  return (
    <>
      <div className="px-9 pt-7 pb-3">
        <PageHeader
          kicker="Today · 04.26.2026"
          title="今天的"
          gradTitle="AI 信号潮汐"
          sub="过去 24 小时已聚合 2,847 条内容 · 7 个爆发事件 · 1,203 个关键词命中"
          action={
            <button
              type="button"
              className="px-5 py-2.5 rounded-full text-white text-[13px] font-semibold flex items-center gap-2 transition-transform hover:-translate-y-0.5"
              style={{ background: 'var(--grad)', boxShadow: '0 4px 16px rgba(20,19,26,0.21)' }}
            >
              ✨ 生成今日日报
            </button>
          }
        />
        <MockupBanner targetSp="SP-9 (HomePage 真数据)" />
      </div>
      <div className="flex-1 overflow-auto px-9 pb-9">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-3.5 mb-6">
          {STATS.map((s, i) => (
            <Glass key={s.l} variant="hover" className="fade-up" style={{ animationDelay: `${i * 0.08}s` }}>
              <div className="px-5 py-4">
                <div className="flex justify-between items-center mb-3.5">
                  <span className="text-[12px] text-ink-2 font-medium">{s.l}</span>
                  <span className="text-[18px]" aria-hidden="true">
                    {s.icon}
                  </span>
                </div>
                <div
                  className="font-bold leading-none"
                  style={{ fontSize: 36, letterSpacing: '-0.03em', color: s.c }}
                >
                  {s.v}
                </div>
                <div className="text-[11px] text-ink-3 mt-2">{s.d}</div>
              </div>
            </Glass>
          ))}
        </div>

        <div className="grid gap-5" style={{ gridTemplateColumns: '1.7fr 1fr' }}>
          {/* Hot list */}
          <div>
            <div className="flex justify-between items-center mb-3.5">
              <h2 className="text-[20px] font-bold tracking-tight">🌊 热度榜单</h2>
              <a href="/news" className="text-[13px] text-aurora font-medium">
                查看全部 →
              </a>
            </div>
            <div className="flex flex-col gap-2.5">
              {TOP_NEWS.map((n, i) => (
                <Glass
                  key={n.id}
                  variant="hover"
                  className="fade-up"
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  <div className="px-4.5 py-4 flex gap-3.5 items-center" style={{ padding: '16px 18px' }}>
                    <div
                      className="font-extrabold leading-none text-ink"
                      style={{ width: 36, fontSize: 28, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold mb-1.5 truncate">{n.title}</div>
                      <div className="flex gap-1.5 items-center flex-wrap">
                        {n.platforms.map((p) => (
                          <Pill key={p} platform={p} />
                        ))}
                        <span className="text-[11px] text-ink-3">· {n.time}</span>
                      </div>
                    </div>
                    <HeatBadge score={n.heat} level={n.level} />
                  </div>
                </Glass>
              ))}
            </div>
          </div>

          {/* Right side */}
          <div className="flex flex-col gap-4">
            {/* Trending */}
            <Glass className="fade-up" style={{ animationDelay: '0.2s' }}>
              <div className="px-5 py-4">
                <div className="flex items-center justify-between mb-3.5">
                  <h3 className="text-[15px] font-bold tracking-tight">📈 增速最快</h3>
                  <span className="text-[10px] text-ink-3 font-mono">过去 24 小时</span>
                </div>
                {TRENDING_KEYWORDS.map((k, i) => (
                  <div
                    key={k.kw}
                    className="py-2 flex items-center gap-3 fade-up"
                    style={{ animationDelay: `${0.3 + i * 0.05}s` }}
                  >
                    <span className="text-[11px] text-ink-3 w-[18px]">#{i + 1}</span>
                    <span className="flex-1 text-[13px] font-medium">{k.kw}</span>
                    <div className="flex-[1.2] h-[5px] bg-aurora-soft rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full fill-bar"
                        style={{
                          width: `${Math.min(k.g / 3.5, 100)}%`,
                          background: k.c,
                          animationDelay: `${0.5 + i * 0.08}s`,
                        }}
                      />
                    </div>
                    <span
                      className="font-mono text-[12px] font-bold text-right"
                      style={{ width: 54, color: k.c }}
                    >
                      +{k.g}%
                    </span>
                  </div>
                ))}
              </div>
            </Glass>

            {/* Source distribution */}
            <Glass className="fade-up" style={{ animationDelay: '0.3s' }}>
              <div className="px-5 py-4">
                <h3 className="text-[15px] font-bold tracking-tight mb-3.5">🌐 信源分布</h3>
                {SOURCE_DISTRIBUTION.map((s, i) => (
                  <div key={s.platform} className="mb-3">
                    <div className="flex justify-between items-center mb-1.5">
                      <Pill platform={s.platform} />
                      <span className="font-mono text-[11px] text-ink-2 font-semibold">{s.pct}%</span>
                    </div>
                    <div className="h-1.5 bg-aurora-soft/60 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full fill-bar"
                        style={{
                          width: `${s.pct}%`,
                          background: `linear-gradient(90deg, ${PLATFORM_COLOR[s.platform]}, ${PLATFORM_COLOR[s.platform]}aa)`,
                          animationDelay: `${0.4 + i * 0.08}s`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Glass>

            {/* My alerts */}
            <Glass className="fade-up" style={{ animationDelay: '0.4s' }}>
              <div className="px-5 py-4">
                <div className="flex justify-between items-center mb-3.5">
                  <h3 className="text-[15px] font-bold tracking-tight">🔔 我的提醒</h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-ink/10 text-ink">
                    3 条新
                  </span>
                </div>
                {ALERTS.map((a) => (
                  <div
                    key={a.kw}
                    className="py-2 flex items-center gap-2.5 border-b border-line last:border-0"
                  >
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold">{a.kw}</div>
                      <div className="text-[11px] text-ink-3 mt-0.5">
                        命中 {a.hits} · {a.last}
                      </div>
                    </div>
                    <MiniSpark data={[20, 28, 35, 32, 48, 55, a.hits / 5 + 10]} color="#10b981" />
                  </div>
                ))}
              </div>
            </Glass>
          </div>
        </div>

        {/* Heat curve */}
        <Glass className="fade-up mt-5" style={{ animationDelay: '0.5s' }}>
          <div className="px-6 py-5">
            <div className="flex justify-between items-baseline mb-4">
              <h3 className="text-[16px] font-bold tracking-tight">🌊 今日热度波形</h3>
              <span className="font-mono text-[11px] text-ink-3">每小时聚合 · 24 小时</span>
            </div>
            <HeatCurve />
          </div>
        </Glass>
      </div>
    </>
  );
}
