'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

// SP-12 (2026-05-22): vault search box.
//
// Client component because we need router.push() on submit. State is
// transient (form field value before submit); URL becomes single source
// of truth on submit so reload / share works naturally.
//
// On submit:
//   - empty trimmed q → push '/vault' (clears search)
//   - non-empty → push '/vault?q=<encoded>'
//
// Existing tag filter (`?tags=`) is intentionally NOT carried into the
// new URL — submitting a new search resets prior tag filters. This matches
// the search-engine mental model ("start fresh"). Users wanting to combine
// search + tag click the tag chip from the result list afterwards.
export function SearchInput({ initialQ }: { initialQ: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQ);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = value.trim();
    router.push(trimmed ? `/vault?q=${encodeURIComponent(trimmed)}` : '/vault');
  };

  return (
    <form onSubmit={onSubmit} className="mt-2 flex gap-2 max-w-xl">
      <div className="relative flex-1">
        <input
          name="q"
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="搜索热点 · 标题 / 摘要 / 标签 / 关键词"
          maxLength={200}
          aria-label="搜索"
          className="w-full px-4 py-2 pr-10 rounded-full bg-white/65 border border-line text-[14px] text-ink placeholder-ink-3 focus:outline-none focus:border-aurora focus:bg-white transition-all"
        />
        {value ? (
          <button
            type="button"
            onClick={() => setValue('')}
            aria-label="清空搜索框"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink text-sm"
          >
            ✕
          </button>
        ) : null}
      </div>
      <button
        type="submit"
        className="px-4 py-2 rounded-full text-white text-[13px] font-semibold shadow-sm transition-all"
        style={{ background: 'var(--grad)' }}
      >
        搜索
      </button>
    </form>
  );
}
