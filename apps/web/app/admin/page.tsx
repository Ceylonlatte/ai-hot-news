import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { Glass, PageHeader } from '@ai-hot-news/ui';
import { getCurrentUser } from '@/lib/auth';
import {
  fetchAdminContentPool,
  fetchAdminDbSize,
  fetchAdminFeeder,
  fetchAdminHealth,
  fetchAdminKeywordStats,
  fetchAdminLlmCost,
} from '@/lib/admin-server';
import type {
  AdminContentPoolDto,
  AdminDbSizeDto,
  AdminFeederDto,
  AdminHealthDto,
  AdminKeywordStatsDto,
  AdminLlmCostDto,
} from '@ai-hot-news/types';

// SP-19 PR-B (2026-05-24): admin ops dashboard.
//
// Page guards:
//   - Not signed in → redirect /login?next=/admin
//   - Signed in but role!=ADMIN → render Forbidden screen (V1 only has
//     ADMIN, but the guard is here for SP-X multi-user)
//
// Layout: 6 KPI sections in stack. No charts (KISS), tabular cards.
// Refresh = browser hard reload; Next.js cache:'no-store' makes that
// 1 req/section.

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '运维仪表盘 · AI Hot News',
};

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/admin' as Route);
  if (user.role !== 'ADMIN') {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <PageHeader kicker="Admin" title="访问受限" sub="此页面仅 admin 角色可见。" />
      </div>
    );
  }

  // Parallel fetch — each endpoint is independent.
  const [health, content, feeder, keywords, dbSize, llmCost] =
    await Promise.all([
      fetchAdminHealth(),
      fetchAdminContentPool(),
      fetchAdminFeeder(),
      fetchAdminKeywordStats(),
      fetchAdminDbSize(),
      fetchAdminLlmCost(),
    ]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
      <PageHeader
        kicker="Ops Dashboard"
        title="运维仪表盘"
        sub={`服务器时间 ${health.serverTime} · 数据每次访问实时拉取`}
      />

      <HealthCard data={health} />
      <ContentPoolCard data={content} />
      <FeederCard data={feeder} />
      <KeywordStatsCard data={keywords} />
      <DbSizeCard data={dbSize} />
      <LlmCostCard data={llmCost} />
    </div>
  );
}

// ─── components ─────────────────────────────────────────────────────────

function HealthCard({ data }: { data: AdminHealthDto }) {
  const heartbeatOk =
    data.workerHeartbeatStaleSec !== null &&
    data.workerHeartbeatStaleSec < 120;
  return (
    <Glass className="px-5 py-4">
      <SectionTitle>服务健康</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
        <Kpi
          label="API"
          value={data.apiOk ? '运行中' : '异常'}
          tone={data.apiOk ? 'good' : 'bad'}
        />
        <Kpi
          label="Worker 心跳"
          value={
            data.workerHeartbeatStaleSec === null
              ? '未检测到'
              : `${data.workerHeartbeatStaleSec}s 前`
          }
          tone={heartbeatOk ? 'good' : 'warn'}
        />
        <Kpi
          label="Search Cron 上次"
          value={
            data.lastSearchTickAt ? relativeTime(data.lastSearchTickAt) : '从未'
          }
        />
        <Kpi
          label="Heat Cron 上次"
          value={
            data.lastHeatTickAt ? relativeTime(data.lastHeatTickAt) : '从未'
          }
        />
      </div>
    </Glass>
  );
}

function ContentPoolCard({ data }: { data: AdminContentPoolDto }) {
  const peak24h = Math.max(1, ...data.growth24h.map((g) => g.count));
  return (
    <Glass className="px-5 py-4">
      <SectionTitle>内容池</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px] mb-4">
        <Kpi label="VISIBLE 行" value={data.totalVisible.toLocaleString()} />
        <Kpi label="HIDDEN 行" value={data.totalHidden.toLocaleString()} />
        <Kpi
          label="search 来源"
          value={
            data.bySource
              .find((s) => s.source === 'search')
              ?.count.toLocaleString() ?? '0'
          }
          hint={`/ ${data.totalVisible.toLocaleString()}`}
        />
        <Kpi
          label="平台分布"
          value={data.byPlatform.map((p) => p.platform).join(' / ')}
          hint={data.byPlatform.map((p) => p.count).join(' / ')}
        />
      </div>
      <div>
        <div className="text-[10px] font-mono text-ink-3 uppercase mb-2">
          24h 每小时新增（峰值 {peak24h}）
        </div>
        <div className="flex items-end gap-0.5 h-12">
          {data.growth24h.map((g) => (
            <div
              key={g.hour}
              className="flex-1 rounded-sm"
              title={`${g.hour}: ${g.count} 行`}
              style={{
                height: `${Math.max(2, (g.count / peak24h) * 100)}%`,
                background:
                  g.count > 0 ? 'var(--grad)' : 'rgba(20,19,26,0.06)',
              }}
            />
          ))}
        </div>
      </div>
    </Glass>
  );
}

function FeederCard({ data }: { data: AdminFeederDto }) {
  return (
    <Glass className="px-5 py-4">
      <SectionTitle>Search Feeder</SectionTitle>
      <div className="text-[11px] text-ink-3 mb-3">
        过去 24h 命中数 <strong className="text-ink">{data.hits24h}</strong>
      </div>
      <table className="w-full text-[12px]">
        <thead className="text-[10px] text-ink-3 uppercase font-mono">
          <tr>
            <th className="text-left pb-1">关键词</th>
            <th className="text-left pb-1">频率</th>
            <th className="text-left pb-1">上次搜索</th>
            <th className="text-left pb-1">状态</th>
          </tr>
        </thead>
        <tbody>
          {data.monitors.length === 0 ? (
            <tr>
              <td colSpan={4} className="text-center text-ink-3 py-4">
                暂无关键词
              </td>
            </tr>
          ) : (
            data.monitors.map((m) => (
              <tr key={m.id} className="border-t border-line">
                <td className="py-2">
                  {m.keyword}
                  {!m.enabled ? (
                    <span className="text-[10px] text-ink-3 ml-2">(已停用)</span>
                  ) : null}
                </td>
                <td className="py-2 text-ink-2">
                  {frequencyLabel(m.monitorFrequency)}
                </td>
                <td className="py-2 text-ink-2">
                  {m.minutesSinceLastSearch === null
                    ? '从未'
                    : m.minutesSinceLastSearch < 60
                      ? `${m.minutesSinceLastSearch} 分钟前`
                      : `${Math.floor(m.minutesSinceLastSearch / 60)} 小时前`}
                </td>
                <td className="py-2">
                  <StatusPill
                    tone={
                      !m.enabled ? 'muted' : m.isOverdue ? 'warn' : 'good'
                    }
                  >
                    {!m.enabled ? '已停用' : m.isOverdue ? '延迟' : '正常'}
                  </StatusPill>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Glass>
  );
}

function KeywordStatsCard({ data }: { data: AdminKeywordStatsDto }) {
  return (
    <Glass className="px-5 py-4">
      <SectionTitle>关键词命中分布</SectionTitle>
      <table className="w-full text-[12px]">
        <thead className="text-[10px] text-ink-3 uppercase font-mono">
          <tr>
            <th className="text-left pb-1">关键词</th>
            <th className="text-right pb-1">总命中</th>
            <th className="text-right pb-1">24h 增量</th>
            <th className="text-right pb-1">命中率</th>
          </tr>
        </thead>
        <tbody>
          {data.items.length === 0 ? (
            <tr>
              <td colSpan={4} className="text-center text-ink-3 py-4">
                暂无关键词
              </td>
            </tr>
          ) : (
            data.items.map((it) => (
              <tr key={it.keyword} className="border-t border-line">
                <td className="py-2">
                  {it.keyword}
                  {!it.enabled ? (
                    <span className="text-[10px] text-ink-3 ml-2">(停用)</span>
                  ) : null}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {it.hitCountTotal.toLocaleString()}
                </td>
                <td className="py-2 text-right tabular-nums text-aurora">
                  +{it.hitCount24h.toLocaleString()}
                </td>
                <td className="py-2 text-right tabular-nums text-ink-2">
                  {it.matchRatePct}%
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Glass>
  );
}

function DbSizeCard({ data }: { data: AdminDbSizeDto }) {
  return (
    <Glass className="px-5 py-4">
      <SectionTitle>数据库占用</SectionTitle>
      <table className="w-full text-[12px]">
        <thead className="text-[10px] text-ink-3 uppercase font-mono">
          <tr>
            <th className="text-left pb-1">表</th>
            <th className="text-right pb-1">行数 (估)</th>
            <th className="text-right pb-1">大小</th>
          </tr>
        </thead>
        <tbody>
          {data.tables.map((t) => (
            <tr key={t.name} className="border-t border-line">
              <td className="py-2 font-mono text-[11px]">{t.name}</td>
              <td className="py-2 text-right tabular-nums">
                {t.rowCount.toLocaleString()}
              </td>
              <td className="py-2 text-right tabular-nums">{t.sizePretty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Glass>
  );
}

function LlmCostCard({ data }: { data: AdminLlmCostDto }) {
  return (
    <Glass className="px-5 py-4">
      <SectionTitle>LLM 成本</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {data.windows.map((w) => (
          <div
            key={w.label}
            className="rounded-xl px-4 py-3 bg-white/60 border border-line-2"
          >
            <div className="text-[10px] text-ink-3 uppercase font-mono mb-1">
              {w.label} 滚动
            </div>
            <div className="text-[20px] font-bold tabular-nums">
              {w.totalCostUsd === null
                ? '—'
                : `$${w.totalCostUsd.toFixed(4)}`}
            </div>
            <div className="text-[11px] text-ink-3 mt-1">
              {w.totalCalls} calls · {w.totalTokensIn.toLocaleString()} in /{' '}
              {w.totalTokensOut.toLocaleString()} out tokens
            </div>
          </div>
        ))}
      </div>

      <SectionSubtitle>24h 按 model 拆分</SectionSubtitle>
      <table className="w-full text-[12px]">
        <thead className="text-[10px] text-ink-3 uppercase font-mono">
          <tr>
            <th className="text-left pb-1">操作</th>
            <th className="text-left pb-1">模型</th>
            <th className="text-right pb-1">调用</th>
            <th className="text-right pb-1">in/out tokens</th>
            <th className="text-right pb-1">成本 USD</th>
          </tr>
        </thead>
        <tbody>
          {data.windows[0]!.byModel.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-center text-ink-3 py-4">
                24h 内无 LLM 调用
              </td>
            </tr>
          ) : (
            data.windows[0]!.byModel.map((m) => (
              <tr key={`${m.operation}-${m.model}`} className="border-t border-line">
                <td className="py-2">{m.operation}</td>
                <td className="py-2 font-mono text-[11px]">{m.model}</td>
                <td className="py-2 text-right tabular-nums">{m.calls}</td>
                <td className="py-2 text-right tabular-nums text-ink-2">
                  {m.tokensIn.toLocaleString()} / {m.tokensOut.toLocaleString()}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {m.costUsd === null
                    ? '(未定价)'
                    : `$${m.costUsd.toFixed(6)}`}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Glass>
  );
}

// ─── primitives ─────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[13px] font-bold text-ink mb-3 flex items-center gap-2">
      {children}
    </h2>
  );
}

function SectionSubtitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-mono text-ink-3 uppercase mb-2 mt-1">
      {children}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const valueColor =
    tone === 'good'
      ? 'text-emerald-600'
      : tone === 'warn'
        ? 'text-amber-600'
        : tone === 'bad'
          ? 'text-red-600'
          : 'text-ink';
  return (
    <div className="rounded-xl px-3 py-2 bg-white/60 border border-line-2">
      <div className="text-[10px] text-ink-3 uppercase font-mono">{label}</div>
      <div className={`text-[14px] font-semibold mt-0.5 truncate ${valueColor}`}>
        {value}
      </div>
      {hint ? <div className="text-[10px] text-ink-3 mt-0.5">{hint}</div> : null}
    </div>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: 'good' | 'warn' | 'muted';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'good'
      ? 'bg-emerald-100 text-emerald-700'
      : tone === 'warn'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-gray-100 text-gray-500';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] ${cls}`}>
      {children}
    </span>
  );
}

function frequencyLabel(f: string): string {
  switch (f) {
    case 'M15':
      return '15 分钟';
    case 'M30':
      return '30 分钟';
    case 'H1':
      return '1 小时';
    case 'D1':
      return '每天';
    default:
      return f;
  }
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return '刚刚';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
  return `${Math.floor(ms / 86_400_000)} 天前`;
}
