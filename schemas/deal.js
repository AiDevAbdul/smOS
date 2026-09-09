// schemas/deal.js — canonical shape for a CRM pipeline deal (Phase 5, Agency OS).
//
// The agency lifecycle already existed in fragments: prospects/<slug>/ + the
// prospect_audits table (with a `converted` flag) on the front, clients/<slug>/ +
// the clients table on the back. This unifies them into ONE pipeline record so the
// agency can see acquisition → contracting → active → churn in one place. /proposal,
// /contract and /billing all hang off this deal (via deal.links + deal.deal terms).
//
// normalize(raw): LENIENT, never throws. validate(obj): FAIL-CLOSED.

import { pick, asArray, isNonEmptyString, isFiniteNumber, result } from "./_shared.js";

// The pipeline stages, in lifecycle order. won = signed (→ /intake makes a client);
// lost/churned are terminal-ish but re-engageable.
export const STAGES = ["lead", "contacted", "audited", "proposed", "negotiating", "won", "lost", "churned"];

// Allowed stage transitions — a real sales pipeline, not a free-for-all. The skill
// enforces this (with an explicit --force escape hatch) so a deal can't silently
// jump from "lead" to "won" without the steps that produce a proposal/contract.
export const TRANSITIONS = {
  lead: ["contacted", "audited", "proposed", "lost"],
  contacted: ["audited", "proposed", "negotiating", "lost"],
  audited: ["proposed", "negotiating", "lost"],
  proposed: ["negotiating", "won", "lost"],
  negotiating: ["won", "lost"],
  won: ["churned"],
  lost: ["contacted"],   // re-engage a dead lead
  churned: ["contacted"], // win back a former client
};

// Default close probability per stage — used for the weighted pipeline forecast.
export const STAGE_PROBABILITY = {
  lead: 10, contacted: 20, audited: 35, proposed: 55,
  negotiating: 75, won: 100, lost: 0, churned: 0,
};

export function isValidTransition(from, to) {
  if (from === to) return true; // idempotent set is allowed
  return (TRANSITIONS[from] || []).includes(to);
}

export function normalizeActivity(raw) {
  const r = raw || {};
  return {
    at: pick(r, "at", "timestamp") ?? null,
    type: (pick(r, "type") || "note").toLowerCase(), // note|call|email|meeting|stage|proposal|contract
    note: pick(r, "note", "text") ?? "",
  };
}

// One-time (non-recurring) line items alongside the recurring retainer — e.g. a
// website rebuild, a landing page, an initial video/graphics production package.
// Kept separate from `deal.monthly_retainer`/`setup_fee` so proposal/contract
// renderers can list recurring vs. one-time charges distinctly.
export function normalizeAddon(raw) {
  const r = raw || {};
  return {
    name: pick(r, "name", "title") ?? null,
    amount: isFiniteNumber(Number(pick(r, "amount", "price"))) ? Number(pick(r, "amount", "price")) : 0,
    currency: pick(r, "currency") ?? null,
    description: pick(r, "description") ?? null,
    recurring: false,
  };
}

export function normalize(raw) {
  const r = raw || {};
  const stage = (pick(r, "stage") || "lead").toLowerCase();
  const contact = r.contact || {};
  const deal = r.deal || {};
  const links = r.links || {};
  return {
    ...r,
    id: pick(r, "id", "slug") ?? null,
    slug: pick(r, "slug", "id") ?? null,
    company_name: pick(r, "company_name", "name", "company") ?? null,
    contact: {
      name: pick(contact, "name") ?? pick(r, "contact_name") ?? null,
      email: pick(contact, "email") ?? pick(r, "contact_email") ?? null,
      phone: pick(contact, "phone") ?? pick(r, "contact_phone") ?? null,
    },
    stage,
    source: pick(r, "source") ?? null, // referral|inbound|outbound|pre-audit|...
    services: asArray(pick(r, "services")),
    deal: {
      monthly_retainer: Number(pick(deal, "monthly_retainer") ?? pick(r, "monthly_retainer") ?? 0) || 0,
      setup_fee: Number(pick(deal, "setup_fee") ?? 0) || 0,
      currency: pick(deal, "currency") ?? pick(r, "currency") ?? "USD",
      addons: asArray(pick(deal, "addons")).map(normalizeAddon),
    },
    probability: isFiniteNumber(r.probability) ? r.probability : (STAGE_PROBABILITY[stage] ?? 0),
    expected_close: pick(r, "expected_close") ?? null,
    owner: pick(r, "owner") ?? null,
    next_action: pick(r, "next_action") ?? null,
    next_action_due: pick(r, "next_action_due") ?? null,
    activities: asArray(pick(r, "activities")).map(normalizeActivity),
    links: {
      pre_audit: pick(links, "pre_audit") ?? null,
      proposal: pick(links, "proposal") ?? null,
      contract: pick(links, "contract") ?? null,
      client_profile: pick(links, "client_profile") ?? null,
    },
    created_at: pick(r, "created_at") ?? null,
    updated_at: pick(r, "updated_at") ?? null,
    won_at: pick(r, "won_at") ?? null,
    lost_at: pick(r, "lost_at") ?? null,
    lost_reason: pick(r, "lost_reason") ?? null,
    // ── retention layer (Group D3) ──
    // The pipeline tracked acquisition well and retention not at all: a won deal
    // had no term, no renewal date, and no way to notice a client going quiet.
    // Dates are YYYY-MM-DD (a term boundary is a date, not an instant).
    engagement_start: pick(r, "engagement_start") ?? null,
    term_months: isFiniteNumber(Number(pick(r, "term_months"))) ? Number(pick(r, "term_months")) : null,
    // Explicit when set; otherwise derived from engagement_start + term_months by
    // renewalDate() below, so the two can never disagree in storage.
    renewal_date: pick(r, "renewal_date") ?? null,
    // Set by a human when they know something the metrics don't ("champion left").
    // The computed health score reports this alongside its own signals.
    risk_note: pick(r, "risk_note") ?? null,
  };
}

/** ISO date `n` months after `start` (YYYY-MM-DD in, YYYY-MM-DD out). */
export function addMonths(start, months) {
  if (!start || !isFiniteNumber(Number(months))) return null;
  const d = new Date(`${String(start).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const targetMonth = d.getUTCMonth() + Number(months);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(targetMonth);
  // Clamp to the last day of the target month, so a Jan-31 start + 1 month is
  // Feb-28, not a silent roll into March.
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

/**
 * When this engagement comes up for renewal: the explicit date if set, else
 * derived from engagement_start + term_months. null when neither is known — an
 * unknown renewal date must read as unknown, never as "not due".
 */
export function renewalDate(d) {
  const n = normalize(d);
  if (isNonEmptyString(n.renewal_date)) return String(n.renewal_date).slice(0, 10);
  if (n.engagement_start && n.term_months) return addMonths(n.engagement_start, n.term_months);
  return null;
}

/** Whole days until renewal (negative = overdue). null when unknown. */
export function daysToRenewal(d, today = new Date().toISOString().slice(0, 10)) {
  const r = renewalDate(d);
  if (!r) return null;
  const ms = new Date(`${r}T00:00:00Z`).getTime() - new Date(`${String(today).slice(0, 10)}T00:00:00Z`).getTime();
  return Number.isFinite(ms) ? Math.round(ms / 86400000) : null;
}

/** Whole months the client has been engaged. null when the start is unknown. */
export function tenureMonths(d, today = new Date().toISOString().slice(0, 10)) {
  const n = normalize(d);
  const start = n.engagement_start || (n.won_at ? String(n.won_at).slice(0, 10) : null);
  if (!start) return null;
  const a = new Date(`${String(start).slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${String(today).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Lifetime revenue booked so far, at the current retainer. Feeds LTV (D5).
 *
 * Returns null — not 0 — when the retainer is unrecorded. A won deal carrying
 * `monthly_retainer: 0` almost always means nobody entered the terms (blue-rose-auto
 * was onboarded outside the formal /proposal flow and is exactly this case), and
 * "we have earned 0 from this client" is a very different claim from "we don't
 * know what this client pays".
 */
export function revenueToDate(d, today = new Date().toISOString().slice(0, 10)) {
  const n = normalize(d);
  const t = tenureMonths(n, today);
  if (t === null) return null;
  if (!(n.deal.monthly_retainer > 0)) return null;
  return Math.round(n.deal.monthly_retainer * t * 100) / 100;
}

export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["deal is not an object"]);
  const d = normalize(obj);
  if (!isNonEmptyString(d.slug)) errors.push("deal.slug is missing");
  if (!isNonEmptyString(d.company_name)) errors.push("deal.company_name is missing");
  if (!STAGES.includes(d.stage)) errors.push(`deal.stage "${d.stage}" is not a valid stage`);
  if (d.probability < 0 || d.probability > 100) errors.push("deal.probability must be 0–100");
  if (d.deal.monthly_retainer < 0) errors.push("deal.deal.monthly_retainer must be ≥ 0");
  d.deal.addons.forEach((a, i) => {
    if (!isNonEmptyString(a.name)) errors.push(`deal.deal.addons[${i}].name is missing`);
    if (a.amount < 0) errors.push(`deal.deal.addons[${i}].amount must be ≥ 0`);
  });
  // A won deal must carry the artifacts that justify the win.
  if (d.stage === "won" && !isNonEmptyString(d.links.proposal)) {
    errors.push("deal.stage=won requires links.proposal (run /proposal before marking won)");
  }
  // Retention fields (D3): validate shape when present. Deliberately NOT required —
  // five clients were won before these existed, and failing them closed would break
  // every existing pipeline read for no safety gain.
  for (const [field, val] of [["engagement_start", d.engagement_start], ["renewal_date", d.renewal_date]]) {
    if (val !== null && !/^\d{4}-\d{2}-\d{2}/.test(String(val))) {
      errors.push(`deal.${field} must be YYYY-MM-DD when set (got "${val}")`);
    }
  }
  if (d.term_months !== null && !(d.term_months > 0)) {
    errors.push("deal.term_months must be > 0 when set");
  }
  return result(errors);
}

/** Weighted value of a deal for the pipeline forecast (annualized retainer × prob). */
export function weightedValue(d) {
  const n = normalize(d);
  if (["won", "lost", "churned"].includes(n.stage)) return n.stage === "won" ? n.deal.monthly_retainer * 12 : 0;
  return Math.round(n.deal.monthly_retainer * 12 * (n.probability / 100));
}
