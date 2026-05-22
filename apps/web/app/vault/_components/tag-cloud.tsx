import { Tag } from '@ai-hot-news/ui';
import type { TopTagDto } from '@ai-hot-news/types';

// SP-12 (2026-05-22): tag cloud entry for /vault.
//
// Each chip is a clickable link to `/vault?tags=<tag>` (single-tag filter
// drilldown). When the chip is already selected, the URL toggles it OFF
// rather than nav'ing to itself — mirrors the SP-10 CategoryChips behavior.
//
// Counts are rendered inline as a subtle hint (e.g. "company:OpenAI · 186")
// so users can gauge tag popularity before clicking.
//
// The component is a pure server component (no 'use client') — all state
// lives in the URL, all interactivity is native `<Link>` navigation.
export function TagCloud({
  tags,
  selectedTags,
}: {
  tags: TopTagDto[];
  selectedTags: string[];
}) {
  if (tags.length === 0) return null;

  return (
    <div className="mt-3" aria-label="推荐标签">
      <div className="text-[11px] uppercase tracking-wider text-ink-3 mb-1.5">
        推荐标签 · 近 30 天
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t, i) => {
          const isSelected = selectedTags.includes(t.tag);
          // Click an already-selected tag → URL drops it (toggle off, back
          // to no filter). Click new tag → URL replaces tags with just this one.
          const href = isSelected
            ? '/vault'
            : `/vault?tags=${encodeURIComponent(t.tag)}`;
          return (
            <Tag
              key={t.tag}
              index={i}
              href={href}
              title={
                isSelected
                  ? `取消筛选 ${t.tag}`
                  : `${t.count} 条命中 · 点击筛选 ${t.tag}`
              }
            >
              {t.tag} · {t.count}
            </Tag>
          );
        })}
      </div>
    </div>
  );
}
