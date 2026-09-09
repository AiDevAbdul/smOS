import Link from "next/link";
import { AppShell } from "../components/AppShell";
import MetricCard from "../components/MetricCard";
import ClientCard from "../components/ClientCard";
import AttentionRail from "../components/AttentionRail";
import PortfolioTrend from "../components/overview/PortfolioTrend";
import { CrmFunnelCard, MrrRankCard } from "../components/overview/CrmPanels";
import {
  getPortfolio,
  getCrmFunnel,
  getAttention,
  getDailySeries,
  getPerformance,
  type DailyPoint,
  type SeriesSource,
} from "../lib/metrics";
import { listApprovals } from "../lib/approvals";
import { fmtCurrency, fmtNumber, fmtRatio } from "../lib/format";

export const dynamic = "force-dynamic";

/** Roll every client's series into one portfolio series, keyed by date. */
function combine(all: Array<{ rows: DailyPoint[]; source: SeriesSource }>): {
  rows: DailyPoint[];
  source: SeriesSource;
} {
  const anyDaily = all.some((s) => s.source === "supabase");
  const use = all.filter((s) => (anyDaily ? s.source === "supabase" : s.source === "windows"));
  if (!use.length) return { rows: [], source: "none" };

  const byDate = new Map<string, DailyPoint & { _value: number }>();
  for (const s of use) {
    for (const r of s.rows) {
      const p =
        byDate.get(r.date) ??
        ({
          date: r.date,
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          ctr: null,
          cpa: null,
          roas: null,
          _value: 0,
        } as DailyPoint & { _value: number });
      p.spend += r.spend ?? 0;
      p.impressions += r.impressions ?? 0;
      p.clicks += r.clicks ?? 0;
      p.conversions += r.conversions ?? 0;
      // Reconstruct revenue so blended ROAS is spend-weighted rather than a
      // mean of per-client ratios (which would let a tiny client dominate).
      p._value += (r.roas ?? 0) * (r.spend ?? 0);
      byDate.set(r.date, p);
    }
  }

  const rows = [...byDate.values()]
    .map((p) => ({
      date: p.date,
      spend: p.spend,
      impressions: p.impressions,
      clicks: p.clicks,
      conversions: p.conversions,
      ctr: p.impressions ? (p.clicks / p.impressions) * 100 : null,
      cpa: p.conversions ? p.spend / p.conversions : null,
      roas: p.spend ? p._value / p.spend : null,
    }))
    .sort((a, b) =>
      anyDaily ? a.date.localeCompare(b.date) : Number(b.date.replace("d", "")) - Number(a.date.replace("d", ""))
    );

  return { rows, source: anyDaily ? "supabase" : "windows" };
}

export default async function Overview() {
  const portfolio = getPortfolio();
  const funnel = getCrmFunnel();
  const attention = getAttention(portfolio);
  const approvals = listApprovals({ status: "pending" });

  const active = portfolio.clients.filter((c) => c.hasPerf);
  const series = await Promise.all(active.map((c) => getDailySeries(c.slug, 90)));
  const combined = combine(series);
  const note =
    combined.source === "supabase"
      ? `Supabase daily · ${active.length} client${active.length === 1 ? "" : "s"}`
      : combined.source === "windows"
        ? "7/14/30-day snapshots — not daily rows"
        : "no data";

  // Currency and ROAS target follow the first client with live paid data;
  // mixed-currency portfolios would need per-client charts instead.
  const lead = active[0] ? getPerformance(active[0].slug) : null;
  const currency = lead?.currency ?? "USD";
  const roasTarget = typeof lead?.kpis?.roas_target === "number" ? (lead.kpis.roas_target as number) : null;

  const withPerf = portfolio.clients.filter((c) => c.hasPerf).length;
  const totalFlags = portfolio.clients.reduce((a, c) => a + c.flagCount, 0);
  // Sparklines only make sense on a real time series. The windows fallback is
  // three cumulative totals (30d ≥ 14d ≥ 7d by construction), so a sparkline
  // of it always slopes down and would read as decline that isn't there.
  const sparkOf = (key: "spend" | "roas") =>
    combined.source === "supabase" ? combined.rows.slice(-14).map((r) => r[key] ?? 0) : undefined;

  const verdict = (() => {
    if (!portfolio.clients.length) return "No clients on file yet — run /intake to onboard the first one.";
    const bits: string[] = [
      `${portfolio.activeCount} active client${portfolio.activeCount === 1 ? "" : "s"}`,
    ];
    if (portfolio.totals.spend7d > 0) {
      bits.push(`${fmtCurrency(portfolio.totals.spend7d, currency)} spent in the last 7 days`);
    }
    if (approvals.length) bits.push(`${approvals.length} approval${approvals.length === 1 ? "" : "s"} waiting`);
    if (totalFlags) bits.push(`${totalFlags} optimizer flag${totalFlags === 1 ? "" : "s"} to review`);
    return `${bits.join(" · ")}.`;
  })();

  return (
    <AppShell breadcrumb={[{ label: "Overview" }]}>
      <div className="ds-page">
        <div className="ds-sec">
          <div>
            <h1 className="ds-sec__title">Portfolio</h1>
            <p className="ds-sec__sub">{verdict}</p>
          </div>
          <div className="ds-sec__actions">
            <Link className="ds-btn ds-btn--ghost ds-btn--sm" href="/clients">
              All clients
            </Link>
            <Link className="ds-btn ds-btn--sm" href="/runs">
              Run a skill
            </Link>
          </div>
        </div>

        <div className="ds-metric-grid ds-stagger">
          <MetricCard
            index={0}
            label="Spend · 7 days"
            value={fmtCurrency(portfolio.totals.spend7d, currency)}
            note={`${withPerf} client${withPerf === 1 ? "" : "s"} with live data`}
            spark={sparkOf("spend")}
            hue={0}
          />
          <MetricCard
            index={1}
            label="Blended ROAS"
            value={fmtRatio(portfolio.totals.blendedRoas)}
            note={roasTarget ? `target ${fmtRatio(roasTarget)}` : "spend-weighted"}
            spark={sparkOf("roas")}
            hue={1}
          />
          <MetricCard
            index={2}
            label="Conversions · 7 days"
            value={fmtNumber(portfolio.totals.conversions7d)}
            note={
              portfolio.totals.conversions7d
                ? `${fmtCurrency(portfolio.totals.spend7d / portfolio.totals.conversions7d, currency)} blended CPA`
                : "no conversions recorded"
            }
            hue={4}
          />
          <MetricCard
            index={3}
            label="Waiting on you"
            value={String(approvals.length + attention.length)}
            note={
              approvals.length
                ? `${approvals.length} hard approval gate${approvals.length === 1 ? "" : "s"}`
                : "flags, failures & gates"
            }
            hue={approvals.length ? 3 : 2}
            href="/approvals"
          />
        </div>

        <div className="ds-band">
          <PortfolioTrend
            rows={combined.rows}
            source={combined.source}
            note={note}
            currency={currency}
            roasTarget={roasTarget}
          />
          <AttentionRail items={attention} approvals={approvals} />
        </div>

        <div className="ds-duo">
          <CrmFunnelCard funnel={funnel} />
          <MrrRankCard funnel={funnel} />
        </div>

        <div>
          <div className="ds-sec">
            <div>
              <h2 className="ds-sec__title">Clients</h2>
              <p className="ds-sec__sub">
                Pipeline completion is every step <code>/smos-status</code> tracks — agency, Phase 0,
                main pipeline and organic.
              </p>
            </div>
          </div>
          {portfolio.clients.length ? (
            <div className="ds-card-grid ds-stagger">
              {portfolio.clients.map((c, i) => (
                <ClientCard key={c.slug} client={c} index={i} />
              ))}
            </div>
          ) : (
            <div className="ds-panel ds-empty" style={{ minHeight: 200 }}>
              <svg aria-hidden="true">
                <use href="/icons.svg#i-client" />
              </svg>
              <p className="ds-empty__title">No clients yet</p>
              <p style={{ fontSize: 12.5, color: "var(--ds-muted)", margin: 0 }}>
                Run <code>/intake</code> to onboard one.
              </p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
