// scripts/lib/reconcile.js — the one place a ledger invoice's status changes to
// match reality (Group D2).
//
// Both routes in — the polling reconciler (`/billing <slug> reconcile`) and the
// webhook handler (`scripts/stripe-webhook.js`) — funnel through `applyStatus` so
// there is exactly one implementation of "what happens when Stripe says paid".
//
// The rules it enforces, each one a way the ledger could otherwise start lying:
//
//   - A terminal state is never silently reopened. Once paid, a stray `open` event
//     (Stripe retries, out-of-order webhooks) does NOT flip it back to sent; the
//     conflict is REPORTED instead. Out-of-order delivery is normal, not an error.
//   - `paid` always carries `paid_at`, `void` always carries `voided_at` — the
//     invoice schema now refuses them otherwise, so this can't be skipped.
//   - Every change records HOW it was learned (`reconciled_via`), so a report can
//     distinguish a Stripe-confirmed payment from a human's `mark-paid` assertion.
//   - An unrecognized Stripe status changes nothing. Guessing would be worse than
//     staying stale, because a wrong "paid" stops collections on real money owed.

import { listInvoices, saveInvoice } from "./billing-store.js";
import { mapInvoiceStatus } from "./stripe.js";

const TERMINAL = new Set(["paid", "void"]);

/**
 * Apply an authoritative status to one ledger invoice.
 *
 * @returns {{changed: boolean, outcome: string, from?: string, to?: string, detail?: string}}
 *   outcome: updated | unchanged | conflict | unknown_status | not_found
 */
export async function applyStatus(slug, invoiceId, {
  stripeStatus,
  via = "stripe_poll",
  at = new Date().toISOString(),
  amountPaid = null,
  stripeInvoiceId = null,
  hostedUrl = null,
}) {
  const all = listInvoices(slug);
  const inv = all.find((i) => i.id === invoiceId)
    || (stripeInvoiceId ? all.find((i) => i.stripe?.invoice_id === stripeInvoiceId) : null);
  if (!inv) {
    return { changed: false, outcome: "not_found", detail: `No ledger invoice ${invoiceId || stripeInvoiceId} for ${slug}.` };
  }

  const target = mapInvoiceStatus(stripeStatus);
  if (!target) {
    return { changed: false, outcome: "unknown_status", from: inv.status, detail: `Stripe status "${stripeStatus}" is not one smOS maps; ledger left unchanged.` };
  }

  // Record Stripe's own view either way, so a mismatch is visible.
  const stripeBlock = {
    ...(inv.stripe || {}),
    ...(stripeInvoiceId ? { invoice_id: stripeInvoiceId } : {}),
    ...(hostedUrl ? { hosted_url: hostedUrl } : {}),
    status: String(stripeStatus),
  };

  if (inv.status === target) {
    await saveInvoice(slug, { ...inv, stripe: stripeBlock, reconciled_via: via, reconciled_at: at });
    return { changed: false, outcome: "unchanged", from: inv.status, to: target };
  }

  // Never walk a settled invoice backwards on a late/out-of-order event.
  if (TERMINAL.has(inv.status) && !TERMINAL.has(target)) {
    await saveInvoice(slug, { ...inv, stripe: stripeBlock });
    return {
      changed: false, outcome: "conflict", from: inv.status, to: target,
      detail: `Ledger says ${inv.status}; Stripe says ${stripeStatus}. Refusing to reopen a settled invoice — resolve by hand if this is real.`,
    };
  }
  // paid → void (or void → paid) is also a conflict worth a human's eyes.
  if (TERMINAL.has(inv.status) && TERMINAL.has(target) && inv.status !== target) {
    await saveInvoice(slug, { ...inv, stripe: stripeBlock });
    return {
      changed: false, outcome: "conflict", from: inv.status, to: target,
      detail: `Ledger says ${inv.status}; Stripe says ${stripeStatus}. Two different terminal states — resolve by hand.`,
    };
  }

  const patch = {
    ...inv, status: target, stripe: stripeBlock,
    reconciled_via: via, reconciled_at: at,
  };
  if (target === "paid") {
    patch.paid_at = inv.paid_at || at;
    patch.amount_paid = amountPaid !== null ? amountPaid : inv.total;
  }
  if (target === "void") patch.voided_at = inv.voided_at || at;

  await saveInvoice(slug, patch);
  return { changed: true, outcome: "updated", from: inv.status, to: target };
}

/** Record a dunning reminder against an invoice (append-only). */
export async function recordReminder(slug, invoiceId, { level, channel = "manual", note = "", at = new Date().toISOString() }) {
  const all = listInvoices(slug);
  const found = all.find((i) => i.id === invoiceId);
  if (!found) return { ok: false, detail: `No ledger invoice ${invoiceId} for ${slug}.` };
  const reminders = [...(found.reminders || []), { at, level, channel, note }];
  await saveInvoice(slug, { ...found, reminders });
  return { ok: true, level, reminders: reminders.length };
}
