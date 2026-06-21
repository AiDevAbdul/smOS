import { test } from "node:test";
import assert from "node:assert/strict";
import { wilsonLowerBound, twoProportionZ, enoughConversions, scaleSignificance } from "../scripts/lib/stats.js";
import { opportunityScore } from "../scripts/lib/opportunity.js";
import { decisionFromFlag, buildParentMap } from "../skills/scale/scale.js";

// ---- stats ----

test("twoProportionZ: a big CTR gap on large samples is significant", () => {
  // 2% vs 1% on 50k impressions each
  const r = twoProportionZ(1000, 50000, 500, 50000);
  assert.ok(r.significant);
});

test("twoProportionZ: same gap on tiny samples is NOT significant (noise)", () => {
  // 2/100 vs 1/100 — looks like a 2× CTR drop but n is tiny
  const r = twoProportionZ(2, 100, 1, 100);
  assert.equal(r.significant, false);
});

test("twoProportionZ: zero sample → not significant, no NaN", () => {
  assert.deepEqual(twoProportionZ(0, 0, 0, 0), { z: 0, significant: false });
});

test("wilsonLowerBound: lower bound is below the point estimate and ≥ 0", () => {
  const lb = wilsonLowerBound(10, 100);
  assert.ok(lb > 0 && lb < 0.1);
});

test("enoughConversions / scaleSignificance gate", () => {
  assert.equal(enoughConversions(20, 15), true);
  assert.equal(enoughConversions(5, 15), false);
  assert.equal(scaleSignificance(20, 15).significant, true);
  assert.equal(scaleSignificance(3, 15).significant, false);
});

// ---- opportunity score ----

test("opportunityScore: blends scale/reclaim/refresh weighted by spend share", () => {
  const adsets = [
    { id: "as1", metrics: { last_7d: { spend: 600, roas: 4 } } },
    { id: "as2", metrics: { last_7d: { spend: 400, roas: 0.5 } } },
  ];
  const ads = [
    { id: "ad1", metrics: { last_7d: { spend: 400 } } }, // bleeding
    { id: "ad2", metrics: { last_7d: { spend: 200 } } }, // fatigued
  ];
  const flags = [
    { entity_id: "as1", flag: "SCALE_CANDIDATE" },
    { entity_id: "ad1", flag: "PAUSE_CANDIDATE_ROAS" },
    { entity_id: "ad2", flag: "CREATIVE_FATIGUE" },
  ];
  const o = opportunityScore({ adsets, ads, flags, kpis: {} });
  // total adset spend = 1000; scalable 600 (0.6), reclaimable 400 (0.4), fatigued 200 (0.2)
  assert.equal(o.scalable_spend_7d, 600);
  assert.equal(o.reclaimable_spend_7d, 400);
  assert.equal(o.fatigued_spend_7d, 200);
  // score = 45*0.6 + 35*0.4 + 20*0.2 = 27 + 14 + 4 = 45
  assert.equal(o.score, 45);
  assert.ok(o.recommendations.length >= 3);
});

test("opportunityScore: empty account scores 0, not NaN", () => {
  const o = opportunityScore({ adsets: [], ads: [], flags: [], kpis: {} });
  assert.equal(o.score, 0);
  assert.ok(Number.isFinite(o.score));
  assert.match(o.recommendations[0], /No major structural opportunity/);
});

// ---- scale.js decisions for the new flags ----

const emptyMap = buildParentMap({});

test("decisionFromFlag: SCALE_WATCH is human-review (never auto)", () => {
  const d = decisionFromFlag({ flag: "SCALE_WATCH", entity_id: "as1", significance: { note: "3 < 15" } }, emptyMap);
  assert.equal(d.action, "flag");
  assert.equal(d.auto, false);
});

test("decisionFromFlag: ANOMALY_spend_spike surfaces as an auto (loud) flag", () => {
  const d = decisionFromFlag({ flag: "ANOMALY_spend_spike", entity_id: "as1", entity_type: "adset" }, emptyMap);
  assert.equal(d.action, "flag");
  assert.equal(d.auto, true);
});

test("decisionFromFlag: insignificant SCALE_CANDIDATE is refused (defense-in-depth)", () => {
  const map = buildParentMap({ by_adset: [{ id: "as1", spend: 200, impressions: 5000, daily_budget: 50 }] });
  const d = decisionFromFlag({ flag: "SCALE_CANDIDATE", entity_id: "as1", significance: { significant: false, note: "thin" } }, map);
  assert.equal(d.action, "flag");
  assert.equal(d.auto, false);
  assert.match(d.reason, /not significant/);
});

test("decisionFromFlag: a significant SCALE_CANDIDATE with budget auto-scales", () => {
  const map = buildParentMap({ by_adset: [{ id: "as1", spend: 200, impressions: 5000, daily_budget: 50 }] });
  const d = decisionFromFlag({ flag: "SCALE_CANDIDATE", entity_id: "as1", significance: { significant: true, note: "ok" } }, map);
  assert.equal(d.action, "scale");
  assert.equal(d.auto, true);
  assert.equal(d.budget_after_cents, 6000); // 5000 * 1.2
});
