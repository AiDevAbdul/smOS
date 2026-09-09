"use client";

/**
 * Portfolio spend + ROAS over time, with a range switcher.
 *
 * The server hands over the full 90-day window and this slices it client-side,
 * so changing the range is instant and needs no API route. The provenance chip
 * is not optional: when the series is 7/14/30-day snapshots rather than daily
 * rows, the chart has to say so.
 */

import { useMemo, useState } from "react";
import ChartCard from "../charts/ChartCard";
import TrendChart from "../charts/TrendChart";
import RankBar from "../charts/RankBar";
import Segmented from "../Segmented";
import { fmtCompact, fmtCurrency, fmtDay, fmtRatio } from "../../lib/format";
import type { DailyPoint, SeriesSource } from "../../lib/metrics";

type Range = "7" | "14" | "30" | "90";

export default function PortfolioTrend({
  rows,
  source,
  note,
  currency = "USD",
  roasTarget,
}: {
  rows: DailyPoint[];
  source: SeriesSource;
  note: string;
  currency?: string;
  roasTarget?: number | null;
}) {
  const [range, setRange] = useState<Range>("30");
  const daily = source === "supabase";

  const data = useMemo(() => {
    if (!daily) return rows; // 3 window points — slicing them is meaningless
    return rows.slice(-Number(range));
  }, [rows, range, daily]);

  const total = data.reduce((a, r) => a + (r.spend ?? 0), 0);
  const conv = data.reduce((a, r) => a + (r.conversions ?? 0), 0);

  /**
   * The fallback rows are CUMULATIVE windows (last 30d / 14d / 7d totals), not
   * successive periods — 30d spend is always ≥ 7d spend by definition. Drawing
   * them as a line produces a confident downward slope that looks like
   * collapsing spend, which is simply false. So when the data isn't daily we
   * change the chart FORM, not just the label: three bars, biggest window
   * first, each read as its own total.
   */
  if (!daily) {
    const windows = [...rows].sort(
      (a, b) => Number(b.date.replace("d", "")) - Number(a.date.replace("d", ""))
    );
    const seven = windows.find((r) => r.date === "7d");
    return (
      <ChartCard
        title="Portfolio spend by window"
        unit={`${currency} · cumulative totals`}
        source={{ label: note, kind: "approx" }}
        height={280}
        empty={windows.length === 0}
        emptyTitle="No spend data yet"
        emptyHint="Run /analyze for a client with a live ad account, or configure Supabase so daily rows are persisted and this becomes a real daily trend."
        summary={
          seven
            ? `Each bar is a rolling total, not a period — the windows overlap. ${
                seven.roas ? `7-day ROAS ${fmtRatio(seven.roas)}.` : ""
              }`
            : "Each bar is a rolling total, not a period — the windows overlap."
        }
        table={{
          head: ["Window", `Spend (${currency})`, "Conversions", "ROAS"],
          rows: windows.map((r) => [
            `Last ${r.date.replace("d", " days")}`,
            fmtCurrency(r.spend, currency),
            r.conversions ?? 0,
            fmtRatio(r.roas),
          ]),
        }}
      >
        <RankBar
          data={windows.map((r) => ({ name: `Last ${r.date.replace("d", " days")}`, value: r.spend }))}
          label={`Spend (${currency})`}
          hue={0}
          sort={false}
          format={(v) => fmtCurrency(v, currency)}
          maxLabelWidth={104}
        />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Portfolio spend & return"
      unit={`${currency} · ${daily ? "per day" : "per window"}`}
      source={{ label: note, kind: daily ? "live" : "approx" }}
      height={280}
      empty={data.length === 0}
      emptyTitle="No spend data yet"
      emptyHint="Run /analyze for a client with a live ad account, or configure Supabase so daily rows are persisted."
      summary={
        data.length
          ? `${fmtCurrency(total, currency)} spent across ${data.length} ${daily ? "days" : "windows"}, ${conv} conversions.`
          : undefined
      }
      actions={
        daily ? (
          <Segmented<Range>
            ariaLabel="Time range"
            value={range}
            onChange={setRange}
            options={[
              { value: "7", label: "7d" },
              { value: "14", label: "14d" },
              { value: "30", label: "30d" },
              { value: "90", label: "90d", disabled: rows.length <= 30 },
            ]}
          />
        ) : undefined
      }
      table={{
        head: ["Period", `Spend (${currency})`, "Conversions", "ROAS"],
        rows: data.map((r) => [
          daily ? fmtDay(r.date) : r.date,
          fmtCurrency(r.spend, currency),
          r.conversions ?? 0,
          fmtRatio(r.roas),
        ]),
      }}
    >
      <TrendChart
        data={data as unknown as Array<Record<string, number | string | null>>}
        xKey="date"
        xFormat={daily ? (v) => fmtDay(String(v)) : (v) => String(v)}
        leftFormat={(v) => fmtCompact(v)}
        rightFormat={(v) => `${v.toFixed(1)}×`}
        threshold={roasTarget ? { value: roasTarget, label: "ROAS target", axis: "right" } : undefined}
        series={[
          { key: "spend", label: `Spend (${currency})`, hue: 0, axis: "left", format: (v) => fmtCurrency(v, currency) },
          { key: "roas", label: "ROAS", hue: 1, axis: "right", format: (v) => fmtRatio(v) },
        ]}
      />
    </ChartCard>
  );
}
