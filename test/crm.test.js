import { test } from "node:test";
import assert from "node:assert/strict";
import { deal } from "../schemas/index.js";

// ---------- normalize ----------
test("deal normalize coerces aliases + defaults probability from stage", () => {
  const d = deal.normalize({ slug: "acme", name: "Acme Co", stage: "proposed", monthly_retainer: 1500 });
  assert.equal(d.company_name, "Acme Co");
  assert.equal(d.id, "acme");
  assert.equal(d.deal.monthly_retainer, 1500);
  assert.equal(d.deal.currency, "USD");
  assert.equal(d.probability, 55); // STAGE_PROBABILITY.proposed
});

test("deal normalize folds flat contact_* fields into contact{}", () => {
  const d = deal.normalize({ slug: "x", company_name: "X", contact_email: "a@x.co", contact_name: "Ann" });
  assert.equal(d.contact.email, "a@x.co");
  assert.equal(d.contact.name, "Ann");
});

// ---------- validate (fail-closed) ----------
test("deal validate requires slug + company_name + valid stage", () => {
  const v = deal.validate({ stage: "bogus" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("slug")));
  assert.ok(v.errors.some((e) => e.includes("company_name")));
  assert.ok(v.errors.some((e) => e.includes("stage")));
});

test("deal validate gates won on a proposal link", () => {
  const base = { slug: "acme", company_name: "Acme", stage: "won" };
  assert.equal(deal.validate(base).ok, false, "won without proposal should fail");
  const withProposal = { ...base, links: { proposal: "clients/acme/proposal.pdf" } };
  assert.equal(deal.validate(withProposal).ok, true, "won with proposal should pass");
});

// ---------- state machine ----------
test("pipeline transitions enforce real sales flow", () => {
  assert.equal(deal.isValidTransition("lead", "contacted"), true);
  assert.equal(deal.isValidTransition("proposed", "won"), true);
  assert.equal(deal.isValidTransition("lead", "won"), false);      // can't skip the funnel
  assert.equal(deal.isValidTransition("negotiating", "audited"), false); // no going backward
  assert.equal(deal.isValidTransition("lost", "contacted"), true);  // re-engage
  assert.equal(deal.isValidTransition("won", "won"), true);         // idempotent
});

// ---------- forecast ----------
test("weightedValue reflects stage + probability; won = full annual, lost = 0", () => {
  assert.equal(deal.weightedValue({ slug: "a", company_name: "A", stage: "proposed", monthly_retainer: 1000 }), Math.round(12000 * 0.55));
  assert.equal(deal.weightedValue({ slug: "b", company_name: "B", stage: "won", monthly_retainer: 1000, links: { proposal: "x" } }), 12000);
  assert.equal(deal.weightedValue({ slug: "c", company_name: "C", stage: "lost", monthly_retainer: 1000 }), 0);
});
