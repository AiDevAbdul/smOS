import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContractMarkdown, sendForSignature } from "../skills/contract/contract.js";

const agency = { name: "Ducker Creative", email: "abdul@duckercreative.com" };
const terms = { contract_length_months: 3, ad_spend: "billed separately", payment: "Net 7", cancellation: "30 days notice" };
const pkg = { id: "growth", name: "Growth", monthly_retainer: 3000, setup_fee: 750, currency: "USD", includes: ["Meta ads", "Retargeting"] };

test("contract markdown names both parties and the package scope", () => {
  const md = buildContractMarkdown({
    agency, client: { company: "Acme Co", contact_name: "Ann Lee", contact_email: "ann@acme.co" },
    pkg, retainer: 0, terms, date: "2026-06-22",
  });
  assert.match(md, /Ducker Creative/);
  assert.match(md, /Acme Co/);
  assert.match(md, /Ann Lee/);
  assert.match(md, /\*\*Growth\*\* package/);
  assert.match(md, /Meta ads/);
});

test("contract fees use per-deal retainer when set, else catalog price", () => {
  const overridden = buildContractMarkdown({ agency, client: { company: "X" }, pkg, retainer: 4200, terms, date: "2026-06-22" });
  assert.match(overridden, /USD 4,200, due monthly/);
  const fallback = buildContractMarkdown({ agency, client: { company: "X" }, pkg, retainer: 0, terms, date: "2026-06-22" });
  assert.match(fallback, /USD 3,000, due monthly/);
  assert.match(fallback, /USD 750, due on signing/); // setup fee
});

test("contract states the attorney-review disclaimer and term length", () => {
  const md = buildContractMarkdown({ agency, client: { company: "X" }, pkg, retainer: 0, terms, date: "2026-06-22" });
  assert.match(md, /not legal advice/i);
  assert.match(md, /3 months/);
});

test("sendForSignature falls back to manual without a provider key", async () => {
  const prev = process.env.DROPBOX_SIGN_API_KEY;
  delete process.env.DROPBOX_SIGN_API_KEY;
  const r = await sendForSignature({ pdfPath: "/nope.pdf", client: { company: "X", contact_email: "x@y.co" }, agency });
  assert.equal(r.sent, false);
  assert.equal(r.mode, "manual");
  if (prev) process.env.DROPBOX_SIGN_API_KEY = prev;
});
