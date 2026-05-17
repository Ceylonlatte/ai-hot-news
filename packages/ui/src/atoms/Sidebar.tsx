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
  { href: '/', label: '首页', icon: '✦' },
  { href: '/news', label: '热点流', icon: '◔' },
  { href: '/radar', label: '关键词监控', icon: '◈' },
  { href: '/trends', label: '趋势分析', icon: '◬' },
  { href: '/vault', label: '内容库', icon: '◎' },
];

export function Sidebar({ currentPath, LinkComponent }: SidebarProps) {
  const activePath = currentPath || '/';
  return (
    <aside className="glass-soft hidden md:flex md:flex-col w-60 px-4 py-6 gap-2 md:self-start md:sticky md:top-4 md:max-h-[calc(100vh-2rem)]">
      <div className="px-3 pb-4 mb-2 border-b border-line">
        <div className="font-bold text-base text-ink leading-tight">AI Hot News</div>
        <div className="text-[10px] text-ink-3 mt-1 font-mono tracking-wider">v0.1 · Aurora</div>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === activePath;
          const cls = `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
            isActive
              ? 'bg-aurora-soft text-aurora font-semibold'
              : 'text-ink-2 hover:bg-ink/[0.04]'
          }`;
          return createElement(
            LinkComponent,
            isActive
              ? { key: item.href, href: item.href, className: cls, 'aria-current': 'page' }
              : { key: item.href, href: item.href, className: cls },
            <>
              <span
                className={`w-5 h-5 inline-flex items-center justify-center text-base ${
                  isActive ? 'opacity-100' : 'opacity-60'
                }`}
              >
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
