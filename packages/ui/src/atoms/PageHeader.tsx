import type { ReactNode } from 'react';

export interface PageHeaderProps {
  /** 顶部小写 kicker（紫色 ✦ uppercase tracking），可选 — spec §3.5 */
  kicker?: string;
  /** 主标题 */
  title: string;
  /** 副标题 / 描述，可选 */
  sub?: string;
  /** 右侧 action slot（如 sort toggle / refresh 按钮），可选 */
  action?: ReactNode;
}

export function PageHeader({ kicker, title, sub, action }: PageHeaderProps) {
  return (
    <header className="flex items-end justify-between mb-6 fade-up">
      <div>
        {kicker && (
          <div
            data-pageheader-kicker
            className="text-[11px] tracking-widest uppercase text-aurora font-semibold mb-2"
          >
            {kicker}
          </div>
        )}
        <h1 className="text-2xl font-bold text-ink tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-ink-2">{sub}</p>}
      </div>
      {action && <div>{action}</div>}
    </header>
  );
}
