// scripts/lib/agency-metrics.js — the agency's own operating metrics (Group D5).
//
// MRR, churn, win rate, pipeline velocity, NRR. All pure; the caller supplies the
// pipeline, the ledgers and the MRR snapshot history.
//
// The hard part of this module is not the arithmetic — it is refusing to produce
// metrics the data cannot support. Three cases were deliberately left as `null`
// with a stated reason rather than given a plausible-looking number:
//
//   1. NRR needs MRR AS OF A PAST DATE. Retainer changes are not versioned on the
//      deal, so past MRR cannot be reconstructed from current state — a deal that
//      was $1000 in June and is $3000 today looks like it was always $3000, which
//      would report expansion as flat and flat as contraction. So NRR is computed
//      from real snapshots (`recordSnapshot`) and returns null until two exist.
//      This is why the dashboard writes a snapshot every run.
//   2. WIN RATE WITH NO LOSSES IS NOT 100%. Nobody has logged a lost deal yet.
//      Reporting a 100% win rate off zero losses is a claim about sales
//      effectiveness that the data does not make; it reports null and says why.
//   3. CHURN WITH NO CHURNED CLIENTS IS NOT 0%. Same shape: a churn rate needs a
//      denominator with real history behind it.
//
// Currencies are never blended (see CLAUDE.md § Reporting Money and Health Honestly).

import { deal as dealSchema } from "../../schemas/index.js";
import { agingReport } from "./ar.js";

const r2 = (n) => Math.round(n * 100) / 100;
const days = (a, b) => {
  const ms = new Date(a).getTime() - new Date(b).getTime();
  return Number.isFinite(ms) ? Math.round(ms / 86400000) : null;
};

/** Current MRR per currency across won deals, plus what's missing from it. */
export function currentMrr(deals) {
  const won = (deals || []).map(dealSchema.normalize).filter((d) => d.stage === "won");
  const by = {};
  const missing = [];
  for (const d of won) {
    if (!(d.deal.monthly_retainer > 0)) { missing.push(d.slug); continue; }
    const c = d.deal.currency || "USD";
    by[c] = r2((by[c] || 0) + d.deal.monthly_retainer);
  }
  return {
    by_currency: by,
    clients: won.length,
    // Reported so the figure is never read as covering the whole book.
    clients_without_retainer: missing.length,
    clients_without_retainer_slugs: missing,
  };
}

/**
 * When a deal reached a stage, from the activity log (stage transitions are
 * auto-logged) with the explicit timestamp fields preferred.
 */
export function stageReachedAt(deal, stage) {
  const d = dealSchema.normalize(deal);
  if (stage === "won" && d.won_at) return d.won_at;
  if (stage === "lost" && d.lost_at) return d.lost_at;
  const hit = d.activities
    .filter((a) => a.type === "stage" && a.at && new RegExp(`\\b${stage}\\b`).test(String(a.note || "")))
    .map((a) => a.at)
    .sort();
  return hit.length ? hit[0] : null;
}

/**
 * Win rate over a window. Returns null when there are no decided-and-lost deals —
 * "100% because nobody logged a loss" is not a win rate.
 */
export function winRate(deals, { since = null, until = new Date().toISOString() } = {}) {
  const all = (deals || []).map(dealSchema.normalize);
  const inWindow = (at) => at && (!since || at >= since) && at <= until;
  const wonList = all.filter((d) => d.stage === "won" && inWindow(stageReachedAt(d, "won")));
  const lostList = all.filter((d) => d.stage === "lost" && inWindow(stageReachedAt(d, "lost")));
  const decided = wonList.length + lostList.length;
  if (!decided) {
    return { rate_pct: null, won: 0, lost: 0, decided: 0, reason: "No decided deals in the window." };
  }
  if (!lostList.length) {
    return {
      rate_pct: null, won: wonList.length, lost: 0, decided,
      reason: `${wonList.length} won and 0 lost recorded. A win rate needs losses in the denominator — 100% off zero recorded losses would be a claim the data doesn't make. Log lost deals with: /crm stage <slug> lost --note "reason".`,
    };
  }
  return { rate_pct: r2((wonList.length / decided) * 100), won: wonList.length, lost: lostList.length, decided, reason: null };
}

/**
 * Pipeline velocity: median and mean days from deal creation to won. Median is
 * reported first because a single slow deal skews a mean badly at this sample size.
 */
export function pipelineVelocity(deals) {
  const durations = (deals || []).map(dealSchema.normalize)
    .filter((d) => d.stage === "won" && d.created_at)
    .map((d) => {
      const at = stageReachedAt(d, "won");
      return at ? { slug: d.slug, days: days(at, d.created_at) } : null;
    })
    .filter((x) => x && x.days !== null && x.days >= 0);
  if (!durations.length) {
    return { median_days: null, mean_days: null, sample: 0, reason: "No won deals with a creation date to measure." };
  }
  const sorted = durations.map((x) => x.days).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    median_days: sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2),
    mean_days: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    sample: sorted.length,
    // At small n the spread matters more than the average.
    range_days: [sorted[0], sorted[sorted.length - 1]],
    per_deal: durations,
    reason: null,
  };
}

/**
 * Logo churn over a window. Returns null when nothing has churned — a 0% churn
 * rate implies a measured denominator, and "we have never lost anyone" from a
 * five-client book three months old is not a retention statistic.
 */
export function churn(deals, { since = null, until = new Date().toISOString() } = {}) {
  const all = (deals || []).map(dealSchema.normalize);
  const churned = all.filter((d) => d.stage === "churned");
  const active = all.filter((d) => d.stage === "won");
  const inWindow = (at) => at && (!since || at >= since) && at <= until;
  const churnedInWindow = churned.filter((d) => inWindow(stageReachedAt(d, "churned")));
  const base = active.length + churnedInWindow.length;
  if (!churned.length) {
    return {
      rate_pct: null, churned: 0, active: active.length,
      reason: `No churned clients recorded, so there is no churn rate to report — 0% would imply a measured denominator. ${active.length} active client(s).`,
    };
  }
  return {
    rate_pct: base ? r2((churnedInWindow.length / base) * 100) : null,
    churned: churnedInWindow.length, active: active.length,
    churned_slugs: churnedInWindow.map((d) => d.slug),
    reason: null,
  };
}

// ─────────────────────────── MRR snapshots / NRR ───────────────────────────

/**
 * Append today's MRR to the snapshot history (idempotent per date: re-running on
 * the same day replaces that day's entry rather than stacking duplicates).
 *
 * This exists because NRR is not derivable from current state — see the header.
 * Every dashboard run records one, so NRR becomes available once there are two.
 */
export function recordSnapshot(history, deals, at = new Date().toISOString()) {
  const date = String(at).slice(0, 10);
  const mrr = currentMrr(deals);
  const won = (deals || []).map(dealSchema.normalize).filter((d) => d.stage === "won");
  const entry = {
    date,
    by_currency: mrr.by_currency,
    clients: mrr.clients,
    // Per-client detail is what makes expansion/contraction separable later.
    per_client: won.map((d) => ({ slug: d.slug, mrr: d.deal.monthly_retainer, currency: d.deal.currency || "USD" })),
  };
  const rest = (history || []).filter((h) => h?.date !== date);
  return [...rest, entry].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/**
 * Net revenue retention between the earliest snapshot on/after `since` and the
 * latest one, decomposed into expansion / contraction / churn / new.
 *
 * NRR excludes NEW logos by definition — it measures what happened to the revenue
 * you already had. `gross_retention_pct` is the same without expansion.
 * Returns null with a reason when fewer than two snapshots exist.
 */
export function nrr(history, { currency = "USD", since = null } = {}) {
  const snaps = (history || []).filter((h) => h?.date && h.by_currency).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const usable = since ? snaps.filter((h) => h.date >= String(since).slice(0, 10)) : snaps;
  if (usable.length < 2) {
    return {
      nrr_pct: null, gross_retention_pct: null, snapshots: usable.length,
      reason: `NRR needs at least two MRR snapshots ${usable.length ? `(have ${usable.length})` : "(have none)"}. Retainer changes aren't versioned on the deal, so past MRR can't be reconstructed from current state — it would read every historical amount as today's. A snapshot is recorded on every /agency-ops run, so this becomes available once a second one exists.`,
    };
  }
  const first = usable[0];
  const last = usable[usable.length - 1];
  const at = (snap, slug) => {
    const row = (snap.per_client || []).find((c) => c.slug === slug && (c.currency || "USD") === currency);
    return row ? Number(row.mrr) || 0 : 0;
  };
  const startSlugs = (first.per_client || []).filter((c) => (c.currency || "USD") === currency && Number(c.mrr) > 0).map((c) => c.slug);
  const startMrr = startSlugs.reduce((s, slug) => s + at(first, slug), 0);
  if (!(startMrr > 0)) {
    return { nrr_pct: null, gross_retention_pct: null, snapshots: usable.length, reason: `No ${currency} MRR in the earliest snapshot (${first.date}) to retain.` };
  }

  let expansion = 0, contraction = 0, churned = 0;
  for (const slug of startSlugs) {
    const before = at(first, slug);
    const after = at(last, slug);
    if (after === 0) churned += before;
    else if (after > before) expansion += after - before;
    else if (after < before) contraction += before - after;
  }
  const endFromCohort = startMrr + expansion - contraction - churned;
  const newLogos = (last.per_client || [])
    .filter((c) => (c.currency || "USD") === currency && !startSlugs.includes(c.slug))
    .reduce((s, c) => s + (Number(c.mrr) || 0), 0);

  return {
    currency,
    from: first.date, to: last.date, snapshots: usable.length,
    start_mrr: r2(startMrr),
    expansion: r2(expansion), contraction: r2(contraction), churned_mrr: r2(churned),
    new_logo_mrr: r2(newLogos),
    // NRR measures the existing book only; new logos are excluded by definition.
    nrr_pct: r2((endFromCohort / startMrr) * 100),
    gross_retention_pct: r2(((startMrr - contraction - churned) / startMrr) * 100),
    reason: null,
  };
}

/**
 * The whole dashboard payload. `arByClient` is { slug: invoices[] } so AR can be
 * summed across the book without this module touching the filesystem.
 */
export function agencyDashboard({ deals, arByClient = {}, snapshots = [], rosterLoadOut = null, since = null, now = new Date().toISOString() } = {}) {
  const allInvoices = Object.values(arByClient).flat();
  const ar = agingReport(allInvoices, now);
  const mrr = currentMrr(deals);
  const currencies = Object.keys(mrr.by_currency);
  return {
    as_of: now,
    window_since: since,
    mrr,
    // One NRR per currency — a blended one would be meaningless.
    nrr: currencies.length ? Object.fromEntries(currencies.map((c) => [c, nrr(snapshots, { currency: c, since })]))
      : { _none: nrr(snapshots, { since }) },
    churn: churn(deals, { since, until: now }),
    win_rate: winRate(deals, { since, until: now }),
    velocity: pipelineVelocity(deals),
    pipeline: (() => {
      const all = (deals || []).map(dealSchema.normalize);
      const active = all.filter((d) => !["won", "lost", "churned"].includes(d.stage));
      const by = {};
      for (const d of active) {
        const c = d.deal.currency || "USD";
        by[c] = r2((by[c] || 0) + dealSchema.weightedValue(d));
      }
      return { open_deals: active.length, weighted_annual_by_currency: by };
    })(),
    ar: {
      // Per currency, because this sums MANY clients' ledgers and the book holds
      // USD, EUR and PKR. The flat total is deliberately NOT surfaced here.
      by_currency: ar.by_currency,
      currencies: ar.currencies,
      mixed_currency: ar.mixed_currency,
      overdue_count: ar.overdue_count,
      buckets: ar.buckets,
      worst: ar.items.slice(0, 5),
    },
    capacity: rosterLoadOut,
  };
}
