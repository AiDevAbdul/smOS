// Regression tests for the 2026-06-30 remediation pass:
//  - multi-client token isolation (global fallback is flagged, per-client wins)
//  - guards fail-closed on missing name / non-finite budget
//  - /creative-test plan + evaluate (significance-gated, fail-closed)

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveToken } from "../scripts/lib/tokens.js";
import { checkNaming, checkBudget } from "../scripts/lib/guards.js";
import { buildTestPlan, evaluateResults } from "../skills/creative-test/creative-test.js";

test("tokens: per-client env wins over global, global fallback is flagged", () => {
  const KEY = "META_PAGE_TOKEN_ACME_TEST";
  delete process.env[KEY];
  process.env.META_PAGE_TOKEN = "GLOBAL";
  const g = resolveToken("page", "acme-test", {});
  assert.equal(g.token, "GLOBAL");
  assert.equal(g.global_fallback, true);

  process.env[KEY] = "PERCLIENT";
  const c = resolveToken("page", "acme-test", {});
  assert.equal(c.token, "PERCLIENT");
  assert.ok(!c.global_fallback);
  delete process.env[KEY];
  delete process.env.META_PAGE_TOKEN;
});

test("tokens: require:true throws when nothing resolves", () => {
  delete process.env.META_PAGE_TOKEN;
  assert.throws(() => resolveToken("page", "nobody", { require: true }));
});

test("guards: create_campaign with no name is BLOCKED (fail-closed)", () => {
  assert.equal(checkNaming("create_campaign", {}).ok, false);
  assert.equal(checkNaming("create_campaign", { name: "CONV_LAL1PCT_202506" }).ok, true);
});

test("guards: non-finite daily_budget is BLOCKED; absent budget passes (CBO)", () => {
  assert.equal(checkBudget("create_campaign", { daily_budget: "abc" }).ok, false);
  assert.equal(checkBudget("create_adset", {}).ok, true); // CBO ad set carries no budget
});

test("creative-test: buildTestPlan makes one cell per angle with a control", () => {
  const brief = {
    creative_angles: [
      { angle_id: "a1", name: "Pain", format: "single_video", hook_code: "PAIN" },
      { angle_id: "a2", name: "Proof", format: "carousel", hook_code: "PROOF" },
    ],
  };
  const plan = buildTestPlan({ brief, adCopy: null, metric: "ctr" });
  assert.equal(plan.cells.length, 2);
  assert.equal(plan.cells.filter((c) => c.is_control).length, 1);
  assert.ok(plan.design.control_cell);
});

test("creative-test: evaluate is fail-closed on thin data, declares a real winner on strong data", () => {
  const plan = buildTestPlan({
    brief: { creative_angles: [
      { angle_id: "a1", name: "Control", format: "single_image", hook_code: "CTRL" },
      { angle_id: "a2", name: "Challenger", format: "single_image", hook_code: "CHAL" },
    ] },
    adCopy: null,
  });
  const ctrlId = plan.design.control_cell;
  const chalId = plan.cells.find((c) => !c.is_control).cell_id;

  // Thin: only a handful of results → no significant winner.
  const thin = evaluateResults({ plan, results: { cells: [
    { cell_id: ctrlId, impressions: 200, results: 4 },
    { cell_id: chalId, impressions: 200, results: 8 },
  ] } });
  assert.equal(thin.decision.verdict, "NO_SIGNIFICANT_WINNER");

  // Strong: large sample + big, significant lift past the conversion gate → winner.
  const strong = evaluateResults({ plan, results: { cells: [
    { cell_id: ctrlId, impressions: 50000, results: 500 },
    { cell_id: chalId, impressions: 50000, results: 1500 },
  ] } });
  assert.equal(strong.decision.verdict, "WINNER");
  assert.equal(strong.decision.cell_id, chalId);
});
