import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HeatBadge } from './HeatBadge';

describe('HeatBadge', () => {
  it('renders null when score and level are null (worker not yet processed)', () => {
    const { container } = render(<HeatBadge score={null} level={null} />);
    expect(container.firstChild).toBeNull();
  });

  describe('pill variant (default)', () => {
    it('renders BURST level as «爆发 · N» pill', () => {
      const { container } = render(<HeatBadge score={94} level="BURST" />);
      expect(container.textContent).toBe('爆发 · 94');
    });

    it('renders HOT level as «热门 · N» pill in aurora soft palette', () => {
      const { container } = render(<HeatBadge score={76} level="HOT" />);
      expect(container.textContent).toBe('热门 · 76');
      const span = container.querySelector('span');
      expect(span!.className).toMatch(/text-aurora/);
      expect(span!.className).toMatch(/bg-aurora-soft/);
    });

    it('renders NORMAL level as «关注 · N»', () => {
      const { container } = render(<HeatBadge score={50} level="NORMAL" />);
      expect(container.textContent).toBe('关注 · 50');
    });

    it('renders LOW level as «普通 · N»', () => {
      const { container } = render(<HeatBadge score={20} level="LOW" />);
      expect(container.textContent).toBe('普通 · 20');
    });

    it('rounds float score to nearest integer (Math.round)', () => {
      const { container } = render(<HeatBadge score={85.7} level="HOT" />);
      expect(container.textContent).toBe('热门 · 86');
    });
  });

  describe('circle variant', () => {
    it('renders BURST level with pulse-ring class (visual emphasis)', () => {
      const { container } = render(
        <HeatBadge score={94} level="BURST" variant="circle" />,
      );
      const span = container.querySelector('span');
      expect(span).not.toBeNull();
      expect(span!.className).toContain('pulse-ring');
      expect(span!.className).toContain('bg-aurora');
      expect(container.textContent).toBe('94');
    });

    it('renders HOT level with aurora-soft2 background, no pulse-ring', () => {
      const { container } = render(
        <HeatBadge score={76} level="HOT" variant="circle" />,
      );
      const span = container.querySelector('span');
      expect(span!.className).toContain('bg-aurora-soft2');
      expect(span!.className).not.toContain('pulse-ring');
    });

    it('renders NORMAL level without pulse-ring', () => {
      const { container } = render(
        <HeatBadge score={50} level="NORMAL" variant="circle" />,
      );
      const span = container.querySelector('span');
      expect(span!.className).not.toContain('pulse-ring');
    });
  });
});
