import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ROOT, makeClient, cleanup, readClientJson, clientFileExists,
  runSkill, profileFixture, analysisFixture, timezoneAtMiddayNow,
} from "./helpers/pipeline.js";

// Integration: the /analyze -> /scale handoff (audit 2026-06-25, item #1).
//
// /analyze writes performance_analysis.json; /scale reads it and decides.
// /analyze always hits the live Meta API (no offline mode), so we cannot chain
// it here. Instead we:
//   1. assert /analyze's WRITER still emits the keys /scale consumes (a source
//      contract — catches a silent rename in a future rebuild), and
//   2. feed /scale a fixture built to that exact shape and run the REAL script
//      end-to-end (offline, dry-run) to prove the handoff + every safety gate.

const SLUG = "__it_analyze_scale";
const ISO_NOW = () => new Date().toISOString();
const HOURS_AGO = (h) => new Date(Date.now() - h * 3600_000).toISOString();

// A plausible ad (passes the bad-data sanity guard) carrying a pause flag.
function pauseAd(id) {
  return { id, name: `IMG_PAIN_${id}`, adset_id: `as_${id}`, spend: 80, impressions: 6000 };
}
function pauseFlag(id) {
  return { flag: "PAUSE_CANDIDATE_CPA", entity_id: id, name: `IMG_PAIN_${id}`, metric: "cpa", threshold: 150, reasoning: "CPA 3x target" };
}

test("contract: /analyze still emits the keys /scale consumes", () => {
  const src = readFileSync(resolve_analyze(), "utf8");
  const outBlock = src.slice(src.indexOf("const out = {"), src.indexOf("writeFileSync(outPath"));
  for (const key of ["generated_at", "flags", "by_ad", "by_adset", "by_campaign"]) {
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(outBlock),
      `/analyze no longer emits "${key}" — the analyze->scale handoff shape drifted (update analysisFixture + this list together)`,
    );
  }
});
function resolve_analyze() {
  return `${ROOT}/skills/analyze/analyze.js`;
}

test("handoff: /scale consumes /analyze output and writes a well-formed scaling_log (dry-run)", () => {
  try {
    makeClient(SLUG, {
      "client_profile.json": profileFixture(SLUG),
      "performance_analysis.json": analysisFixture({
        slug: SLUG,
        generatedAt: ISO_NOW(),
        ads: [pauseAd("a1"), pauseAd("a2")],
        flags: [pauseFlag("a1"), pauseFlag("a2")],
      }),
    });

    // --force bypasses freshness/business-hours/breaker so this test isolates the
    // pure handoff: does scale read analyze's shape and produce valid decisions?
    const r = runSkill("skills/scale/scale.js", SLUG, "--force");
    assert.equal(r.status, 0, `scale dry-run failed:\n${r.stderr}`);
    assert.ok(clientFileExists(SLUG, "scaling_log.json"), "scale did not write scaling_log.json");

    const log = readClientJson(SLUG, "scaling_log.json");
    assert.equal(log.summary.dry_run, true, "expected a dry-run log");
    assert.equal(log.analysis_generated_at, readClientJson(SLUG, "performance_analysis.json").generated_at,
      "scaling_log must echo the analysis it consumed (provenance link broken)");
    assert.ok(Array.isArray(log.decisions) && log.decisions.length === 2, "expected one decision per flagged ad");
    for (const d of log.decisions) {
      assert.equal(d.action, "pause", "plausible PAUSE_CANDIDATE_CPA should classify as pause");
      assert.equal(d.status, "dry_run", "dry-run decisions must not be applied");
    }
    assert.equal(log.summary.auto_paused, 2, "both pause decisions should count as auto_paused");
  } finally {
    cleanup(SLUG);
  }
});

test("gate: stale analysis is refused (freshness gate, exit 4)", () => {
  try {
    makeClient(SLUG, {
      "client_profile.json": profileFixture(SLUG),
      "performance_analysis.json": analysisFixture({ slug: SLUG, generatedAt: HOURS_AGO(9), flags: [pauseFlag("a1")], ads: [pauseAd("a1")] }),
    });
    const r = runSkill("skills/scale/scale.js", SLUG); // no --force
    assert.equal(r.status, 4, `expected freshness gate (exit 4), got ${r.status}:\n${r.stderr}`);
    assert.match(r.stderr, /old/, "freshness error should explain the analysis is stale");
    assert.ok(!clientFileExists(SLUG, "scaling_log.json"), "a refused run must not write a log");
  } finally {
    cleanup(SLUG);
  }
});

test("gate: unknown timezone fails CLOSED on business hours (exit 5)", () => {
  try {
    makeClient(SLUG, {
      "client_profile.json": profileFixture(SLUG, { timezone: null }),
      "performance_analysis.json": analysisFixture({ slug: SLUG, generatedAt: ISO_NOW(), flags: [pauseFlag("a1")], ads: [pauseAd("a1")] }),
    });
    const r = runSkill("skills/scale/scale.js", SLUG); // fresh data, no --force, no tz
    assert.equal(r.status, 5, `expected business-hours gate (exit 5), got ${r.status}:\n${r.stderr}`);
  } finally {
    cleanup(SLUG);
  }
});

test("safety: circuit breaker refuses a mass auto-mutation from garbage analysis (exit 6)", () => {
  try {
    // 30 plausible ads all flagged for pause — exceeds the absolute cap (25) and
    // the 50%-of-active cap. With --execute (but NOT --force), the breaker must
    // refuse BEFORE any Meta call. Midday tz keeps the business-hours gate open.
    const ads = [], flags = [];
    for (let i = 0; i < 30; i++) { ads.push(pauseAd(`a${i}`)); flags.push(pauseFlag(`a${i}`)); }
    makeClient(SLUG, {
      "client_profile.json": profileFixture(SLUG, { timezone: timezoneAtMiddayNow() }),
      "performance_analysis.json": analysisFixture({ slug: SLUG, generatedAt: ISO_NOW(), ads, flags }),
    });
    const r = runSkill("skills/scale/scale.js", SLUG, "--execute");
    assert.equal(r.status, 6, `expected circuit breaker (exit 6), got ${r.status}:\n${r.stderr}`);
    assert.match(r.stderr, /CIRCUIT BREAKER/, "breaker error should name itself");
    assert.ok(!clientFileExists(SLUG, "scaling_log.json"), "a tripped breaker must not write a log");
  } finally {
    cleanup(SLUG);
  }
});
