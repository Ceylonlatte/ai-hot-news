import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Glass } from './Glass';

describe('Glass', () => {
  it('renders default variant=card with .glass class', () => {
    render(<Glass data-testid="g">hello</Glass>);
    const el = screen.getByTestId('g');
    expect(el.className).toContain('glass');
    expect(el.className).not.toContain('glass-soft');
    expect(el.tagName).toBe('DIV');
  });

  it('renders variant=hover with .glass and .glass-hover classes', () => {
    render(<Glass variant="hover" data-testid="g">x</Glass>);
    const el = screen.getByTestId('g');
    expect(el.className).toContain('glass');
    expect(el.className).toContain('glass-hover');
  });

  it('renders as=article when as prop is set', () => {
    render(<Glass as="article" data-testid="g">x</Glass>);
    const el = screen.getByTestId('g');
    expect(el.tagName).toBe('ARTICLE');
  });
});
