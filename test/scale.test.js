import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inBusinessHours, metricsArePlausible, decisionFromFlag, reverseDecision, buildParentMap,
} from "../skills/scale/scale.js";

test("business hours: unknown tz fails CLOSED in autonomous mode", () => {
  assert.equal(inBusinessHours(null, true), false);
});
test("business hours: unknown tz is lenient with operator override", () => {
  assert.equal(inBusinessHours(null, false), true);
});
test("business hours: bad tz string fails closed in autonomous mode", () => {
  assert.equal(inBusinessHours("Not/AZone", true), false);
});

test("sanity: zero-spend metrics are implausible", () => {
  assert.equal(metricsArePlausible({ spend: 0, impressions: 1000 }), false);
});
test("sanity: null metrics are implausible", () => {
  assert.equal(metricsArePlausible({ spend: null }), false);
});
test("sanity: tiny sample is implausible", () => {
  assert.equal(metricsArePlausible({ spend: 5, impressions: 10 }), false);
});
test("sanity: plausible metrics pass", () => {
  assert.equal(metricsArePlausible({ spend: 50, impressions: 5000 }), true);
});
test("sanity: entity absent from rollup is trusted (can't second-guess analyzer)", () => {
  assert.equal(metricsArePlausible(undefined), true);
});

test("decision: pause on garbage (zero-spend) metrics downgrades to flag, not auto-pause", () => {
  const analysis = { by_ad: [{ id: "ad1", spend: 0, impressions: 0 }], by_adset: [], by_campaign: [] };
  const pm = buildParentMap(analysis);
  const d = decisionFromFlag({ flag: "PAUSE_CANDIDATE_CPA", entity_id: "ad1" }, pm);
  assert.equal(d.action, "flag");
  assert.equal(d.auto, false);
});
test("decision: pause on plausible metrics auto-executes", () => {
  const analysis = { by_ad: [{ id: "ad1", spend: 80, impressions: 9000 }], by_adset: [], by_campaign: [] };
  const pm = buildParentMap(analysis);
  const d = decisionFromFlag({ flag: "PAUSE_CANDIDATE_CPA", entity_id: "ad1" }, pm);
  assert.equal(d.action, "pause");
  assert.equal(d.auto, true);
});

test("rollback: paused entity reverses to ACTIVE", () => {
  const r = reverseDecision({ status: "applied", action: "pause", entity_id: "ad1" });
  assert.deepEqual(r.body, { status: "ACTIVE" });
});
test("rollback: scaled entity restores prior budget", () => {
  const r = reverseDecision({ status: "applied", action: "scale", entity_id: "as1", budget_before_cents: 5000 });
  assert.deepEqual(r.body, { daily_budget: "5000" });
});
test("rollback: dry_run / non-applied decisions are skipped", () => {
  assert.equal(reverseDecision({ status: "dry_run", action: "pause", entity_id: "ad1" }), null);
});
