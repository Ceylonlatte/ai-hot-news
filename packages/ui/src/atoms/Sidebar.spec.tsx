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

  it('aside uses glass-soft container per spec §3.6 (was border-r drift)', () => {
    const { container } = render(<Sidebar currentPath="/" LinkComponent={NavLink} />);
    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();
    expect(aside!.className).toMatch(/glass-soft/);
  });

  it('renders logo block with brand title and version sub per spec §3.6', () => {
    render(<Sidebar currentPath="/" LinkComponent={NavLink} />);
    expect(screen.getByText('AI Hot News')).toBeInTheDocument();
    expect(screen.getByText(/v0\.1 · Aurora/)).toBeInTheDocument();
  });

  it('uses unicode geometric icons matching design mockup (✦◔◈◬◎)', () => {
    render(<Sidebar currentPath="/" LinkComponent={NavLink} />);
    expect(screen.getByText('✦')).toBeInTheDocument();
    expect(screen.getByText('◔')).toBeInTheDocument();
    expect(screen.getByText('◈')).toBeInTheDocument();
    expect(screen.getByText('◬')).toBeInTheDocument();
    expect(screen.getByText('◎')).toBeInTheDocument();
  });
});
