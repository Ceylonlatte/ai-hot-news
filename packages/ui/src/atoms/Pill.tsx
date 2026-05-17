type Platform = 'HACKERNEWS' | 'REDDIT' | 'RSS' | 'TWITTER';

export interface PillProps {
  platform: Platform;
}

/** 设计稿 PLAT 字典对齐（line 115-120）：
 *  - HN  → ink 黑系
 *  - RD  / X → aurora 紫系
 *  - RSS → ink-2 灰系
 *  全部使用浅色 bg + 配色 fg + 同色细边框（color + alpha 22）。
 */
const PLATFORM_META: Record<
  Platform,
  { label: string; color: string; bg: string }
> = {
  HACKERNEWS: { label: 'HackerNews', color: '#14131a', bg: 'rgba(20,19,26,0.06)' },
  REDDIT:     { label: 'Reddit',     color: '#7e57f5', bg: 'rgba(126,87,245,0.10)' },
  RSS:        { label: 'RSS',        color: '#5a5763', bg: 'rgba(90,87,99,0.08)' },
  TWITTER:    { label: 'Twitter',    color: '#7e57f5', bg: 'rgba(126,87,245,0.10)' },
};

export function Pill({ platform }: PillProps) {
  const meta = PLATFORM_META[platform];
  return (
    <span
      className="inline-flex items-center px-2.5 py-[3px] rounded-full text-[11px] font-medium"
      style={{
        color: meta.color,
        background: meta.bg,
        border: `1px solid ${meta.color}22`,
      }}
    >
      {meta.label}
    </span>
  );
}
