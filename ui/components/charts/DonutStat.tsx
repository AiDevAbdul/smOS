"use client";

/**
 * Donut for a small proportional split (≤5 slices — beyond that a bar chart
 * is clearer, so the caller should switch form rather than cram this one).
 * The centre carries the total, which is what a donut is actually good for.
 */

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import GlassTooltip from "./GlassTooltip";
import { useChartTheme, usePrefersReducedMotion } from "../../lib/chart-theme";

export interface DonutStatProps {
  data: Array<{ name: string; value: number }>;
  centerLabel?: string;
  centerValue?: string;
  format?: (v: number) => string;
}

export default function DonutStat({ data, centerLabel, centerValue, format }: DonutStatProps) {
  const t = useChartTheme();
  const reduced = usePrefersReducedMotion();

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <ResponsiveContainer width="100%" height="100%" key={t.rev}>
        <PieChart>
          <Tooltip content={<GlassTooltip format={format ? { value: format } : undefined} />} />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 12, fontFamily: t.font }}
            formatter={(v) => <span style={{ color: t.muted }}>{v}</span>}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={2}
            stroke={t.surface}
            strokeWidth={2}
            isAnimationActive={!reduced}
            animationDuration={520}
          >
            {data.map((d, i) => (
              <Cell key={d.name} fill={t.series[i % t.series.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {(centerValue || centerLabel) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            // Legend occupies the bottom strip; nudge the label off centre.
            paddingBottom: 28,
          }}
          aria-hidden="true"
        >
          {centerValue && (
            <span
              style={{
                fontFamily: "var(--ds-font-display)",
                fontWeight: 700,
                fontSize: 24,
                color: "var(--ds-ink)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {centerValue}
            </span>
          )}
          {centerLabel && (
            <span
              style={{
                fontFamily: "var(--ds-font-mono)",
                fontSize: 10,
                letterSpacing: ".07em",
                textTransform: "uppercase",
                color: "var(--ds-muted)",
              }}
            >
              {centerLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
