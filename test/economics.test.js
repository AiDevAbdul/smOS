import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEconomics } from "../scripts/lib/economics.js";
import { normalizeUnitEconomics } from "../schemas/client_profile.js";
import { economicsSection } from "../skills/analyze/analyze.js";

// B2 — account-level economics math.

test("blended MER = revenue / spend", () => {
  const e = computeEconomics({ spend: 1000, conversion_value: 3000, conversions: 30 }, {});
  assert.equal(e.blended_mer, 3); // 3000/1000
});

test("breakeven & target ROAS derive from gross margin (fraction or percent)", () => {
  const eFrac = computeEconomics({ spend: 100, conversion_value: 250 }, normalizeUnitEconomics({ gross_margin: 0.5 }));
  assert.equal(eFrac.breakeven_roas, 2); // 1/0.5
  assert.equal(eFrac.target_roas, 2); // no target_mer -> breakeven
  const ePct = computeEconomics({ spend: 100, conversion_value: 250 }, normalizeUnitEconomics({ gross_margin: 40 }));
  assert.equal(ePct.gross_margin, 0.4);
  assert.equal(ePct.breakeven_roas, 2.5); // 1/0.4
});

test("explicit target_mer overrides breakeven for target ROAS", () => {
  const e = computeEconomics({ spend: 100, conversion_value: 400 }, normalizeUnitEconomics({ gross_margin: 0.5, target_mer: 3 }));
  assert.equal(e.breakeven_roas, 2);
  assert.equal(e.target_roas, 3);
  assert.equal(e.mer_verdict, "above_target"); // MER 4 >= 3
});

test("gross profit and profit-after-ads (POAS)", () => {
  const e = computeEconomics({ spend: 1000, conversion_value: 5000 }, normalizeUnitEconomics({ gross_margin: 0.6 }));
  assert.equal(e.gross_profit, 3000); // 5000*0.6
  assert.equal(e.profit_after_ads, 2000); // 3000-1000
});

test("nCAC prefers true new customers, flags fallback to all conversions", () => {
  const withNew = computeEconomics({ spend: 1000, conversions: 50, new_customers: 20 }, {});
  assert.equal(withNew.nCAC, 50); // 1000/20
  assert.equal(withNew.cac_basis, "new_customers");
  const fallback = computeEconomics({ spend: 1000, conversions: 50 }, {});
  assert.equal(fallback.nCAC, 20); // 1000/50
  assert.equal(fallback.cac_basis, "all_conversions");
});

test("cac_verdict compares against target_cac", () => {
  const healthy = computeEconomics({ spend: 500, new_customers: 25 }, normalizeUnitEconomics({ target_cac: 30 }));
  assert.equal(healthy.nCAC, 20);
  assert.equal(healthy.cac_verdict, "healthy");
  const over = computeEconomics({ spend: 500, new_customers: 10 }, normalizeUnitEconomics({ target_cac: 30 }));
  assert.equal(over.nCAC, 50);
  assert.equal(over.cac_verdict, "over_target");
});

test("missing inputs degrade to null, never NaN or fabricated", () => {
  const e = computeEconomics({}, {});
  assert.equal(e.blended_mer, null);
  assert.equal(e.breakeven_roas, null);
  assert.equal(e.nCAC, null);
  assert.equal(e.profit_after_ads, null);
  assert.equal(e.mer_verdict, null);
});

test("economicsSection renders nothing when there is no usable economics", () => {
  assert.deepEqual(economicsSection(computeEconomics({}, {}), "USD"), []);
});

test("economicsSection renders a table when MER is computable", () => {
  const e = computeEconomics({ spend: 1000, conversion_value: 3000 }, normalizeUnitEconomics({ gross_margin: 0.5 }));
  const rows = economicsSection(e, "USD");
  assert.ok(rows.length > 0);
  const md = rows.join("\n");
  assert.match(md, /Account economics/);
  assert.match(md, /Blended MER \| 3×/);
  assert.match(md, /Breakeven ROAS \| 2×/);
});
