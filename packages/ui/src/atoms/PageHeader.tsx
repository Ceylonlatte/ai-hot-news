import type { ReactNode } from 'react';

export interface PageHeaderProps {
  /** 顶部 ✦ kicker（紫色 uppercase tracking）— spec §3.5 */
  kicker?: string;
  /** 主标题（深色） */
  title: string;
  /** 主标题之后的额外片段；与 title 拼接显示，可用于设计稿"今天的 AI 信号潮汐"的双段标题 */
  gradTitle?: string;
  /** 副标题 / 描述，可选 */
  sub?: string;
  /** 右侧 action slot（如生成日报按钮），可选 */
  action?: ReactNode;
}

export function PageHeader({ kicker, title, gradTitle, sub, action }: PageHeaderProps) {
  return (
    <header className="flex items-end justify-between gap-6 mb-5 fade-up">
      <div className="min-w-0">
        {kicker ? (
          <div
            data-pageheader-kicker
            className="font-mono text-[11px] tracking-[0.18em] uppercase text-aurora font-medium mb-2.5"
          >
            ✦ {kicker}
          </div>
        ) : null}
        <h1
          className="text-ink font-bold leading-[1.1]"
          style={{ fontSize: 36, letterSpacing: '-0.03em' }}
        >
          {title}
          {gradTitle ? (
            <>
              {' '}
              <span className="text-ink">{gradTitle}</span>
            </>
          ) : null}
        </h1>
        {sub ? <p className="text-sm text-ink-2 mt-2">{sub}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
