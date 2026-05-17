import { type ComponentType, type CSSProperties, type ReactNode, createElement } from 'react';

export interface NavLinkProps {
  href: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  'aria-current'?: 'page';
}

export interface SidebarProps {
  currentPath: string;
  LinkComponent: ComponentType<NavLinkProps>;
  /** Sidebar 右侧通知徽标计数（V1 hard-code 3 占位；SP-17 接通真值）*/
  notifCount?: number;
}

type NavItem = { href: string; label: string; en: string; icon: string };

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: '/', label: '今日热点', en: 'Dashboard', icon: '✦' },
  { href: '/news', label: '热点流', en: 'Hot Feed', icon: '◔' },
  { href: '/radar', label: '关键词监控', en: 'Keyword Radar', icon: '◈' },
  { href: '/trends', label: '趋势分析', en: 'Trends', icon: '◬' },
  { href: '/vault', label: '内容库', en: 'Vault', icon: '◎' },
];

const STATUS_ITEMS: ReadonlyArray<[string, string]> = [
  ['数据抓取', '正常'],
  ['AI 摘要', '运行中'],
  ['推送服务', '就绪'],
];

export function Sidebar({ currentPath, LinkComponent, notifCount = 3 }: SidebarProps) {
  const activePath = currentPath || '/';
  return (
    <aside
      className="hidden md:flex md:flex-col w-60 shrink-0 h-screen sticky top-0 gap-1.5 px-4 py-5 relative z-[2]"
      data-testid="sidebar"
    >
      {/* Logo block */}
      <div className="glass flex items-center gap-3 px-3.5 py-4 mb-2">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center font-extrabold text-white text-sm shrink-0"
          style={{ background: 'var(--grad)', boxShadow: '0 4px 12px rgba(20,19,26,0.24)' }}
        >
          AI
        </div>
        <div className="leading-tight">
          <div className="font-bold text-sm text-ink">Hot News</div>
          <div className="text-[11px] text-ink-3 mt-0.5">AI 信息聚合</div>
        </div>
      </div>

      {/* Navigation */}
      <div className="glass flex-1 flex flex-col gap-0.5 p-1.5 overflow-hidden">
        <div className="font-mono text-[9px] text-ink-3 tracking-[0.15em] uppercase px-3 pt-2.5 pb-1.5">
          Navigation
        </div>
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === activePath ||
            (item.href !== '/' && activePath.startsWith(item.href));
          const cls = [
            'flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-left transition-colors',
            isActive
              ? 'text-white font-semibold'
              : 'text-ink hover:bg-white/60',
          ].join(' ');
          const linkProps: NavLinkProps & { key?: string } = {
            key: item.href,
            href: item.href,
            className: cls,
          };
          if (isActive) {
            linkProps['aria-current'] = 'page';
            linkProps.style = {
              background: 'var(--grad)',
              boxShadow: '0 4px 12px rgba(126,87,245,0.3)',
            };
          }
          return createElement(
            LinkComponent,
            linkProps,
            <>
              <span
                className={`text-[15px] ${isActive ? 'opacity-100' : 'opacity-70'}`}
                aria-hidden="true"
              >
                {item.icon}
              </span>
              <div className="flex-1 leading-tight">
                <div className="text-[13px] font-semibold">{item.label}</div>
                <div
                  className={`font-mono text-[10px] ${isActive ? 'opacity-80' : 'opacity-60'}`}
                >
                  {item.en}
                </div>
              </div>
              {item.href === '/radar' && notifCount > 0 ? (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    isActive
                      ? 'bg-white/25 text-white'
                      : 'bg-ink text-white'
                  }`}
                >
                  {notifCount}
                </span>
              ) : null}
            </>,
          );
        })}
      </div>

      {/* System status + user */}
      <div className="glass px-3.5 py-3">
        <div className="font-mono text-[9px] text-ink-3 tracking-[0.15em] uppercase mb-2.5">
          系统状态
        </div>
        {STATUS_ITEMS.map(([k, v]) => (
          <div
            key={k}
            className="flex justify-between items-center py-1 text-[11px]"
          >
            <span className="text-ink-2">{k}</span>
            <span className="flex items-center gap-1.5 text-emerald-500 font-medium">
              <span
                className="blink w-1.5 h-1.5 rounded-full bg-emerald-500"
                style={{ boxShadow: '0 0 6px #10b981' }}
                aria-hidden="true"
              />
              {v}
            </span>
          </div>
        ))}
        <div className="border-t border-line-2 mt-2.5 pt-2.5 flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white font-semibold text-[11px] shrink-0"
            style={{ background: 'var(--grad)' }}
          >
            张
          </div>
          <div className="flex-1 leading-tight">
            <div className="text-[12px] font-semibold">张研究员</div>
            <div className="text-[10px] text-ink-3 mt-0.5">Pro 用户</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
