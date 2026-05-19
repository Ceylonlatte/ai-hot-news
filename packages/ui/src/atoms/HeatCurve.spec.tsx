import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HeatCurve } from './HeatCurve';

describe('<HeatCurve>', () => {
  it('renders an SVG with a polyline whose point count matches data length', () => {
    const data = [10, 20, 30, 40, 50, 60, 70, 80];
    const { container } = render(<HeatCurve data={data} />);
    const polyline = container.querySelector('polyline');
    expect(polyline).not.toBeNull();
    const points = polyline!.getAttribute('points')!.trim().split(/\s+/);
    expect(points).toHaveLength(data.length);
  });

  it('renders empty SVG when data is empty (does not crash)', () => {
    const { container } = render(<HeatCurve data={[]} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(container.querySelector('polyline')).toBeNull();
  });

  it('clips data values exceeding maxY without auto-zooming the axis', () => {
    const { container } = render(<HeatCurve data={[200, 0]} maxY={100} />);
    const polyline = container.querySelector('polyline')!;
    const [p0] = polyline.getAttribute('points')!.trim().split(/\s+/);
    const [, y0] = p0!.split(',').map(Number);
    // Clamp keeps the first point above the bottom inset (≈ 0.075 * 120 = 9).
    expect(y0!).toBeLessThanOrEqual(120 * 0.075 + 1);
  });

  it('renders 24 labels at 6-hour interval ticks when labels.length === 24', () => {
    const labels = Array.from({ length: 24 }, (_, i) =>
      `${String(i).padStart(2, '0')}:00`,
    );
    const { container } = render(<HeatCurve data={new Array(24).fill(50)} labels={labels} />);
    // Ticks: [0, 4, 8, 12, 16, 20, 23] — 7 spans
    const spans = container.querySelectorAll('span');
    expect(spans).toHaveLength(7);
    expect(spans[0]!.textContent).toBe('00:00');
    expect(spans[5]!.textContent).toBe('20:00');
    // Last tick is the special "现在" placeholder for the partial bucket.
    expect(spans[6]!.textContent).toBe('现在');
  });

  it('renders all labels verbatim when labels.length !== 24', () => {
    const labels = ['Q1', 'Q2', 'Q3', 'Q4'];
    const { container } = render(<HeatCurve data={[10, 20, 30, 40]} labels={labels} />);
    const spans = container.querySelectorAll('span');
    expect(spans).toHaveLength(4);
    expect(spans[0]!.textContent).toBe('Q1');
    expect(spans[3]!.textContent).toBe('Q4');
  });

  it('emits marker dots: every 4th point when labels absent', () => {
    const { container } = render(<HeatCurve data={new Array(24).fill(50)} />);
    const circles = container.querySelectorAll('circle');
    // indices 0,4,8,12,16,20 + last point (23) → 7 circles
    expect(circles.length).toBe(7);
  });

  it('honors custom width and height in the viewBox', () => {
    const { container } = render(
      <HeatCurve data={[10, 20]} width={500} height={60} />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 500 60');
  });

  it('applies className and style to the wrapper', () => {
    const { container } = render(
      <HeatCurve data={[10, 20]} labels={['a', 'b']} className="my-chart" style={{ marginTop: 8 }} />,
    );
    const wrapper = container.firstChild as HTMLDivElement;
    expect(wrapper.className).toBe('my-chart');
    expect(wrapper.getAttribute('style')).toMatch(/margin-top:\s*8px/);
  });
});
