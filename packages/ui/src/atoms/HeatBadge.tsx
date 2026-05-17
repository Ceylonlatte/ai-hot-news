type HeatLevel = 'BURST' | 'HOT' | 'NORMAL' | 'LOW';

export interface HeatBadgeProps {
  score: number | null;
  level: HeatLevel | null;
  /** Display variant.
   *  - `pill`: «爆发 · 96» 胶囊（默认，匹配设计稿 FeedPage 卡片）
   *  - `circle`: 圆形数字徽章（极紧凑列表场景备用）
   */
  variant?: 'pill' | 'circle';
}

const LEVEL_META: Record<HeatLevel, { label: string; cls: string; pulse: boolean }> = {
  BURST: {
    label: '爆发',
    cls: 'bg-ink/[0.08] text-ink border-ink/15',
    pulse: false,
  },
  HOT: {
    label: '热门',
    cls: 'bg-aurora-soft text-aurora border-aurora/15',
    pulse: false,
  },
  NORMAL: {
    label: '关注',
    cls: 'bg-ink-2/[0.08] text-ink-2 border-ink-2/15',
    pulse: false,
  },
  LOW: {
    label: '普通',
    cls: 'bg-ink-3/[0.10] text-ink-3 border-ink-3/15',
    pulse: false,
  },
};

const CIRCLE_LEVEL_META: Record<HeatLevel, { cls: string; pulse: boolean }> = {
  BURST: { cls: 'bg-aurora text-white', pulse: true },
  HOT: { cls: 'bg-aurora-soft2 text-aurora', pulse: false },
  NORMAL: { cls: 'bg-ink/[0.06] text-ink-2', pulse: false },
  LOW: { cls: 'bg-ink/[0.04] text-ink-3', pulse: false },
};

export function HeatBadge({ score, level, variant = 'pill' }: HeatBadgeProps) {
  if (score === null || level === null) return null;
  const display = Math.round(score);
  if (variant === 'circle') {
    const meta = CIRCLE_LEVEL_META[level];
    return (
      <span
        className={`inline-flex items-center justify-center w-9 h-9 rounded-full text-xs font-mono font-semibold ${meta.cls} ${meta.pulse ? 'pulse-ring' : ''}`}
      >
        {display}
      </span>
    );
  }
  const meta = LEVEL_META[level];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.cls} ${meta.pulse ? 'pulse-ring' : ''}`}
    >
      <span className="tracking-tight">
        {meta.label} · {display}
      </span>
    </span>
  );
}
