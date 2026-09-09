"use client";

/**
 * Axis-free inline sparkline. Hand-rolled SVG rather than a Recharts instance:
 * an Overview page renders a dozen of these, and a dozen ResponsiveContainers
 * with their resize observers is real work for a 76×24 glyph.
 *
 * Decorative by design — it shows shape, not values. Every sparkline sits next
 * to the exact number it summarises, so it is aria-hidden.
 */

import { useChartTheme } from "../../lib/chart-theme";

export interface SparklineProps {
  values: number[];
  /** Palette index; or pass an explicit CSS color. */
  hue?: number;
  color?: string;
  filled?: boolean;
  className?: string;
}

export default function Sparkline({
  values,
  hue = 0,
  color,
  filled = true,
  className = "ds-sparkline",
}: SparklineProps) {
  const t = useChartTheme();
  const stroke = color ?? t.series[hue % t.series.length];

  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) {
    // A single point has no shape to show — render a flat hairline so the
    // layout doesn't jump between cards that do and don't have history.
    return (
      <svg className={className} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="16" x2="100" y2="16" stroke={t.grid} strokeWidth="1.5" />
      </svg>
    );
  }

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const step = 100 / (clean.length - 1);
  const pad = 3;

  const pts = clean.map((v, i) => {
    const x = i * step;
    const y = pad + (1 - (v - min) / span) * (32 - pad * 2);
    return [x, y] as const;
  });

  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L100 32 L0 32 Z`;
  const gradId = `ds-spark-${hue}-${clean.length}-${Math.round(max)}`;

  return (
    <svg className={className} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      {filled && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.26" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradId})`} />
        </>
      )}
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.2" fill={stroke} />
    </svg>
  );
}
