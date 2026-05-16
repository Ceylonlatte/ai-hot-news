type HeatLevel = 'BURST' | 'HOT' | 'NORMAL' | 'LOW';

export interface HeatBadgeProps {
  score: number | null;
  level: HeatLevel | null;
}

const LEVEL_META: Record<HeatLevel, { cls: string; pulse: boolean }> = {
  BURST:  { cls: 'bg-aurora text-white',                pulse: true },
  HOT:    { cls: 'bg-aurora-soft2 text-aurora',         pulse: false },
  NORMAL: { cls: 'bg-ink/[0.06] text-ink-2',            pulse: false },
  LOW:    { cls: 'bg-ink/[0.04] text-ink-3',            pulse: false },
};

export function HeatBadge({ score, level }: HeatBadgeProps) {
  if (score === null || level === null) return null;
  const meta = LEVEL_META[level];
  const display = Math.round(score);
  return (
    <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full text-xs font-mono font-semibold ${meta.cls} ${meta.pulse ? 'pulse-ring' : ''}`}>
      {display}
    </span>
  );
}
