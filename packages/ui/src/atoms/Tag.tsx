import type { CSSProperties, ReactNode } from 'react';

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
  /** SP-10: 传 href 则渲染为 <a> 可点击链接，未传保持 <span>（SP-8 dashboard / tags 列表既有用法不破）。 */
  href?: string;
  /** SP-10: 鼠标悬停 tooltip，常用于 "筛选 X" 提示。 */
  title?: string;
}

export function Tag({ children, color, index, href, title }: TagProps) {
  const resolvedColor =
    color ??
    (typeof index === 'number' ? COLOR_PALETTE[index % COLOR_PALETTE.length] : 'var(--c1)');
  const className = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium';
  const style: CSSProperties = {
    background: `color-mix(in srgb, ${resolvedColor} 10%, transparent)`,
    color: resolvedColor,
    border: `1px solid color-mix(in srgb, ${resolvedColor} 20%, transparent)`,
  };

  if (href) {
    return (
      <a
        href={href}
        title={title}
        className={`${className} transition-opacity hover:opacity-80`}
        style={style}
      >
        {children}
      </a>
    );
  }

  return (
    <span className={className} style={style} title={title}>
      {children}
    </span>
  );
}
