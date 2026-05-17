import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill } from './Pill';

describe('Pill', () => {
  it('renders HACKERNEWS as "HackerNews"', () => {
    render(<Pill platform="HACKERNEWS" />);
    expect(screen.getByText('HackerNews')).toBeInTheDocument();
  });

  it('renders REDDIT as "Reddit"', () => {
    render(<Pill platform="REDDIT" />);
    expect(screen.getByText('Reddit')).toBeInTheDocument();
  });

  it('renders RSS as "RSS"', () => {
    render(<Pill platform="RSS" />);
    expect(screen.getByText('RSS')).toBeInTheDocument();
  });

  it('renders TWITTER as "Twitter"', () => {
    render(<Pill platform="TWITTER" />);
    expect(screen.getByText('Twitter')).toBeInTheDocument();
  });

  it('applies aurora purple fg/bg for REDDIT', () => {
    const { container } = render(<Pill platform="REDDIT" />);
    const span = container.querySelector('span')!;
    expect(span.style.color).toBe('rgb(126, 87, 245)');
  });

  it('applies ink black fg for HACKERNEWS', () => {
    const { container } = render(<Pill platform="HACKERNEWS" />);
    const span = container.querySelector('span')!;
    expect(span.style.color).toBe('rgb(20, 19, 26)');
  });
});
