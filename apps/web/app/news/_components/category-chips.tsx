import Link from 'next/link';
import { buildNewsUrl, toggleTag, type NewsFilterState } from './search-params';

// SP-10 (2026-05-21): category chip filter.
//
// 10 个 category 与 SP-5.6 taxonomy v4 一致（packages/prompts/src/taxonomy.ts）。
// 这里 hardcode 而非从 TAXONOMY 动态读取的原因：
//   1. 顺序需要按 UX 重要性手动排（OpenSource / Release 在前），不是字母顺序
//   2. 中文标签是 web-only display 字符串，跟 prompts 包没必要绑死
//   3. SP-5.6 之后 taxonomy 几乎不会再扩，硬编码维护成本低
//
// 如果未来 SP 加新 category，需要同步改：
//   - packages/prompts/src/taxonomy.ts (LLM 看的)
//   - 本文件 CATEGORIES 数组 (用户看的)
const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'category:OpenSource', label: '开源' },
  { value: 'category:Release', label: '模型发布' },
  { value: 'category:Tooling', label: '工具' },
  { value: 'category:Product', label: '产品' },
  { value: 'category:Tutorial', label: '教程' },
  { value: 'category:Research', label: '研究' },
  { value: 'category:Opinion', label: '观点' },
  { value: 'category:Benchmark', label: '基准' },
  { value: 'category:Incident', label: '事故' },
  { value: 'category:Funding', label: '融资' },
];

export function CategoryChips({
  selectedTags,
  state,
}: {
  selectedTags: string[];
  state: Omit<NewsFilterState, 'tags'>;
}) {
  // "全部" chip 仅 active 当所有 category-prefixed tags 都不在 selectedTags 时
  const noCategoryActive = !selectedTags.some((t) => t.startsWith('category:'));

  // "全部" 只清掉 category:* tags，保留其它 namespace（company/model/tech）的选择
  const resetTags = selectedTags.filter((t) => !t.startsWith('category:'));

  return (
    <div
      className="flex flex-wrap gap-1.5"
      role="group"
      aria-label="内容类型筛选"
    >
      <Link
        href={buildNewsUrl({ ...state, tags: resetTags })}
        className={
          'px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors ' +
          (noCategoryActive
            ? 'bg-aurora text-white shadow-sm'
            : 'bg-white/55 text-ink-2 border border-line hover:text-ink')
        }
        aria-current={noCategoryActive ? 'page' : undefined}
      >
        全部
      </Link>
      {CATEGORIES.map(({ value, label }) => {
        const isActive = selectedTags.includes(value);
        const nextTags = toggleTag(selectedTags, value);
        return (
          <Link
            key={value}
            href={buildNewsUrl({ ...state, tags: nextTags })}
            className={
              'px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors ' +
              (isActive
                ? 'bg-aurora text-white shadow-sm'
                : 'bg-white/55 text-ink-2 border border-line hover:text-ink')
            }
            aria-current={isActive ? 'page' : undefined}
            title={value}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
