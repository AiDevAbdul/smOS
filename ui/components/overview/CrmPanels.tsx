"use client";

import ChartCard from "../charts/ChartCard";
import FunnelBar from "../charts/FunnelBar";
import RankBar from "../charts/RankBar";
import { fmtCurrency } from "../../lib/format";
import type { CrmFunnel } from "../../lib/metrics";

export function CrmFunnelCard({ funnel }: { funnel: CrmFunnel }) {
  const open = funnel.openStages;
  return (
    <ChartCard
      title="Sales pipeline"
      unit="deals by stage · drop-off"
      height={230}
      empty={funnel.totalDeals === 0}
      emptyTitle="No deals yet"
      emptyHint="Run /crm to add a prospect, or /pre-audit to create one from a public audit."
      summary={
        funnel.totalDeals
          ? `${funnel.totalDeals} deals · ${fmtCurrency(funnel.weightedForecast)} weighted forecast`
          : undefined
      }
      table={{
        head: ["Stage", "Deals", "MRR"],
        rows: funnel.stages.map((s) => [s.stage, s.count, fmtCurrency(s.value)]),
      }}
    >
      <FunnelBar stages={open} />
    </ChartCard>
  );
}

export function MrrRankCard({ funnel }: { funnel: CrmFunnel }) {
  const rows = funnel.topDeals.map((d) => ({ name: d.name, value: d.mrr }));
  return (
    <ChartCard
      title="Retainer value by client"
      unit="monthly · USD"
      height={230}
      empty={rows.length === 0}
      emptyTitle="No retainers on file"
      emptyHint="Deal amounts are set by /proposal and /contract."
      summary={`${fmtCurrency(funnel.wonMrr)} won MRR · ${fmtCurrency(funnel.weightedForecast)} weighted in flight`}
      table={{
        head: ["Client", "MRR", "Probability", "Stage"],
        rows: funnel.topDeals.map((d) => [d.name, fmtCurrency(d.mrr), `${d.probability}%`, d.stage]),
      }}
    >
      <RankBar
        data={rows}
        label="Monthly retainer"
        hue={4}
        format={(v) => fmtCurrency(v)}
        // Won deals read as banked, everything else as in-flight.
        colorBy={(row) => {
          const deal = funnel.topDeals.find((d) => d.name === row.name);
          return deal?.stage === "won" ? "good" : null;
        }}
      />
    </ChartCard>
  );
}
