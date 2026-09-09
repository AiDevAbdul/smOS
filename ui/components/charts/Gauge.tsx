"use client";

/**
 * 0–100 arc gauge — used for the Opportunity Score and any other bounded
 * index. Hand-rolled SVG: an arc with a threshold band is fiddly to coax out
 * of a chart library, and this is 40 lines of geometry.
 *
 * The band colour is a verdict, so the numeric value and verdict word are
 * both rendered as text — never colour alone.
 */

import { useChartTheme } from "../../lib/chart-theme";

export interface GaugeProps {
  value: number;
  max?: number;
  label?: string;
  /** Verdict thresholds: below `warn` is calm, above `bad` needs action. */
  bands?: { warn: number; bad: number };
  size?: number;
}

export default function Gauge({
  value,
  max = 100,
  label,
  bands = { warn: 40, bad: 70 },
  size = 168,
}: GaugeProps) {
  const t = useChartTheme();
  const pct = Math.max(0, Math.min(1, value / max));

  const verdict = value >= bands.bad ? "bad" : value >= bands.warn ? "warn" : "good";
  const color = verdict === "bad" ? t.bad : verdict === "warn" ? t.warn : t.good;
  const verdictWord = verdict === "bad" ? "Act now" : verdict === "warn" ? "Worth a look" : "Steady";

  // 240° sweep, opening at the bottom.
  const START = 150;
  const SWEEP = 240;
  const r = 62;
  const cx = 84;
  const cy = 84;

  const polar = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
  };
  const arc = (fromDeg: number, toDeg: number) => {
    const [x1, y1] = polar(fromDeg);
    const [x2, y2] = polar(toDeg);
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--ds-space-1)" }}
      role="img"
      aria-label={`${label ?? "Score"}: ${Math.round(value)} of ${max} — ${verdictWord}`}
    >
      <svg width={size} height={size * 0.72} viewBox="0 0 168 122" style={{ display: "block" }}>
        <path d={arc(START, START + SWEEP)} fill="none" stroke={t.grid} strokeWidth="11" strokeLinecap="round" />
        <path
          d={arc(START, START + SWEEP * pct)}
          fill="none"
          stroke={color}
          strokeWidth="11"
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray var(--ds-dur) var(--ds-ease)" }}
        />
        {/* Threshold ticks so the reader can see where the bands begin. */}
        {[bands.warn, bands.bad].map((b) => {
          const [x, y] = polar(START + SWEEP * (b / max));
          const [xi, yi] = (() => {
            const rad = ((START + SWEEP * (b / max) - 90) * Math.PI) / 180;
            return [cx + (r - 9) * Math.cos(rad), cy + (r - 9) * Math.sin(rad)] as const;
          })();
          return (
            <line key={b} x1={xi} y1={yi} x2={x} y2={y} stroke={t.surface} strokeWidth="2" />
          );
        })}
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          style={{
            fontFamily: "var(--ds-font-display)",
            fontWeight: 700,
            fontSize: 34,
            fill: t.ink,
          }}
        >
          {Math.round(value)}
        </text>
        <text
          x={cx}
          y={cy + 22}
          textAnchor="middle"
          style={{
            fontFamily: "var(--ds-font-mono)",
            fontSize: 9.5,
            letterSpacing: ".08em",
            fill: t.faint,
          }}
        >
          {`OF ${max}`}
        </text>
      </svg>
      <span
        className={
          verdict === "bad"
            ? "ds-badge ds-badge--bad"
            : verdict === "warn"
              ? "ds-badge ds-badge--warn"
              : "ds-badge ds-badge--good"
        }
      >
        {verdictWord}
      </span>
      {label && <span style={{ fontSize: 12, color: "var(--ds-muted)" }}>{label}</span>}
    </div>
  );
}
