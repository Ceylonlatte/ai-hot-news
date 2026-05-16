import { type ComponentType, type ReactNode, createElement } from 'react';

export interface NavLinkProps {
  href: string;
  children?: ReactNode;
  className?: string;
  'aria-current'?: 'page';
}

export interface SidebarProps {
  currentPath: string;
  LinkComponent: ComponentType<NavLinkProps>;
}

const NAV_ITEMS: ReadonlyArray<{ href: string; label: string; icon: string }> = [
  { href: '/', label: 'Home', icon: 'H' },
  { href: '/news', label: 'News', icon: 'N' },
  { href: '/radar', label: 'Radar', icon: 'R' },
  { href: '/trends', label: 'Trends', icon: 'T' },
  { href: '/vault', label: 'Vault', icon: 'V' },
];

export function Sidebar({ currentPath, LinkComponent }: SidebarProps) {
  const activePath = currentPath || '/';
  return (
    <aside className="hidden md:flex md:flex-col w-56 px-4 py-8 border-r border-line">
      <div className="px-3 mb-8 text-lg font-light tracking-tight text-ink">
        Aurora
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === activePath;
          const cls = `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
            isActive
              ? 'bg-aurora-soft text-aurora font-medium'
              : 'text-ink-2 hover:bg-ink/[0.04]'
          }`;
          return createElement(
            LinkComponent,
            isActive
              ? { key: item.href, href: item.href, className: cls, 'aria-current': 'page' }
              : { key: item.href, href: item.href, className: cls },
            <>
              <span className="w-5 h-5 inline-flex items-center justify-center text-xs font-mono opacity-60">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </>,
          );
        })}
      </nav>
    </aside>
  );
}
