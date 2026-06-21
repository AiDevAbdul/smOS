import { test } from "node:test";
import assert from "node:assert/strict";
import { invoice } from "../schemas/index.js";
import { buildInvoice } from "../skills/billing/billing.js";

const deal = {
  slug: "acme", company_name: "Acme Co",
  contact: { email: "cfo@acme.co" },
  deal: { monthly_retainer: 3000, currency: "USD" },
};
const pkg = { id: "growth", name: "Growth", monthly_retainer: 3000, setup_fee: 750, currency: "USD" };

test("first invoice includes the one-time setup fee", () => {
  const inv = buildInvoice({ slug: "acme", deal, pkg, period: "2026-06", includeSetup: true, issuedAt: "2026-06-01T00:00:00Z" });
  assert.equal(inv.id, "INV-acme-2026-06");
  assert.equal(inv.line_items.length, 2);
  assert.equal(inv.total, 3750);
  assert.match(inv.line_items[1].description, /setup/i);
});

test("subsequent invoice has retainer only (no setup)", () => {
  const inv = buildInvoice({ slug: "acme", deal, pkg, period: "2026-07", includeSetup: false, issuedAt: "2026-07-01T00:00:00Z" });
  assert.equal(inv.line_items.length, 1);
  assert.equal(inv.total, 3000);
});

test("ad-spend pass-through adds a line", () => {
  const inv = buildInvoice({ slug: "acme", deal, pkg, period: "2026-07", includeSetup: false, adSpend: 500, issuedAt: "2026-07-01T00:00:00Z" });
  assert.equal(inv.line_items.length, 2);
  assert.equal(inv.total, 3500);
});

test("due date is 7 days after issue", () => {
  const inv = buildInvoice({ slug: "acme", deal, pkg, period: "2026-07", includeSetup: false, issuedAt: "2026-07-01T00:00:00Z" });
  assert.equal(inv.due_date.slice(0, 10), "2026-07-08");
});

// ---------- schema validation ----------
test("invoice validate enforces YYYY-MM period and totals integrity", () => {
  const good = buildInvoice({ slug: "acme", deal, pkg, period: "2026-06", includeSetup: true, issuedAt: "2026-06-01T00:00:00Z" });
  assert.equal(invoice.validate(good).ok, true);

  const badPeriod = { ...good, period: "June" };
  assert.equal(invoice.validate(badPeriod).ok, false);

  const driftedTotal = { ...good, total: 9999 };
  const v = invoice.validate(driftedTotal);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /total/.test(e)));
});
