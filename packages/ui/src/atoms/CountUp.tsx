'use client';

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

export interface CountUpProps {
  /** Target integer to count up to. Negative supported. */
  value: number;
  /** Duration of the tween in milliseconds (default 1500). */
  duration?: number;
  /** Override the className applied to the wrapping span. */
  className?: string;
  /** Inline style passthrough. */
  style?: CSSProperties;
  /**
   * Optional render override. Receives the current intermediate integer
   * value and returns the JSX to render. Default renders
   * `value.toLocaleString('en-US')` (thousand-separator commas).
   */
  format?: (current: number) => ReactNode;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * SP-9 (2026-05-19): RAF-tweened integer counter for HomePage stat cards.
 *
 * Contract — **first-mount only**: the tween runs exactly once on the
 * component's initial render. Subsequent `value` prop changes are
 * intentionally ignored (the display stays at the most-recently-tweened
 * value). This avoids re-running the animation every time a parent RSC
 * re-renders (e.g. Next router refresh after data revalidation).
 *
 * SSR safety: `useState(0)` ensures the SSR HTML always emits `0` (then
 * formatted to `'0'`), and the client RAF kicks off in `useEffect` after
 * hydration, ramping to `value`. No hydration mismatch.
 *
 * If `requestAnimationFrame` is not available (e.g. some SSR test
 * environments), the component skips the tween and immediately shows
 * the target value — degraded but correct.
 */
export function CountUp({
  value,
  duration = 1500,
  className,
  style,
  format,
}: CountUpProps) {
  const [display, setDisplay] = useState(0);
  const targetRef = useRef(value);

  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') {
      setDisplay(targetRef.current);
      return;
    }
    const target = targetRef.current;
    // We use `Date.now()` instead of `performance.now()` because vitest's
    // fake-timer machinery fakes `Date.now` (so tests can advance time)
    // but does NOT fake `performance.now`. Difference for the 1500ms
    // tween is negligible (Date.now's millisecond granularity is plenty).
    const start = Date.now();
    let raf = 0;

    const tick = (_now: number) => {
      const elapsed = Date.now() - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(t);
      setDisplay(Math.round(target * eased));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
    // First-mount only by design — `targetRef` captures `value` at mount,
    // and subsequent prop changes are intentionally ignored. We omit deps
    // here on purpose; the spec verifies the contract.
  }, []);

  const rendered: ReactNode = format
    ? format(display)
    : display.toLocaleString('en-US');

  return (
    <span className={className} style={style}>
      {rendered}
    </span>
  );
}
