// test/ar-reconcile.test.js — Group D2: reconciliation, AR aging, dunning.
//
// The failure modes being pinned here all end with the ledger lying about money:
//   - an out-of-order webhook reopening a paid invoice (Stripe retries; delivery
//     order is not guaranteed), so collections chase money already received;
//   - an unrecognized Stripe status being guessed at, so an unpaid invoice reads
//     "paid" and nobody chases it;
//   - an unsigned webhook being trusted, which is exactly how someone marks their
//     own invoice settled;
//   - "overdue" drifting because it was stored rather than derived.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = resolve(ROOT, "test", ".tmp-ar");
process.env.SMOS_DATA_ROOT = TMP;

const {
  agingBucket, agingReport, daysOverdue, isOutstanding,
  dunningLevel, dunningPlan, dunningQueue, DUNNING_SCHEDULE, BUCKETS,
} = await import("../scripts/lib/ar.js");
const { mapInvoiceStatus, verifyWebhookSignature, HANDLED_EVENTS } = await import("../scripts/lib/stripe.js");
const { applyStatus, recordReminder } = await import("../scripts/lib/reconcile.js");
const { saveInvoice, getInvoice, listInvoices } = await import("../scripts/lib/billing-store.js");
const { planEvent } = await import("../scripts/stripe-webhook.js");
const { invoice: invoiceSchema } = await import("../schemas/index.js");

const NOW = "2026-09-09T00:00:00.000Z";
const inv = (over = {}) => ({
  id: "INV-acme-2026-08", slug: "acme", company: "Acme Co", period: "2026-08",
  currency: "USD", line_items: [{ description: "Retainer", amount: 3000 }],
  status: "sent", issued_at: "2026-08-01T00:00:00.000Z", due_date: "2026-08-08T00:00:00.000Z",
  ...over,
});

describe("outstanding / overdue are derived, never stored", () => {
  test("only a sent invoice is receivable", () => {
    assert.equal(isOutstanding(inv({ status: "sent" })), true);
    // A draft hasn't been given to the client, so it isn't money owed yet.
    assert.equal(isOutstanding(inv({ status: "draft" })), false);
    assert.equal(isOutstanding(inv({ status: "paid", paid_at: NOW })), false);
    assert.equal(isOutstanding(inv({ status: "void", voided_at: NOW })), false);
  });

  test("days overdue is positive when late, negative before due", () => {
    assert.equal(daysOverdue(inv(), NOW), 32);
    assert.equal(daysOverdue(inv({ due_date: "2026-09-20T00:00:00.000Z" }), NOW), -11);
  });

  test("a paid invoice has no aging bucket — paying stops the clock with no field rewrite", () => {
    assert.equal(agingBucket(inv({ status: "paid", paid_at: NOW }), NOW), null);
    assert.equal(daysOverdue(inv({ status: "paid", paid_at: NOW }), NOW), null);
  });

  test("no due date means no aging claim", () => {
    assert.equal(agingBucket(inv({ due_date: null }), NOW), null);
  });
});

describe("aging buckets", () => {
  const at = (days) => {
    const d = new Date(NOW); d.setUTCDate(d.getUTCDate() - days);
    return inv({ due_date: d.toISOString() });
  };

  test("bucket boundaries", () => {
    assert.equal(agingBucket(at(-5), NOW), "current"); // not yet due
    assert.equal(agingBucket(at(0), NOW), "current");  // due today
    assert.equal(agingBucket(at(1), NOW), "1-30");
    assert.equal(agingBucket(at(30), NOW), "1-30");
    assert.equal(agingBucket(at(31), NOW), "31-60");
    assert.equal(agingBucket(at(60), NOW), "31-60");
    assert.equal(agingBucket(at(61), NOW), "61-90");
    assert.equal(agingBucket(at(90), NOW), "61-90");
    assert.equal(agingBucket(at(91), NOW), "90+");
  });

  test("report totals only outstanding money and sorts worst-first", () => {
    const r = agingReport([
      at(1), at(95), at(-3),
      inv({ id: "paid", status: "paid", paid_at: NOW }),
      inv({ id: "draft", status: "draft" }),
    ], NOW);
    assert.equal(r.items.length, 3, "paid and draft are not receivable");
    assert.equal(r.outstanding, 9000);
    assert.equal(r.overdue_count, 2);
    assert.equal(r.overdue_total, 6000);
    assert.equal(r.items[0].days_overdue, 95, "worst first");
    assert.equal(r.buckets["90+"].count, 1);
    assert.equal(r.buckets.current.total, 3000);
  });

  test("every bucket key is present even when empty, so a renderer needn't guard", () => {
    const r = agingReport([], NOW);
    assert.deepEqual(Object.keys(r.buckets), BUCKETS);
    assert.equal(r.outstanding, 0);
  });
});

describe("dunning ladder", () => {
  const late = (days) => {
    const d = new Date(NOW); d.setUTCDate(d.getUTCDate() - days);
    return inv({ due_date: d.toISOString() });
  };

  test("level rises with lateness", () => {
    assert.equal(dunningLevel(late(0), NOW), 0);
    assert.equal(dunningLevel(late(1), NOW), 1);
    assert.equal(dunningLevel(late(6), NOW), 1);
    assert.equal(dunningLevel(late(7), NOW), 2);
    assert.equal(dunningLevel(late(29), NOW), 2);
    assert.equal(dunningLevel(late(30), NOW), 3);
    assert.equal(dunningLevel(late(60), NOW), 4);
    assert.equal(dunningLevel(late(400), NOW), 4, "tops out at the last rung");
  });

  test("a paid invoice is never dunned", () => {
    assert.equal(dunningLevel(inv({ status: "paid", paid_at: NOW }), NOW), 0);
    assert.equal(dunningPlan(inv({ status: "paid", paid_at: NOW }), NOW).action, "none");
  });

  test("a due level is sent once, then waits for the next rung", () => {
    const i = late(10); // level 2
    assert.equal(dunningPlan(i, NOW).action, "send");
    const sent = { ...i, reminders: [{ at: NOW, level: 2, channel: "email" }] };
    const p = dunningPlan(sent, NOW);
    assert.equal(p.action, "wait", "must not dun the same level twice");
    assert.match(p.reason, /already sent/);
  });

  test("a higher rung reopens sending", () => {
    const i = { ...late(35), reminders: [{ at: NOW, level: 2, channel: "email" }] };
    const p = dunningPlan(i, NOW);
    assert.equal(p.action, "send");
    assert.equal(p.level, 3);
  });

  test("level 4 escalates and demands a human, never an automatic service pause", () => {
    const p = dunningPlan(late(75), NOW);
    assert.equal(p.action, "escalate");
    assert.equal(p.level, 4);
    assert.match(p.requires_human, /business decision/);
  });

  test("the queue lists only actionable invoices, worst first", () => {
    const q = dunningQueue([
      late(2), late(80), inv({ status: "paid", paid_at: NOW }), late(-5),
      { ...late(3), reminders: [{ at: NOW, level: 1 }] },
    ], NOW);
    assert.equal(q.length, 2);
    assert.equal(q[0].days_overdue, 80);
    assert.ok(q.every((p) => ["send", "escalate"].includes(p.action)));
  });

  test("the schedule is monotonic in both level and day", () => {
    for (let i = 1; i < DUNNING_SCHEDULE.length; i++) {
      assert.ok(DUNNING_SCHEDULE[i].level > DUNNING_SCHEDULE[i - 1].level);
      assert.ok(DUNNING_SCHEDULE[i].day > DUNNING_SCHEDULE[i - 1].day);
    }
  });
});

describe("Stripe status mapping", () => {
  test("known statuses map explicitly", () => {
    assert.equal(mapInvoiceStatus("paid"), "paid");
    assert.equal(mapInvoiceStatus("open"), "sent");
    assert.equal(mapInvoiceStatus("draft"), "draft");
    assert.equal(mapInvoiceStatus("void"), "void");
    // Written off is an accounting outcome, not a payment.
    assert.equal(mapInvoiceStatus("uncollectible"), "void");
  });

  test("an unknown status maps to null so the caller leaves the ledger alone", () => {
    for (const s of ["deleted", "pending", "", null, undefined, "PAID"]) {
      assert.equal(mapInvoiceStatus(s), null, `"${s}" must not be guessed at`);
    }
  });
});

describe("webhook signature verification is fail-closed", () => {
  const body = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
  const secret = "whsec_test";
  const sign = (ts, b = body, s = secret) =>
    `t=${ts},v1=${createHmac("sha256", s).update(`${ts}.${b}`).digest("hex")}`;

  test("a correctly signed, fresh event verifies", () => {
    const ts = 1789000000;
    const v = verifyWebhookSignature(body, sign(ts), { secret, now: ts * 1000 });
    assert.equal(v.ok, true);
  });

  test("no secret configured means not verified", () => {
    const v = verifyWebhookSignature(body, sign(1789000000), { secret: undefined });
    assert.equal(v.ok, false);
    assert.match(v.reason, /STRIPE_WEBHOOK_SECRET/);
  });

  test("a tampered body fails", () => {
    const ts = 1789000000;
    const v = verifyWebhookSignature(JSON.stringify({ id: "evt_1", type: "invoice.paid", extra: 1 }), sign(ts), { secret, now: ts * 1000 });
    assert.equal(v.ok, false);
    assert.match(v.reason, /mismatch/);
  });

  test("a wrong secret fails", () => {
    const ts = 1789000000;
    const v = verifyWebhookSignature(body, sign(ts, body, "whsec_other"), { secret, now: ts * 1000 });
    assert.equal(v.ok, false);
  });

  test("a stale timestamp is rejected — a captured request cannot be replayed later", () => {
    const ts = 1789000000;
    const v = verifyWebhookSignature(body, sign(ts), { secret, now: (ts + 3600) * 1000 });
    assert.equal(v.ok, false);
    assert.match(v.reason, /outside tolerance/);
  });

  test("missing and malformed headers are rejected, not ignored", () => {
    assert.match(verifyWebhookSignature(body, null, { secret }).reason, /missing Stripe-Signature/);
    assert.match(verifyWebhookSignature(body, "garbage", { secret }).reason, /malformed/);
    assert.match(verifyWebhookSignature(body, "t=123", { secret }).reason, /malformed/);
  });
});

describe("webhook planEvent", () => {
  const paidEvent = {
    id: "evt_1", type: "invoice.paid",
    data: { object: { id: "in_1", status: "paid", amount_paid: 300000, hosted_invoice_url: "https://pay", metadata: { smos_slug: "acme", smos_invoice_id: "INV-acme-2026-08" } } },
  };

  test("a paid invoice event becomes an apply_status plan with major-unit amount", () => {
    const p = planEvent(paidEvent);
    assert.equal(p.action, "apply_status");
    assert.equal(p.slug, "acme");
    assert.equal(p.invoice_id, "INV-acme-2026-08");
    assert.equal(p.amount_paid, 3000, "cents converted back to major units");
  });

  test("an unhandled event type is acknowledged, not errored", () => {
    // Erroring would make Stripe retry it forever.
    const p = planEvent({ id: "e", type: "charge.succeeded", data: { object: {} } });
    assert.equal(p.action, "ignored");
  });

  test("an event with no smos_slug is unroutable rather than applied to a guess", () => {
    const p = planEvent({ id: "e", type: "invoice.paid", data: { object: { id: "in_x", status: "paid", metadata: {} } } });
    assert.equal(p.action, "unroutable");
  });

  test("a failed payment is a dunning signal, not a status change", () => {
    const p = planEvent({ id: "e", type: "invoice.payment_failed", data: { object: { id: "in_1", status: "open", metadata: { smos_slug: "acme" } } } });
    assert.equal(p.action, "payment_failed");
    assert.match(p.reason, /remains outstanding/);
  });

  test("a deleted subscription is reported for /crm, not auto-churned", () => {
    const p = planEvent({ id: "e", type: "customer.subscription.deleted", data: { object: { id: "sub_1", metadata: { smos_slug: "acme" } } } });
    assert.equal(p.action, "subscription_canceled");
    assert.match(p.reason, /\/crm/);
  });

  test("garbage in does not throw", () => {
    for (const e of [null, undefined, {}, { type: null }, 42]) {
      assert.doesNotThrow(() => planEvent(e));
    }
  });

  test("every handled event type produces a non-ignored plan", () => {
    for (const type of HANDLED_EVENTS) {
      const p = planEvent({ id: "e", type, data: { object: { id: "in_1", status: "paid", metadata: { smos_slug: "acme" } } } });
      assert.notEqual(p.action, "ignored", `${type} is listed as handled but produces no plan`);
    }
  });
});

describe("applyStatus — the single writer", () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  test("open → paid stamps paid_at, amount and provenance", async () => {
    await saveInvoice("acme", inv({ stripe: { invoice_id: "in_1" } }));
    const r = await applyStatus("acme", "INV-acme-2026-08", { stripeStatus: "paid", via: "stripe_webhook", amountPaid: 3000, stripeInvoiceId: "in_1" });
    assert.equal(r.outcome, "updated");
    const after = getInvoice("acme", "2026-08");
    assert.equal(after.status, "paid");
    assert.ok(after.paid_at, "paid must carry paid_at — the schema requires it");
    assert.equal(after.amount_paid, 3000);
    assert.equal(after.reconciled_via, "stripe_webhook");
    assert.equal(after.stripe.status, "paid", "Stripe's own view is kept verbatim");
  });

  test("a repeated paid event is unchanged, not a second mutation", async () => {
    await saveInvoice("acme", inv({ stripe: { invoice_id: "in_1" } }));
    await applyStatus("acme", "INV-acme-2026-08", { stripeStatus: "paid" });
    const first = getInvoice("acme", "2026-08").paid_at;
    const r = await applyStatus("acme", "INV-acme-2026-08", { stripeStatus: "paid" });
    assert.equal(r.outcome, "unchanged");
    assert.equal(getInvoice("acme", "2026-08").paid_at, first, "paid_at must not be rewritten by a replay");
  });

  test("an out-of-order 'open' event does NOT reopen a paid invoice", async () => {
    await saveInvoice("acme", inv({ stripe: { invoice_id: "in_1" } }));
    await applyStatus("acme", "INV-acme-2026-08", { stripeStatus: "paid" });
    const r = await applyStatus("acme", "INV-acme-2026-08", { stripeStatus: "open" });
    assert.equal(r.outcome, "conflict");
    assert.equal(getInvoice("acme", "2026-08").status, "paid", "chasing money already received is the bug this prevents");
  });

  test("paid vs void is a conflict a human resolves", async () => {
    await saveInvoice("acme", inv({ stripe: { invoice_id: "in_1" } }));
    await applyStatus("acme", "INV-acme-2026-08", { stripeStatus: "paid" });
    const r = await applyStatus("acme", "INV-acme-2026-08", { stripeStatus: "void" });
    assert.equal(r.outcome, "conflict");
    assert.match(r.detail, /terminal states/);
  });

  test("an unknown Stripe status changes nothing", async () => {
    await saveInvoice("acme", inv({ stripe: { invoice_id: "in_1" } }));
    const r = await applyStatus("acme", "INV-acme-2026-08", { stripeStatus: "pending" });
    assert.equal(r.outcome, "unknown_status");
    assert.equal(getInvoice("acme", "2026-08").status, "sent");
  });

  test("void stamps voided_at", async () => {
    await saveInvoice("acme", inv({ stripe: { invoice_id: "in_1" } }));
    await applyStatus("acme", "INV-acme-2026-08", { stripeStatus: "uncollectible" });
    const after = getInvoice("acme", "2026-08");
    assert.equal(after.status, "void");
    assert.ok(after.voided_at);
  });

  test("an invoice can be found by its Stripe id when the ledger id isn't known", async () => {
    await saveInvoice("acme", inv({ stripe: { invoice_id: "in_1" } }));
    const r = await applyStatus("acme", null, { stripeStatus: "paid", stripeInvoiceId: "in_1" });
    assert.equal(r.outcome, "updated");
  });

  test("an unknown invoice is reported, never created", async () => {
    const r = await applyStatus("acme", "INV-nope", { stripeStatus: "paid" });
    assert.equal(r.outcome, "not_found");
    assert.equal(listInvoices("acme").length, 0);
  });

  test("reminders append and are recorded against the invoice", async () => {
    await saveInvoice("acme", inv());
    await recordReminder("acme", "INV-acme-2026-08", { level: 1, channel: "email", note: "first nudge" });
    const r2 = await recordReminder("acme", "INV-acme-2026-08", { level: 2, channel: "email" });
    assert.equal(r2.reminders, 2);
    const after = getInvoice("acme", "2026-08");
    assert.equal(after.reminders.length, 2);
    assert.equal(after.reminders[0].level, 1);
    // ...and the dunning planner now respects them.
    assert.equal(dunningPlan(after, NOW).action, "send"); // 32 days late → level 3 due
  });

  test("a reminder against an unknown invoice fails cleanly", async () => {
    const r = await recordReminder("acme", "INV-nope", { level: 1 });
    assert.equal(r.ok, false);
  });
});

describe("invoice schema — D2 additions are fail-closed", () => {
  test("paid requires paid_at", () => {
    const v = invoiceSchema.validate(inv({ status: "paid" }));
    assert.equal(v.ok, false);
    assert.match(v.errors.join(), /paid requires paid_at/);
    assert.equal(invoiceSchema.validate(inv({ status: "paid", paid_at: NOW })).ok, true);
  });

  test("void requires voided_at", () => {
    assert.equal(invoiceSchema.validate(inv({ status: "void" })).ok, false);
    assert.equal(invoiceSchema.validate(inv({ status: "void", voided_at: NOW })).ok, true);
  });

  test("a reminder needs a timestamp and a real level", () => {
    assert.equal(invoiceSchema.validate(inv({ reminders: [{ level: 1 }] })).ok, false);
    assert.equal(invoiceSchema.validate(inv({ reminders: [{ at: NOW, level: 0 }] })).ok, false);
    assert.equal(invoiceSchema.validate(inv({ reminders: [{ at: NOW, level: 1 }] })).ok, true);
  });

  test("normalize keeps the old shape working — no field is now mandatory that wasn't", () => {
    const n = invoiceSchema.normalize(inv());
    assert.equal(n.paid_at, null);
    assert.equal(n.reminders.length, 0);
    assert.equal(n.reconciled_via, null);
    assert.equal(invoiceSchema.validate(inv()).ok, true);
  });
});
