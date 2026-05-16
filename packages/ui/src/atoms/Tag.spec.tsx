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

  it('accepts custom color via prop', () => {
    const { container } = render(<Tag color="rgb(255, 0, 0)">red tag</Tag>);
    const span = container.querySelector('span');
    expect(span!.style.color).toBe('rgb(255, 0, 0)');
  });
});
