'use client';

import React, { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Glass, Tag } from '@ai-hot-news/ui';
import type {
  KeywordListResponseDto,
  KeywordMonitorDto,
} from '@ai-hot-news/types';
import {
  ApiError,
  deleteKeywordClient,
  updateKeywordClient,
} from '@/lib/api';
import { KeywordFormModal } from './keyword-form-modal';

// SP-15 (2026-05-23): 关键词监控页 client 主体。
//
// State model:
//   - `items`: local mirror of the server list, updated optimistically on
//     mutate so the UI feels instant. After every mutation we also call
//     router.refresh() to re-pull the RSC tree (cheap intra-docker) so any
//     server-side derived data (e.g. hitCount) is reconciled.
//   - `modal`: 'closed' | { mode: 'create' } | { mode: 'edit', target }
//   - `pendingId`: id of the row currently being mutated (toggle / delete)
//     — drives per-row spinner + disabled state.
//
// Why client component vs server form actions:
//   - Need a stateful modal for create/edit form
//   - Toggle enable + delete should feel instant (optimistic)
//   - SP-15 V1 single-user, no concurrent edits — optimism is safe

type ModalState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; target: KeywordMonitorDto };

const FREQUENCY_LABEL: Record<KeywordMonitorDto['monitorFrequency'], string> = {
  M15: '15 分钟',
  M30: '30 分钟',
  H1: '1 小时',
  D1: '每天',
};

export function KeywordsClient({
  initialData,
}: {
  initialData: KeywordListResponseDto;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialData.items);
  const [modal, setModal] = useState<ModalState>({ mode: 'closed' });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const refreshFromServer = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  const handleCreated = useCallback(
    (created: KeywordMonitorDto) => {
      setItems((prev) => [created, ...prev]);
      setModal({ mode: 'closed' });
      refreshFromServer();
    },
    [refreshFromServer],
  );

  const handleUpdated = useCallback(
    (updated: KeywordMonitorDto) => {
      setItems((prev) =>
        prev.map((it) => (it.id === updated.id ? updated : it)),
      );
      setModal({ mode: 'closed' });
      refreshFromServer();
    },
    [refreshFromServer],
  );

  const handleToggle = useCallback(
    async (row: KeywordMonitorDto) => {
      setPendingId(row.id);
      setError(null);
      // Optimistic flip
      const next = !row.enabled;
      setItems((prev) =>
        prev.map((it) => (it.id === row.id ? { ...it, enabled: next } : it)),
      );
      try {
        const updated = await updateKeywordClient(row.id, { enabled: next });
        setItems((prev) =>
          prev.map((it) => (it.id === row.id ? updated : it)),
        );
        refreshFromServer();
      } catch (err) {
        // Roll back
        setItems((prev) =>
          prev.map((it) =>
            it.id === row.id ? { ...it, enabled: row.enabled } : it,
          ),
        );
        setError(formatErr(err, '切换启用状态失败'));
      } finally {
        setPendingId(null);
      }
    },
    [refreshFromServer],
  );

  const handleDelete = useCallback(
    async (row: KeywordMonitorDto) => {
      const confirmed = window.confirm(
        `确定删除关键词「${row.keyword}」吗？\n该关键词的所有 KeywordHit 记录将被级联删除（${row.hitCount} 条）。`,
      );
      if (!confirmed) return;

      setPendingId(row.id);
      setError(null);
      // Optimistic remove
      const snapshot = items;
      setItems((prev) => prev.filter((it) => it.id !== row.id));
      try {
        await deleteKeywordClient(row.id);
        refreshFromServer();
      } catch (err) {
        setItems(snapshot);
        setError(formatErr(err, '删除失败'));
      } finally {
        setPendingId(null);
      }
    },
    [items, refreshFromServer],
  );

  return (
    <div className="mt-4 space-y-3" data-testid="keywords-client">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] text-ink-3 font-mono">
          {items.length} active
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: 'create' })}
          className="rounded-xl px-4 py-2 text-[13px] font-semibold text-white shadow-md hover:shadow-lg transition-shadow"
          style={{ background: 'var(--grad)' }}
          data-testid="keywords-create-btn"
        >
          + 新增关键词
        </button>
      </div>

      {error ? (
        <Glass className="px-4 py-3 text-[12px] text-red-600" data-testid="keywords-error">
          {error}
        </Glass>
      ) : null}

      {/* Empty state */}
      {items.length === 0 ? (
        <Glass className="px-6 py-12 text-center">
          <div className="text-[15px] font-semibold text-ink mb-2">
            还没有监控关键词
          </div>
          <div className="text-[12px] text-ink-3 mb-4">
            添加你关注的公司、产品或技术，命中后会自动写入数据库并反写卡片标签。
          </div>
          <button
            type="button"
            onClick={() => setModal({ mode: 'create' })}
            className="rounded-xl px-4 py-2 text-[13px] font-semibold text-white"
            style={{ background: 'var(--grad)' }}
          >
            + 新增第一个关键词
          </button>
        </Glass>
      ) : (
        <ul className="space-y-3" data-testid="keywords-list">
          {items.map((row) => (
            <KeywordRow
              key={row.id}
              row={row}
              pending={pendingId === row.id}
              onToggle={() => handleToggle(row)}
              onEdit={() => setModal({ mode: 'edit', target: row })}
              onDelete={() => handleDelete(row)}
            />
          ))}
        </ul>
      )}

      {modal.mode !== 'closed' ? (
        <KeywordFormModal
          mode={modal.mode}
          initial={modal.mode === 'edit' ? modal.target : undefined}
          onClose={() => setModal({ mode: 'closed' })}
          onCreated={handleCreated}
          onUpdated={handleUpdated}
        />
      ) : null}
    </div>
  );
}

function KeywordRow({
  row,
  pending,
  onToggle,
  onEdit,
  onDelete,
}: {
  row: KeywordMonitorDto;
  pending: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li>
      <Glass
        className={`px-4 py-3.5 flex items-center gap-4 ${
          row.enabled ? '' : 'opacity-60'
        }`}
        data-testid={`keyword-row-${row.id}`}
      >
        {/* Status dot */}
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            row.enabled ? 'bg-emerald-500' : 'bg-gray-300'
          }`}
          style={
            row.enabled
              ? { boxShadow: '0 0 8px rgba(16,185,129,0.6)' }
              : undefined
          }
          aria-hidden="true"
        />

        {/* Keyword + synonyms */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold text-ink truncate">
              {row.keyword}
            </span>
            <MetaPill>{FREQUENCY_LABEL[row.monitorFrequency]}</MetaPill>
            <MetaPill>
              {row.platforms.length > 0
                ? row.platforms.join(' / ')
                : '全平台'}
            </MetaPill>
          </div>
          {row.synonyms.length > 0 || row.excludeWords.length > 0 ? (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] text-ink-3">
              {row.synonyms.length > 0 ? (
                <span className="inline-flex items-center gap-1 flex-wrap">
                  <span className="text-ink-3">同义词：</span>
                  {row.synonyms.map((s) => (
                    <Tag key={s} color="#7e57f5">
                      {s}
                    </Tag>
                  ))}
                </span>
              ) : null}
              {row.excludeWords.length > 0 ? (
                <span className="inline-flex items-center gap-1 flex-wrap">
                  <span className="text-ink-3">排除：</span>
                  {row.excludeWords.map((w) => (
                    <Tag key={w} color="#5a5763">
                      −{w}
                    </Tag>
                  ))}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Hit count */}
        <div className="text-right shrink-0">
          <div
            className="text-[20px] font-bold tabular-nums"
            style={{
              background: 'var(--grad)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
            data-testid={`keyword-hits-${row.id}`}
          >
            {row.hitCount}
          </div>
          <div className="text-[10px] text-ink-3 font-mono uppercase tracking-wider">
            hits
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggle}
            disabled={pending}
            className="text-[11px] text-ink-3 hover:text-ink underline-offset-2 hover:underline disabled:opacity-50"
            aria-pressed={row.enabled}
            data-testid={`keyword-toggle-${row.id}`}
          >
            {row.enabled ? '停用' : '启用'}
          </button>
          <button
            type="button"
            onClick={onEdit}
            disabled={pending}
            className="text-[11px] text-ink-2 hover:text-ink underline-offset-2 hover:underline disabled:opacity-50"
            data-testid={`keyword-edit-${row.id}`}
          >
            编辑
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            className="text-[11px] text-red-500 hover:text-red-700 underline-offset-2 hover:underline disabled:opacity-50"
            data-testid={`keyword-delete-${row.id}`}
          >
            删除
          </button>
        </div>
      </Glass>
    </li>
  );
}

function MetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center px-2 py-[2px] rounded-full text-[10px] font-medium text-ink-2 bg-white/60 border border-line-2"
    >
      {children}
    </span>
  );
}

function formatErr(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return `${fallback} (${err.status}): ${err.message.slice(0, 200)}`;
  }
  if (err instanceof Error) return `${fallback}: ${err.message}`;
  return fallback;
}
