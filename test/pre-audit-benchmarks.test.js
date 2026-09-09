import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Coverage for E6's vertical/geo benchmark table: the resolver in
// scripts/meta-ad-library/benchmarks.py, its wiring into build.py's
// synthesis.json, and the honesty labeling the rendered report depends on.
//
// The rule under test throughout: a figure that is NOT a measured value for
// this prospect's vertical AND country must say so — as a `basis`, a `match`
// level, or a caveat. Silence would let a cross-vertical US number read as
// this prospect's category benchmark.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MLIB = resolve(ROOT, "scripts", "meta-ad-library");
const FA = "2026-07-15T00:00:00Z";

/** Call benchmarks.resolve() and get the JSON back. */
function resolveBench(vertical, geo) {
  const py = `import json, benchmarks as b; print(json.dumps(b.resolve(${
    vertical === null ? "None" : JSON.stringify(vertical)
  }, ${geo === null ? "None" : JSON.stringify(geo)})))`;
  const r = spawnSync("python3", ["-c", py], { cwd: MLIB, encoding: "utf8" });
  assert.equal(r.status, 0, `resolve failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function loadJson() {
  return JSON.parse(readFileSync(resolve(MLIB, "benchmarks.json"), "utf8"));
}

test("every benchmark cell carries a source and a date", () => {
  const b = loadJson();
  for (const [key, m] of Object.entries(b.global.metrics)) {
    assert.ok(m.source, `${key} has no source`);
    assert.ok(m.source_date, `${key} has no source_date`);
    assert.equal(typeof m.value, "number", `${key} value is not numeric`);
  }
  for (const block of ["verticals", "geos"]) {
    const src = b[block]._source;
    assert.ok(src.source && src.source_date, `${block} source block incomplete`);
    assert.ok(src.sample_note, `${block} must disclose (or disclaim) its sample`);
  }
});

test("an exact vertical in the index-base geo is reported as observed, not derived", () => {
  const r = resolveBench("fitness", "US");
  assert.equal(r.vertical.match, "exact");
  assert.equal(r.geo.match, "exact");
  assert.equal(r.geo.cpm_index, 1.0);
  assert.equal(r.is_tailored, true);
  assert.equal(r.is_geo_adjusted, false, "US is the index base — nothing to adjust");
  for (const m of Object.values(r.metrics)) assert.equal(m.basis, "vertical_observed");
});

test("an alias maps to its proxy row and says which row it landed on", () => {
  const r = resolveBench("auto_repair", "US");
  assert.equal(r.vertical.match, "alias");
  assert.equal(r.vertical.key, "home_services");
  assert.equal(r.vertical.input, "auto_repair");
  assert.equal(r.vertical.label, "Home Services");
});

test("only CPM is geo-adjusted; CPC/CTR/CPA keep the source's mixed-geo basis", () => {
  const r = resolveBench("apparel", "GB");
  assert.equal(r.is_geo_adjusted, true);
  assert.equal(r.metrics.cpm.basis, "geo_derived");
  assert.equal(r.metrics.cpm.geo_adjusted, true);
  // The derived value is the vertical figure times the index, not a lookup.
  const b = loadJson();
  const expected = Math.round(b.verticals.apparel.cpm * r.geo.cpm_index * 100) / 100;
  assert.equal(r.metrics.cpm.value, expected);
  assert.match(r.metrics.cpm.note, /Derived estimate, not a measured/);
  for (const key of ["cpc", "ctr_pct", "cpa"]) {
    assert.equal(r.metrics[key].basis, "vertical_observed", `${key} must not be geo-adjusted`);
    assert.equal(r.metrics[key].geo_adjusted, false);
    assert.equal(r.metrics[key].value, b.verticals.apparel[key], `${key} value was altered`);
  }
});

test("a market absent from the source table gets no index and no substitute", () => {
  const r = resolveBench("auto_repair", "PK");
  assert.equal(r.geo.match, "gap");
  assert.equal(r.geo.key, null);
  assert.equal(r.geo.cpm_index, null, "an unmeasured market must not get an index");
  assert.equal(r.is_geo_adjusted, false);
  // It must NOT quietly borrow a neighbouring market's cost.
  const b = loadJson();
  assert.equal(r.metrics.cpm.value, b.verticals.home_services.cpm);
  assert.ok(r.caveats.some((c) => /No geo adjustment applied/.test(c)),
    "the missing market must be stated, not implied");
  assert.ok(r.caveats.some((c) => /Pakistan/.test(c)));
});

test("a deliberately unmapped vertical falls back to global and refuses a commercial proxy", () => {
  const r = resolveBench("nonprofit", "AT");
  assert.equal(r.vertical.match, "unmapped");
  assert.equal(r.vertical.key, null);
  assert.equal(r.is_tailored, false, "an unmapped vertical is not a tailored report");
  assert.deepEqual(r.metrics, {}, "no vertical metrics may be invented for it");
  assert.ok(r.caveats.some((c) => /deliberately unmapped/.test(c)));
  // The global block is still there — the honest floor.
  assert.ok(r.global.meta_cpl.value > 0);
});

test("no vertical supplied is labeled cross-vertical, never silently tailored", () => {
  const r = resolveBench(null, null);
  assert.equal(r.is_tailored, false);
  assert.equal(r.vertical.match, "unknown");
  assert.equal(r.geo.match, "unknown");
  assert.ok(r.caveats.some((c) => /No vertical supplied/.test(c)));
});

test("an unrecognized vertical says it did not match rather than guessing", () => {
  const r = resolveBench("quantum_yak_grooming", "US");
  assert.equal(r.vertical.match, "unknown");
  assert.equal(r.is_tailored, false);
  assert.ok(r.caveats.some((c) => /did not match a vertical/.test(c)));
});

test("EU resolves through an alias and is reported as a proxy, not exact", () => {
  const r = resolveBench("ecommerce", "EU");
  assert.equal(r.geo.match, "proxy");
  assert.equal(r.geo.key, "DE");
});

test("a country name resolves as well as its ISO code", () => {
  const byCode = resolveBench("ecommerce", "GB");
  const byName = resolveBench("ecommerce", "United Kingdom");
  assert.equal(byName.geo.key, byCode.geo.key);
  assert.equal(byName.geo.match, "exact");
});

test("the geo index is relative to the declared base, and every band is known", () => {
  const b = loadJson();
  const base = b.geos[b.geos._source.index_base].cpm;
  const r = resolveBench("ecommerce", "IN");
  assert.equal(r.geo.cpm_index, Math.round((b.geos.IN.cpm / base) * 10000) / 10000);
  assert.ok(r.geo.cpm_index < 1, "India must index below the US base");
  const bands = new Set(["very_high", "high", "medium", "low", "very_low"]);
  for (const [k, v] of Object.entries(b.geos)) {
    if (k.startsWith("_")) continue;
    assert.ok(bands.has(v.band), `${k} has an unknown band ${v.band}`);
    assert.equal(typeof v.cpm, "number");
  }
});

test("the source conflict between aggregators is recorded, not hidden", () => {
  const b = loadJson();
  assert.equal(b.confidence.tier, "third_party_aggregate");
  assert.ok(Array.isArray(b.disagreement) && b.disagreement.length);
  const r = resolveBench("fitness", "US");
  assert.equal(r.confidence_tier, "third_party_aggregate");
  assert.ok(r.caveats.some((c) => /Aggregators disagree/.test(c)));
});

// ── build.py wiring ─────────────────────────────────────────────────────────

function fixture(country) {
  const dataRoot = mkdtempSync(resolve(tmpdir(), "smos-bench-"));
  const raw = resolve(dataRoot, "prospects", "acme", "data", "raw");
  mkdirSync(raw, { recursive: true });
  const w = (name, obj) => writeFileSync(resolve(raw, name), JSON.stringify(obj));
  w("facebook.json", { status: "ok", url: "fb", likes: 1766, has_profile_pic: true, about: "HVAC", fetched_at: FA });
  w("instagram.json", { status: "ok", url: "ig", handle: "acme", bio: "b", is_business_account: true, followers: 842, posts_per_week: 2.1, recency_days: 4, fetched_at: FA });
  w("website.json", { status: "ok", url: "https://acme.com", meta_pixel: { installed: false, id: null }, ga4: { installed: true, id: "G-A" }, gtm: { installed: true, id: null }, conversion_events: false, viewport_meta: true, fetched_at: FA });
  w("ads_self.json", { status: "ok", url: "self", data: [], fetched_at: FA });
  w("ads_competitors.json", { status: "ok", fetched_at: FA, competitors: [{ status: "ok", url: "c1", data: [
    { page_name: "BestAir", ad_delivery_start_time: "2026-04-01", ad_delivery_stop_time: null, ad_snapshot_url: "a", ad_creative_bodies: ["x"] },
  ] }] });
  const manifest = { slug: "acme", fetched_at: FA, window_days: 90 };
  if (country) manifest.country = country;
  w("manifest.json", manifest);
  return dataRoot;
}

function run(script, dataRoot, extra = []) {
  const r = spawnSync("python3", [resolve(MLIB, script), "acme", ...extra], {
    encoding: "utf8", env: { ...process.env, SMOS_DATA_ROOT: dataRoot },
  });
  assert.equal(r.status, 0, `${script} failed: ${r.stderr}`);
  return r;
}
const readSyn = (dataRoot) =>
  JSON.parse(readFileSync(resolve(dataRoot, "prospects", "acme", "data", "synthesis.json"), "utf8"));

test("build resolves the benchmark set into synthesis.json for the renderer", () => {
  const dataRoot = fixture("GB");
  try {
    run("normalize.py", dataRoot);
    run("build.py", dataRoot, ["--vertical", "hvac"]);
    const bm = readSyn(dataRoot).benchmarks;
    assert.equal(bm.vertical.key, "home_services");
    assert.equal(bm.geo.key, "GB", "geo defaults to the collect manifest country");
    assert.equal(bm.is_geo_adjusted, true);
    assert.equal(bm.metrics.cpm.basis, "geo_derived");
  } finally { rmSync(dataRoot, { recursive: true, force: true }); }
});

test("--geo overrides the manifest country", () => {
  const dataRoot = fixture("GB");
  try {
    run("normalize.py", dataRoot);
    run("build.py", dataRoot, ["--vertical", "apparel", "--geo", "AE"]);
    assert.equal(readSyn(dataRoot).benchmarks.geo.key, "AE");
  } finally { rmSync(dataRoot, { recursive: true, force: true }); }
});

test("a run with no vertical and no manifest country still builds, labeled untailored", () => {
  const dataRoot = fixture(null);
  try {
    run("normalize.py", dataRoot);
    run("build.py", dataRoot);
    const bm = readSyn(dataRoot).benchmarks;
    assert.equal(bm.is_tailored, false);
    assert.equal(bm.geo.key, null);
    assert.ok(bm.global.meta_cpl.value > 0, "the cross-vertical floor is still supplied");
  } finally { rmSync(dataRoot, { recursive: true, force: true }); }
});

// ── renderer ────────────────────────────────────────────────────────────────

function render(dataRoot) {
  const D = (f) => resolve(dataRoot, "prospects", "acme", "data", f);
  const out = resolve(dataRoot, "out.html");
  const r = spawnSync("python3", [resolve(MLIB, "pre_audit_report.py"),
    "--page-audit", D("page_audit.json"), "--competitors", D("competitor_summary.json"),
    "--synthesis", D("synthesis.json"), "--business", "Acme HVAC", "--slug", "acme",
    "--output", out], { encoding: "utf8" });
  assert.equal(r.status, 0, `render failed: ${r.stderr}`);
  return readFileSync(out, "utf8");
}

test("the report states the benchmark scope and marks each row's basis", () => {
  const dataRoot = fixture("GB");
  try {
    run("normalize.py", dataRoot);
    run("build.py", dataRoot, ["--vertical", "hvac"]);
    const html = render(dataRoot);
    assert.match(html, /Scope:\s*Home Services/);
    assert.match(html, /closest match for/, "an aliased vertical must admit it is a proxy");
    assert.match(html, /United Kingdom/);
    assert.match(html, /CPM cost-indexed/);
    assert.match(html, /ds-badge--warn">Derived/, "the derived CPM must be badged Derived");
    assert.match(html, /ds-badge--good">Vertical/);
    assert.match(html, /ds-badge--neutral">Cross-vertical/, "the global floor stays visible");
    assert.match(html, /Aggregators disagree materially/, "the source conflict must reach the page");
  } finally { rmSync(dataRoot, { recursive: true, force: true }); }
});

test("an untailored run never claims vertical specificity in the report", () => {
  const dataRoot = fixture(null);
  try {
    run("normalize.py", dataRoot);
    run("build.py", dataRoot);
    const html = render(dataRoot);
    assert.match(html, /Scope:\s*Cross-vertical — not tailored to this vertical/);
    assert.doesNotMatch(html, /ds-badge--good">Vertical/);
  } finally { rmSync(dataRoot, { recursive: true, force: true }); }
});

test("a synthesis.json predating the vertical table still renders (cross-vertical)", () => {
  const dataRoot = fixture("GB");
  try {
    run("normalize.py", dataRoot);
    run("build.py", dataRoot, ["--vertical", "hvac"]);
    const path = resolve(dataRoot, "prospects", "acme", "data", "synthesis.json");
    const syn = JSON.parse(readFileSync(path, "utf8"));
    delete syn.benchmarks;
    writeFileSync(path, JSON.stringify(syn));
    const html = render(dataRoot);
    assert.match(html, /Scope:\s*Cross-vertical/);
    assert.match(html, /Meta CPL/);
  } finally { rmSync(dataRoot, { recursive: true, force: true }); }
});
