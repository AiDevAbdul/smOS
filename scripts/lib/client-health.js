// scripts/lib/client-health.js — client health + renewal risk (Group D3).
//
// The pipeline tracked acquisition well and retention not at all. A won deal had
// no term, no renewal date, and nothing that would notice a client drifting toward
// churn until they said so.
//
// The design rule that matters most here: **a score computed from nothing must not
// look like a score computed from something.** Each signal is optional and
// independently weighted; the result reports which signals were available, which
// were missing, and what share of the total weight actually had data
// (`confidence`). A client with no performance data and no invoices scores
// `null` — not 100, and not 50. Reporting "healthy" because there is no bad news
// is exactly how a retention system fails silently.
//
// Signals, all derived from artifacts smOS already produces:
//   performance — trend direction from /monthly-review's raw.json (ROAS/CPA/CTR)
//   payment     — overdue invoices from the D2 ledger (AR is a churn leading indicator)
//   delivery    — recency of the last report actually sent to the client
//   engagement  — CRM activity recency (is anyone talking to them?)
//   tenure      — months engaged, as a stabilizer (new clients are inherently riskier)
//
// Everything is PURE: callers gather the artifacts, this scores them.

import { deal as dealSchema } from "../../schemas/index.js";
import { agingReport } from "./ar.js";

export const BANDS = ["healthy", "watch", "at_risk", "critical"];

// Weights sum to 100 when every signal is present. When one is missing its weight
// is removed from the denominator rather than scored as zero — absence of evidence
// is not evidence of trouble.
export const WEIGHTS = {
  performance: 35,
  payment: 25,
  delivery: 15,
  engagement: 15,
  tenure: 10,
};

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const daysBetweenDates = (a, b) => {
  const ms = new Date(`${String(a).slice(0, 10)}T00:00:00Z`).getTime()
    - new Date(`${String(b).slice(0, 10)}T00:00:00Z`).getTime();
  return Number.isFinite(ms) ? Math.round(ms / 86400000) : null;
};

/**
 * Performance sub-score from /monthly-review's `trends` block.
 *
 * Only metrics actually present are used, and direction is what matters, not
 * absolute level: a client at 2.1 ROAS trending up is healthier than one at 2.4
 * trending down. `direction` is monthly-review's own classification.
 * Returns null when no usable trend exists.
 */
export function scorePerformance(trends) {
  if (!trends || typeof trends !== "object") return null;
  // For each metric: is "up" good or bad?
  const polarity = { roas: 1, conversions: 1, revenue: 1, ctr: 1, cpa: -1, cpm: -1, frequency: -1 };
  const scored = [];
  for (const [metric, good] of Object.entries(polarity)) {
    const t = trends[metric];
    if (!t || typeof t !== "object") continue;
    // A flat/absent mean means the metric never really moved — skip rather than
    // read noise as a trend.
    if (!Number.isFinite(Number(t.mean)) || Number(t.mean) === 0) continue;
    const dir = String(t.direction || "").toLowerCase();
    let s;
    if (dir.includes("up") || dir.includes("rising") || dir.includes("increas")) s = good > 0 ? 85 : 25;
    else if (dir.includes("down") || dir.includes("falling") || dir.includes("decreas")) s = good > 0 ? 25 : 85;
    else s = 60; // flat/stable — fine, not a win
    scored.push(s);
  }
  if (!scored.length) return null;
  return Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
}

/**
 * Payment sub-score from the invoice ledger. Overdue money is one of the
 * strongest churn leading indicators there is. Returns null when the client has
 * no receivable history at all (nothing to judge).
 */
export function scorePayment(invoices, today = new Date().toISOString()) {
  const list = invoices || [];
  if (!list.length) return null;
  const ar = agingReport(list, today);
  // Nothing outstanding at all: healthy, but only if they've actually been billed.
  if (!ar.items.length) {
    const settled = list.some((i) => ["paid", "void"].includes(String(i.status)));
    return settled ? 95 : null;
  }
  if (!ar.overdue_count) return 90; // outstanding but current
  const worst = Math.max(...ar.items.map((i) => i.days_overdue || 0));
  // Graduated, matching the dunning ladder's shape.
  if (worst > 90) return 5;
  if (worst > 60) return 15;
  if (worst > 30) return 35;
  if (worst > 7) return 55;
  return 70;
}

/** Delivery sub-score: how long since the client last received a report. */
export function scoreDelivery(lastReportDate, today = new Date().toISOString().slice(0, 10)) {
  if (!lastReportDate) return null;
  const days = daysBetweenDates(today, lastReportDate);
  if (days === null) return null;
  if (days <= 9) return 95;    // weekly cadence being met
  if (days <= 16) return 75;   // one slip
  if (days <= 35) return 45;   // a month of silence
  if (days <= 60) return 20;
  return 5;
}

/** Engagement sub-score: recency of any logged CRM activity. */
export function scoreEngagement(activities, today = new Date().toISOString().slice(0, 10)) {
  const list = (activities || []).map((a) => a?.at).filter(Boolean).sort();
  if (!list.length) return null;
  const days = daysBetweenDates(today, String(list[list.length - 1]).slice(0, 10));
  if (days === null) return null;
  if (days <= 14) return 90;
  if (days <= 30) return 70;
  if (days <= 60) return 40;
  return 15;
}

/**
 * Tenure sub-score. A stabilizer, not a verdict: month 1–2 is the risky window
 * (nothing has been proven yet), and a long-tenured client has demonstrated they
 * stay. Never null when tenure is known.
 */
export function scoreTenure(months) {
  if (months === null || months === undefined) return null;
  if (months < 2) return 45;
  if (months < 4) return 60;
  if (months < 7) return 75;
  if (months < 13) return 85;
  return 92;
}

export function bandFor(score) {
  if (score === null) return null;
  if (score >= 75) return "healthy";
  if (score >= 55) return "watch";
  if (score >= 35) return "at_risk";
  return "critical";
}

/**
 * Compute a client's health.
 *
 * @param {object} input
 *   deal        — the CRM deal (for tenure, retainer, risk_note)
 *   trends      — /monthly-review raw.json `trends` block, or null
 *   invoices    — the D2 ledger, or []
 *   lastReport  — YYYY-MM-DD of the last report delivered, or null
 *   today       — YYYY-MM-DD
 *
 * @returns {{score, band, confidence, signals, missing, reasons, renewal}}
 *   score is null when NO signal had data — never a default.
 */
export function clientHealth({ deal, trends = null, invoices = [], lastReport = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const d = dealSchema.normalize(deal || {});
  const tenure = dealSchema.tenureMonths(d, today);

  const signals = {
    performance: scorePerformance(trends),
    payment: scorePayment(invoices, `${today}T00:00:00.000Z`),
    delivery: scoreDelivery(lastReport, today),
    engagement: scoreEngagement(d.activities, today),
    tenure: scoreTenure(tenure),
  };

  const present = Object.entries(signals).filter(([, v]) => v !== null && v !== undefined);
  const missing = Object.entries(signals).filter(([, v]) => v === null || v === undefined).map(([k]) => k);

  let score = null;
  let confidence = 0;
  if (present.length) {
    const totalWeight = present.reduce((s, [k]) => s + WEIGHTS[k], 0);
    const weighted = present.reduce((s, [k, v]) => s + v * WEIGHTS[k], 0);
    score = Math.round(clamp(weighted / totalWeight));
    // What share of the full weighting actually had data. A 90 at 25% confidence
    // is not the same claim as a 90 at 100%, and a report must be able to say so.
    confidence = Math.round((totalWeight / Object.values(WEIGHTS).reduce((a, b) => a + b, 0)) * 100);
  }

  const reasons = [];
  if (signals.payment !== null && signals.payment <= 55) {
    const ar = agingReport(invoices, `${today}T00:00:00.000Z`);
    reasons.push(`${ar.overdue_count} overdue invoice(s), ${ar.items[0]?.currency || ""} ${ar.overdue_total} outstanding past due`);
  }
  if (signals.performance !== null && signals.performance <= 45) reasons.push("Performance trending the wrong way in the last monthly review");
  if (signals.delivery !== null && signals.delivery <= 45) reasons.push(`No report delivered in ${daysBetweenDates(today, lastReport)} days`);
  if (signals.engagement !== null && signals.engagement <= 40) reasons.push("No CRM activity logged recently — nobody is talking to this client");
  if (tenure !== null && tenure < 2) reasons.push("New engagement — nothing proven yet, highest-risk window");
  if (d.risk_note) reasons.push(`Operator note: ${d.risk_note}`);
  // A won client with no retainer on file silently drops out of every MRR and
  // at-risk-revenue total. Say it out loud instead.
  if (!(d.deal.monthly_retainer > 0)) reasons.push("No retainer recorded on the deal — this client is missing from MRR and at-risk-revenue totals. Set it: /crm set <slug> retainer=<amount>");
  if (missing.length) reasons.push(`Signals unavailable: ${missing.join(", ")} — score is based on ${confidence}% of the full weighting`);

  const days = dealSchema.daysToRenewal(d, today);
  const band = bandFor(score);
  return {
    slug: d.slug,
    company: d.company_name,
    score,
    band,
    confidence,
    // A band derived from a quarter of the weighting is a hint, not a finding, and
    // "at_risk" reads as a finding. Say which one this is so a report — or a person
    // skimming — cannot mistake thin evidence for a verdict.
    band_provisional: score !== null && confidence < 50,
    signals,
    missing,
    reasons,
    tenure_months: tenure,
    mrr: d.deal.monthly_retainer,
    // Carried so callers can bucket by currency. The portfolio has EUR, USD and PKR
    // retainers in it, so any cross-client total that drops the currency is a
    // meaningless number (an early version of this summed them into one "MRR").
    currency: d.deal.currency,
    retainer_recorded: d.deal.monthly_retainer > 0,
    revenue_to_date: dealSchema.revenueToDate(d, today),
    renewal: {
      date: dealSchema.renewalDate(d),
      days_away: days,
      // "unknown" is a distinct state from "not due" — an unset term must never
      // read as "nothing to do".
      status: days === null ? "unknown" : days < 0 ? "overdue" : days <= 30 ? "due_soon" : days <= 60 ? "approaching" : "scheduled",
    },
  };
}

/**
 * Sum MRR per currency across a set of healths. Never returns one blended number:
 * the portfolio holds EUR, USD and PKR retainers, and adding them is arithmetic on
 * incommensurable units. `unrecorded` counts clients whose retainer is missing, so
 * a total is never quietly understated.
 */
export function mrrByCurrency(healths) {
  const by = {};
  let unrecorded = 0;
  for (const h of healths || []) {
    if (!h?.retainer_recorded) { unrecorded += 1; continue; }
    const c = h.currency || "USD";
    by[c] = Math.round(((by[c] || 0) + h.mrr) * 100) / 100;
  }
  return { by_currency: by, clients_without_retainer: unrecorded };
}

/**
 * Which clients need a retention conversation, most urgent first. Feeds `/crm next`.
 * Only `won` deals are considered — retention is about current clients.
 */
export function retentionQueue(healths) {
  const urgency = (h) => {
    let u = 0;
    if (h.renewal.status === "overdue") u += 100;
    else if (h.renewal.status === "due_soon") u += 60;
    else if (h.renewal.status === "approaching") u += 20;
    if (h.band === "critical") u += 80;
    else if (h.band === "at_risk") u += 50;
    else if (h.band === "watch") u += 20;
    return u;
  };
  return (healths || [])
    .map((h) => ({ ...h, urgency: urgency(h) }))
    .filter((h) => h.urgency > 0)
    .sort((a, b) => b.urgency - a.urgency);
}
