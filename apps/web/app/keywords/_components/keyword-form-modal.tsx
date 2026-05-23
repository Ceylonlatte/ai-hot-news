'use client';

import { useEffect, useMemo, useState } from 'react';
import { Glass } from '@ai-hot-news/ui';
import type {
  KeywordMonitorDto,
  MonitorFrequency,
  NotifyChannel,
} from '@ai-hot-news/types';
import {
  ApiError,
  createKeywordClient,
  updateKeywordClient,
} from '@/lib/api';

// SP-15 (2026-05-23): keyword create / edit modal.
//
// Form mirrors KeywordMonitor schema (PRD §5.3 + SP-14 server validation):
//   - keyword        (required, 1..100 chars)
//   - synonyms       (comma-separated chips input, stripped + de-duped client-side
//                     too — server is authoritative but the UX should not
//                     surprise users)
//   - excludeWords   (same shape as synonyms)
//   - platforms      (multi-checkbox; empty = all)
//   - monitorFrequency (radio)
//   - triggerRules   (3 optional numeric fields)
//   - notifyChannels (multi-checkbox; default site)
//   - enabled        (toggle, default true on create; preserved on edit)
//
// Why a raw <form onSubmit> instead of a form library: zero deps, one
// component, ~150 LOC. The shape is small enough that react-hook-form
// would be overkill.

const FREQUENCY_OPTIONS: Array<{ value: MonitorFrequency; label: string }> = [
  { value: 'M15', label: '15 分钟' },
  { value: 'M30', label: '30 分钟' },
  { value: 'H1', label: '1 小时' },
  { value: 'D1', label: '每天' },
];

const PLATFORM_OPTIONS = [
  { value: 'HACKERNEWS', label: 'HackerNews' },
  { value: 'REDDIT', label: 'Reddit' },
  { value: 'RSS', label: 'RSS' },
  { value: 'TWITTER', label: 'Twitter (SP-22)' },
];

const CHANNEL_OPTIONS: Array<{ value: NotifyChannel; label: string }> = [
  { value: 'site', label: '站内' },
  { value: 'email', label: '邮件 (SP-18)' },
  { value: 'feishu', label: '飞书 (SP-23)' },
  { value: 'dingtalk', label: '钉钉 (SP-23)' },
  { value: 'telegram', label: 'Telegram (SP-23)' },
];

export interface KeywordFormModalProps {
  mode: 'create' | 'edit';
  initial?: KeywordMonitorDto;
  onClose: () => void;
  onCreated: (created: KeywordMonitorDto) => void;
  onUpdated: (updated: KeywordMonitorDto) => void;
}

export function KeywordFormModal({
  mode,
  initial,
  onClose,
  onCreated,
  onUpdated,
}: KeywordFormModalProps) {
  const [keyword, setKeyword] = useState(initial?.keyword ?? '');
  const [synonymsRaw, setSynonymsRaw] = useState(
    (initial?.synonyms ?? []).join(', '),
  );
  const [excludeRaw, setExcludeRaw] = useState(
    (initial?.excludeWords ?? []).join(', '),
  );
  const [platforms, setPlatforms] = useState<string[]>(
    initial?.platforms ?? [],
  );
  const [monitorFrequency, setMonitorFrequency] = useState<MonitorFrequency>(
    initial?.monitorFrequency ?? 'H1',
  );
  const [notifyChannels, setNotifyChannels] = useState<NotifyChannel[]>(
    initial?.notifyChannels ?? ['site'],
  );
  const [minCount, setMinCount] = useState(
    initial?.triggerRules?.minCount?.toString() ?? '',
  );
  const [minHeatScore, setMinHeatScore] = useState(
    initial?.triggerRules?.minHeatScore?.toString() ?? '',
  );
  const [growthRatePct, setGrowthRatePct] = useState(
    initial?.triggerRules?.growthRatePct?.toString() ?? '',
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape — better UX than only ☓
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const synonyms = useMemo(() => splitChips(synonymsRaw), [synonymsRaw]);
  const excludeWords = useMemo(() => splitChips(excludeRaw), [excludeRaw]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
      setError('关键词不能为空');
      return;
    }
    setSubmitting(true);
    setError(null);

    const triggerRules = pickRules(minCount, minHeatScore, growthRatePct);

    try {
      if (mode === 'create') {
        const created = await createKeywordClient({
          keyword: trimmedKeyword,
          synonyms,
          excludeWords,
          platforms,
          monitorFrequency,
          notifyChannels,
          triggerRules,
          enabled,
        });
        onCreated(created);
      } else {
        const updated = await updateKeywordClient(initial!.id, {
          keyword: trimmedKeyword,
          synonyms,
          excludeWords,
          platforms,
          monitorFrequency,
          notifyChannels,
          triggerRules,
          enabled,
        });
        onUpdated(updated);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`${err.status}: ${err.message.slice(0, 300)}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('未知错误');
      }
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      data-testid="keyword-form-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Glass className="w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-[16px] font-bold text-ink">
              {mode === 'create' ? '新增关键词' : '编辑关键词'}
            </h2>
            <p className="text-[11px] text-ink-3 mt-0.5">
              同义词命中视为同一个关键词；排除词后置过滤
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-3 hover:text-ink text-[20px] leading-none"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="关键词" required>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              required
              maxLength={100}
              placeholder="如 Claude Code"
              className="w-full px-3 py-2 text-[13px] rounded-lg border border-line-2 bg-white/60 focus:outline-none focus:ring-2 focus:ring-aurora"
              data-testid="kw-input-keyword"
            />
          </Field>

          <Field label="同义词（逗号分隔）" hint="任一命中即视为关键词命中">
            <input
              type="text"
              value={synonymsRaw}
              onChange={(e) => setSynonymsRaw(e.target.value)}
              placeholder="如 claude, Anthropic, claude-code"
              className="w-full px-3 py-2 text-[13px] rounded-lg border border-line-2 bg-white/60 focus:outline-none focus:ring-2 focus:ring-aurora"
              data-testid="kw-input-synonyms"
            />
          </Field>

          <Field label="排除词（逗号分隔）" hint="出现任一则丢弃命中">
            <input
              type="text"
              value={excludeRaw}
              onChange={(e) => setExcludeRaw(e.target.value)}
              placeholder="如 fruit, song"
              className="w-full px-3 py-2 text-[13px] rounded-lg border border-line-2 bg-white/60 focus:outline-none focus:ring-2 focus:ring-aurora"
              data-testid="kw-input-exclude"
            />
          </Field>

          <Field label="平台" hint="空 = 所有平台">
            <div className="flex flex-wrap gap-2">
              {PLATFORM_OPTIONS.map((p) => {
                const checked = platforms.includes(p.value);
                return (
                  <label
                    key={p.value}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] cursor-pointer transition-colors ${
                      checked
                        ? 'text-white'
                        : 'text-ink-2 bg-white/60 border border-line-2 hover:bg-white'
                    }`}
                    style={checked ? { background: 'var(--grad)' } : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePlatform(setPlatforms, p.value)}
                      className="sr-only"
                    />
                    {p.label}
                  </label>
                );
              })}
            </div>
          </Field>

          <Field label="监控频率">
            <div className="flex flex-wrap gap-2">
              {FREQUENCY_OPTIONS.map((f) => (
                <label
                  key={f.value}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] cursor-pointer ${
                    monitorFrequency === f.value
                      ? 'text-white'
                      : 'text-ink-2 bg-white/60 border border-line-2 hover:bg-white'
                  }`}
                  style={
                    monitorFrequency === f.value
                      ? { background: 'var(--grad)' }
                      : undefined
                  }
                >
                  <input
                    type="radio"
                    name="freq"
                    value={f.value}
                    checked={monitorFrequency === f.value}
                    onChange={() => setMonitorFrequency(f.value)}
                    className="sr-only"
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </Field>

          <Field
            label="触发条件（留空 = 任一命中即触发）"
            hint="SP-17 通知服务读取，SP-16 检测阶段不评估"
          >
            <div className="grid grid-cols-3 gap-2">
              <RuleInput
                label="最少命中数"
                value={minCount}
                onChange={setMinCount}
                placeholder="如 5"
              />
              <RuleInput
                label="最低热度"
                value={minHeatScore}
                onChange={setMinHeatScore}
                placeholder="如 70"
              />
              <RuleInput
                label="增速 %"
                value={growthRatePct}
                onChange={setGrowthRatePct}
                placeholder="如 200"
              />
            </div>
          </Field>

          <Field label="推送渠道">
            <div className="flex flex-wrap gap-2">
              {CHANNEL_OPTIONS.map((c) => {
                const checked = notifyChannels.includes(c.value);
                return (
                  <label
                    key={c.value}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] cursor-pointer ${
                      checked
                        ? 'text-white'
                        : 'text-ink-2 bg-white/60 border border-line-2 hover:bg-white'
                    }`}
                    style={checked ? { background: 'var(--grad)' } : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleChannel(setNotifyChannels, c.value)}
                      className="sr-only"
                    />
                    {c.label}
                  </label>
                );
              })}
            </div>
          </Field>

          <Field label="启用">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4 accent-aurora"
              />
              <span className="text-[13px] text-ink-2">
                {enabled ? '启用中（worker 会匹配新 ingest）' : '已停用'}
              </span>
            </label>
          </Field>

          {error ? (
            <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-[12px] border border-red-200">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-line-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-[13px] text-ink-2 hover:bg-white/60 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white shadow-md disabled:opacity-50"
              style={{ background: 'var(--grad)' }}
              data-testid="kw-submit"
            >
              {submitting ? '保存中…' : mode === 'create' ? '创建' : '保存'}
            </button>
          </div>
        </form>
      </Glass>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <label className="text-[12px] font-semibold text-ink-2">
          {label}
          {required ? <span className="text-red-500 ml-0.5">*</span> : null}
        </label>
        {hint ? (
          <span className="text-[10px] text-ink-3 truncate">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function RuleInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="text-[10px] text-ink-3 mb-1">{label}</div>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 text-[12px] rounded-lg border border-line-2 bg-white/60 focus:outline-none focus:ring-2 focus:ring-aurora"
      />
    </div>
  );
}

function splitChips(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,，\n]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function togglePlatform(
  setter: React.Dispatch<React.SetStateAction<string[]>>,
  value: string,
) {
  setter((prev) =>
    prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
  );
}

function toggleChannel(
  setter: React.Dispatch<React.SetStateAction<NotifyChannel[]>>,
  value: NotifyChannel,
) {
  setter((prev) =>
    prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
  );
}

function pickRules(
  minCount: string,
  minHeatScore: string,
  growthRatePct: string,
) {
  const mc = parseFloat(minCount);
  const mh = parseFloat(minHeatScore);
  const gr = parseFloat(growthRatePct);
  const rules: {
    minCount?: number;
    minHeatScore?: number;
    growthRatePct?: number;
  } = {};
  if (Number.isFinite(mc) && mc > 0) rules.minCount = mc;
  if (Number.isFinite(mh) && mh > 0) rules.minHeatScore = mh;
  if (Number.isFinite(gr) && gr > 0) rules.growthRatePct = gr;
  return Object.keys(rules).length > 0 ? rules : null;
}
