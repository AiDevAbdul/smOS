/**
 * E5 /listening CLI behaviour, offline only — no network is touched (the suite
 * runs with SMOS_OFFLINE=1 and no token), so what is under test is the
 * watchlist management path, the halt conditions, and the honesty of the
 * snapshot the script writes when nothing could be pulled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SCRIPT = resolve(ROOT, "skills/listening/listening.js");

if (!process.env.SMOS_DATA_ROOT) process.env.SMOS_DATA_ROOT = resolve(ROOT, "test", ".tmp");
const P = await import("../scripts/lib/paths.js");

// Offline + no Supabase, so the child never reaches the network.
const CHILD_ENV = {
  ...process.env,
  SMOS_OFFLINE: "1",
  SUPABASE_URL: "",
  SUPABASE_SERVICE_KEY: "",
  META_PAGE_TOKEN: "",
  META_ACCESS_TOKEN: "",
  TAVILY_API_KEY: "",
};

function makeClient(slug, profile = {}) {
  const dir = P.clientRoot(slug);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "client_profile.json"), JSON.stringify({ client_slug: slug, name: "Acme Care", accounts: {}, ...profile }, null, 2));
  return dir;
}

function run(slug, args = []) {
  const res = spawnSync(process.execPath, [SCRIPT, slug, ...args], { encoding: "utf8", env: CHILD_ENV });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

test("no slug → exit 2 with usage", () => {
  const res = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env: CHILD_ENV });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /usage: listening\.js/);
});

test("missing profile → exit 3 HALT", () => {
  const { code, err } = run("e5-cli-nobody");
  assert.equal(code, 3);
  assert.match(err, /HALT/);
});

test("--add-* persists a watchlist and prints it; --show-watchlist reads it back", () => {
  const slug = "e5-cli-wl";
  makeClient(slug);
  const add = run(slug, ["--add-brand-term", "Acme Care", "--add-keyword", "oil change", "--add-hashtag", "#AcmeCare", "--add-competitor", "@RivalBrand"]);
  assert.equal(add.code, 0);
  const parsed = JSON.parse(add.out);
  assert.deepEqual(parsed.watchlist.hashtags, ["acmecare"]);
  assert.equal(parsed.watchlist.competitors[0].handle, "rivalbrand");
  assert.ok(existsSync(P.clientData(slug, "listening_watchlist.json")));

  const show = run(slug, ["--show-watchlist"]);
  assert.equal(show.code, 0);
  assert.deepEqual(JSON.parse(show.out).watchlist.keywords, ["oil change"]);

  const rm = run(slug, ["--remove", "oil change"]);
  assert.equal(rm.code, 0);
  assert.deepEqual(JSON.parse(rm.out).watchlist.keywords, []);
});

test("an empty watchlist HALTS (exit 7) rather than reporting zero mentions", () => {
  const slug = "e5-cli-empty";
  makeClient(slug, { name: "" });
  const { code, err } = run(slug);
  assert.equal(code, 7);
  assert.match(err, /nothing to listen for/);
});

test("offline run writes an honest snapshot: unreached sources null, no crisis verdict", () => {
  const slug = "e5-cli-offline";
  makeClient(slug, { competitors: [{ handle: "rivalbrand", name: "Rival Brand" }], tracked_keywords: ["oil change"] });
  const { code, out } = run(slug, ["--hashtag-search", "--web-search", "--fb-comments"]);
  assert.equal(code, 0, out);

  const snap = JSON.parse(readFileSync(P.clientFile(slug, "listening_snapshot.json"), "utf8"));
  assert.ok(snap.captured_at);

  // Every source is unreached offline → mentions must be null everywhere.
  assert.ok(snap.coverage.length > 5);
  for (const c of snap.coverage) {
    assert.equal(c.mentions, null, `${c.source} should be null offline, got ${c.mentions}`);
  }
  // Platforms with no API at all are still listed, so their absence cannot read as 0.
  assert.ok(snap.coverage.some((c) => c.platform === "tiktok" && c.status === "unavailable"));

  // No data ⇒ no total, no share of voice, no crisis severity.
  assert.equal(snap.mention_total.total, null);
  assert.equal(snap.share_of_voice.status, "no_data");
  assert.equal(snap.crisis.severity, null);
  assert.equal(snap.crisis.status, "insufficient_data");

  // Competitor stubs survive; metrics stay null rather than 0-filled.
  assert.equal(snap.competitors[0].handle, "rivalbrand");
  assert.equal(snap.competitors[0].engagement_rate, null);

  assert.match(out, /crisis insufficient_data/);
});

test("a supplied capture is matched, classified untagged, and time-series tracked", () => {
  const slug = "e5-cli-capture";
  makeClient(slug, { competitors: [{ handle: "rivalbrand", name: "Rival Brand" }] });
  run(slug, ["--add-brand-term", "Acme Care", "--add-keyword", "oil change"]);
  writeFileSync(P.clientFile(slug, "listening_capture.json", { forWrite: true }), JSON.stringify({
    mentions: [
      { source: "capture", platform: "reddit", text: "Acme Care did my oil change, great", url: "https://r/1", at: "2026-09-08T00:00:00Z" },
      { source: "capture", platform: "reddit", text: "Rival Brand was faster", url: "https://r/2", at: "2026-09-08T01:00:00Z" },
      { source: "capture", platform: "reddit", text: "totally unrelated chatter", url: "https://r/3", at: "2026-09-08T02:00:00Z" },
    ],
    sentiment_judgments: { "https://r/1": "positive" },
  }, null, 2));

  const { code, out } = run(slug);
  assert.equal(code, 0, out);
  const snap = JSON.parse(readFileSync(P.clientFile(slug, "listening_snapshot.json"), "utf8"));

  assert.equal(snap.mentions.length, 2, "the unmatched mention is discarded, not counted");
  assert.equal(snap.discarded_unmatched, 1);
  const brand = snap.mentions.find((m) => m.url === "https://r/1");
  assert.equal(brand.discovery, "untagged");
  assert.equal(brand.about_client, true);
  assert.equal(brand.sentiment, "positive", "url-keyed judgments still merge");
  const rival = snap.mentions.find((m) => m.url === "https://r/2");
  assert.equal(rival.about_client, false);
  assert.deepEqual(rival.matched_terms.competitors, ["rivalbrand"]);

  // Share of voice runs on the one measured source, and is labelled a floor.
  assert.equal(snap.share_of_voice.status, "computed");
  assert.deepEqual(snap.share_of_voice.basis_platforms, ["capture"]);
  assert.equal(snap.share_of_voice.is_floor, true);
  assert.equal(snap.share_of_voice.entities.find((e) => e.is_client).mentions, 1);

  // One capture is not a baseline.
  assert.equal(snap.crisis.severity, null);

  const series = JSON.parse(readFileSync(resolve(P.clientDataDir(slug), "listening_timeseries.json"), "utf8"));
  assert.equal(series.points.length, 1);
  assert.equal(series.points[0].mentions, 1);
  assert.equal(series.points[0].untagged, 2);
  assert.equal(series.points[0].is_floor, true);
});

test("--no-timeseries leaves the baseline untouched", () => {
  const slug = "e5-cli-nots";
  makeClient(slug, { name: "Acme Care" });
  const { code } = run(slug, ["--no-timeseries"]);
  // Nothing captured offline → validation still passes because coverage rows
  // are present (they are the honest record of "we looked, here is the limit").
  assert.equal(code, 0);
  assert.equal(existsSync(resolve(P.clientDataDir(slug), "listening_timeseries.json")), false);
});
