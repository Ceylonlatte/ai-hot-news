import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const pushMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { SearchInput } from './search-input';

describe('SearchInput (SP-12)', () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  it('renders with initialQ prefilled into the input', () => {
    const { container } = render(<SearchInput initialQ="OpenAI" />);
    const input = container.querySelector('input[name="q"]') as HTMLInputElement;
    expect(input.value).toBe('OpenAI');
  });

  it('submitting empty form pushes /vault (clears search)', () => {
    const { container } = render(<SearchInput initialQ="" />);
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    expect(pushMock).toHaveBeenCalledWith('/vault');
  });

  it('submitting "Claude" pushes /vault?q=Claude', () => {
    const { container } = render(<SearchInput initialQ="" />);
    const input = container.querySelector('input[name="q"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Claude' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(pushMock).toHaveBeenCalledWith('/vault?q=Claude');
  });

  it('submitting CJK pushes URL-encoded q', () => {
    const { container } = render(<SearchInput initialQ="" />);
    const input = container.querySelector('input[name="q"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '智能体' } });
    fireEvent.submit(container.querySelector('form')!);
    // %E6%99%BA%E8%83%BD%E4%BD%93
    expect(pushMock).toHaveBeenCalledWith('/vault?q=%E6%99%BA%E8%83%BD%E4%BD%93');
  });

  it('trims whitespace before pushing', () => {
    const { container } = render(<SearchInput initialQ="" />);
    const input = container.querySelector('input[name="q"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   Anthropic   ' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(pushMock).toHaveBeenCalledWith('/vault?q=Anthropic');
  });

  it('whitespace-only submission clears search (push /vault)', () => {
    const { container } = render(<SearchInput initialQ="" />);
    const input = container.querySelector('input[name="q"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(pushMock).toHaveBeenCalledWith('/vault');
  });

  it('clear button (✕) appears when value non-empty', () => {
    const { container } = render(<SearchInput initialQ="Anthropic" />);
    const clearBtn = container.querySelector('button[aria-label="清空搜索框"]');
    expect(clearBtn).not.toBeNull();
  });

  it('clear button is hidden when value empty', () => {
    const { container } = render(<SearchInput initialQ="" />);
    const clearBtn = container.querySelector('button[aria-label="清空搜索框"]');
    expect(clearBtn).toBeNull();
  });

  it('maxLength is 200', () => {
    const { container } = render(<SearchInput initialQ="" />);
    const input = container.querySelector('input[name="q"]') as HTMLInputElement;
    expect(input.maxLength).toBe(200);
  });
});
