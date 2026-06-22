import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inBusinessHours, metricsArePlausible, decisionFromFlag, reverseDecision, buildParentMap,
  isActionable, duplicateName, cloneAdset,
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

// ---- DUPLICATE_CANDIDATE ----

test("duplicate: qualifying adset yields a duplicate action at 0.5× budget, auto-eligible", () => {
  const analysis = { by_ad: [], by_adset: [{ id: "as1", spend: 200, impressions: 50000, daily_budget: 100 }], by_campaign: [] };
  const pm = buildParentMap(analysis);
  const d = decisionFromFlag({ flag: "DUPLICATE_CANDIDATE", entity_id: "as1" }, pm);
  assert.equal(d.action, "duplicate");
  assert.equal(d.entity_type, "adset");
  assert.equal(d.auto, true);
  assert.equal(d.source_id, "as1");
  assert.equal(d.budget_before_cents, 10000);
  assert.equal(d.budget_after_cents, 5000); // 0.5×
});

test("duplicate: a duplicate decision is actionable (counts toward circuit breaker)", () => {
  const analysis = { by_ad: [], by_adset: [{ id: "as1", spend: 200, impressions: 50000, daily_budget: 100 }], by_campaign: [] };
  const pm = buildParentMap(analysis);
  const d = decisionFromFlag({ flag: "DUPLICATE_CANDIDATE", entity_id: "as1" }, pm);
  assert.equal(isActionable(d), true);
});

test("duplicate: garbage (zero-spend) metrics downgrade to flag, not auto-duplicate", () => {
  const analysis = { by_ad: [], by_adset: [{ id: "as1", spend: 0, impressions: 0, daily_budget: 100 }], by_campaign: [] };
  const pm = buildParentMap(analysis);
  const d = decisionFromFlag({ flag: "DUPLICATE_CANDIDATE", entity_id: "as1" }, pm);
  assert.equal(d.action, "flag");
  assert.equal(d.auto, false);
});

test("duplicate: no daily_budget (CBO) downgrades to flag, not auto-duplicate", () => {
  const analysis = { by_ad: [], by_adset: [{ id: "as1", spend: 200, impressions: 50000, daily_budget: null }], by_campaign: [] };
  const pm = buildParentMap(analysis);
  const d = decisionFromFlag({ flag: "DUPLICATE_CANDIDATE", entity_id: "as1" }, pm);
  assert.equal(d.action, "flag");
  assert.equal(d.auto, false);
});

test("duplicate: decisionFromFlag alone never mutates Meta (dry-run = proposal only)", () => {
  // The decision is pure data — no endpoint to flip on the source, only a
  // source_id resolved into a clone at execute time. Proves dry-run proposes
  // without cloning.
  const analysis = { by_ad: [], by_adset: [{ id: "as1", spend: 200, impressions: 50000, daily_budget: 100 }], by_campaign: [] };
  const pm = buildParentMap(analysis);
  const d = decisionFromFlag({ flag: "DUPLICATE_CANDIDATE", entity_id: "as1" }, pm);
  assert.equal(d.endpoint, undefined); // nothing to POST on the source
});

test("duplicate naming: bumps trailing version token", () => {
  assert.equal(duplicateName("FEED_2545_FITNESS_v1"), "FEED_2545_FITNESS_v2");
  assert.equal(duplicateName("REELS_1834_RUNNING"), "REELS_1834_RUNNING_DUP");
});

test("cloneAdset: builds a PAUSED clone at half budget via the guarded graph, inheriting targeting", async () => {
  const posted = [];
  const fakeGraph = {
    act: (id) => `act_${String(id).replace(/^act_/, "")}`,
    get: async () => ({
      name: "FEED_2545_FITNESS_v1",
      campaign_id: "camp1",
      optimization_goal: "OFFSITE_CONVERSIONS",
      billing_event: "IMPRESSIONS",
      targeting: { geo_locations: { countries: ["US"] } },
    }),
    post: async (path, body) => { posted.push({ path, body }); return { id: "as_new" }; },
  };
  const decision = { action: "duplicate", source_id: "as1", entity_name: "FEED_2545_FITNESS_v1", budget_after_cents: 5000 };
  const res = await cloneAdset(fakeGraph, "123456", decision);
  assert.equal(res.ok, true);
  assert.equal(res.created_id, "as_new");
  assert.equal(posted.length, 1);
  assert.equal(posted[0].path, "/act_123456/adsets");
  assert.equal(posted[0].body.status, "PAUSED");
  assert.equal(posted[0].body.daily_budget, "5000");
  assert.equal(posted[0].body.campaign_id, "camp1");
  assert.equal(posted[0].body.name, "FEED_2545_FITNESS_v2");
  assert.deepEqual(posted[0].body.targeting, { geo_locations: { countries: ["US"] } });
});
