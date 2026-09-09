"use client";

/**
 * Sales funnel as stacked proportional bars, not a tapered SVG funnel — a
 * real pipeline doesn't decrease monotonically (deals skip stages), and a
 * tapered shape would imply an ordering the data doesn't have.
 *
 * Each stage shows its count, its share, and the drop-off from the previous
 * stage as explicit text, per the accessibility note for funnel charts.
 */

import { useChartTheme } from "../../lib/chart-theme";
import { fmtCurrency } from "../../lib/format";

export interface FunnelStage {
  stage: string;
  count: number;
  value: number;
}

export interface FunnelBarProps {
  stages: FunnelStage[];
  currency?: string;
}

function money(n: number, currency: string) {
  return n ? fmtCurrency(n, currency) : "—";
}

export default function FunnelBar({ stages, currency = "USD" }: FunnelBarProps) {
  const t = useChartTheme();
  const max = Math.max(1, ...stages.map((s) => s.count));

  return (
    <ol
      style={{
        listStyle: "none",
        margin: 0,
        padding: "var(--ds-space-2) var(--ds-space-2)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--ds-space-2)",
      }}
    >
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].count : null;
        const drop = prev && prev > 0 ? Math.round(((prev - s.count) / prev) * 100) : null;
        const pct = (s.count / max) * 100;
        const color = t.series[i % t.series.length];

        return (
          <li key={s.stage} style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-3)" }}>
            <span
              style={{
                fontFamily: "var(--ds-font-mono)",
                fontSize: 10.5,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: "var(--ds-muted)",
                width: 88,
                flex: "none",
              }}
            >
              {s.stage}
            </span>

            <span
              style={{
                position: "relative",
                flex: "1 1 auto",
                height: 22,
                background: "var(--ds-ink-tint)",
                borderRadius: "var(--ds-r-sm)",
                overflow: "hidden",
                minWidth: 40,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  inset: "0 auto 0 0",
                  width: `${Math.max(pct, s.count ? 3 : 0)}%`,
                  background: color,
                  borderRadius: "var(--ds-r-sm)",
                  transition: "width var(--ds-dur) var(--ds-ease)",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: "var(--ds-space-2)",
                  top: 0,
                  lineHeight: "22px",
                  fontFamily: "var(--ds-font-mono)",
                  fontSize: 11,
                  fontWeight: 700,
                  color: s.count && pct > 12 ? "#fff" : "var(--ds-ink-2)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {s.count}
              </span>
            </span>

            <span
              style={{
                fontFamily: "var(--ds-font-mono)",
                fontSize: 11,
                color: "var(--ds-ink-2)",
                width: 76,
                textAlign: "right",
                flex: "none",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {money(s.value, currency)}
            </span>

            {/* Drop-off as text, not implied by width alone. */}
            <span
              style={{
                fontFamily: "var(--ds-font-mono)",
                fontSize: 10.5,
                color: drop && drop > 0 ? "var(--ds-red-ink)" : "var(--ds-faint)",
                width: 54,
                textAlign: "right",
                flex: "none",
              }}
            >
              {drop == null ? "" : drop > 0 ? `−${drop}%` : "—"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
