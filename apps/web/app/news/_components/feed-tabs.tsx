import Link from 'next/link';

export type FeedTab = 'community' | 'media';

const TABS: Array<{ key: FeedTab; label: string }> = [
  { key: 'community', label: '社区热点 · 48h' },
  { key: 'media', label: '权威媒体 · 7d' },
];

export function parseTab(raw: string | undefined): FeedTab {
  return raw === 'media' ? 'media' : 'community';
}

export function FeedTabs({ active }: { active: FeedTab }) {
  return (
    <nav className="mt-1 flex gap-1.5">
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/news?tab=${t.key}`}
            className={
              'px-3.5 py-1.5 rounded-full text-[12px] transition-all ' +
              (isActive
                ? 'text-white font-semibold shadow-sm'
                : 'text-ink-2 hover:text-ink bg-white/55 border border-white/70')
            }
            style={isActive ? { background: 'var(--grad)', boxShadow: '0 2px 8px rgba(126,87,245,0.3)' } : undefined}
            aria-current={isActive ? 'page' : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
