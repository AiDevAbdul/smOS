// test/subscription.test.js — Group D1: recurring retainers.
//
// Three things are worth pinning here, because each one is a way real money goes
// wrong quietly:
//   1. The schema refuses to record "Stripe is collecting this" without a Stripe
//      subscription id — otherwise every downstream MRR/AR statement is a guess.
//   2. billsPeriod() is the cron's whole decision. Off-by-one on start/end period
//      is the difference between billing a client correctly and invoicing them for
//      months they already settled by hand.
//   3. Every mutating Stripe call carries a DETERMINISTIC Idempotency-Key, so a
//      retried run replays instead of double-charging.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.SMOS_DATA_ROOT) process.env.SMOS_DATA_ROOT = resolve(ROOT, "test", ".tmp");

const { subscription: sub } = await import("../schemas/index.js");
const { idempotencyKey, toCents, stripePost, createSubscription } = await import("../scripts/lib/stripe.js");
const { planClient, currentPeriod } = await import("../scripts/billing-cron.js");

const base = {
  slug: "acme", company: "Acme Co", amount: 3000, currency: "USD",
  interval: "month", status: "active", collection_mode: "invoice_manual",
  start_period: "2026-09",
};

describe("schemas/subscription — normalize", () => {
  test("defaults are the conservative ones", () => {
    const s = sub.normalize({ slug: "acme", amount: 1000, start_period: "2026-09" });
    assert.equal(s.currency, "USD");
    assert.equal(s.interval, "month");
    assert.equal(s.status, "active");
    // Never assume Stripe is collecting money nobody wired up.
    assert.equal(s.collection_mode, "invoice_manual");
    assert.equal(s.stripe, null);
  });

  test("accepts monthly_retainer as an alias for amount", () => {
    assert.equal(sub.normalize({ slug: "a", monthly_retainer: 2500 }).amount, 2500);
  });

  test("never throws on garbage", () => {
    for (const bad of [null, undefined, 0, "", [], { amount: "abc" }]) {
      assert.doesNotThrow(() => sub.normalize(bad));
    }
  });
});

describe("schemas/subscription — validate is fail-closed", () => {
  test("a well-formed manual subscription passes", () => {
    assert.equal(sub.validate(base).ok, true);
  });

  test("amount must be positive", () => {
    const v = sub.validate({ ...base, amount: 0 });
    assert.equal(v.ok, false);
    assert.match(v.errors.join(), /amount must be > 0/);
  });

  test("start_period must be YYYY-MM", () => {
    assert.equal(sub.validate({ ...base, start_period: "Sept 2026" }).ok, false);
    assert.equal(sub.validate({ ...base, start_period: null }).ok, false);
  });

  test("end_period before start_period is rejected", () => {
    const v = sub.validate({ ...base, end_period: "2026-08" });
    assert.equal(v.ok, false);
    assert.match(v.errors.join(), /before start_period/);
  });

  test("claiming Stripe collection without a subscription id is rejected", () => {
    const v = sub.validate({ ...base, collection_mode: "stripe_subscription" });
    assert.equal(v.ok, false);
    assert.match(v.errors.join(), /requires stripe\.subscription_id/);
    // ...and passes once the id is actually there.
    assert.equal(sub.validate({
      ...base, collection_mode: "stripe_subscription",
      stripe: { subscription_id: "sub_123" },
    }).ok, true);
  });

  test("a canceled subscription must say when", () => {
    assert.equal(sub.validate({ ...base, status: "canceled" }).ok, false);
    assert.equal(sub.validate({ ...base, status: "canceled", canceled_at: "2026-09-09T00:00:00Z" }).ok, true);
  });

  test("unknown status / interval / collection_mode are named, not coerced", () => {
    assert.match(sub.validate({ ...base, status: "trialing" }).errors.join(), /status "trialing" invalid/);
    assert.match(sub.validate({ ...base, interval: "week" }).errors.join(), /interval "week" invalid/);
    assert.match(sub.validate({ ...base, collection_mode: "carrier_pigeon" }).errors.join(), /collection_mode .* invalid/);
  });
});

describe("billsPeriod — the cron's decision", () => {
  test("bills from the start period onward, never before it", () => {
    assert.equal(sub.billsPeriod(base, "2026-08"), false, "back-dating would re-bill a settled month");
    assert.equal(sub.billsPeriod(base, "2026-09"), true);
    assert.equal(sub.billsPeriod(base, "2027-03"), true);
  });

  test("respects a fixed term's end period inclusively", () => {
    const fixed = { ...base, end_period: "2026-11" };
    assert.equal(sub.billsPeriod(fixed, "2026-11"), true);
    assert.equal(sub.billsPeriod(fixed, "2026-12"), false);
  });

  test("a non-active subscription bills nothing", () => {
    for (const status of ["paused", "canceled", "past_due"]) {
      assert.equal(sub.billsPeriod({ ...base, status }, "2026-10"), false);
    }
  });

  test("an annual retainer bills only in its anniversary month", () => {
    const yearly = { ...base, interval: "year", amount: 30000, start_period: "2026-09" };
    assert.equal(sub.billsPeriod(yearly, "2026-09"), true);
    assert.equal(sub.billsPeriod(yearly, "2026-10"), false);
    assert.equal(sub.billsPeriod(yearly, "2027-09"), true);
  });

  test("a malformed period is never billable", () => {
    for (const p of ["2026", "2026-9", "", null, undefined]) {
      assert.equal(sub.billsPeriod(base, p), false);
    }
  });
});

describe("MRR / annual value", () => {
  test("monthly retainer", () => {
    assert.equal(sub.mrr(base), 3000);
    assert.equal(sub.annualValue(base), 36000);
  });

  test("annual retainer is amortized into MRR", () => {
    const yearly = { ...base, interval: "year", amount: 30000 };
    assert.equal(sub.mrr(yearly), 2500);
    assert.equal(sub.annualValue(yearly), 30000);
  });

  test("inactive contributes no MRR", () => {
    assert.equal(sub.mrr({ ...base, status: "paused" }), 0);
    assert.equal(sub.mrr({ ...base, status: "canceled", canceled_at: "x" }), 0);
    assert.equal(sub.annualValue({ ...base, status: "canceled", canceled_at: "x" }), 0);
  });
});

describe("stripe boundary — idempotency and cents", () => {
  test("keys are deterministic, not random", () => {
    assert.equal(idempotencyKey("INV-acme-2026-09", "invoice"), idempotencyKey("INV-acme-2026-09", "invoice"));
    assert.notEqual(idempotencyKey("INV-acme-2026-09", "invoice"), idempotencyKey("INV-acme-2026-10", "invoice"));
    // Distinct operations on the same invoice must not collapse into one request.
    assert.notEqual(idempotencyKey("INV-acme-2026-09", "item-0"), idempotencyKey("INV-acme-2026-09", "item-1"));
  });

  test("major units convert to integer cents without float drift", () => {
    assert.equal(toCents(3000), 300000);
    assert.equal(toCents(19.99), 1999);
    assert.equal(toCents(0.1 + 0.2), 30); // would be 30.000000000000004 naively
    assert.equal(toCents(undefined), 0);
  });

  test("stripePost sends the Idempotency-Key header and form-encodes the body", async () => {
    process.env.STRIPE_API_KEY = "sk_test_dummy";
    let seen = null;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ id: "in_1" }) };
    };
    await stripePost("invoices", { customer: "cus_1", days_until_due: "7" }, {
      idempotency: idempotencyKey("INV-acme-2026-09", "invoice"), fetchImpl,
    });
    assert.equal(seen.init.headers["Idempotency-Key"], "smos:INV-acme-2026-09:invoice");
    assert.equal(seen.init.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.equal(String(seen.init.body), "customer=cus_1&days_until_due=7");
    delete process.env.STRIPE_API_KEY;
  });

  test("a non-2xx throws rather than returning a fake success", async () => {
    process.env.STRIPE_API_KEY = "sk_test_dummy";
    const fetchImpl = async () => ({ ok: false, status: 402, text: async () => "card_declined" });
    await assert.rejects(
      () => stripePost("invoices", {}, { idempotency: "k", fetchImpl }),
      /Stripe invoices 402: card_declined/,
    );
    delete process.env.STRIPE_API_KEY;
  });

  test("no API key is an error, never a silent no-op", async () => {
    delete process.env.STRIPE_API_KEY;
    await assert.rejects(() => stripePost("invoices", {}, { idempotency: "k" }), /STRIPE_API_KEY is not set/);
  });

  test("createSubscription builds a recurring price and an invoice-collected subscription", async () => {
    process.env.STRIPE_API_KEY = "sk_test_dummy";
    const calls = [];
    const fetchImpl = async (url, init) => {
      const path = url.replace("https://api.stripe.com/v1/", "");
      calls.push({ path, body: init.body ? String(init.body) : null, key: init.headers["Idempotency-Key"] });
      if (path.startsWith("customers/search")) return { ok: true, json: async () => ({ data: [] }) };
      if (path === "customers") return { ok: true, json: async () => ({ id: "cus_1" }) };
      if (path === "prices") return { ok: true, json: async () => ({ id: "price_1" }) };
      if (path === "subscriptions") return { ok: true, json: async () => ({ id: "sub_1" }) };
      throw new Error(`unexpected path ${path}`);
    };
    const out = await createSubscription({
      slug: "acme", email: "a@acme.test", company: "Acme Co",
      amount: 3000, currency: "USD", interval: "month",
    }, { fetchImpl });

    assert.deepEqual(out, { customer_id: "cus_1", price_id: "price_1", subscription_id: "sub_1" });
    const priceCall = calls.find((c) => c.path === "prices");
    assert.match(priceCall.body, /unit_amount=300000/);
    assert.match(priceCall.body, /recurring%5Binterval%5D=month/);
    const subCall = calls.find((c) => c.path === "subscriptions");
    // send_invoice, not a silent card charge — matches how one-offs are collected.
    assert.match(subCall.body, /collection_method=send_invoice/);
    assert.match(subCall.body, /metadata%5Bsmos_slug%5D=acme/);
    // Every mutating call is keyed.
    for (const c of calls.filter((x) => !x.path.startsWith("customers/search"))) {
      assert.ok(c.key, `${c.path} must carry an Idempotency-Key`);
    }
    delete process.env.STRIPE_API_KEY;
  });

  test("an existing customer is reused rather than forked", async () => {
    process.env.STRIPE_API_KEY = "sk_test_dummy";
    const calls = [];
    const fetchImpl = async (url, init) => {
      const path = url.replace("https://api.stripe.com/v1/", "");
      calls.push(path);
      if (path.startsWith("customers/search")) return { ok: true, json: async () => ({ data: [{ id: "cus_existing" }] }) };
      if (path === "prices") return { ok: true, json: async () => ({ id: "price_1" }) };
      if (path === "subscriptions") return { ok: true, json: async () => ({ id: "sub_1" }) };
      throw new Error(`unexpected ${path}`);
    };
    const out = await createSubscription({
      slug: "acme", email: "a@acme.test", company: "Acme Co",
      amount: 3000, currency: "USD", interval: "month",
    }, { fetchImpl });
    assert.equal(out.customer_id, "cus_existing");
    assert.ok(!calls.includes("customers"), "must not create a second customer for the same slug");
    delete process.env.STRIPE_API_KEY;
  });
});

describe("SMOS_DATA_ROOT isolates the CRM pipeline", () => {
  // Found the hard way while building D1: `SMOS_DATA_ROOT=... billing.js subscribe`
  // appended an activity to the REAL crm/pipeline.json, because crm-store.js and
  // crm.js each resolved the path against the repo root. Both now go through
  // paths.js, so a scratch/test run can never write to the live pipeline.
  test("crmPipeline() lives under the data root, not the repo root", async () => {
    const { crmPipeline } = await import("../scripts/lib/paths.js");
    const p = crmPipeline();
    assert.ok(
      p.startsWith(resolve(ROOT, "test", ".tmp")),
      `pipeline path must be under SMOS_DATA_ROOT, got ${p}`,
    );
    assert.notEqual(p, resolve(ROOT, "crm", "pipeline.json"));
  });
});

describe("billing-cron planClient — what gets billed, and what must not", () => {
  const period = "2026-10";

  test("an active manual subscription with no invoice yet is due", () => {
    const p = planClient({ slug: "acme", sub: base, invoices: [], period });
    assert.equal(p.action, "issue");
    assert.equal(p.amount, 3000);
  });

  test("an already-issued period is skipped, not reissued", () => {
    const p = planClient({ slug: "acme", sub: base, invoices: [{ period }], period });
    assert.equal(p.action, "skipped");
  });

  test("a Stripe-collected subscription is never billed locally", () => {
    const p = planClient({
      slug: "acme", invoices: [], period,
      sub: { ...base, collection_mode: "stripe_subscription", stripe: { subscription_id: "sub_1" } },
    });
    assert.equal(p.action, "stripe_managed", "issuing locally too would double-bill the client");
  });

  test("paused and canceled subscriptions are inactive", () => {
    assert.equal(planClient({ slug: "a", sub: { ...base, status: "paused" }, invoices: [], period }).action, "inactive");
    assert.equal(planClient({ slug: "a", sub: { ...base, status: "canceled" }, invoices: [], period }).action, "inactive");
  });

  test("a past_due subscription still bills the new period", () => {
    // Non-payment of a prior month is a collections problem, not a reason to stop
    // invoicing for work being delivered now.
    const p = planClient({ slug: "a", sub: { ...base, status: "past_due" }, invoices: [], period });
    assert.equal(p.action, "issue");
  });

  test("a period before the start is not due", () => {
    const p = planClient({ slug: "a", sub: { ...base, start_period: "2026-11" }, invoices: [], period });
    assert.equal(p.action, "not_due");
  });

  test("a term that has ended is not due", () => {
    const p = planClient({ slug: "a", sub: { ...base, end_period: "2026-09" }, invoices: [], period });
    assert.equal(p.action, "not_due");
  });

  test("no subscription record says so instead of guessing an amount", () => {
    const p = planClient({ slug: "a", sub: null, invoices: [], period });
    assert.equal(p.action, "no_subscription");
    assert.match(p.reason, /subscribe/);
  });

  test("currentPeriod is YYYY-MM", () => {
    assert.match(currentPeriod(new Date("2026-10-15T12:00:00Z")), /^2026-10$/);
  });
});
