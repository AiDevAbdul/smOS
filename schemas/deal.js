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
  };
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
  // A won deal must carry the artifacts that justify the win.
  if (d.stage === "won" && !isNonEmptyString(d.links.proposal)) {
    errors.push("deal.stage=won requires links.proposal (run /proposal before marking won)");
  }
  return result(errors);
}

/** Weighted value of a deal for the pipeline forecast (annualized retainer × prob). */
export function weightedValue(d) {
  const n = normalize(d);
  if (["won", "lost", "churned"].includes(n.stage)) return n.stage === "won" ? n.deal.monthly_retainer * 12 : 0;
  return Math.round(n.deal.monthly_retainer * 12 * (n.probability / 100));
}
