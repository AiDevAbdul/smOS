import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ROOT, makeClient, cleanup, readClientJson, clientFileExists,
  runSkill,
} from "./helpers/pipeline.js";

// Integration: intake -> audit (audit 2026-06-25, item #1).
//
// /intake build produces client_profile.json (+ per-client CLAUDE.md); /audit
// reads profile.accounts.{facebook_page_id, instagram_business_id,
// ad_account_id, pixel_id}. /audit always hits the live Meta API (no offline
// mode), so as with /analyze we don't run it here; instead we run the REAL
// /intake build offline and prove the profile it emits carries exactly the
// account shape /audit consumes (source contract), plus the intake gates.

// Must be slug-stable: /intake slugifies its arg, so a slug with underscores
// would build into a different dir than makeClient creates.
const SLUG = "it-intake-audit-fixture";

// A complete intake_answers.json (the shape `intake init` scaffolds), all
// required fields filled, with real-looking account IDs so it onboards as an
// established (non-zero-start) client.
function answersFixture(overrides = {}) {
  return {
    slug: SLUG,
    name: "Fixture Fitness",
    business: {
      product_description: "1:1 personal training and small-group fitness classes",
      price_low: 80,
      price_high: 300,
      business_model: "service",
      usp: "Certified coaches, first session free",
      conversion_event: "Lead",
    },
    audience: { age_low: 25, age_high: 45, gender: "all", geo_targets: ["US"], pain_points: ["no time to work out"] },
    voice: { tone: "motivating", restricted_words: ["guaranteed"], cta_style: "direct" },
    accounts: {
      ad_account_id: "act_1234567890",
      pixel_id: "111222333",
      facebook_page_id: "444555666",
      instagram_business_id: "777888999",
      currency: "USD",
      timezone: "America/Chicago",
    },
    kpis: { target_cpa: 50, target_roas: 2.0, monthly_budget_low: 3000, monthly_budget_high: 6000 },
    approvals: { discord_user_id: "u_123", budget_increase_ceiling: 500 },
    ...overrides,
  };
}

test("contract: /audit reads the account keys /intake writes", () => {
  const src = readFileSync(`${ROOT}/skills/audit/audit.js`, "utf8");
  for (const key of ["facebook_page_id", "instagram_business_id", "ad_account_id", "pixel_id"]) {
    assert.match(src, new RegExp(`acct\\.${key}\\b`), `/audit no longer reads acct.${key} — intake->audit account handoff drifted`);
  }
});

test("handoff: /intake build emits an audit-ready client_profile + CLAUDE.md", () => {
  try {
    makeClient(SLUG, { "intake_answers.json": answersFixture() });
    const r = runSkill("skills/intake/intake.js", "build", SLUG);
    assert.equal(r.status, 0, `intake build failed:\n${r.stderr}`);

    assert.ok(clientFileExists(SLUG, "client_profile.json"), "no client_profile.json written");
    // Per-client constitution is part of the intake contract.
    assert.ok(clientFileExists(SLUG, "CLAUDE.md"), "intake must generate the per-client CLAUDE.md");

    const profile = readClientJson(SLUG, "client_profile.json");
    const acct = profile.accounts || {};
    // The exact keys /audit will read must be present and non-TBD.
    for (const key of ["facebook_page_id", "instagram_business_id", "ad_account_id", "pixel_id"]) {
      assert.ok(acct[key] && !/TBD/i.test(String(acct[key])), `profile.accounts.${key} missing/TBD — /audit can't run`);
    }
    // Downstream skills also rely on kpis surviving intake.
    assert.ok(profile.kpis && profile.kpis.target_cpa, "profile.kpis.target_cpa lost in intake build");
  } finally {
    cleanup(SLUG);
  }
});

test("gate: /intake build refuses incomplete answers (exit 3)", () => {
  try {
    const bad = answersFixture();
    delete bad.business.usp; // drop a REQUIRED_BUSINESS field
    makeClient(SLUG, { "intake_answers.json": bad });
    const r = runSkill("skills/intake/intake.js", "build", SLUG);
    assert.equal(r.status, 3, `expected validation gate (exit 3), got ${r.status}:\n${r.stderr}`);
    assert.match(r.stderr, /usp/, "validation error should name the missing field");
    assert.ok(!clientFileExists(SLUG, "client_profile.json"), "a refused intake must not write a profile");
  } finally {
    cleanup(SLUG);
  }
});

test("gate: /audit refuses to run with no profile (exit 2)", () => {
  try {
    makeClient(SLUG, {}); // empty client dir, no client_profile.json
    const r = runSkill("skills/audit/audit.js", SLUG);
    assert.equal(r.status, 2, `expected missing-profile gate (exit 2), got ${r.status}:\n${r.stderr}`);
    assert.ok(!clientFileExists(SLUG, "audit_raw.json"), "a refused audit must not write audit_raw.json");
  } finally {
    cleanup(SLUG);
  }
});
