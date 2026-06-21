// schemas/invoice.js — canonical shape for a retainer invoice (Phase 5, Agency OS).
//
// /billing issues one invoice per client per period (YYYY-MM): the monthly retainer,
// plus the one-time setup fee on the first invoice, plus an optional ad-spend
// pass-through line. The ledger (billing/<slug>/ledger.json) is the source of truth;
// /portal reads it for the client's invoice view. Amounts are MAJOR units (e.g. 3000
// USD); Stripe cents conversion happens only at the API boundary.
//
// normalize(raw): LENIENT. validate(obj): FAIL-CLOSED, including a totals check so a
// stored invoice can never disagree with its own line items.

import { pick, asArray, isNonEmptyString, isFiniteNumber, result } from "./_shared.js";

export const STATUSES = ["draft", "sent", "paid", "void"];

export function normalizeLine(raw) {
  const r = raw || {};
  return {
    description: pick(r, "description", "desc") ?? "",
    amount: Number(pick(r, "amount") ?? 0) || 0,
  };
}

export function computeTotal(lineItems) {
  return asArray(lineItems).reduce((s, l) => s + (Number(normalizeLine(l).amount) || 0), 0);
}

export function normalize(raw) {
  const r = raw || {};
  const line_items = asArray(pick(r, "line_items", "lines")).map(normalizeLine);
  const subtotal = computeTotal(line_items);
  const stripe = r.stripe || null;
  return {
    ...r,
    id: pick(r, "id") ?? null,
    slug: pick(r, "slug", "client_slug") ?? null,
    company: pick(r, "company", "company_name") ?? null,
    period: pick(r, "period") ?? null, // YYYY-MM
    currency: pick(r, "currency") ?? "USD",
    line_items,
    subtotal,
    total: isFiniteNumber(r.total) ? r.total : subtotal,
    status: (pick(r, "status") || "draft").toLowerCase(),
    issued_at: pick(r, "issued_at") ?? null,
    due_date: pick(r, "due_date") ?? null,
    stripe: stripe ? {
      customer_id: stripe.customer_id ?? null,
      invoice_id: stripe.invoice_id ?? null,
      hosted_url: stripe.hosted_url ?? null,
    } : null,
  };
}

export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["invoice is not an object"]);
  const inv = normalize(obj);
  if (!isNonEmptyString(inv.id)) errors.push("invoice.id is missing");
  if (!isNonEmptyString(inv.slug)) errors.push("invoice.slug is missing");
  if (!isNonEmptyString(inv.period) || !/^\d{4}-\d{2}$/.test(inv.period)) errors.push("invoice.period must be YYYY-MM");
  if (!inv.line_items.length) errors.push("invoice.line_items is empty");
  if (inv.line_items.some((l) => !isNonEmptyString(l.description))) errors.push("every line item needs a description");
  if (inv.total < 0) errors.push("invoice.total must be ≥ 0");
  if (!STATUSES.includes(inv.status)) errors.push(`invoice.status "${inv.status}" invalid`);
  // The stored total must equal the sum of line items — no silent drift.
  if (Math.round(inv.total * 100) !== Math.round(inv.subtotal * 100)) {
    errors.push(`invoice.total (${inv.total}) != sum of line items (${inv.subtotal})`);
  }
  return result(errors);
}
