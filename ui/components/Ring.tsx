/**
 * Completion ring. Server-renderable (no hooks) — colours come from CSS
 * classes, not from useChartTheme, so it works in a Server Component and
 * follows the theme without JS.
 */

export interface RingProps {
  /** 0–100. */
  pct: number;
  size?: number;
  stroke?: number;
  /** Ring hue by verdict; defaults to blue (neutral progress). */
  tone?: "blue" | "good" | "warn";
  label?: string;
  /** Accessible description — the ring alone says nothing to a reader. */
  title?: string;
}

export default function Ring({
  pct,
  size = 44,
  stroke = 4,
  tone = "blue",
  label,
  title,
}: RingProps) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamped / 100);
  const fillClass =
    tone === "good" ? "ds-ring__fill ds-ring__fill--good"
    : tone === "warn" ? "ds-ring__fill ds-ring__fill--warn"
    : "ds-ring__fill";

  return (
    <span className="ds-ring-wrap" style={{ width: size, height: size }}>
      <svg className="ds-ring" width={size} height={size} role="img" aria-label={title ?? `${clamped}% complete`}>
        <circle
          className="ds-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
        />
        <circle
          className={fillClass}
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      {label !== undefined && <span className="ds-ring-wrap__label">{label}</span>}
    </span>
  );
}
