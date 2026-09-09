"use client";

/**
 * Cost / duration / volume charts over the run history.
 *
 * The numbers come from the CLI's own `result` event (total_cost_usd,
 * duration_ms, num_turns), lifted into the registry — so the provenance chip
 * says "CLI result event" rather than implying a billing-grade source.
 */

import ChartCard from "../charts/ChartCard";
import TrendChart from "../charts/TrendChart";
import RankBar from "../charts/RankBar";
import { fmtCost, fmtDay, fmtDuration, fmtNumber } from "../../lib/format";
import type { RunStats } from "../../lib/runs";

export default function RunAnalytics({ stats }: { stats: RunStats }) {
  const source = { label: "CLI result event", kind: "live" as const };
  // The cards are h3, so they need an h2 above them — otherwise the page
  // jumps h1 → h3, which is a heading-order failure, not just untidy markup.

  // One day of history is a point, not a trend — a single-day line invites the
  // reader to extrapolate a slope that doesn't exist yet.
  const trendReady = stats.byDay.length >= 2;
  const costUnknown = stats.total - stats.costed;

  return (
    <section>
      <div className="ds-sec">
        <div>
          <h2 className="ds-sec__title">Cost &amp; duration</h2>
          <p className="ds-sec__sub">
            Reported by the CLI itself when each run exits — not an estimate.
          </p>
        </div>
      </div>
      <div className="ds-duo">
      <ChartCard
        title="Run cost & volume"
        unit="per day"
        headingLevel={3}
        source={source}
        height={220}
        empty={!trendReady}
        emptyTitle={stats.total ? "Not enough history yet" : "No runs recorded"}
        emptyHint={
          stats.total
            ? "Cost per day needs at least two days of runs before a trend means anything."
            : "Start a run from the launcher — cost, duration and turn count are recorded when it finishes."
        }
        summary={
          trendReady
            ? `${fmtCost(stats.totalCost)} across ${fmtNumber(stats.total)} runs${
                costUnknown ? ` · ${fmtNumber(costUnknown)} reported no cost` : ""
              }`
            : undefined
        }
        table={{
          head: ["Day", "Runs", "Cost"],
          rows: stats.byDay.map((d) => [d.date, d.runs, fmtCost(d.cost)]),
        }}
      >
        <TrendChart
          data={stats.byDay.map((d) => ({ date: d.date, cost: d.cost, runs: d.runs }))}
          xKey="date"
          xFormat={(v) => fmtDay(String(v))}
          leftFormat={(v) => fmtCost(v)}
          rightFormat={(v) => fmtNumber(v)}
          series={[
            { key: "cost", label: "Cost", hue: 0, format: (v) => fmtCost(v) },
            { key: "runs", label: "Runs", hue: 4, axis: "right", format: (v) => fmtNumber(v) },
          ]}
        />
      </ChartCard>

      <ChartCard
        title="Where the time goes"
        unit="avg duration by skill"
        headingLevel={3}
        source={source}
        height={220}
        empty={!stats.bySkill.some((s) => s.avgDurationMs !== null)}
        emptyTitle="No completed runs yet"
        emptyHint="A run reports its duration when it exits."
        summary={
          stats.medianDurationMs !== null
            ? `Median run ${fmtDuration(stats.medianDurationMs)} · ${fmtNumber(stats.totalTurns)} turns total`
            : undefined
        }
        table={{
          head: ["Skill", "Runs", "Avg duration", "Cost", "Failed"],
          rows: stats.bySkill.map((s) => [
            s.label,
            s.runs,
            fmtDuration(s.avgDurationMs),
            fmtCost(s.cost),
            s.failed,
          ]),
        }}
      >
        <RankBar
          data={stats.bySkill
            .filter((s) => s.avgDurationMs !== null)
            .slice(0, 8)
            .map((s) => ({ name: s.label, value: Math.round(s.avgDurationMs!) }))}
          label="Avg duration"
          format={(v) => fmtDuration(v)}
          hue={4}
          // A skill whose runs fail is worth seeing in the ranking itself.
          colorBy={(row) => {
            const hit = stats.bySkill.find((s) => s.label === row.name);
            return hit && hit.failed > 0 ? "bad" : null;
          }}
        />
      </ChartCard>
      </div>
    </section>
  );
}
