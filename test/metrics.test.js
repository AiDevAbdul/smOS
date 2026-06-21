import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveMetrics, normalizeKpis, findAction, DEFAULT_KPIS } from "../scripts/lib/metrics.js";

const ROW = {
  spend: "100", impressions: "10000", clicks: "200", inline_link_clicks: "150",
  reach: "8000", frequency: "1.25", ctr: "2.0", inline_link_click_ctr: "1.5",
  cpc: "0.5", cpm: "10",
  actions: [{ action_type: "purchase", value: "10" }],
  action_values: [{ action_type: "purchase", value: "500" }],
  purchase_roas: [{ value: "5.0" }],
};

test("deriveMetrics: ROAS prefers purchase_roas", () => {
  assert.equal(deriveMetrics(ROW).roas, 5.0);
});
test("deriveMetrics: ROAS falls back to value/spend when purchase_roas absent", () => {
  const { purchase_roas, ...noRoas } = ROW;
  assert.equal(deriveMetrics(noRoas).roas, 5.0); // 500/100
});
test("deriveMetrics: CPA = spend/conversions", () => {
  assert.equal(deriveMetrics(ROW).cpa, 10); // 100/10
});
test("deriveMetrics: CTR is percent, taken from Meta's field", () => {
  assert.equal(deriveMetrics(ROW).ctr, 2.0);
  assert.equal(deriveMetrics(ROW).link_ctr, 1.5);
});
test("deriveMetrics: CTR derived as percent when Meta omits it", () => {
  const { ctr, inline_link_click_ctr, ...noCtr } = ROW;
  const m = deriveMetrics(noCtr);
  assert.equal(m.ctr, 2.0);       // 200/10000*100
  assert.equal(m.link_ctr, 1.5);  // 150/10000*100
});
test("deriveMetrics: zero impressions never divides by zero", () => {
  const m = deriveMetrics({ spend: "5", impressions: "0", clicks: "0" });
  assert.equal(m.ctr, 0);
  assert.equal(m.cpa, null);
  assert.equal(m.roas, null);
});

test("findAction: returns first matching action_type value", () => {
  assert.equal(findAction([{ action_type: "lead", value: "3" }], ["purchase", "lead"]), 3);
  assert.equal(findAction(null, ["purchase"]), 0);
});

test("normalizeKpis: reads FLAT targets (analyze-style)", () => {
  const k = normalizeKpis({ kpis: { cpa_target: 35, roas_target: 1.5 } });
  assert.equal(k.cpa_target, 35);
  assert.equal(k.roas_target, 1.5);
});
test("normalizeKpis: reads NESTED targets (report-style kpis.leads.*)", () => {
  const k = normalizeKpis({ kpis: { leads: { target_cpa: 35, target_roas: 1.5, target_ctr_link: 1.2 } } });
  assert.equal(k.cpa_target, 35);
  assert.equal(k.roas_target, 1.5);
  assert.equal(k.ctr_target, 1.2);
});
test("normalizeKpis: falls back to defaults when nothing set", () => {
  const k = normalizeKpis({});
  assert.equal(k.cpa_target, DEFAULT_KPIS.cpa_target);
  assert.equal(k.roas_target, DEFAULT_KPIS.roas_target);
});
test("normalizeKpis: CTR floor is in PERCENT (0.5), not the old 0.005 fraction", () => {
  assert.equal(normalizeKpis({}).pause_ctr_floor, 0.5);
});
test("normalizeKpis: preserves extra flat overrides like min-spend gates", () => {
  const k = normalizeKpis({ kpis: { pause_cpa_min_spend: 75 } });
  assert.equal(k.pause_cpa_min_spend, 75);
});
