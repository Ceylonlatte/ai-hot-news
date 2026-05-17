import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders title and sub (sub field, was renamed from subtitle in fix-spec-drift)', () => {
    render(<PageHeader title="Hot News" sub="real-time aggregation" />);
    expect(screen.getByText('Hot News')).toBeInTheDocument();
    expect(screen.getByText('real-time aggregation')).toBeInTheDocument();
  });

  it('renders title only when sub is omitted', () => {
    render(<PageHeader title="Vault" />);
    expect(screen.getByText('Vault')).toBeInTheDocument();
  });

  it('renders action slot when provided (action field, was renamed from right)', () => {
    render(<PageHeader title="x" action={<button>sort</button>} />);
    expect(screen.getByRole('button', { name: 'sort' })).toBeInTheDocument();
  });

  it('renders kicker above title in aurora color when provided (spec §3.5)', () => {
    render(<PageHeader kicker="LIVE FEED" title="News" />);
    const kicker = screen.getByText('LIVE FEED');
    expect(kicker).toBeInTheDocument();
    expect(kicker.className).toMatch(/text-aurora/);
    expect(kicker.className).toMatch(/uppercase/);
    expect(kicker.className).toMatch(/tracking/);
  });

  it('does not render kicker node when kicker is omitted', () => {
    const { container } = render(<PageHeader title="Vault" />);
    const kickers = container.querySelectorAll('[data-pageheader-kicker]');
    expect(kickers).toHaveLength(0);
  });

  it('uses text-2xl font-bold for h1 (spec §3.5 visual weight)', () => {
    render(<PageHeader title="Weighty Title" />);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Weighty Title' });
    expect(h1.className).toMatch(/text-2xl/);
    expect(h1.className).toMatch(/font-bold/);
  });

  it('applies fade-up entry animation on the wrapper (spec §3.5)', () => {
    const { container } = render(<PageHeader title="t" />);
    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    expect(header!.className).toMatch(/fade-up/);
  });
});
