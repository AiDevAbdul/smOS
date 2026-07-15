import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditNaming, auditFatigue, auditBudgetAllocation, auditZombies, computeScore,
} from "../skills/auditor/auditor.js";

test("auditNaming flags entities that violate the naming-check convention", () => {
  const campaigns = [{ id: "c1", name: "CONV_LAL1PCT_202606" }, { id: "c2", name: "bad name" }];
  const adsets = [{ id: "as1", name: "FEED_2545_FITNESS" }, { id: "as2", name: "nope" }];
  const ads = [{ id: "ad1", name: "IMG_PAIN_v1" }, { id: "ad2", name: "nope_v" }];
  const violations = auditNaming(campaigns, adsets, ads);
  assert.equal(violations.length, 3);
  assert.ok(violations.some((v) => v.id === "c2"));
  assert.ok(violations.some((v) => v.id === "as2"));
  assert.ok(violations.some((v) => v.id === "ad2"));
});

test("auditFatigue requires >= 14 days active before flagging", () => {
  const ads = [{ id: "a1", name: "x" }];
  const insightsByAd = new Map([["a1", { ctr_7d: 0.1, ctr_30d: 1.0, frequency_7d: 1, days_active: 5 }]]);
  assert.deepEqual(auditFatigue(ads, insightsByAd), []);
});

test("auditFatigue flags CTR decay >= 14 days (ctr_7d < 0.6 * ctr_30d)", () => {
  const ads = [{ id: "a1", name: "decaying" }];
  const insightsByAd = new Map([["a1", { ctr_7d: 0.4, ctr_30d: 1.0, frequency_7d: 1, days_active: 20 }]]);
  const flagged = auditFatigue(ads, insightsByAd);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].id, "a1");
});

test("auditFatigue flags high frequency independent of CTR", () => {
  const ads = [{ id: "a1", name: "over-frequent" }];
  const insightsByAd = new Map([["a1", { ctr_7d: 1.0, ctr_30d: 1.0, frequency_7d: 5.5, days_active: 20 }]]);
  assert.equal(auditFatigue(ads, insightsByAd).length, 1);
});

test("auditFatigue skips ads with no insight data (never fabricates)", () => {
  assert.deepEqual(auditFatigue([{ id: "a1", name: "no-data" }], new Map()), []);
});

test("auditBudgetAllocation needs >= 4 spending adsets to compute quartiles", () => {
  const small = [{ id: "1", spend_30d: 100, roas: 0.5 }, { id: "2", spend_30d: 100, roas: 3 }];
  assert.deepEqual(auditBudgetAllocation(small), []);
});

test("auditBudgetAllocation flags bottom-quartile ROAS adsets holding > 10% of spend", () => {
  const adsets = [
    { id: "1", name: "worst", spend_30d: 5000, roas: 0.2 },
    { id: "2", name: "ok1", spend_30d: 1000, roas: 2.0 },
    { id: "3", name: "ok2", spend_30d: 1000, roas: 2.5 },
    { id: "4", name: "best", spend_30d: 1000, roas: 4.0 },
  ];
  const flagged = auditBudgetAllocation(adsets);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].id, "1");
});

test("auditZombies flags active campaigns with zero impressions in the last 7 days", () => {
  const campaigns = [
    { id: "c1", name: "alive", status: "ACTIVE" },
    { id: "c2", name: "zombie", status: "ACTIVE" },
    { id: "c3", name: "paused", status: "PAUSED" },
  ];
  const insightsByCampaign = new Map([
    ["c1", { impressions_7d: 500 }],
    ["c2", { impressions_7d: 0 }],
  ]);
  const zombies = auditZombies(campaigns, insightsByCampaign);
  assert.equal(zombies.length, 1);
  assert.equal(zombies[0].id, "c2");
});

test("computeScore starts at 100 and subtracts per-category, floored at 0", () => {
  assert.equal(computeScore({ naming: [], overlap: [], fatigue: [], pixel: {}, budget: [], zombies: [] }), 100);
  const score = computeScore({
    naming: [1], overlap: [1, 2], fatigue: [1, 2, 3],
    pixel: { missing_events: ["Lead"] }, budget: [1], zombies: [1, 2],
  });
  // 100 - 5 - 20 - 9 - 15 - 8 - 20 = 23
  assert.equal(score, 23);
});

test("computeScore floors at 0 rather than going negative", () => {
  const score = computeScore({
    naming: new Array(30).fill(0), overlap: [], fatigue: [], pixel: {}, budget: [], zombies: [],
  });
  assert.equal(score, 0);
});
