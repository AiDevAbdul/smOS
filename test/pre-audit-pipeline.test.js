import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Integration coverage for the deterministic /pre-audit data pipeline:
// canned raw passes → normalize.py → signals.csv → build.py → contract JSON.
// Exercises the source-of-truth CSV, the render contract shape, the 0–100
// scoring rubric, and byte-for-byte reproducibility.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MLIB = resolve(ROOT, "scripts", "meta-ad-library");
const FA = "2026-07-15T00:00:00Z";

function fixture() {
  const dataRoot = mkdtempSync(resolve(tmpdir(), "smos-preaudit-"));
  const raw = resolve(dataRoot, "prospects", "acme", "data", "raw");
  mkdirSync(raw, { recursive: true });
  const w = (name, obj) => writeFileSync(resolve(raw, name), JSON.stringify(obj));
  w("facebook.json", { status: "ok", url: "fb", likes: 1766, has_profile_pic: true, about: "HVAC", fetched_at: FA });
  w("instagram.json", { status: "ok", url: "ig", handle: "acme", bio: "b", is_business_account: true, followers: 842, posts_per_week: 2.1, recency_days: 4, fetched_at: FA });
  w("website.json", { status: "ok", url: "https://acme.com", meta_pixel: { installed: false, id: null }, ga4: { installed: true, id: "G-A" }, gtm: { installed: true, id: null }, conversion_events: false, viewport_meta: true, fetched_at: FA });
  w("ads_self.json", { status: "ok", url: "self", data: [], fetched_at: FA });
  w("ads_competitors.json", {
    status: "ok", fetched_at: FA,
    competitors: [{ status: "ok", url: "c1", data: [
      { page_name: "BestAir", ad_delivery_start_time: "2026-04-01", ad_delivery_stop_time: null, ad_snapshot_url: "a/video/b", ad_creative_bodies: ["x"] },
      { page_name: "BestAir", ad_delivery_start_time: "2026-07-10", ad_delivery_stop_time: null, ad_snapshot_url: "a", ad_creative_bodies: ["x", "y"] },
    ] }],
  });
  w("manifest.json", { slug: "acme", fetched_at: FA, country: "US", window_days: 90 });
  return dataRoot;
}

function run(script, dataRoot) {
  const r = spawnSync("python3", [resolve(MLIB, script), "acme"], {
    encoding: "utf8", env: { ...process.env, SMOS_DATA_ROOT: dataRoot },
  });
  assert.equal(r.status, 0, `${script} failed: ${r.stderr}`);
  return r;
}
const readJson = (dataRoot, f) => JSON.parse(readFileSync(resolve(dataRoot, "prospects", "acme", "data", f), "utf8"));

test("normalize writes a long-format signals.csv from all four passes", () => {
  const dataRoot = fixture();
  try {
    run("normalize.py", dataRoot);
    const csv = readFileSync(resolve(dataRoot, "prospects", "acme", "data", "signals.csv"), "utf8");
    assert.match(csv, /^slug,pass,entity,metric,value,unit,status,source,fetched_at$/m);
    assert.match(csv, /acme,facebook,self,likes,1766,count,ok/);
    assert.match(csv, /acme,ads,competitor:BestAir,active_ads_last_90d,2,count,ok/);
    // nested paths become dotted metrics
    assert.match(csv, /acme,website,self,meta_pixel\.installed,False,bool/);
  } finally { rmSync(dataRoot, { recursive: true, force: true }); }
});

test("build re-inflates the render contract and scores 0–100 deterministically", () => {
  const dataRoot = fixture();
  try {
    run("normalize.py", dataRoot);
    run("build.py", dataRoot);

    const page = readJson(dataRoot, "page_audit.json");
    assert.equal(page.facebook.likes, 1766);
    assert.equal(page.website.meta_pixel.installed, false); // bool coerced, not "False"
    assert.equal(page.instagram.is_business_account, true);

    const comp = readJson(dataRoot, "competitor_summary.json");
    assert.ok(comp.competitors.BestAir, "competitors keyed by name (dict, per render contract)");
    assert.equal(comp.competitors.BestAir.active_ads_last_90d, 2);

    const syn = readJson(dataRoot, "synthesis.json");
    assert.ok(syn.score >= 0 && syn.score <= 100);
    const dims = Object.values(syn.dimensions);
    assert.equal(dims.length, 5);
    assert.ok(dims.every((d) => d >= 0 && d <= 100));
    assert.equal(syn.dimensions.pixel_tracking, 35); // GA4(20)+GTM(15), no pixel/conv
    assert.equal(syn.dimensions.ad_maturity, 0);     // zero self ads
    assert.equal(syn.wins.length <= 3 && syn.gaps.length <= 3, true);
    assert.equal(syn.scored_at, FA); // derived from data, not wall-clock
  } finally { rmSync(dataRoot, { recursive: true, force: true }); }
});

test("build is reproducible: same signals.csv → byte-identical synthesis", () => {
  const dataRoot = fixture();
  try {
    run("normalize.py", dataRoot);
    run("build.py", dataRoot);
    const a = readFileSync(resolve(dataRoot, "prospects", "acme", "data", "synthesis.json"), "utf8");
    run("build.py", dataRoot);
    const b = readFileSync(resolve(dataRoot, "prospects", "acme", "data", "synthesis.json"), "utf8");
    assert.equal(a, b);
  } finally { rmSync(dataRoot, { recursive: true, force: true }); }
});

test("competitor creative_matrix (from classifier) flows CSV → competitor_summary", () => {
  const dataRoot = fixture();
  try {
    // Simulate what collect.py writes after scoring: a creative_matrix on the raw envelope.
    const rawComp = resolve(dataRoot, "prospects", "acme", "data", "raw", "ads_competitors.json");
    const env = JSON.parse(readFileSync(rawComp, "utf8"));
    env.competitors[0].creative_matrix = {
      hook_strength: 8, visual_strategy: 7, cta_match: 9,
      psychological_trigger: 6.5, run_duration_score: 8, rationale: "proof-led hooks",
    };
    writeFileSync(rawComp, JSON.stringify(env));

    run("normalize.py", dataRoot);
    const csv = readFileSync(resolve(dataRoot, "prospects", "acme", "data", "signals.csv"), "utf8");
    assert.match(csv, /creative_matrix\.hook_strength,8,count/);
    assert.doesNotMatch(csv, /rationale/, "rationale is prose, not a ledger signal");

    run("build.py", dataRoot);
    const cm = readJson(dataRoot, "competitor_summary.json").competitors.BestAir.creative_matrix;
    assert.deepEqual(cm, { hook_strength: 8, visual_strategy: 7, cta_match: 9, psychological_trigger: 6.5, run_duration_score: 8 });
  } finally { rmSync(dataRoot, { recursive: true, force: true }); }
});

// Run a snippet against the collectors module (meta-ad-library on sys.path) and
// return its JSON stdout. Exercises the Tavily-fallback parsers offline.
function pyCollectors(snippet) {
  const code = `import sys, json; sys.path.insert(0, ${JSON.stringify(MLIB)}); import collectors as c\n${snippet}`;
  const r = spawnSync("python3", ["-c", code], { encoding: "utf8" });
  assert.equal(r.status, 0, `python failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

test("_denum parses commas and K/M/B suffixes", () => {
  const out = pyCollectors(
    `print(json.dumps([c._denum("1,234"), c._denum("1.2M"), c._denum("10.5k"), c._denum("3B"), c._denum(None), c._denum("n/a")]))`);
  assert.deepEqual(out, [1234, 1200000, 10500, 3000000000, null, null]);
});

test("parse_facebook_text recovers likes/talking-about from Tavily content", () => {
  const txt = "BA Works. 1,766 likes · 42 talking about this · 7 were here. Auto detailing.";
  const out = pyCollectors(`print(json.dumps(c.parse_facebook_text(${JSON.stringify(txt)})))`);
  assert.equal(out.likes, 1766);
  assert.equal(out.talking_about, 42);
  assert.equal(out.were_here, 7);
  assert.equal(out.about, null); // never fabricated via this path
});

test("parse_instagram_text recovers followers/following/posts + bio from Tavily content", () => {
  const txt = '1.2M Followers, 340 Following, 1,234 Posts - BA Works (@baworks) on Instagram: "We detail cars"';
  const out = pyCollectors(`print(json.dumps(c.parse_instagram_text(${JSON.stringify(txt)}, "baworks")))`);
  assert.equal(out.followers, 1200000);
  assert.equal(out.following, 340);
  assert.equal(out.posts_total, 1234);
  assert.equal(out.bio, "We detail cars");
  assert.equal(out.handle, "baworks");
  assert.equal(out.posts_per_week, null); // no per-post timestamps via fallback
});

test("Tavily fallback is a no-op without an API key (honest block preserved)", () => {
  // No TAVILY_API_KEY in this env → _tavily_* return None → collector keeps the block.
  const code = `import sys, json, os; sys.path.insert(0, ${JSON.stringify(MLIB)});\n` +
    `os.environ.pop("TAVILY_API_KEY", None); import collectors as c\n` +
    `print(json.dumps(c._tavily_facebook("https://m.facebook.com/x", "blocked_429")))`;
  const r = spawnSync("python3", ["-c", code], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "null");
});

test("data-quality gate flags low_confidence when ≥2 core passes are blocked", () => {
  const dataRoot = fixture();
  try {
    // Block Facebook + Instagram; website + ads remain ok → 2 blocked.
    const raw = resolve(dataRoot, "prospects", "acme", "data", "raw");
    writeFileSync(resolve(raw, "facebook.json"), JSON.stringify({ status: "blocked", url: "fb", fetched_at: FA }));
    writeFileSync(resolve(raw, "instagram.json"), JSON.stringify({ status: "blocked", url: "ig", fetched_at: FA }));
    run("normalize.py", dataRoot);
    run("build.py", dataRoot);
    const dq = readJson(dataRoot, "synthesis.json").data_quality;
    assert.equal(dq.low_confidence, true);
    assert.deepEqual(dq.blocked_passes, ["facebook", "instagram"]);
    assert.equal(dq.core_passes, 4);
  } finally { rmSync(dataRoot, { recursive: true, force: true }); }
});

test("data-quality gate stays confident with ≤1 blocked pass (ok ≠ blocked)", () => {
  const dataRoot = fixture();
  try {
    writeFileSync(resolve(dataRoot, "prospects", "acme", "data", "raw", "facebook.json"),
      JSON.stringify({ status: "blocked", url: "fb", fetched_at: FA }));
    run("normalize.py", dataRoot);
    run("build.py", dataRoot);
    const dq = readJson(dataRoot, "synthesis.json").data_quality;
    assert.equal(dq.low_confidence, false);
    assert.deepEqual(dq.blocked_passes, ["facebook"]);
  } finally { rmSync(dataRoot, { recursive: true, force: true }); }
});

test("build fails clearly (not a raw traceback) on a malformed signals.csv header", () => {
  const dataRoot = fixture();
  try {
    run("normalize.py", dataRoot);
    const csvPath = resolve(dataRoot, "prospects", "acme", "data", "signals.csv");
    const body = readFileSync(csvPath, "utf8").replace(/^slug,pass,/, "slug,WRONG,");
    writeFileSync(csvPath, body);
    const r = spawnSync("python3", [resolve(MLIB, "build.py"), "acme"], {
      encoding: "utf8", env: { ...process.env, SMOS_DATA_ROOT: dataRoot },
    });
    assert.notEqual(r.status, 0, "build should exit non-zero on a bad CSV");
    assert.match(r.stderr + r.stdout, /missing required column/i);
    assert.doesNotMatch(r.stderr, /Traceback/, "operator sees a clear message, not a traceback");
  } finally { rmSync(dataRoot, { recursive: true, force: true }); }
});

test("narrative.json overrides template prose without touching the score", () => {
  const dataRoot = fixture();
  try {
    run("normalize.py", dataRoot);
    run("build.py", dataRoot);
    const scored = readJson(dataRoot, "synthesis.json").score;
    writeFileSync(resolve(dataRoot, "prospects", "acme", "data", "narrative.json"),
      JSON.stringify({ headline: "Custom human headline" }));
    run("build.py", dataRoot);
    const syn = readJson(dataRoot, "synthesis.json");
    assert.equal(syn.headline, "Custom human headline");
    assert.equal(syn.score, scored, "override must not change the computed score");
  } finally { rmSync(dataRoot, { recursive: true, force: true }); }
});
