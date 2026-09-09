import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { makeClient, cleanup, runSkill, readClientJson } from "./helpers/pipeline.js";
import * as P from "../scripts/lib/paths.js";
import { loadSpine, spinePath } from "../scripts/lib/measurement_spine.js";
import { unknownEventStats, platformConversionsFromAnalysis, flagValue } from "../skills/capi-setup/capi-setup.js";

// E4 — /capi-setup EMQ capture + reconciliation, and /attribution reading the
// same spine. All runs are offline (runSkill sets SMOS_OFFLINE=1) — no network.

const SLUG = "__it_capi_emq";

function profile() {
  return {
    slug: SLUG,
    business_name: "Fixture Co",
    accounts: { ad_account_id: "act_1234567890", pixel_id: "1234567890", currency: "USD" },
    business: { conversion_events: ["Purchase", "Lead"] },
    kpis: { target_cpa: 50, target_roas: 2 },
  };
}

function analysis(conversions) {
  return {
    slug: SLUG,
    generated_at: "2026-09-08T00:00:00.000Z",
    ad_account_id: "act_1234567890",
    currency: "USD",
    window_summary: { last_7d_totals: { spend: 1000, conversions, conversion_value: 5000 } },
    by_campaign: [], by_adset: [], by_ad: [], flags: [],
  };
}

test("unknownEventStats reports unknown, never never_fired, when nothing was queried", () => {
  const e = unknownEventStats(["Purchase"]);
  assert.equal(e[0].status, "unknown");
  assert.equal(e[0].count_7d, null);
  assert.equal(e[0].server_share, null);
  assert.equal(e[0].firing, null);
});

test("flagValue accepts both --flag value and --flag=value, null when absent", () => {
  assert.equal(flagValue(["--observed", "12"], "--observed"), "12");
  assert.equal(flagValue(["--observed=12"], "--observed"), "12");
  assert.equal(flagValue(["--observed", "--audited"], "--observed"), null);
  assert.equal(flagValue([], "--observed"), null);
});

test("platform-reported conversions come from /analyze's handoff, or say why they can't", () => {
  try {
    makeClient(SLUG, { "client_profile.json": profile() });
    const none = platformConversionsFromAnalysis(SLUG);
    assert.equal(none.value, null);
    assert.match(none.reason, /run \/analyze first/);

    makeClient(SLUG, { "client_profile.json": profile(), "performance_analysis.json": analysis(100) });
    const found = platformConversionsFromAnalysis(SLUG);
    assert.equal(found.value, 100);
    assert.match(found.source, /performance_analysis\.json/);
  } finally {
    cleanup(SLUG);
  }
});

test("offline /capi-setup writes an EMQ snapshot marked unknown — it never fabricates a score", () => {
  try {
    makeClient(SLUG, { "client_profile.json": profile() });
    const r = runSkill("skills/capi-setup/capi-setup.js", SLUG);
    assert.equal(r.status, 0, `capi-setup failed:\n${r.stderr}`);

    const report = readClientJson(SLUG, "capi_report.json");
    assert.equal(report.data_source, "offline");
    assert.equal(report.emq.captured, false);
    assert.equal(report.emq.snapshot.source, "offline");
    assert.equal(report.emq.snapshot.dataset_avg_score, null); // unknown, not 0
    assert.equal(report.emq.snapshot.scored_events, 0);
    assert.ok(report.events.every((e) => e.status === "unknown"));
    assert.ok(report.gaps.some((g) => /not verified this run/.test(g)));
    assert.ok(report.gaps.some((g) => /Event Match Quality is unknown/.test(g)));

    // The spine exists, in the canonical data/ bucket, with the snapshot in it.
    assert.equal(report.spine_path, P.clientData(SLUG, "measurement_spine.json"));
    assert.ok(existsSync(spinePath(SLUG)));
    const spine = loadSpine(SLUG);
    assert.equal(spine.emq_series.length, 1);
    assert.equal(spine.reconciliations.length, 0); // no --observed ⇒ no half-empty row

    // Supabase persistence is reported honestly, not assumed.
    assert.equal(typeof report.supabase.persisted, "boolean");

    // stdout summary carries the unknowns rather than a fake pass.
    const summary = JSON.parse(r.stdout);
    assert.equal(summary.emq.dataset_avg_score, null);
    assert.equal(summary.pixel.unknown, 2);
    assert.equal(summary.reconciliation.recorded, false);
    assert.match(summary.reconciliation.reason, /platform-reported/);
  } finally {
    cleanup(SLUG);
  }
});

test("re-running offline does not add a second identical snapshot", () => {
  try {
    makeClient(SLUG, { "client_profile.json": profile() });
    assert.equal(runSkill("skills/capi-setup/capi-setup.js", SLUG).status, 0);
    const second = runSkill("skills/capi-setup/capi-setup.js", SLUG);
    assert.equal(second.status, 0);
    assert.equal(loadSpine(SLUG).emq_series.length, 1);
    assert.equal(readClientJson(SLUG, "capi_report.json").emq.not_appended_reason, "duplicate_snapshot");
  } finally {
    cleanup(SLUG);
  }
});

test("--observed reconciles against /analyze's platform-reported total and labels both sides", () => {
  try {
    makeClient(SLUG, { "client_profile.json": profile(), "performance_analysis.json": analysis(100) });
    const r = runSkill(
      "skills/capi-setup/capi-setup.js", SLUG,
      "--observed", "80", "--observed-source", "crm", "--observed-audited", "--event", "Lead",
    );
    assert.equal(r.status, 0, r.stderr);

    const rec = readClientJson(SLUG, "capi_report.json").reconciliation;
    assert.equal(rec.recorded, true);
    assert.equal(rec.platform_reported.value, 100);
    assert.match(rec.platform_reported.source, /performance_analysis\.json/);
    assert.equal(rec.platform_reported.basis, "platform_reported");
    assert.equal(rec.observed.value, 80);
    assert.equal(rec.observed.basis, "audited");
    assert.equal(rec.coverage_ratio, 0.8);
    assert.equal(rec.gap, -20);
    assert.equal(rec.verdict, "platform_over_reported");
    assert.equal(rec.event, "Lead");
    assert.equal(loadSpine(SLUG).reconciliations.length, 1);
  } finally {
    cleanup(SLUG);
  }
});

test("with no platform-reported number, the reconciliation is null with a reason (not zero)", () => {
  try {
    makeClient(SLUG, { "client_profile.json": profile() }); // no performance_analysis.json
    const r = runSkill("skills/capi-setup/capi-setup.js", SLUG, "--observed", "40", "--observed-source", "crm");
    assert.equal(r.status, 0, r.stderr);
    const rec = readClientJson(SLUG, "capi_report.json").reconciliation;
    assert.equal(rec.platform_reported.value, null);
    assert.equal(rec.coverage_ratio, null);
    assert.equal(rec.verdict, "unknown");
    assert.equal(rec.observed.basis, "observed_unverified"); // not declared audited
    assert.ok(rec.notes.some((n) => /platform-reported conversions unknown/.test(n)));
  } finally {
    cleanup(SLUG);
  }
});

test("/attribution --spine reads the same record without needing lift data", () => {
  try {
    makeClient(SLUG, { "client_profile.json": profile(), "performance_analysis.json": analysis(100) });
    assert.equal(
      runSkill("skills/capi-setup/capi-setup.js", SLUG, "--observed", "120", "--observed-source", "crm", "--observed-audited").status,
      0,
    );

    const spineRun = runSkill("skills/attribution/attribution.js", SLUG, "--spine");
    assert.equal(spineRun.status, 0, spineRun.stderr);
    const out = JSON.parse(spineRun.stdout);
    assert.equal(out.available, true);
    assert.equal(out.samples.emq_snapshots, 1);
    assert.equal(out.reconciliation.coverage_ratio, 1.2);
    assert.equal(out.reconciliation.verdict, "platform_under_reported");
    assert.equal(out.spine_path, spinePath(SLUG));

    // Without lift data /attribution still HALTs — the spine does not become a
    // substitute for measured incrementality.
    const halt = runSkill("skills/attribution/attribution.js", SLUG);
    assert.equal(halt.status, 4);
  } finally {
    cleanup(SLUG);
  }
});

test("/attribution --observed records through the shared writer", () => {
  try {
    makeClient(SLUG, { "client_profile.json": profile() });
    const r = runSkill(
      "skills/attribution/attribution.js", SLUG,
      "--observed=55", "--observed-source=crm", "--observed-audited", "--platform-conversions=50", "--spine",
    );
    assert.equal(r.status, 0, r.stderr);
    const spine = loadSpine(SLUG);
    assert.equal(spine.reconciliations.length, 1);
    assert.equal(spine.reconciliations[0].recorded_by, "attribution");
    assert.equal(spine.reconciliations[0].coverage_ratio, 1.1);
  } finally {
    cleanup(SLUG);
  }
});

test("/attribution embeds the spine in the report and labels last-click as platform-reported", () => {
  try {
    makeClient(SLUG, {
      "client_profile.json": profile(),
      "lift_export.json": {
        rows: [{ entity_id: "23851", entity_name: "CONV_LAL1PCT_202609", conversions: 120, incremental_conversions: 45, spend: 900 }],
      },
    });
    assert.equal(runSkill("skills/capi-setup/capi-setup.js", SLUG).status, 0);

    const r = runSkill("skills/attribution/attribution.js", SLUG);
    assert.equal(r.status, 0, r.stderr);
    const report = readClientJson(SLUG, "attribution_report.json");
    assert.ok(report.measurement_spine, "attribution_report should carry the spine handoff");
    assert.equal(report.measurement_spine.emq.dataset_avg_score, null); // offline capture ⇒ unknown
    assert.equal(report.measurement_spine.samples.emq_snapshots, 1);
    assert.match(r.stdout, /EMQ unknown \(run \/capi-setup\)/);
    assert.match(r.stdout, /conversions unreconciled/);
  } finally {
    cleanup(SLUG);
  }
});
