// ui/lib/metrics.ts — server-side chart data loaders.
//
// Reads the same on-disk artifacts the skills write, plus (optionally) the
// Supabase `daily_metrics` table for genuine per-day series. Everything here
// follows the discipline skills/smos-status/status.js sets: never throw, always
// return a well-formed empty shape, and say in `note` why a series is thin —
// so the UI can render an honest empty state instead of a broken axis.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllClientStatuses, type ClientStatus } from "./status";
import { clientDisplayName } from "./client-name";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/* --------------------------------------------------------------- helpers -- */

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** publish_log.json is NDJSON — one object per line, not an array. */
function readNdjson<T>(path: string): T[] {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as T];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

const clientDir = (slug: string) => resolve(REPO_ROOT, "clients", slug);
const clientDataFile = (slug: string, f: string) => resolve(clientDir(slug), "data", f);

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------ performance -- */

export interface WindowMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  link_clicks?: number;
  reach?: number;
  frequency?: number;
  ctr?: number;
  link_ctr?: number;
  cpc?: number;
  cpm?: number;
  conversions: number;
  conversion_value?: number;
  cpa: number | null;
  roas: number | null;
}

export interface Entity {
  id: string;
  name: string;
  status?: string;
  objective?: string;
  daily_budget?: number | null;
  campaign_id?: string;
  adset_id?: string;
  metrics: { last_7d?: WindowMetrics; last_14d?: WindowMetrics; last_30d?: WindowMetrics };
  breakdowns?: Record<string, Array<Record<string, unknown>>> | null;
}

export interface Flag {
  entity_type: string;
  entity_id: string;
  name: string;
  flag: string;
  metric: number;
  threshold: number;
  reasoning: string;
}

export interface Performance {
  slug: string;
  exists: boolean;
  generated_at: string | null;
  currency: string;
  totals7d: WindowMetrics | null;
  by_campaign: Entity[];
  by_adset: Entity[];
  by_ad: Entity[];
  flags: Flag[];
  opportunity: {
    score: number;
    components: Record<string, { weight: number; ratio: number; points: number }>;
    total_spend_7d: number;
    reclaimable_spend_7d: number;
    scalable_spend_7d: number;
    fatigued_spend_7d: number;
    recommendations: string[];
  } | null;
  winners: { top_roas: RankRow[]; lowest_cpa: RankRow[] } | null;
  losers: { bottom_roas: RankRow[] } | null;
  kpis: Record<string, unknown>;
  note: string | null;
}

export interface RankRow {
  id: string;
  name: string;
  spend: number;
  roas: number | null;
  cpa: number | null;
  ctr: number | null;
}

const EMPTY_PERF = (slug: string, note: string): Performance => ({
  slug,
  exists: false,
  generated_at: null,
  currency: "USD",
  totals7d: null,
  by_campaign: [],
  by_adset: [],
  by_ad: [],
  flags: [],
  opportunity: null,
  winners: null,
  losers: null,
  kpis: {},
  note,
});

export function getPerformance(slug: string): Performance {
  const raw = readJson<Record<string, any>>(clientDataFile(slug, "performance_analysis.json"));
  if (!raw) {
    return EMPTY_PERF(slug, "No performance_analysis.json yet — run /analyze for this client.");
  }
  const totals = raw.window_summary?.last_7d_totals ?? null;
  const hasSpend = num(totals?.spend) != null && (num(totals?.spend) as number) > 0;
  return {
    slug,
    exists: true,
    generated_at: raw.generated_at ?? null,
    currency: raw.currency || "USD",
    totals7d: totals,
    by_campaign: raw.by_campaign ?? [],
    by_adset: raw.by_adset ?? [],
    by_ad: raw.by_ad ?? [],
    flags: raw.flags ?? [],
    opportunity: raw.opportunity ?? null,
    winners: raw.winners ?? null,
    losers: raw.losers ?? null,
    kpis: raw.kpis_used ?? {},
    note: hasSpend ? null : "Last /analyze returned no spend in the 7-day window.",
  };
}

/* ------------------------------------------------------------ daily series -- */

export type SeriesSource = "supabase" | "windows" | "none";

export interface DailyPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number | null;
  cpa: number | null;
  roas: number | null;
}

export interface DailySeries {
  slug: string;
  source: SeriesSource;
  rows: DailyPoint[];
  /** Always states where the numbers came from — surfaced as a chip on the chart. */
  note: string;
}

/**
 * Genuine per-day rows come from Supabase; performance_analysis.json only holds
 * 7d/14d/30d snapshots. When Supabase is unconfigured, errored, or empty we fall
 * back to those three window points and SAY SO, rather than presenting a
 * 3-point series as if it were daily data.
 */
export async function getDailySeries(slug: string, days = 30): Promise<DailySeries> {
  const perf = getPerformance(slug);

  try {
    const sb = await import("../../scripts/lib/supabase.js");
    if (sb.supabaseConfigured?.()) {
      const clientId = await sb.clientIdBySlug(slug);
      if (clientId) {
        const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
        const rows = (await sb.select(
          "daily_metrics",
          { client_id: `eq.${clientId}`, date: `gte.${since}`, order: "date.asc" },
          "date,spend,impressions,clicks,ctr,cpa,roas,conversions"
        )) as Array<Record<string, unknown>>;

        if (Array.isArray(rows) && rows.length) {
          // Rows are per campaign/adset/ad — roll them up to one point per day.
          // `value` reconstructs revenue (roas × spend) so the day's ROAS can be
          // spend-weighted; averaging per-entity ratios would let a $1 adset
          // count as much as a $500 one.
          type Acc = DailyPoint & { value: number };
          const byDate = new Map<string, Acc>();
          for (const r of rows) {
            const date = String(r.date);
            const p =
              byDate.get(date) ??
              ({
                date,
                spend: 0,
                impressions: 0,
                clicks: 0,
                conversions: 0,
                ctr: null,
                cpa: null,
                roas: null,
                value: 0,
              } as Acc);
            const spend = num(r.spend) ?? 0;
            p.spend += spend;
            p.impressions += num(r.impressions) ?? 0;
            p.clicks += num(r.clicks) ?? 0;
            p.conversions += num(r.conversions) ?? 0;
            p.value += (num(r.roas) ?? 0) * spend;
            byDate.set(date, p);
          }
          // Derived rates are recomputed from the rolled-up totals.
          const out: DailyPoint[] = [...byDate.values()].map(({ value, ...p }) => ({
            ...p,
            ctr: p.impressions ? (p.clicks / p.impressions) * 100 : null,
            cpa: p.conversions ? p.spend / p.conversions : null,
            roas: p.spend ? value / p.spend : null,
          }));
          out.sort((a, b) => a.date.localeCompare(b.date));
          return {
            slug,
            source: "supabase",
            rows: out,
            note: `${out.length} days from Supabase daily_metrics`,
          };
        }
      }
    }
  } catch {
    // Supabase is best-effort; fall through to the on-disk windows.
  }

  // Fallback: the three window snapshots, plotted as coarse points.
  const w = perf.by_campaign.length || perf.totals7d ? windowPoints(perf) : [];
  if (!w.length) {
    return { slug, source: "none", rows: [], note: perf.note ?? "No performance data on file." };
  }
  return {
    slug,
    source: "windows",
    rows: w,
    note: "7/14/30-day snapshots — not daily rows (Supabase unavailable)",
  };
}

/** Turn the 7d/14d/30d account totals into three plottable points. */
function windowPoints(perf: Performance): DailyPoint[] {
  const acc = (key: "last_7d" | "last_14d" | "last_30d") => {
    const t = perf.by_campaign.reduce(
      (a, c) => {
        const m = c.metrics?.[key];
        if (!m) return a;
        a.spend += num(m.spend) ?? 0;
        a.impressions += num(m.impressions) ?? 0;
        a.clicks += num(m.clicks) ?? 0;
        a.conversions += num(m.conversions) ?? 0;
        a.value += num(m.conversion_value) ?? 0;
        return a;
      },
      { spend: 0, impressions: 0, clicks: 0, conversions: 0, value: 0 }
    );
    return t;
  };

  const labels: Array<["last_30d" | "last_14d" | "last_7d", string]> = [
    ["last_30d", "30d"],
    ["last_14d", "14d"],
    ["last_7d", "7d"],
  ];

  return labels
    .map(([key, label]) => {
      const t = acc(key);
      if (!t.spend && !t.impressions) return null;
      return {
        date: label,
        spend: t.spend,
        impressions: t.impressions,
        clicks: t.clicks,
        conversions: t.conversions,
        ctr: t.impressions ? (t.clicks / t.impressions) * 100 : null,
        cpa: t.conversions ? t.spend / t.conversions : null,
        roas: t.spend ? t.value / t.spend : null,
      } as DailyPoint;
    })
    .filter((p): p is DailyPoint => p !== null);
}

/* -------------------------------------------------------------- CRM funnel -- */

export const CRM_STAGES = [
  "lead",
  "contacted",
  "audited",
  "proposed",
  "negotiating",
  "won",
  "lost",
  "churned",
] as const;

export interface CrmFunnel {
  stages: Array<{ stage: string; count: number; value: number }>;
  /** The 5 open stages only, for the drop-off view — lost/churned aren't a step. */
  openStages: Array<{ stage: string; count: number; value: number }>;
  weightedForecast: number;
  wonMrr: number;
  totalDeals: number;
  bySource: Array<{ name: string; value: number }>;
  topDeals: Array<{ name: string; slug: string; mrr: number; probability: number; stage: string }>;
  note: string | null;
}

export function getCrmFunnel(): CrmFunnel {
  const deals = readJson<Array<Record<string, any>>>(resolve(REPO_ROOT, "crm", "pipeline.json"));
  if (!Array.isArray(deals) || !deals.length) {
    return {
      stages: [],
      openStages: [],
      weightedForecast: 0,
      wonMrr: 0,
      totalDeals: 0,
      bySource: [],
      topDeals: [],
      note: "No deals in crm/pipeline.json — run /crm to add one.",
    };
  }

  const stages = CRM_STAGES.map((stage) => {
    const rows = deals.filter((d) => d.stage === stage);
    return {
      stage,
      count: rows.length,
      value: rows.reduce((a, d) => a + (num(d.deal?.monthly_retainer) ?? 0), 0),
    };
  });

  const weightedForecast = deals
    .filter((d) => !["won", "lost", "churned"].includes(d.stage))
    .reduce((a, d) => a + ((num(d.deal?.monthly_retainer) ?? 0) * (num(d.probability) ?? 0)) / 100, 0);

  const sourceCounts = new Map<string, number>();
  for (const d of deals) {
    const s = d.source || "unknown";
    sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1);
  }

  return {
    stages,
    openStages: stages.filter((s) => !["lost", "churned"].includes(s.stage)),
    weightedForecast,
    wonMrr: stages.find((s) => s.stage === "won")?.value ?? 0,
    totalDeals: deals.length,
    bySource: [...sourceCounts].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    topDeals: deals
      .map((d) => ({
        name: d.company_name || d.slug,
        slug: d.slug,
        mrr: num(d.deal?.monthly_retainer) ?? 0,
        probability: num(d.probability) ?? 0,
        stage: d.stage,
      }))
      .filter((d) => d.mrr > 0)
      .sort((a, b) => b.mrr - a.mrr)
      .slice(0, 8),
    note: null,
  };
}

/* ----------------------------------------------------------- content/organic -- */

export interface ContentStats {
  total: number;
  published: number;
  pending: number;
  errored: number;
  byPlatform: Array<{ name: string; value: number }>;
  byFormat: Array<{ name: string; value: number }>;
  byPillar: Array<{ name: string; value: number }>;
  /** Calendar cadence: items scheduled per ISO day. */
  cadence: Array<{ date: string; count: number }>;
  note: string | null;
}

export function getContentStats(slug: string): ContentStats {
  const cal = readJson<{ items?: Array<Record<string, any>> }>(
    clientDataFile(slug, "content_calendar.json")
  );
  const items = cal?.items ?? [];
  if (!items.length) {
    return {
      total: 0,
      published: 0,
      pending: 0,
      errored: 0,
      byPlatform: [],
      byFormat: [],
      byPillar: [],
      cadence: [],
      note: "No content_calendar.json items — run /content-plan.",
    };
  }

  const tally = (key: string) => {
    const m = new Map<string, number>();
    for (const i of items) {
      const v = i[key] || "unknown";
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };

  const cadenceMap = new Map<string, number>();
  for (const i of items) {
    if (!i.publish_at) continue;
    const day = String(i.publish_at).slice(0, 10);
    cadenceMap.set(day, (cadenceMap.get(day) ?? 0) + 1);
  }

  return {
    total: items.length,
    published: items.filter((i) => i.status === "published").length,
    pending: items.filter((i) => i.status === "pending").length,
    errored: items.filter((i) => i.status === "error" || i.error).length,
    byPlatform: tally("platform"),
    byFormat: tally("format"),
    byPillar: tally("pillar_id"),
    cadence: [...cadenceMap].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
    note: null,
  };
}

export interface PublishStats {
  attempts: number;
  succeeded: number;
  failed: number;
  recentErrors: Array<{ ts: string; itemId: string; error: string }>;
  note: string | null;
}

export function getPublishStats(slug: string): PublishStats {
  const rows = readNdjson<Record<string, any>>(resolve(clientDir(slug), "publish_log.json"));
  if (!rows.length) {
    return { attempts: 0, succeeded: 0, failed: 0, recentErrors: [], note: "No publish attempts logged yet." };
  }
  const failed = rows.filter((r) => r.error);
  return {
    attempts: rows.length,
    succeeded: rows.filter((r) => r.published_id).length,
    failed: failed.length,
    recentErrors: failed
      .slice(-5)
      .reverse()
      .map((r) => ({ ts: r.ts ?? "", itemId: r.item_id ?? "", error: String(r.error).slice(0, 180) })),
    note: null,
  };
}

export interface InboxStats {
  total: number;
  unread: number;
  overdueSla: number;
  byPlatform: Array<{ name: string; value: number }>;
  byType: Array<{ name: string; value: number }>;
  note: string | null;
}

export function getInboxStats(slug: string): InboxStats {
  const box = readJson<{ items?: Array<Record<string, any>> }>(clientDataFile(slug, "inbox.json"));
  const items = box?.items ?? [];
  if (!items.length) {
    return {
      total: 0,
      unread: 0,
      overdueSla: 0,
      byPlatform: [],
      byType: [],
      note: "No inbox items on file — run /inbox.",
    };
  }
  const now = Date.now();
  const tally = (key: string) => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i[key] || "unknown", (m.get(i[key] || "unknown") ?? 0) + 1);
    return [...m].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };
  return {
    total: items.length,
    unread: items.filter((i) => i.state === "unread").length,
    overdueSla: items.filter(
      (i) => !i.replied_at && i.first_reply_due_at && new Date(i.first_reply_due_at).getTime() < now
    ).length,
    byPlatform: tally("platform"),
    byType: tally("type"),
    note: null,
  };
}

/* --------------------------------------------------------------- portfolio -- */

/**
 * No per-client trend field here: getPortfolio is synchronous, and the only
 * synchronous data available is the CUMULATIVE 7/14/30-day windows, whose shape
 * always slopes downward by construction. A card gets a trend line once it can
 * read genuine daily rows (see getDailySeries).
 */
export interface PortfolioClient {
  slug: string;
  name: string;
  stage: string;
  isClient: boolean;
  /** Completion across every status.js step, and the raw counts behind it. */
  completion: { pct: number; done: number; blocked: number; total: number };
  nextAction: string | null;
  spend7d: number | null;
  roas7d: number | null;
  cpa7d: number | null;
  currency: string;
  flagCount: number;
  hasPerf: boolean;
  perfNote: string | null;
}

export interface Portfolio {
  clients: PortfolioClient[];
  totals: { spend7d: number; conversions7d: number; value7d: number; blendedRoas: number | null };
  activeCount: number;
  note: string | null;
}

function completionOf(status: ClientStatus) {
  const steps = status.sections.flatMap((s) => s.steps);
  const done = steps.filter((s) => s.status === "done").length;
  const blocked = steps.filter((s) => s.status === "blocked" || s.status === "partial").length;
  return {
    pct: steps.length ? Math.round((done / steps.length) * 100) : 0,
    done,
    blocked,
    total: steps.length,
  };
}

export function getPortfolio(): Portfolio {
  const statuses = getAllClientStatuses();
  if (!statuses.length) {
    return {
      clients: [],
      totals: { spend7d: 0, conversions7d: 0, value7d: 0, blendedRoas: null },
      activeCount: 0,
      note: "No clients on file — run /intake to onboard one.",
    };
  }

  let spend = 0;
  let conversions = 0;
  let value = 0;

  const clients: PortfolioClient[] = statuses.map((st) => {
    const perf = getPerformance(st.slug);
    const t = perf.totals7d;
    if (t) {
      spend += num(t.spend) ?? 0;
      conversions += num(t.conversions) ?? 0;
      value += num(t.conversion_value) ?? 0;
    }
    return {
      slug: st.slug,
      name: clientDisplayName(st.slug),
      stage: st.crm_stage || (st.is_zero_start ? "zero-start" : st.is_client ? "active" : "prospect"),
      isClient: st.is_client,
      completion: completionOf(st),
      nextAction: st.next_action ? `${st.next_action.section} — ${st.next_action.step}` : null,
      spend7d: t ? num(t.spend) : null,
      roas7d: t ? num(t.roas) : null,
      cpa7d: t ? num(t.cpa) : null,
      currency: perf.currency,
      flagCount: perf.flags.length,
      hasPerf: perf.exists,
      perfNote: perf.note,
    };
  });

  return {
    clients,
    totals: {
      spend7d: spend,
      conversions7d: conversions,
      value7d: value,
      blendedRoas: spend ? value / spend : null,
    },
    activeCount: clients.filter((c) => c.isClient).length,
    note: null,
  };
}

/* ------------------------------------------------------- attention feed ---- */

export interface AttentionItem {
  kind: "approval" | "flag" | "publish" | "inbox" | "gate";
  severity: "bad" | "warn" | "info";
  title: string;
  meta: string;
  href: string;
}

/** Everything that needs a human today, newest/most severe first. */
export function getAttention(portfolio: Portfolio): AttentionItem[] {
  const out: AttentionItem[] = [];

  for (const c of portfolio.clients) {
    const perf = getPerformance(c.slug);
    for (const f of perf.flags.slice(0, 2)) {
      out.push({
        kind: "flag",
        severity: f.flag.startsWith("PAUSE") || f.flag.startsWith("ANOMALY") ? "bad" : "warn",
        title: `${f.flag.replace(/_/g, " ")} — ${f.name}`,
        meta: `${c.name} · ${f.reasoning.slice(0, 90)}`,
        href: `/clients/${c.slug}/reports`,
      });
    }

    const pub = getPublishStats(c.slug);
    if (pub.failed > 0) {
      out.push({
        kind: "publish",
        severity: "warn",
        title: `${pub.failed} publish ${pub.failed === 1 ? "failure" : "failures"}`,
        meta: `${c.name} · ${pub.recentErrors[0]?.error ?? ""}`.slice(0, 120),
        href: `/clients/${c.slug}/data`,
      });
    }

    const box = getInboxStats(c.slug);
    if (box.overdueSla > 0) {
      out.push({
        kind: "inbox",
        severity: "bad",
        title: `${box.overdueSla} replies past SLA`,
        meta: `${c.name} · ${box.unread} unread in the inbox`,
        href: `/clients/${c.slug}/data`,
      });
    }

    if (c.completion.blocked > 0) {
      out.push({
        kind: "gate",
        severity: "info",
        title: `${c.completion.blocked} step${c.completion.blocked === 1 ? "" : "s"} blocked`,
        meta: `${c.name} · ${c.nextAction ?? "see pipeline"}`,
        href: `/clients/${c.slug}/pipeline`,
      });
    }
  }

  const rank = { bad: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 8);
}

/** Reports on disk, newest first — used for the Overview "latest deliverables". */
export function getRecentReports(slug: string, limit = 4): Array<{ date: string; file: string }> {
  try {
    const root = resolve(clientDir(slug), "reports");
    if (!existsSync(root)) return [];
    const dates = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
    const out: Array<{ date: string; file: string }> = [];
    for (const date of dates) {
      for (const f of readdirSync(resolve(root, date))) {
        if (f.endsWith(".html")) out.push({ date, file: f });
        if (out.length >= limit) return out;
      }
    }
    return out;
  } catch {
    return [];
  }
}
