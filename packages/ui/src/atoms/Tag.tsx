import type { ReactNode } from 'react';

/** 设计稿轮用 4 色（aurora / ink / aurora / ink-2），逻辑用 index%4 取色 */
const COLOR_PALETTE: ReadonlyArray<string> = [
  '#7e57f5',
  '#14131a',
  '#7e57f5',
  '#5a5763',
];

export interface TagProps {
  children: ReactNode;
  /** 显式颜色优先级最高；否则用 index 走 palette；都没有则用 var(--c1)。 */
  color?: string;
  /** 在 palette 中的轮用索引（0..n），不传则使用主紫色 */
  index?: number;
}

export function Tag({ children, color, index }: TagProps) {
  const resolvedColor = color ?? (typeof index === 'number' ? COLOR_PALETTE[index % COLOR_PALETTE.length] : 'var(--c1)');
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{
        background: `color-mix(in srgb, ${resolvedColor} 10%, transparent)`,
        color: resolvedColor,
        border: `1px solid color-mix(in srgb, ${resolvedColor} 20%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}
