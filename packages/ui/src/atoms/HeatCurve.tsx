import type { CSSProperties, ReactNode } from 'react';

export interface HeatCurveProps {
  /**
   * Series values. Length defines the number of plot points. Renders as a
   * smooth (catmull-style) polyline; `0` values are valid (curve dips to
   * the baseline). When `data` is empty, the SVG renders empty (no path).
   */
  data: number[];
  /**
   * Optional labels rendered below the curve at evenly-spaced ticks.
   * - When `labels.length === 24`, ticks at indices [0,4,8,12,16,20,23]
   *   (matches the 6-hour interval of the SP-9 Aurora design).
   * - When `labels.length !== 24`, every label is rendered.
   *
   * The LAST tick (highest index) renders with extra emphasis (font-semibold +
   * text-ink color); the special string `'现在'` is substituted when
   * `labels.length === 24` (for the live partial bucket).
   */
  labels?: string[];
  /**
   * Y-axis max. Defaults to 100 (heat score domain). When a `data` value
   * exceeds `maxY`, the curve is clipped at `maxY` (not the data max), so
   * the chart never auto-zooms away from absolute heat-score semantics.
   */
  maxY?: number;
  /** SVG viewBox width (default 1000). Display is responsive via width="100%". */
  width?: number;
  /** SVG viewBox height (default 120). */
  height?: number;
  /** Optional wrapper className. */
  className?: string;
  /** Optional wrapper style. */
  style?: CSSProperties;
}

// SP-9 (2026-05-19): 24-point sparkline SVG extracted from inline HomePage
// mockup (apps/web/app/page.tsx). Token-driven gradient (`var(--c1)` / `var(--c2)`)
// instead of hardcoded purple — picks up the Aurora palette automatically.
// Reusable: SP-11 detail page heat-history will consume the same component
// (probably with `data.length=72` for a 7-day daily breakdown).
//
// Why not Recharts/ECharts: the chart is purely decorative — no tooltips,
// no zoom, no axis. A 60-line SVG path beats a ~200kb chart-lib import.
export function HeatCurve({
  data,
  labels,
  maxY = 100,
  width = 1000,
  height = 120,
  className,
  style,
}: HeatCurveProps) {
  if (data.length === 0) {
    return (
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={className}
        style={style}
      />
    );
  }

  // Coordinate computation. y is inverted (SVG origin top-left) and inset
  // 7.5% top/bottom so the curve never touches the viewBox edges.
  const yPad = height * 0.075;
  const yRange = height - 2 * yPad;
  const denom = data.length > 1 ? data.length - 1 : 1;

  const pts: Array<[number, number]> = data.map((v, i) => {
    const x = i * (width / denom);
    const clamped = Math.min(Math.max(v, 0), maxY);
    const y = height - yPad - (clamped / maxY) * yRange;
    return [x, y];
  });

  const polylinePoints = pts.map(([x, y]) => `${x},${y}`).join(' ');

  // Closed area path for the soft gradient fill below the line.
  const areaPath =
    `M${pts[0]![0]},${pts[0]![1]}` +
    pts.slice(1).map(([x, y]) => ` L${x},${y}`).join('') +
    ` L${width},${height} L0,${height} Z`;

  // Marker dots: every 4th point when labels absent; otherwise sample by
  // labels.length so dots align with visible ticks.
  const markerStep = labels
    ? Math.max(1, Math.floor(data.length / Math.max(labels.length, 1)))
    : 4;

  const tickIndices: number[] = labels
    ? labels.length === 24
      ? [0, 4, 8, 12, 16, 20, 23]
      : labels.map((_, i) => i)
    : [];

  return (
    <div className={className} style={style}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient id="heatcurve-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--c1, #7e57f5)" />
            <stop offset="50%" stopColor="var(--c2, #a584ff)" />
            <stop offset="100%" stopColor="var(--c1, #7e57f5)" />
          </linearGradient>
          <linearGradient id="heatcurve-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--c1, #7e57f5)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--c1, #7e57f5)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#heatcurve-fill)" />
        <polyline
          points={polylinePoints}
          fill="none"
          stroke="url(#heatcurve-line)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {pts.map(([x, y], i) => {
          if (i % markerStep !== 0 && i !== pts.length - 1) return null;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="3"
              fill="#fff"
              stroke="var(--c1, #7e57f5)"
              strokeWidth="1.5"
            />
          );
        })}
      </svg>
      {labels ? renderLabelStrip(labels, tickIndices) : null}
    </div>
  );
}

function renderLabelStrip(labels: string[], tickIndices: number[]): ReactNode {
  const lastIdx = labels.length - 1;
  return (
    <div className="flex justify-between mt-2 font-mono">
      {tickIndices.map((idx) => {
        const isLast = idx === lastIdx;
        const showText = isLast && labels.length === 24 ? '现在' : labels[idx];
        return (
          <span
            key={idx}
            className={`text-[10px] ${isLast ? 'text-ink font-semibold' : 'text-ink-3'}`}
          >
            {showText}
          </span>
        );
      })}
    </div>
  );
}
