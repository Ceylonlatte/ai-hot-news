import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Tag } from './Tag';

describe('Tag', () => {
  it('renders children with default aurora color (var(--c1))', () => {
    const { container } = render(<Tag>model:GPT-5</Tag>);
    const span = container.querySelector('span');
    expect(span!.textContent).toBe('model:GPT-5');
    expect(span!.style.color).toBe('var(--c1)');
  });

  it('accepts custom color via prop (highest priority)', () => {
    const { container } = render(
      <Tag color="rgb(255, 0, 0)" index={0}>
        red tag
      </Tag>,
    );
    const span = container.querySelector('span');
    expect(span!.style.color).toBe('rgb(255, 0, 0)');
  });

  it('walks palette colors by index when color is omitted', () => {
    const { container: c0 } = render(<Tag index={0}>a</Tag>);
    const { container: c1 } = render(<Tag index={1}>b</Tag>);
    const { container: c3 } = render(<Tag index={3}>d</Tag>);
    // palette: ['#7e57f5', '#14131a', '#7e57f5', '#5a5763']
    expect(c0.querySelector('span')!.style.color).toBe('rgb(126, 87, 245)');
    expect(c1.querySelector('span')!.style.color).toBe('rgb(20, 19, 26)');
    expect(c3.querySelector('span')!.style.color).toBe('rgb(90, 87, 99)');
  });

  it('wraps around palette modulo length', () => {
    const { container } = render(<Tag index={4}>fifth</Tag>);
    // 4 % 4 === 0 → first color
    expect(container.querySelector('span')!.style.color).toBe('rgb(126, 87, 245)');
  });
});
