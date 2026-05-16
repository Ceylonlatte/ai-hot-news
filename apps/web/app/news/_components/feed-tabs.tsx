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
    <nav className="mb-6 flex gap-1 border-b border-line">
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/news?tab=${t.key}`}
            className={
              'border-b-2 px-4 py-2.5 text-sm transition-colors ' +
              (isActive
                ? 'border-aurora font-medium text-aurora'
                : 'border-transparent text-ink-2 hover:text-ink')
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
