import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill } from './Pill';

describe('Pill', () => {
  it('renders HACKERNEWS as "HN"', () => {
    render(<Pill platform="HACKERNEWS" />);
    expect(screen.getByText('HN')).toBeInTheDocument();
  });

  it('renders REDDIT as "Reddit"', () => {
    render(<Pill platform="REDDIT" />);
    expect(screen.getByText('Reddit')).toBeInTheDocument();
  });

  it('renders RSS as "RSS"', () => {
    render(<Pill platform="RSS" />);
    expect(screen.getByText('RSS')).toBeInTheDocument();
  });

  it('renders TWITTER as "X"', () => {
    render(<Pill platform="TWITTER" />);
    expect(screen.getByText('X')).toBeInTheDocument();
  });
});
