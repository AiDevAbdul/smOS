import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as competitorSchema from "../schemas/competitor_intel.js";
import {
  ROOT, makeClient, cleanup, readClientJson, clientFileExists,
  runSkill, profileFixture,
} from "./helpers/pipeline.js";

// Integration: research / audience-map -> strategy-brief (audit 2026-06-25 #1).
//
// strategy-brief is the consumer and runs fully offline (no Meta API), so we
// chain the REAL scripts:
//   - audience-map --offline (a real run — produces audience_map.json)
//   - a competitor_intel.json fixture built through the SAME schema research
//     uses (research itself has no offline mode)
//   - strategy-brief (real run — consumes both, writes strategy_brief.json)
//
// Guards the two historical drifts this pipeline has hit: competitor_intel
// missing a top-level `angles` array (brief picked no angles), and offline
// audience-map emitting zero clusters (brief had no cold audiences to rank).

const SLUG = "__it_research_strategy";

function profileWithInterests() {
  return profileFixture(SLUG, {
    kpis: { target_cpa: 50, target_roas: 2.0, monthly_budget_low: 3000 },
    extra: {
      audience: { interests: ["fitness", "yoga", "wellness"] },
      location: { primary: "Austin, TX" },
      products: [{ name: "Personal Training" }],
    },
  });
}

// competitor_intel.json as research would write it: normalized through the
// canonical schema so the fixture tracks the producer's real output shape.
function competitorIntelFixture() {
  return competitorSchema.normalize({
    client_slug: SLUG,
    generated_at: new Date().toISOString(),
    country: "US",
    competitors: [{ name: "RivalFit", angles: [{ angle: "Transformation results", frequency: 5 }] }],
    angles: [
      { angle: "Transformation results", frequency: 5 },
      { angle: "Limited-time offer", frequency: 3 },
    ],
    gaps: ["No video testimonials"],
  });
}

test("contract: competitor schema derives a top-level angles array strategy-brief can read", () => {
  // The drift competitor_intel.js was built to fix: research wrote { competitors }
  // with no top-level angles, so strategy-brief's `.angles` read was always [].
  const fromTopLevel = competitorSchema.normalize({ angles: [{ angle: "A" }] });
  assert.ok(Array.isArray(fromTopLevel.angles) && fromTopLevel.angles.length === 1, "top-level angles must survive normalize");
  const derived = competitorSchema.normalize({ competitors: [{ angles: [{ angle: "B" }] }] });
  assert.ok(derived.angles.length >= 1, "angles must be derived from competitors[].angles when top-level is absent");

  // And strategy-brief must actually consume `.angles`.
  const src = readFileSync(`${ROOT}/skills/strategy-brief/strategy-brief.js`, "utf8");
  assert.match(src, /\.angles\b/, "strategy-brief no longer reads competitor.angles — handoff drifted");
});

test("regression: audience-map --offline emits non-empty clusters (structure-only)", () => {
  try {
    makeClient(SLUG, { "client_profile.json": profileWithInterests() });
    const r = runSkill("skills/audience-map/audience-map.js", SLUG, "--offline");
    assert.equal(r.status, 0, `audience-map --offline failed:\n${r.stderr}`);
    const map = readClientJson(SLUG, "audience_map.json");
    assert.ok(map.clusters.length >= 1, "offline audience-map must build structure-only clusters, not []");
    for (const c of map.clusters) {
      assert.ok(c.id, "each cluster needs an id (launch join key)");
      assert.ok(Array.isArray(c.interest_stack) && c.interest_stack.length > 0, `cluster ${c.id} has empty interest_stack`);
    }
    // Its own schema must accept the offline map (no validation issues).
    assert.deepEqual(map.diagnostics.issues, [], `offline map should be schema-clean, got: ${map.diagnostics.issues.join("; ")}`);
  } finally {
    cleanup(SLUG);
  }
});

test("handoff: audience-map --offline + competitor_intel -> a well-formed strategy_brief", () => {
  try {
    makeClient(SLUG, {
      "client_profile.json": profileWithInterests(),
      "competitor_intel.json": competitorIntelFixture(),
    });

    const am = runSkill("skills/audience-map/audience-map.js", SLUG, "--offline");
    assert.equal(am.status, 0, `audience-map failed:\n${am.stderr}`);

    const sb = runSkill("skills/strategy-brief/strategy-brief.js", SLUG);
    assert.equal(sb.status, 0, `strategy-brief failed:\n${sb.stderr}`);
    assert.ok(clientFileExists(SLUG, "strategy_brief.json"), "no strategy_brief.json written");
    assert.ok(clientFileExists(SLUG, "strategy_brief.md"), "constitution requires the .md companion too");

    const brief = readClientJson(SLUG, "strategy_brief.json");
    // Creative angles must have flowed from competitor_intel.angles.
    assert.ok(brief.creative_angles.length > 0, "brief has no creative_angles — competitor->brief angle handoff broke");
    // Cold audiences must have flowed from the offline clusters.
    assert.ok(brief.audience_priority.length > 0, "brief has no audience_priority — audience-map->brief handoff broke");
    assert.ok(
      brief.budget_allocation.adsets.some((a) => a.role === "cold"),
      "no cold adsets — offline clusters did not reach budget allocation",
    );
  } finally {
    cleanup(SLUG);
  }
});

test("gate: strategy-brief refuses when an upstream input is missing (exit 3)", () => {
  try {
    // Profile + audience_map present, but competitor_intel.json absent.
    makeClient(SLUG, { "client_profile.json": profileWithInterests() });
    runSkill("skills/audience-map/audience-map.js", SLUG, "--offline");
    // (no competitor_intel.json written)
    const r = runSkill("skills/strategy-brief/strategy-brief.js", SLUG);
    assert.equal(r.status, 3, `expected missing-input gate (exit 3), got ${r.status}:\n${r.stderr}`);
    assert.match(r.stderr, /competitor_intel\.json/, "error should name the missing input and how to produce it");
    assert.ok(!clientFileExists(SLUG, "strategy_brief.json"), "a refused run must not write a brief");
  } finally {
    cleanup(SLUG);
  }
});
