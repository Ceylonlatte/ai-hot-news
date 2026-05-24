import { type ComponentType, type CSSProperties, type ReactNode, createElement } from 'react';

export interface NavLinkProps {
  href: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  'aria-current'?: 'page';
}

export interface SidebarCurrentUser {
  username: string;
  role: string;
}

export interface SidebarProps {
  currentPath: string;
  LinkComponent: ComponentType<NavLinkProps>;
  /** Sidebar 右侧通知徽标计数（V1 hard-code 3 占位；SP-17 接通真值）*/
  notifCount?: number;
  /** SP-15: when null/undefined, sidebar shows placeholder "游客" + login link.
   *  When present, shows username + role + logout form posting to /api/auth/logout. */
  currentUser?: SidebarCurrentUser | null;
  /** SP-15: where login link points to (defaults to '/login'). */
  loginPath?: string;
  /** SP-15: where logout form posts to (defaults to '/api/auth/logout'). */
  logoutPath?: string;
}

type NavItem = { href: string; label: string; en: string; icon: string };

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: '/', label: '今日热点', en: 'Dashboard', icon: '✦' },
  { href: '/news', label: '热点流', en: 'Hot Feed', icon: '◔' },
  { href: '/keywords', label: '关键词监控', en: 'Keyword Radar', icon: '◈' },
  { href: '/trends', label: '趋势分析', en: 'Trends', icon: '◬' },
  { href: '/vault', label: '内容库', en: 'Vault', icon: '◎' },
];

const STATUS_ITEMS: ReadonlyArray<[string, string]> = [
  ['数据抓取', '正常'],
  ['AI 摘要', '运行中'],
  ['推送服务', '就绪'],
];

export function Sidebar({
  currentPath,
  LinkComponent,
  notifCount = 3,
  currentUser = null,
  loginPath = '/login',
  logoutPath = '/api/auth/logout',
}: SidebarProps) {
  const activePath = currentPath || '/';
  // SP-15: keep notif badge on /keywords (was /radar) — only show while
  // user is signed in, since notif center is a logged-in-only surface.
  const notifNavHref = '/keywords';
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
              {item.href === notifNavHref && currentUser != null && notifCount > 0 ? (
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
        {/* SP-15: user block — signed-out shows login link;
            signed-in shows username + role + logout form (no JS needed) */}
        <div
          className="border-t border-line-2 mt-2.5 pt-2.5 flex items-center gap-2.5"
          data-testid="sidebar-user"
        >
          {currentUser ? (
            <>
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white font-semibold text-[11px] shrink-0 uppercase"
                style={{ background: 'var(--grad)' }}
                aria-hidden="true"
              >
                {currentUser.username.charAt(0)}
              </div>
              <div className="flex-1 leading-tight min-w-0">
                <div className="text-[12px] font-semibold truncate">
                  {currentUser.username}
                </div>
                <div className="text-[10px] text-ink-3 mt-0.5 truncate">
                  {currentUser.role}
                </div>
              </div>
              <form action={logoutPath} method="post" className="shrink-0">
                <button
                  type="submit"
                  className="text-[10px] text-ink-3 hover:text-ink underline-offset-2 hover:underline transition-colors"
                  aria-label="登出"
                  data-testid="sidebar-logout"
                >
                  登出
                </button>
              </form>
            </>
          ) : (
            createElement(
              LinkComponent,
              {
                href: loginPath,
                className:
                  'flex items-center gap-2.5 w-full text-left hover:opacity-80 transition-opacity',
                'data-testid': 'sidebar-login',
              } as NavLinkProps & { 'data-testid': string },
              <>
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-ink-3 font-semibold text-[11px] shrink-0 border border-line-2"
                  aria-hidden="true"
                >
                  ?
                </div>
                <div className="flex-1 leading-tight min-w-0">
                  <div className="text-[12px] font-semibold">游客</div>
                  <div className="text-[10px] text-ink-3 mt-0.5">点击登录</div>
                </div>
              </>,
            )
          )}
        </div>
        {/* SP-19 PR-B: admin-only ops dashboard link, hidden for guests +
            non-admin roles. Position below user block keeps it out of the
            way on the daily-driver navigation. */}
        {currentUser?.role === 'ADMIN'
          ? createElement(
              LinkComponent,
              {
                href: '/admin',
                className:
                  'mt-1.5 text-[10px] text-ink-3 hover:text-ink underline-offset-2 hover:underline transition-colors text-center',
                'data-testid': 'sidebar-admin-link',
              } as NavLinkProps & { 'data-testid': string },
              <span>⚙ 运维仪表盘</span>,
            )
          : null}
      </div>
    </aside>
  );
}
