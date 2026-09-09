"use client";

import Link from "next/link";
import Sparkline from "./charts/Sparkline";
import { deltaDir, fmtPercent } from "../lib/format";

export interface MetricCardProps {
  label: string;
  /** Pre-formatted so the caller owns currency/locale decisions. */
  value: string;
  unit?: string;
  /** Percent change vs the prior period. Rendered with an arrow, not colour alone. */
  deltaPct?: number | null;
  /** Free-text footnote — use for provenance or the comparison window. */
  note?: string;
  spark?: number[];
  /** Palette index driving the top accent hairline and the sparkline. */
  hue?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  href?: string;
  /** Position in a .ds-stagger group, driving the entrance delay. */
  index?: number;
}

const ACCENTS = [
  "var(--ds-chart-1)",
  "var(--ds-chart-2)",
  "var(--ds-chart-3)",
  "var(--ds-chart-4)",
  "var(--ds-chart-5)",
  "var(--ds-chart-6)",
  "var(--ds-chart-7)",
];

export default function MetricCard({
  label,
  value,
  unit,
  deltaPct,
  note,
  spark,
  hue = 0,
  href,
  index = 0,
}: MetricCardProps) {
  const dir = deltaDir(deltaPct);
  const body = (
    <>
      <span className="ds-metric-card__label">{label}</span>
      <span className="ds-metric-card__value">
        {value}
        {unit && <span className="ds-metric-card__unit">{unit}</span>}
      </span>
      <span className="ds-metric-card__foot">
        {deltaPct != null && Number.isFinite(deltaPct) ? (
          <span className={`ds-metric-card__delta ds-metric-card__delta--${dir}`}>
            {fmtPercent(Math.abs(deltaPct))}
          </span>
        ) : null}
        {note && <span className="ds-metric-card__note">{note}</span>}
        {spark && spark.length > 0 && (
          <span className="ds-metric-card__spark">
            <Sparkline values={spark} hue={hue} />
          </span>
        )}
      </span>
    </>
  );

  const style = {
    ["--ds-metric-accent" as string]: ACCENTS[hue],
    ["--ds-i" as string]: index,
  };

  if (href) {
    return (
      <Link className="ds-metric-card" href={href} style={style}>
        {body}
      </Link>
    );
  }
  return (
    <div className="ds-metric-card" style={style}>
      {body}
    </div>
  );
}
