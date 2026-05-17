import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import type { ComponentType, ReactNode } from 'react';

const NavLink: ComponentType<{
  href: string;
  children?: ReactNode;
  className?: string;
  'aria-current'?: 'page';
}> = ({ href, children, className, 'aria-current': ariaCurrent }) => (
  <a href={href} data-testid={`link-${href}`} className={className} aria-current={ariaCurrent}>
    {children}
  </a>
);

describe('Sidebar', () => {
  it('renders all 5 nav items via LinkComponent', () => {
    render(<Sidebar currentPath="/news" LinkComponent={NavLink} />);
    expect(screen.getByTestId('link-/')).toBeInTheDocument();
    expect(screen.getByTestId('link-/news')).toBeInTheDocument();
    expect(screen.getByTestId('link-/radar')).toBeInTheDocument();
    expect(screen.getByTestId('link-/trends')).toBeInTheDocument();
    expect(screen.getByTestId('link-/vault')).toBeInTheDocument();
  });

  it('marks current path as active (aria-current="page")', () => {
    render(<Sidebar currentPath="/news" LinkComponent={NavLink} />);
    const newsLink = screen.getByTestId('link-/news');
    expect(newsLink.getAttribute('aria-current')).toBe('page');
    const radarLink = screen.getByTestId('link-/radar');
    expect(radarLink.getAttribute('aria-current')).toBeNull();
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

  it('shows notif badge on /radar when notifCount > 0 (defaults to 3)', () => {
    render(<Sidebar currentPath="/" LinkComponent={NavLink} />);
    const radarLink = screen.getByTestId('link-/radar');
    expect(radarLink.textContent).toMatch(/3/);
  });

  it('hides notif badge on /radar when notifCount = 0', () => {
    render(<Sidebar currentPath="/" LinkComponent={NavLink} notifCount={0} />);
    const radarLink = screen.getByTestId('link-/radar');
    expect(radarLink.querySelector('span.bg-ink')).toBeNull();
  });

  it('renders system status panel with 3 services', () => {
    render(<Sidebar currentPath="/" LinkComponent={NavLink} />);
    expect(screen.getByText('系统状态')).toBeInTheDocument();
    expect(screen.getByText('数据抓取')).toBeInTheDocument();
    expect(screen.getByText('AI 摘要')).toBeInTheDocument();
    expect(screen.getByText('推送服务')).toBeInTheDocument();
  });

  it('renders user card with avatar + name + tier', () => {
    render(<Sidebar currentPath="/" LinkComponent={NavLink} />);
    expect(screen.getByText('张研究员')).toBeInTheDocument();
    expect(screen.getByText('Pro 用户')).toBeInTheDocument();
  });
});
