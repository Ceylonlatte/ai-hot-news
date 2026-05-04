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
    <nav className="mb-4 flex gap-2 border-b border-gray-200">
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/news?tab=${t.key}`}
            className={
              'border-b-2 px-3 py-2 text-sm transition-colors ' +
              (isActive
                ? 'border-blue-600 font-medium text-blue-700'
                : 'border-transparent text-gray-600 hover:text-gray-900')
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
