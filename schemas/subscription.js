// schemas/subscription.js — the recurring-retainer arrangement for one client (Group D1).
//
// Why this is separate from schemas/invoice.js: the ledger
// (billing/<slug>/ledger.json) is the append-only HISTORY of invoices actually
// issued. This is the single CURRENT state of the client's recurring billing —
// what they pay, how often, since when, and (if Stripe is wired) the Stripe ids
// that own the recurring charge. One file per client:
// billing/<slug>/subscription.json.
//
// Before D1, "recurring" existed only as a number on the deal
// (deal.deal.monthly_retainer) plus a human remembering to run `/billing invoice`
// every month. That is not a subscription — nothing recorded that the arrangement
// was live, when it started, or whether Stripe was collecting automatically. This
// record is what the auto-issue cron reads to decide who to bill.
//
// Amounts are MAJOR units (e.g. 3000 USD), matching schemas/invoice.js. Cents
// conversion happens only at the Stripe API boundary.
//
// normalize(raw): LENIENT, never throws. validate(obj): FAIL-CLOSED.

import { pick, isNonEmptyString, isFiniteNumber, result } from "./_shared.js";

// active   — billing normally
// past_due — a charge failed; dunning applies (D2)
// paused   — deliberately not billing this month, arrangement intact
// canceled — the arrangement is over (terminal; a churned client)
export const STATUSES = ["active", "past_due", "paused", "canceled"];

export const INTERVALS = ["month", "year"];

// How the money is actually collected. This is recorded rather than inferred so a
// report can never imply Stripe is auto-collecting when nobody wired it up.
//   stripe_subscription — Stripe owns the recurring charge; invoices arrive by webhook
//   invoice_manual      — smOS issues an invoice each period; a human collects
export const COLLECTION_MODES = ["stripe_subscription", "invoice_manual"];

export function normalize(raw) {
  const r = raw || {};
  const stripe = r.stripe || null;
  const amount = Number(pick(r, "amount", "monthly_retainer") ?? 0) || 0;
  return {
    ...r,
    slug: pick(r, "slug", "client_slug") ?? null,
    company: pick(r, "company", "company_name") ?? null,
    amount,
    currency: pick(r, "currency") ?? "USD",
    interval: (pick(r, "interval") || "month").toLowerCase(),
    status: (pick(r, "status") || "active").toLowerCase(),
    collection_mode: (pick(r, "collection_mode", "mode") || "invoice_manual").toLowerCase(),
    // YYYY-MM — the first period this subscription bills for. The auto-issue cron
    // never issues for a period before this, so activating mid-engagement cannot
    // retroactively invoice months the client already settled by hand.
    start_period: pick(r, "start_period") ?? null,
    // YYYY-MM — the last period to bill, when the term is fixed. null = open-ended.
    end_period: pick(r, "end_period") ?? null,
    created_at: pick(r, "created_at") ?? null,
    updated_at: pick(r, "updated_at") ?? null,
    canceled_at: pick(r, "canceled_at") ?? null,
    stripe: stripe ? {
      customer_id: stripe.customer_id ?? null,
      price_id: stripe.price_id ?? null,
      subscription_id: stripe.subscription_id ?? null,
    } : null,
  };
}

export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["subscription is not an object"]);
  const s = normalize(obj);
  if (!isNonEmptyString(s.slug)) errors.push("subscription.slug is missing");
  if (!isFiniteNumber(s.amount) || s.amount <= 0) errors.push("subscription.amount must be > 0");
  if (!INTERVALS.includes(s.interval)) errors.push(`subscription.interval "${s.interval}" invalid (${INTERVALS.join("|")})`);
  if (!STATUSES.includes(s.status)) errors.push(`subscription.status "${s.status}" invalid (${STATUSES.join("|")})`);
  if (!COLLECTION_MODES.includes(s.collection_mode)) {
    errors.push(`subscription.collection_mode "${s.collection_mode}" invalid (${COLLECTION_MODES.join("|")})`);
  }
  if (!isNonEmptyString(s.start_period) || !/^\d{4}-\d{2}$/.test(s.start_period)) {
    errors.push("subscription.start_period must be YYYY-MM");
  }
  if (s.end_period !== null) {
    if (!/^\d{4}-\d{2}$/.test(String(s.end_period))) errors.push("subscription.end_period must be YYYY-MM or null");
    else if (String(s.end_period) < String(s.start_period)) errors.push("subscription.end_period is before start_period");
  }
  // Claiming Stripe collects the money while carrying no subscription id would make
  // every downstream "auto-collected" statement a lie. Fail closed on it.
  if (s.collection_mode === "stripe_subscription" && !isNonEmptyString(s.stripe?.subscription_id)) {
    errors.push("collection_mode=stripe_subscription requires stripe.subscription_id");
  }
  if (s.status === "canceled" && !isNonEmptyString(s.canceled_at)) {
    errors.push("subscription.status=canceled requires canceled_at");
  }
  return result(errors);
}

/** Does this subscription bill for `period` (YYYY-MM)? Pure — the cron's decision. */
export function billsPeriod(sub, period) {
  const s = normalize(sub);
  if (s.status !== "active") return false;
  if (!/^\d{4}-\d{2}$/.test(String(period))) return false;
  if (!s.start_period || String(period) < String(s.start_period)) return false;
  if (s.end_period && String(period) > String(s.end_period)) return false;
  if (s.interval === "year") {
    // An annual retainer bills only in its anniversary month.
    return String(period).slice(5, 7) === String(s.start_period).slice(5, 7);
  }
  return true;
}

/** Annualized value — what this arrangement is worth per year. Feeds MRR/ARR (D5). */
export function annualValue(sub) {
  const s = normalize(sub);
  if (s.status === "canceled") return 0;
  return s.interval === "year" ? s.amount : s.amount * 12;
}

/** Monthly recurring revenue contribution. Feeds the MRR roll-up (D5). */
export function mrr(sub) {
  const s = normalize(sub);
  if (s.status !== "active") return 0;
  return s.interval === "year" ? Math.round((s.amount / 12) * 100) / 100 : s.amount;
}
