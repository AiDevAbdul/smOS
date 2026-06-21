import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { launchPlan as launchPlanSchema } from "../schemas/index.js";

// E2E gate (Phase 1.9): run the REAL pipeline scripts on a fresh fixture client
// and assert the launch plan is fully resolved — the headline regression the
// expert review found (all 15 ads carried copy_used: null on a fresh client).
//
// Chain: strategy-brief -> creative skeleton -> (fill draft) -> creative lint -> launch (dry-run)
// Source artifacts are copied from blue-rose-auto; the brief/copy are regenerated
// through the FIXED code so angle_id flows brief -> ad_copy -> launch.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SLUG = "__e2e_fixture";
const FIX = resolve(ROOT, "clients", SLUG);
const SRC = resolve(ROOT, "clients", "blue-rose-auto");

function run(scriptRelPath, ...args) {
  const r = spawnSync("node", [resolve(ROOT, scriptRelPath), SLUG, ...args], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, SMOS_OFFLINE: "1" },
  });
  return r;
}

function setup() {
  rmSync(FIX, { recursive: true, force: true });
  mkdirSync(FIX, { recursive: true });
  for (const f of ["client_profile.json", "competitor_intel.json", "audience_map.json"]) {
    copyFileSync(resolve(SRC, f), resolve(FIX, f));
  }
  // Pre-resolve custom audiences (simulates a prior `--create-audiences` pass) so
  // the plan has real IDs — lets the gate also assert ZERO <TBD_> audiences.
  const mapPath = resolve(FIX, "audience_map.json");
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  const resolved = {};
  let n = 1000;
  for (const layer of map.retargeting_layers || []) resolved[layer.id] = String(++n);
  const lals = map.lookalikes || (map.lookalike ? [map.lookalike] : []);
  for (const lal of lals) resolved[lal.id || "LAL_1PCT"] = String(++n);
  map.resolved_audiences = resolved;
  writeFileSync(mapPath, JSON.stringify(map, null, 2));
}
function teardown() { rmSync(FIX, { recursive: true, force: true }); }

// Fill the creative skeleton with valid placeholder copy (simulating Claude) so
// the lint stage produces real variants. Compliant, within length limits.
function fillDraft() {
  const draftPath = resolve(FIX, "ad_copy_draft.json");
  const draft = JSON.parse(readFileSync(draftPath, "utf8"));
  for (const angle of draft.angles) {
    angle.hooks = (angle.hooks || []).map((_, i) => ({
      text: `Quality service you can trust today ${i + 1}`,
      primary_text: [
        "Real results from a team that shows up on time and does it right.",
        "Save money and skip the hassle with a shop that treats you fairly.",
        "Book today and see the difference local experts make for you.",
      ],
      headlines: ["Trusted Local Experts", "Service Done Right", "Book Your Slot"],
      ctas: ["BOOK_NOW", "LEARN_MORE", "GET_QUOTE"],
    }));
  }
  writeFileSync(draftPath, JSON.stringify(draft, null, 2));
}

test("E2E: fresh-client pipeline yields a launch plan with ZERO copy_used:null", { timeout: 60000 }, () => {
  if (!existsSync(SRC)) return; // skip if fixture source absent
  try {
    setup();

    const brief = run("skills/strategy-brief/strategy-brief.js");
    assert.equal(brief.status, 0, `strategy-brief failed:\n${brief.stderr}`);

    const skel = run("skills/creative/creative.js", "skeleton");
    assert.equal(skel.status, 0, `creative skeleton failed:\n${skel.stderr}`);

    fillDraft();

    const lint = run("skills/creative/creative.js", "lint");
    assert.equal(lint.status, 0, `creative lint failed:\n${lint.stderr}`);

    // angle_id must have flowed from the brief into ad_copy.json
    const adCopy = JSON.parse(readFileSync(resolve(FIX, "ad_copy.json"), "utf8"));
    assert.ok(adCopy.angles.every((a) => a.angle_id), "ad_copy angle missing angle_id join key");

    const launch = run("skills/launch/launch.js"); // dry-run
    assert.equal(launch.status, 0, `launch dry-run failed:\n${launch.stderr}`);

    const plan = launchPlanSchema.normalize(JSON.parse(readFileSync(resolve(FIX, "launch_plan.json"), "utf8")));
    assert.ok(plan.ads.length > 0, "launch plan produced no ads");
    const nulls = plan.ads.filter((ad) => !ad.copy_used);
    assert.equal(nulls.length, 0,
      `HEADLINE REGRESSION: ${nulls.length}/${plan.ads.length} ads have copy_used:null — the creative→launch handoff is broken again`);

    // No adset may reference an unresolved <TBD_> custom audience.
    const tbd = JSON.stringify(plan.adsets).match(/<TBD_/g) || [];
    assert.equal(tbd.length, 0,
      `HEADLINE REGRESSION: ${tbd.length} adset(s) still carry <TBD_> audience IDs — audience resolution (H5) failed`);

    // The canonical executable gate must pass outright.
    const gate = launchPlanSchema.validate(plan, { requireExecutable: true });
    assert.ok(gate.ok, `launch_plan executable gate failed:\n${gate.errors.join("\n")}`);

    // Every resolved ad must carry real copy text + the join key.
    for (const ad of plan.ads) {
      assert.ok(ad.copy_used.angle_id, `ad ${ad.name} copy_used missing angle_id`);
      assert.ok(ad.copy_used.primary_text || ad.copy_used.headline, `ad ${ad.name} copy_used has no text`);
    }
  } finally {
    teardown();
  }
});
