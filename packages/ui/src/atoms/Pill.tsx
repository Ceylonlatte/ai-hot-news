type Platform = 'HACKERNEWS' | 'REDDIT' | 'RSS' | 'TWITTER';

export interface PillProps {
  platform: Platform;
}

const PLATFORM_META: Record<Platform, { label: string; cls: string }> = {
  HACKERNEWS: { label: 'HN',     cls: 'bg-ink/[0.06] text-ink' },
  REDDIT:     { label: 'Reddit', cls: 'bg-aurora-soft text-aurora' },
  RSS:        { label: 'RSS',    cls: 'bg-ink-2/[0.08] text-ink-2' },
  TWITTER:    { label: 'X',      cls: 'bg-aurora-soft text-aurora' },
};

export function Pill({ platform }: PillProps) {
  const meta = PLATFORM_META[platform];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}
