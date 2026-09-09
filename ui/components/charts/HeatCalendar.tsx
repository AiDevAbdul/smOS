"use client";

/**
 * Content-cadence heat calendar — weeks as columns, weekdays as rows. Answers
 * "is the calendar actually being fed, and where are the gaps" at a glance,
 * which a line chart of post counts does not.
 *
 * Intensity is quantised into 4 steps with a visible legend, and every cell
 * carries a title + aria-label with the exact count (colour is never the only
 * carrier of the value).
 */

import { useChartTheme } from "../../lib/chart-theme";

export interface HeatCalendarProps {
  data: Array<{ date: string; count: number }>;
  /** Weeks to show, counted back from the last data point. */
  weeks?: number;
  hue?: number;
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default function HeatCalendar({ data, weeks = 12, hue = 0 }: HeatCalendarProps) {
  const t = useChartTheme();
  const base = t.series[hue % t.series.length];

  const counts = new Map<string, number>();
  for (const d of data) counts.set(d.date, (counts.get(d.date) ?? 0) + d.count);

  // Anchor on the latest scheduled item, not today — a calendar is mostly
  // future-dated, so anchoring on today would show an empty grid.
  const dates = data.map((d) => new Date(d.date)).filter((d) => !Number.isNaN(d.getTime()));
  const anchor = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : new Date();
  const lastWeek = startOfWeek(anchor);
  const max = Math.max(1, ...counts.values());

  const cols: Array<{ label: string; cells: Array<{ iso: string; count: number }> }> = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const weekStart = new Date(lastWeek);
    weekStart.setDate(weekStart.getDate() - w * 7);
    const cells = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      return { iso, count: counts.get(iso) ?? 0 };
    });
    cols.push({
      label: weekStart.getDate() <= 7 ? weekStart.toLocaleString(undefined, { month: "short" }) : "",
      cells,
    });
  }

  const step = (n: number) => (n === 0 ? 0 : Math.ceil((n / max) * 3));
  const ALPHA = [0, 0.28, 0.58, 1];

  return (
    <div style={{ padding: "var(--ds-space-2) var(--ds-space-2) 0", overflowX: "auto" }}>
      <div style={{ display: "flex", gap: 3, minWidth: "min-content" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginRight: 2 }}>
          <span style={{ height: 12 }} />
          {DAY_LABELS.map((d, i) => (
            <span
              key={i}
              style={{
                height: 13,
                lineHeight: "13px",
                fontFamily: "var(--ds-font-mono)",
                fontSize: 8.5,
                color: "var(--ds-muted)",
                width: 9,
              }}
            >
              {i % 2 === 0 ? d : ""}
            </span>
          ))}
        </div>

        {cols.map((col, ci) => (
          <div key={ci} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span
              style={{
                height: 12,
                fontFamily: "var(--ds-font-mono)",
                fontSize: 8.5,
                color: "var(--ds-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {col.label}
            </span>
            {col.cells.map((cell) => {
              const s = step(cell.count);
              return (
                <span
                  key={cell.iso}
                  title={`${cell.iso}: ${cell.count} ${cell.count === 1 ? "post" : "posts"}`}
                  aria-label={`${cell.iso}: ${cell.count} posts`}
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 3,
                    background: s === 0 ? "var(--ds-ink-tint)" : base,
                    opacity: s === 0 ? 1 : ALPHA[s],
                    border: "1px solid var(--ds-line)",
                    boxSizing: "border-box",
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginTop: "var(--ds-space-3)",
          fontFamily: "var(--ds-font-mono)",
          fontSize: 9.5,
          color: "var(--ds-muted)",
        }}
      >
        <span>none</span>
        {[0, 1, 2, 3].map((s) => (
          <span
            key={s}
            style={{
              width: 11,
              height: 11,
              borderRadius: 2,
              background: s === 0 ? "var(--ds-ink-tint)" : base,
              opacity: s === 0 ? 1 : ALPHA[s],
              border: "1px solid var(--ds-line)",
              boxSizing: "border-box",
            }}
          />
        ))}
        <span>{`${max}/day`}</span>
      </div>
    </div>
  );
}
