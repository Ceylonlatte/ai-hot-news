import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HeatBadge } from './HeatBadge';

describe('HeatBadge', () => {
  it('renders null when score and level are null (worker not yet processed)', () => {
    const { container } = render(<HeatBadge score={null} level={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders BURST level with pulse-ring class (visual emphasis)', () => {
    const { container } = render(<HeatBadge score={94} level="BURST" />);
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span!.className).toContain('pulse-ring');
    expect(span!.className).toContain('bg-aurora');
  });

  it('renders HOT level with aurora-soft2 background, no pulse-ring', () => {
    const { container } = render(<HeatBadge score={76} level="HOT" />);
    const span = container.querySelector('span');
    expect(span!.className).toContain('bg-aurora-soft2');
    expect(span!.className).not.toContain('pulse-ring');
  });

  it('renders NORMAL level without pulse-ring', () => {
    const { container } = render(<HeatBadge score={50} level="NORMAL" />);
    const span = container.querySelector('span');
    expect(span!.className).not.toContain('pulse-ring');
  });

  it('rounds float score to nearest integer (Math.round)', () => {
    const { container } = render(<HeatBadge score={85.7} level="HOT" />);
    expect(container.textContent).toBe('86');
  });
});
