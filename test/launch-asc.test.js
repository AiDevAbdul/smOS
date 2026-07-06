import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import * as competitorSchema from "../schemas/competitor_intel.js";
import {
  makeClient, cleanup, readClientJson, runSkill, profileFixture, clientPath,
} from "./helpers/pipeline.js";

// B1 — Advantage+ Shopping (ASC) campaign path.
//   e-commerce + healthy pixel  -> strategy-brief sets campaign_type:"asc",
//   launch builds a single Meta-managed ASC campaign (smart_promotion_type +
//   existing-customer cap). Pixel unhealthy -> falls back to the manual tree.

const SLUG = "__it_asc";

function ecommerceProfile({ pixelHealthy }) {
  return profileFixture(SLUG, {
    extra: {
      name: "Shopify Store",
      business: {
        business_model: "ecommerce",
        conversion_events: ["Purchase"],
        primary_url: "https://shop.example.com",
      },
      audience: { interests: ["fitness"], age_range: [18, 65], geo_targets: ["US"] },
      location: { country: "US" },
      accounts: {
        ad_account_id: "act_1234567890",
        currency: "USD",
        facebook_page_id: "111",
        instagram_business_id: "222",
        pixel_id: pixelHealthy ? "333" : null,
        pixel_installed: pixelHealthy,
        catalog_id: "cat_999",
        website: "https://shop.example.com",
      },
    },
  });
}

function competitorIntelFixture() {
  return competitorSchema.normalize({
    client_slug: SLUG,
    generated_at: new Date().toISOString(),
    country: "US",
    competitors: [{ name: "Rival", angles: [{ angle: "Free shipping", frequency: 4 }] }],
    angles: [{ angle: "Free shipping", frequency: 4 }],
    gaps: [],
  });
}

function buildBriefAndPlan(profile) {
  makeClient(SLUG, {
    "client_profile.json": profile,
    "competitor_intel.json": competitorIntelFixture(),
  });
  const am = runSkill("skills/audience-map/audience-map.js", SLUG, "--offline");
  assert.equal(am.status, 0, `audience-map failed:\n${am.stderr}`);
  const sb = runSkill("skills/strategy-brief/strategy-brief.js", SLUG);
  assert.equal(sb.status, 0, `strategy-brief failed:\n${sb.stderr}`);
  const brief = readClientJson(SLUG, "strategy_brief.json");
  // ad_copy.json must EXIST for launch (existence gate); content is irrelevant to
  // the structural assertions here.
  writeFileSync(clientPath(SLUG, "ad_copy.json"), JSON.stringify({ slug: SLUG, angles: [] }, null, 2));
  const lr = runSkill("skills/launch/launch.js", SLUG);
  // dry-run may print "not executable" but must still write the plan (exit 0).
  assert.equal(lr.status, 0, `launch dry-run failed:\n${lr.stderr}`);
  const plan = readClientJson(SLUG, "launch_plan.json");
  return { brief, plan };
}

test("ASC: e-commerce + healthy pixel -> Advantage+ Shopping campaign", () => {
  try {
    const { brief, plan } = buildBriefAndPlan(ecommerceProfile({ pixelHealthy: true }));

    assert.equal(brief.campaign_type, "asc", "brief should default to ASC for e-comm + healthy pixel");
    assert.ok(brief.asc, "brief.asc config block missing");
    assert.equal(brief.asc.existing_customer_budget_percentage, 20, "default existing-customer cap should be 20%");

    // Single Meta-managed campaign (no per-audience fan-out).
    assert.equal(plan.campaigns.length, 1, "ASC must be ONE campaign, not per-audience");
    const camp = plan.campaigns[0].payload;
    assert.equal(camp.smart_promotion_type, "AUTOMATED_SHOPPING_ADS", "missing ASC marker");
    assert.equal(camp.objective, "OUTCOME_SALES");
    assert.equal(camp.status, "PAUSED", "constitution: new campaigns are PAUSED");
    assert.ok(camp.daily_budget, "ASC budget must live on the campaign");
    assert.equal(camp.existing_customer_budget_percentage, 20);

    // The ASC ad set binds to the purchase pixel and catalog.
    const adset = plan.campaigns[0].adsets[0].payload;
    assert.equal(adset.promoted_object.pixel_id, "333");
    assert.equal(adset.promoted_object.custom_event_type, "PURCHASE");
    assert.equal(adset.promoted_object.product_catalog_id, "cat_999");
    assert.ok(!adset.daily_budget, "ASC ad set must NOT carry a budget (campaign does)");
  } finally {
    cleanup(SLUG);
  }
});

test("ASC fallback: unhealthy pixel -> manual ABO/CBO tree, not ASC", () => {
  try {
    const { brief, plan } = buildBriefAndPlan(ecommerceProfile({ pixelHealthy: false }));
    assert.equal(brief.campaign_type, "manual", "no healthy pixel -> must fall back to manual");
    assert.equal(brief.asc, null);
    for (const c of plan.campaigns) {
      assert.notEqual(c.payload.smart_promotion_type, "AUTOMATED_SHOPPING_ADS", "manual plan must not be ASC");
    }
  } finally {
    cleanup(SLUG);
  }
});
