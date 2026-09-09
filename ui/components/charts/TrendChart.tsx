"use client";

/**
 * Multi-series trend. Line/area over a time or window axis, with an optional
 * threshold reference line drawn from the client's kpis_used.
 *
 * Series are distinguished by stroke pattern as well as hue, so the chart is
 * still readable without color (WCAG: never color alone).
 */

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import GlassTooltip from "./GlassTooltip";
import { useChartTheme, usePrefersReducedMotion } from "../../lib/chart-theme";

export interface TrendSeries {
  key: string;
  label: string;
  /** Index into the 7-hue palette. */
  hue?: number;
  /** Which Y axis: "left" (default) or "right" for a differently-scaled metric. */
  axis?: "left" | "right";
  format?: (v: number) => string;
}

export interface TrendChartProps {
  data: Array<Record<string, number | string | null>>;
  xKey: string;
  series: TrendSeries[];
  xFormat?: (v: string | number) => string;
  leftFormat?: (v: number) => string;
  rightFormat?: (v: number) => string;
  /** e.g. { value: 3.0, label: "ROAS target", axis: "right" } */
  threshold?: { value: number; label: string; axis?: "left" | "right" };
}

const DASH = ["", "5 4", "2 3", "8 4"];

export default function TrendChart({
  data,
  xKey,
  series,
  xFormat,
  leftFormat,
  rightFormat,
  threshold,
}: TrendChartProps) {
  const t = useChartTheme();
  const reduced = usePrefersReducedMotion();
  const hasRight = series.some((s) => s.axis === "right");

  const tickStyle = { fill: t.axis, fontSize: 11, fontFamily: t.fontMono };
  const formats = Object.fromEntries(
    series.filter((s) => s.format).map((s) => [s.key, s.format!])
  ) as Record<string, (v: number) => string>;

  return (
    // key on rev forces a clean re-render when the theme flips, so gradient
    // <defs> pick up the new hues instead of keeping the stale ones.
    <ResponsiveContainer width="100%" height="100%" key={t.rev}>
      <AreaChart data={data} margin={{ top: 8, right: hasRight ? 8 : 16, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s, i) => {
            const color = t.series[(s.hue ?? i) % t.series.length];
            return (
              <linearGradient id={`ds-grad-${s.key}`} key={s.key} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            );
          })}
        </defs>

        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={tickStyle}
          tickFormatter={xFormat as (v: unknown) => string}
          stroke={t.grid}
          tickMargin={8}
          minTickGap={24}
        />
        <YAxis
          yAxisId="left"
          tick={tickStyle}
          tickFormatter={leftFormat as (v: unknown) => string}
          stroke={t.grid}
          width={52}
        />
        {hasRight && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={tickStyle}
            tickFormatter={rightFormat as (v: unknown) => string}
            stroke={t.grid}
            width={48}
          />
        )}

        <Tooltip
          content={<GlassTooltip format={formats} labelFormat={xFormat} />}
          cursor={{ stroke: t.faint, strokeDasharray: "3 3" }}
        />
        <Legend
          iconType="plainline"
          wrapperStyle={{ fontSize: 12, fontFamily: t.font, paddingTop: 4 }}
        />

        {threshold && (
          <ReferenceLine
            y={threshold.value}
            yAxisId={threshold.axis ?? "left"}
            stroke={t.warn}
            strokeDasharray="6 4"
            label={{ value: threshold.label, position: "insideTopRight", fill: t.warn, fontSize: 10 }}
          />
        )}

        {series.map((s, i) => {
          const color = t.series[(s.hue ?? i) % t.series.length];
          return (
            <Area
              key={s.key}
              yAxisId={s.axis ?? "left"}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={color}
              strokeWidth={2}
              strokeDasharray={DASH[i % DASH.length] || undefined}
              fill={`url(#ds-grad-${s.key})`}
              dot={data.length <= 8 ? { r: 3, fill: color, strokeWidth: 0 } : false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: t.surface }}
              isAnimationActive={!reduced}
              animationDuration={520}
              connectNulls
            />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}
