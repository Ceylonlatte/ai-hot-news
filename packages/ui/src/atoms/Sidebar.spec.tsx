import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import type { ComponentType, ReactNode } from 'react';

type NavLinkMockProps = {
  href: string;
  children?: ReactNode;
  className?: string;
  'aria-current'?: 'page';
  'data-testid'?: string;
};

const NavLink = (({
  href,
  children,
  className,
  'aria-current': ariaCurrent,
  'data-testid': testIdOverride,
}: NavLinkMockProps) => (
  <a
    href={href}
    data-testid={testIdOverride ?? `link-${href}`}
    className={className}
    aria-current={ariaCurrent}
  >
    {children}
  </a>
)) as ComponentType<NavLinkMockProps>;

describe('Sidebar', () => {
  it('renders all 5 nav items via LinkComponent', () => {
    render(<Sidebar currentPath="/news" LinkComponent={NavLink} />);
    expect(screen.getByTestId('link-/')).toBeInTheDocument();
    expect(screen.getByTestId('link-/news')).toBeInTheDocument();
    expect(screen.getByTestId('link-/keywords')).toBeInTheDocument();
    expect(screen.getByTestId('link-/trends')).toBeInTheDocument();
    expect(screen.getByTestId('link-/vault')).toBeInTheDocument();
  });

  it('marks current path as active (aria-current="page")', () => {
    render(<Sidebar currentPath="/news" LinkComponent={NavLink} />);
    const newsLink = screen.getByTestId('link-/news');
    expect(newsLink.getAttribute('aria-current')).toBe('page');
    const keywordsLink = screen.getByTestId('link-/keywords');
    expect(keywordsLink.getAttribute('aria-current')).toBeNull();
  });

  it('falls back to / when currentPath is empty string', () => {
    render(<Sidebar currentPath="" LinkComponent={NavLink} />);
    const homeLink = screen.getByTestId('link-/');
    expect(homeLink.getAttribute('aria-current')).toBe('page');
  });

  it('treats nested paths (e.g. /news/abc) as active for parent nav', () => {
    render(<Sidebar currentPath="/news/abc" LinkComponent={NavLink} />);
    const newsLink = screen.getByTestId('link-/news');
    expect(newsLink.getAttribute('aria-current')).toBe('page');
  });

  it('renders logo block with AI badge + brand title + sub line', () => {
    render(<Sidebar currentPath="/" LinkComponent={NavLink} />);
    expect(screen.getByText('Hot News')).toBeInTheDocument();
    expect(screen.getByText('AI 信息聚合')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('uses unicode geometric icons matching design mockup (✦◔◈◬◎)', () => {
    render(<Sidebar currentPath="/" LinkComponent={NavLink} />);
    expect(screen.getByText('✦')).toBeInTheDocument();
    expect(screen.getByText('◔')).toBeInTheDocument();
    expect(screen.getByText('◈')).toBeInTheDocument();
    expect(screen.getByText('◬')).toBeInTheDocument();
    expect(screen.getByText('◎')).toBeInTheDocument();
  });

  it('renders bilingual nav labels (Chinese label + English en)', () => {
    render(<Sidebar currentPath="/" LinkComponent={NavLink} />);
    expect(screen.getByText('今日热点')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('热点流')).toBeInTheDocument();
    expect(screen.getByText('Hot Feed')).toBeInTheDocument();
    expect(screen.getByText('关键词监控')).toBeInTheDocument();
    expect(screen.getByText('Keyword Radar')).toBeInTheDocument();
  });

  it('shows notif badge on /keywords ONLY when signed in (notifCount > 0)', () => {
    render(
      <Sidebar
        currentPath="/"
        LinkComponent={NavLink}
        currentUser={{ username: 'admin', role: 'ADMIN' }}
      />,
    );
    const keywordsLink = screen.getByTestId('link-/keywords');
    expect(keywordsLink.textContent).toMatch(/3/);
  });

  it('hides notif badge when signed-out (anonymous user)', () => {
    render(<Sidebar currentPath="/" LinkComponent={NavLink} />);
    const keywordsLink = screen.getByTestId('link-/keywords');
    expect(keywordsLink.querySelector('span.bg-ink')).toBeNull();
  });

  it('hides notif badge on /keywords when notifCount = 0', () => {
    render(
      <Sidebar
        currentPath="/"
        LinkComponent={NavLink}
        notifCount={0}
        currentUser={{ username: 'admin', role: 'ADMIN' }}
      />,
    );
    const keywordsLink = screen.getByTestId('link-/keywords');
    expect(keywordsLink.querySelector('span.bg-ink')).toBeNull();
  });

  it('renders system status panel with 3 services', () => {
    render(<Sidebar currentPath="/" LinkComponent={NavLink} />);
    expect(screen.getByText('系统状态')).toBeInTheDocument();
    expect(screen.getByText('数据抓取')).toBeInTheDocument();
    expect(screen.getByText('AI 摘要')).toBeInTheDocument();
    expect(screen.getByText('推送服务')).toBeInTheDocument();
  });

  it('SP-15: shows login link when signed out (currentUser=null)', () => {
    render(<Sidebar currentPath="/" LinkComponent={NavLink} />);
    expect(screen.getByTestId('sidebar-login')).toBeInTheDocument();
    expect(screen.getByText('游客')).toBeInTheDocument();
    expect(screen.getByText('点击登录')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-logout')).toBeNull();
  });

  it('SP-15: shows username + role + logout form when signed in', () => {
    render(
      <Sidebar
        currentPath="/"
        LinkComponent={NavLink}
        currentUser={{ username: 'admin', role: 'ADMIN' }}
      />,
    );
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('ADMIN')).toBeInTheDocument();
    const logoutBtn = screen.getByTestId('sidebar-logout');
    expect(logoutBtn).toBeInTheDocument();
    const form = logoutBtn.closest('form');
    expect(form?.getAttribute('action')).toBe('/api/auth/logout');
    expect(form?.getAttribute('method')).toBe('post');
    expect(screen.queryByTestId('sidebar-login')).toBeNull();
  });

  it('SP-15: customizes loginPath + logoutPath overrides', () => {
    const { rerender } = render(
      <Sidebar
        currentPath="/"
        LinkComponent={NavLink}
        loginPath="/custom-login"
      />,
    );
    const loginLink = screen.getByTestId('sidebar-login');
    expect(loginLink.getAttribute('href')).toBe('/custom-login');

    rerender(
      <Sidebar
        currentPath="/"
        LinkComponent={NavLink}
        currentUser={{ username: 'admin', role: 'ADMIN' }}
        logoutPath="/custom-logout"
      />,
    );
    const form = screen.getByTestId('sidebar-logout').closest('form');
    expect(form?.getAttribute('action')).toBe('/custom-logout');
  });

  it('SP-15: drops legacy "张研究员" / "Pro 用户" hard-code', () => {
    render(<Sidebar currentPath="/" LinkComponent={NavLink} />);
    expect(screen.queryByText('张研究员')).toBeNull();
    expect(screen.queryByText('Pro 用户')).toBeNull();
  });
});
