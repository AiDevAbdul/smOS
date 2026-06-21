import { test } from "node:test";
import assert from "node:assert/strict";
import { pickPackage, buildProposalMarkdown } from "../skills/proposal/proposal.js";

const catalog = {
  agency: { name: "Test Agency", email: "a@test.co", tagline: "T" },
  packages: [
    { id: "starter", name: "Starter", monthly_retainer: 1500, setup_fee: 500, currency: "USD", best_for: "new", includes: ["A"] },
    { id: "growth", name: "Growth", monthly_retainer: 3000, setup_fee: 750, currency: "USD", best_for: "scaling", includes: ["B", "C"] },
    { id: "scale", name: "Scale", monthly_retainer: 6000, setup_fee: 1000, currency: "USD", best_for: "volume", includes: ["D"] },
  ],
  terms: { contract_length_months: 3, ad_spend: "separate", payment: "net7", cancellation: "30d" },
};

test("pickPackage honors an explicit package id", () => {
  assert.equal(pickPackage(catalog, { packageId: "scale" }).id, "scale");
});

test("pickPackage throws on an unknown package id", () => {
  assert.throws(() => pickPackage(catalog, { packageId: "enterprise" }), /No package/);
});

test("pickPackage infers the tier closest to the deal retainer", () => {
  assert.equal(pickPackage(catalog, { retainer: 2700 }).id, "growth"); // closest to 3000
  assert.equal(pickPackage(catalog, { retainer: 1400 }).id, "starter");
  assert.equal(pickPackage(catalog, { retainer: 5500 }).id, "scale");
});

test("pickPackage defaults to growth when nothing specified", () => {
  assert.equal(pickPackage(catalog, {}).id, "growth");
});

test("buildProposalMarkdown uses the per-deal retainer over the catalog price", () => {
  const md = buildProposalMarkdown({
    slug: "acme", company: "Acme Co", catalog, pkg: catalog.packages[1], retainer: 3500, findings: null,
  });
  assert.match(md, /Proposal — Acme Co/);
  assert.match(md, /USD 3,500\/month/); // overridden price, not 3,000
  assert.match(md, /Recommended package — Growth/);
});

test("buildProposalMarkdown renders pre-audit findings when present", () => {
  const md = buildProposalMarkdown({
    slug: "acme", company: "Acme Co", catalog, pkg: catalog.packages[0], retainer: 0,
    findings: { wins: ["Strong organic"], gaps: ["No retargeting"] },
  });
  assert.match(md, /Strong organic/);
  assert.match(md, /No retargeting/);
  assert.match(md, /USD 1,500\/month/); // falls back to catalog price when retainer 0
});
