// Pipeline integration-test harness.
//
// Purpose: stand up a throwaway fixture client on disk, run the REAL skill
// scripts against it via spawnSync (offline), and read the artifacts they
// emit — so a test can prove that one skill's output is actually consumable
// by the next skill in the pipeline (the handoff SHAPE survives), and that
// the safety gates between them fire on bad input.
//
// This is the shared substrate the audit (2026-06-25, item #1) called for:
// golden-path E2E per pipeline, asserting handoffs survive a rebuild. New
// pipeline tests should build on these helpers rather than re-implementing
// client scaffolding each time.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as P from "../../scripts/lib/paths.js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Keep fixture clients/prospects out of the real data dirs: route all fixture
// writes under test/.tmp via SMOS_DATA_ROOT (honored by paths.js at call time
// and inherited by spawned skills through runSkill's env). See A3.
export const TEST_DATA_ROOT = resolve(ROOT, "test", ".tmp");
if (!process.env.SMOS_DATA_ROOT) process.env.SMOS_DATA_ROOT = TEST_DATA_ROOT;

/**
 * Absolute path to a fixture client's file, RESOLVED for reading: prefers the
 * canonical bucket (where rewired skills now write their output) and falls back
 * to the legacy flat location (where makeClient writes inputs). Asserts use this.
 */
export function clientPath(slug, file) {
  return P.clientFile(slug, file);
}

/**
 * Create a fresh fixture client dir, writing inputs to the LEGACY flat location.
 * Skills read via clientFile(), which falls back to flat, so flat fixtures are
 * found; skill OUTPUTS land in the canonical buckets and are read back via
 * clientPath() above. Keeping inputs flat avoids pre-creating every data/ subdir.
 */
export function makeClient(slug, files = {}) {
  const dir = P.clientRoot(slug);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(resolve(dir, name), JSON.stringify(value, null, 2));
  }
  return dir;
}

/** Remove a fixture client dir. Always call in a finally{}. */
export function cleanup(slug) {
  rmSync(P.clientRoot(slug), { recursive: true, force: true });
}

/** Read a JSON artifact a skill wrote into the fixture client dir. */
export function readClientJson(slug, file) {
  return JSON.parse(readFileSync(clientPath(slug, file), "utf8"));
}

export function clientFileExists(slug, file) {
  return existsSync(clientPath(slug, file));
}

/**
 * Run a real skill script against the fixture client, offline.
 * Returns { status, stdout, stderr }. SMOS_OFFLINE=1 is set so any skill that
 * honors it stays off the network; dry-run skills (no --execute) never build a
 * live Graph client anyway.
 */
export function runSkill(scriptRelPath, slug, ...args) {
  const r = spawnSync("node", [resolve(ROOT, scriptRelPath), slug, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SMOS_OFFLINE: "1" },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/**
 * Pick an Etc/GMT zone where it is currently ~midday, so business-hours-gated
 * skills run deterministically regardless of when the suite executes. Etc zones
 * are fixed-offset (no DST), so local hour = utcHour + offset exactly.
 */
export function timezoneAtMiddayNow(now = new Date()) {
  const utcHour = now.getUTCHours();
  let offset = (12 - utcHour + 24) % 24; // lands local hour on 12
  if (offset > 14) offset -= 24; // keep within Etc/GMT bounds (UTC-12..UTC+14)
  // POSIX sign flip: Etc/GMT-5 means UTC+5.
  return offset >= 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

/** A minimal non-TBD client profile sufficient for analyze/scale to proceed. */
export function profileFixture(slug, overrides = {}) {
  return {
    slug,
    business_name: "Fixture Co",
    accounts: {
      ad_account_id: "act_1234567890",
      currency: "USD",
      timezone: overrides.timezone ?? null,
    },
    kpis: overrides.kpis ?? { target_cpa: 50, target_roas: 2.0 },
    ...overrides.extra,
  };
}

/**
 * Build a performance_analysis.json with the EXACT top-level shape analyze.js
 * emits (see skills/analyze/analyze.js `out = {...}`). If analyze's writer ever
 * drifts, the source-contract test in integration.analyze-scale.test.js fails;
 * keep this builder in sync with that.
 */
export function analysisFixture({ slug, generatedAt, flags = [], ads = [], adsets = [], campaigns = [] }) {
  return {
    slug,
    generated_at: generatedAt,
    ad_account_id: "act_1234567890",
    currency: "USD",
    kpis_used: { target_cpa: 50, target_roas: 2.0 },
    window_summary: { last_7d_totals: {} },
    by_campaign: campaigns,
    by_adset: adsets,
    by_ad: ads,
    flags,
    opportunity: { score: 0, drivers: [] },
    winners: { top_roas: [], lowest_cpa: [] },
    losers: { bottom_roas: [] },
    segment_highlights: [],
  };
}
