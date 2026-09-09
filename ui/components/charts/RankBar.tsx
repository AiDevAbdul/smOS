"use client";

/**
 * Horizontal ranked bars — the right form for "which of these is biggest".
 * Sorted descending, value labelled directly on each bar so the eye doesn't
 * have to travel to an axis.
 */

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import GlassTooltip from "./GlassTooltip";
import { useChartTheme, usePrefersReducedMotion } from "../../lib/chart-theme";

export interface RankBarProps {
  data: Array<{ name: string; value: number }>;
  /** Series label shown in the tooltip. */
  label?: string;
  format?: (v: number) => string;
  /** Single hue for the whole set (a ranking is one measure, not categories). */
  hue?: number;
  /** Colour each bar by a verdict instead — e.g. under/over a target. */
  colorBy?: (row: { name: string; value: number }) => "good" | "warn" | "bad" | null;
  maxLabelWidth?: number;
  /** Rankings sort descending; a fixed sequence (e.g. 7d/14d/30d windows)
   *  must keep the caller's order or the labels stop meaning anything. */
  sort?: boolean;
}

export default function RankBar({
  data,
  label = "Value",
  format,
  hue = 0,
  colorBy,
  maxLabelWidth = 130,
  sort = true,
}: RankBarProps) {
  const t = useChartTheme();
  const reduced = usePrefersReducedMotion();
  const rows = sort ? [...data].sort((a, b) => b.value - a.value) : data;
  const base = t.series[hue % t.series.length];

  const pick = (row: { name: string; value: number }) => {
    const verdict = colorBy?.(row);
    if (verdict === "good") return t.good;
    if (verdict === "warn") return t.warn;
    if (verdict === "bad") return t.bad;
    return base;
  };

  return (
    <ResponsiveContainer width="100%" height="100%" key={t.rev}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, left: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={maxLabelWidth}
          tick={{ fill: t.muted, fontSize: 11.5, fontFamily: t.font }}
          stroke={t.grid}
          tickLine={false}
          interval={0}
        />
        <Tooltip
          content={<GlassTooltip format={format ? { value: format } : undefined} />}
          cursor={{ fill: t.grid, fillOpacity: 0.35 }}
        />
        <Bar
          dataKey="value"
          name={label}
          radius={[0, 4, 4, 0]}
          barSize={16}
          isAnimationActive={!reduced}
          animationDuration={520}
        >
          {rows.map((row) => (
            <Cell key={row.name} fill={pick(row)} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={((v: number) => (format ? format(v) : String(v))) as never}
            style={{ fill: t.ink, fontSize: 11.5, fontFamily: t.fontMono, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
