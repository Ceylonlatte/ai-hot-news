import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { CountUp } from './CountUp';

/**
 * Helper: replaces `requestAnimationFrame` / `cancelAnimationFrame` with a
 * setTimeout-based shim so that vitest fake timers can drive the loop.
 *
 * Each rAF callback fires after ~16ms of fake time. The shim returns a
 * monotonically increasing handle so cancelAnimationFrame can match it.
 */
function installRafShim() {
  let handle = 0;
  const handles = new Map<number, ReturnType<typeof setTimeout>>();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    handle += 1;
    const id = handle;
    const t = setTimeout(() => {
      handles.delete(id);
      cb(performance.now());
    }, 16);
    handles.set(id, t);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    const t = handles.get(id);
    if (t) {
      clearTimeout(t);
      handles.delete(id);
    }
  });
}

describe('<CountUp>', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installRafShim();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders 0 on initial mount (SSR-safe baseline)', () => {
    const { container } = render(<CountUp value={1000} duration={1000} />);
    expect(container.textContent).toBe('0');
  });

  it('ramps to the target after duration elapses', () => {
    const { container } = render(<CountUp value={100} duration={1000} />);
    expect(container.textContent).toBe('0');
    act(() => {
      // Run long enough for the RAF loop to complete (duration + slop).
      vi.advanceTimersByTime(1200);
    });
    expect(container.textContent).toBe('100');
  });

  it('formats with thousand-separator commas by default', () => {
    const { container } = render(<CountUp value={2847} duration={500} />);
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(container.textContent).toBe('2,847');
  });

  it('does NOT re-tween when value prop changes (first-mount only contract)', () => {
    const { container, rerender } = render(
      <CountUp value={100} duration={500} />,
    );
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(container.textContent).toBe('100');
    rerender(<CountUp value={500} duration={500} />);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    // Display stays at the first-mount target (100), ignoring the new prop.
    expect(container.textContent).toBe('100');
  });

  it('honors the optional format render override', () => {
    const { container } = render(
      <CountUp value={42} duration={100} format={(n) => `~${n}~`} />,
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.textContent).toBe('~42~');
  });

  it('applies className and style to the wrapping span', () => {
    const { container } = render(
      <CountUp
        value={1}
        className="my-stat"
        style={{ fontSize: 36, color: 'red' }}
      />,
    );
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span!.className).toBe('my-stat');
    expect(span!.getAttribute('style')).toMatch(/font-size:\s*36px/);
  });

  it('cleans up RAF on unmount (no leaked callbacks)', () => {
    const { unmount } = render(<CountUp value={100} duration={1000} />);
    unmount();
    // After unmount, advancing timers should not throw / produce warnings.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // Sanity: no React warnings about state-update-on-unmounted-component.
    // (vitest will surface any console.error from React.)
  });

  it('handles zero value gracefully', () => {
    const { container } = render(<CountUp value={0} duration={100} />);
    expect(container.textContent).toBe('0');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.textContent).toBe('0');
  });
});
