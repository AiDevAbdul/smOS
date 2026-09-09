/**
 * E5 listening depth — watchlist, term matching, tagged-vs-untagged
 * classification, cross-platform coverage accounting, and share of voice.
 *
 * The honesty invariants under test (CLAUDE.md): an unreached platform reports
 * `null`, never 0; a total or a share from a partial/truncated source is a
 * FLOOR and says so; and a missing signal is removed from the denominator
 * rather than scored as good news.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
if (!process.env.SMOS_DATA_ROOT) process.env.SMOS_DATA_ROOT = resolve(ROOT, "test", ".tmp");

const {
  containsTerm, matchTerms, normalizeMention, mentionId, dedupeMentions,
  coverageRow, noApiCoverage, measuredSources, mentionTotal, shareOfVoice,
  LISTENING_SOURCES, NO_API_PLATFORMS,
} = await import("../scripts/lib/listening_depth.js");
const WL = await import("../scripts/lib/listening_watchlist.js");
const { listeningSnapshot } = await import("../schemas/index.js");
const { parseResults, available, searchWeb } = await import("../scripts/lib/web_search.js");

const watchlist = WL.normalizeWatchlist({
  brand_terms: ["Acme Care", "acmecare"],
  keywords: ["oil change"],
  hashtags: ["#AcmeCare", "carrepair"],
  competitors: [{ handle: "@RivalBrand", name: "Rival Brand" }],
});

// ─────────────────────────── term matching ───────────────────────────

test("containsTerm matches whole words, hashtags and handles — not substrings", () => {
  assert.equal(containsTerm("love @acmecare so much", "acmecare"), true);
  assert.equal(containsTerm("check #AcmeCare out", "acmecare"), true);
  assert.equal(containsTerm("acmecarefoundation is unrelated", "acmecare"), false);
  assert.equal(containsTerm("", "acmecare"), false);
  assert.equal(containsTerm("acmecare", ""), false);
});

test("matchTerms splits hits by watchlist list and canonicalizes competitors", () => {
  const m = matchTerms("Got an oil change at Acme Care, way better than Rival Brand", watchlist);
  assert.deepEqual(m.brand_terms, ["acme care"]);
  assert.deepEqual(m.keywords, ["oil change"]);
  assert.deepEqual(m.competitors, ["rivalbrand"]);
});

test("normalizeWatchlist strips sigils, lowercases, dedupes and keeps competitor names", () => {
  assert.deepEqual(watchlist.hashtags, ["acmecare", "carrepair"]);
  assert.equal(watchlist.competitors[0].handle, "rivalbrand");
  assert.equal(watchlist.competitors[0].name, "Rival Brand");
});

// ─────────────────── tagged vs untagged classification ───────────────────

test("a tagged-only source is always classified tagged; a hashtag hit is untagged", () => {
  const tagged = normalizeMention({ text: "thanks!", permalink: "u1" }, { watchlist, source: "ig_tags" });
  assert.equal(tagged.discovery, "tagged");
  assert.equal(tagged.about_client, true, "a tagged mention is about the client by construction");
  assert.equal(LISTENING_SOURCES.ig_tags.discovers, "tagged");

  const untagged = normalizeMention({ text: "great service at Acme Care #carrepair", permalink: "u2" }, { watchlist, source: "ig_hashtag" });
  assert.equal(untagged.discovery, "untagged");
  assert.equal(untagged.about_client, true, "brand term present ⇒ attributable");
});

test("an untagged mention with no brand term is NOT attributed to the client", () => {
  const m = normalizeMention({ text: "Rival Brand did my oil change", url: "u3" }, { watchlist, source: "web_search" });
  assert.equal(m.discovery, "untagged");
  assert.equal(m.about_client, false);
  assert.deepEqual(m.matched_terms.competitors, ["rivalbrand"]);
});

test("mention_id is deterministic and dedupes a re-pulled mention", () => {
  const a = normalizeMention({ text: "hi Acme Care", url: "u4", at: "2026-09-01T00:00:00Z" }, { watchlist, source: "ig_hashtag" });
  const b = normalizeMention({ text: "hi Acme Care", url: "u4", at: "2026-09-01T00:00:00Z" }, { watchlist, source: "ig_hashtag" });
  assert.equal(a.mention_id, b.mention_id);
  assert.equal(dedupeMentions([a, b]).length, 1);
  assert.notEqual(mentionId({ source: "web_search", url: "u4" }), a.mention_id);
});

// ────────────────────────── coverage accounting ──────────────────────────

test("a source that did not run reports mentions:null, never 0", () => {
  for (const status of ["unavailable", "error", "skipped"]) {
    const row = coverageRow("ig_hashtag", { status, reason: "x" });
    assert.equal(row.mentions, null, `${status} must be null`);
    assert.equal(row.truncated, null);
  }
  const ran = coverageRow("ig_hashtag", { status: "partial", mentions: 0 });
  assert.equal(ran.mentions, 0, "a source that ran and found nothing is genuinely 0");
});

test("every no-API platform is listed as unavailable with a reason", () => {
  const rows = noApiCoverage();
  assert.equal(rows.length, Object.keys(NO_API_PLATFORMS).length);
  for (const r of rows) {
    assert.equal(r.status, "unavailable");
    assert.equal(r.mentions, null);
    assert.match(r.reason, /no smOS-reachable listening API/);
  }
  assert.ok(rows.some((r) => r.platform === "tiktok"));
});

test("mentionTotal is a labelled FLOOR whenever a source is partial or a platform unmeasured", () => {
  const cov = [coverageRow("ig_tags", { status: "partial", mentions: 4 }), ...noApiCoverage()];
  const t = mentionTotal(cov);
  assert.equal(t.total, 4);
  assert.equal(t.is_floor, true);
  assert.match(t.reason, /floor, not the real total/);
  assert.ok(t.unmeasured.includes("tiktok"));
  assert.deepEqual(measuredSources(cov).map((c) => c.source), ["ig_tags"]);
});

test("mentionTotal with no measured source is null, not 0", () => {
  const t = mentionTotal(noApiCoverage());
  assert.equal(t.total, null);
  assert.equal(t.is_floor, null);
});

// ────────────────────────── share of voice ──────────────────────────

test("shareOfVoice computes only over measured platforms and reports basis + confidence", () => {
  const cov = [
    coverageRow("ig_hashtag", { status: "partial", mentions: 3 }),
    coverageRow("web_search", { status: "unavailable", reason: "no key" }),
    ...noApiCoverage(["tiktok"]),
  ];
  const mentions = [
    normalizeMention({ text: "Acme Care fixed it", url: "a" }, { watchlist, source: "ig_hashtag" }),
    normalizeMention({ text: "Acme Care again", url: "b" }, { watchlist, source: "ig_hashtag" }),
    normalizeMention({ text: "Rival Brand was cheaper", url: "c" }, { watchlist, source: "ig_hashtag" }),
    // On an UNMEASURED source — must be excluded from the basis entirely.
    normalizeMention({ text: "Rival Brand rocks", url: "d" }, { watchlist, source: "web_search" }),
  ];
  const sov = shareOfVoice({ mentions, coverage: cov, watchlist });
  assert.equal(sov.status, "computed");
  assert.deepEqual(sov.basis_platforms, ["instagram"]);
  assert.equal(sov.total_attributed, 3, "the web_search mention is excluded — that source produced no data");
  const client = sov.entities.find((e) => e.is_client);
  assert.equal(client.mentions, 2);
  assert.equal(client.share_pct, 66.7);
  assert.equal(sov.entities.find((e) => e.handle === "rivalbrand").share_pct, 33.3);
  assert.equal(sov.is_floor, true);
  assert.ok(sov.confidence < 1 && sov.confidence > 0);
  assert.ok(sov.unmeasured_platforms.includes("tiktok"));
});

test("shareOfVoice with no brand_terms cannot identify the client — null, not 0", () => {
  const wl = WL.normalizeWatchlist({ keywords: ["oil change"], competitors: [{ handle: "rivalbrand" }] });
  const cov = [coverageRow("ig_hashtag", { status: "partial", mentions: 1 })];
  const mentions = [normalizeMention({ text: "rivalbrand oil change", url: "x" }, { watchlist: wl, source: "ig_hashtag" })];
  const sov = shareOfVoice({ mentions, coverage: cov, watchlist: wl });
  const client = sov.entities.find((e) => e.is_client);
  assert.equal(client.mentions, null);
  assert.equal(client.share_pct, null);
  assert.match(client.reason, /no brand_terms/);
});

test("shareOfVoice reports no_data / no_attributable_mentions instead of a 0/100 split", () => {
  const none = shareOfVoice({ mentions: [], coverage: noApiCoverage(), watchlist });
  assert.equal(none.status, "no_data");
  assert.equal(none.total_attributed, null);
  assert.equal(none.is_floor, null);
  for (const e of none.entities) assert.equal(e.share_pct, null);

  const empty = shareOfVoice({ mentions: [], coverage: [coverageRow("ig_tags", { status: "partial", mentions: 0 })], watchlist });
  assert.equal(empty.status, "no_attributable_mentions");
  assert.equal(empty.total_attributed, 0);
  for (const e of empty.entities) assert.equal(e.share_pct, null);
});

// ────────────────────── watchlist persistence + series ──────────────────────

test("watchlist add/remove round-trips through paths.js", () => {
  const slug = "e5-wl";
  const dir = resolve(process.env.SMOS_DATA_ROOT, "clients", slug);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "client_profile.json"), JSON.stringify({ client_slug: slug, name: "Acme" }));

  let wl = WL.loadWatchlist(slug, { name: "Acme", tracked_keywords: ["brakes"] });
  assert.deepEqual(wl.brand_terms, ["acme"], "seeded from the profile when no file exists");
  wl = WL.addToWatchlist(wl, { hashtags: ["#Brakes"], competitors: ["@Rival"] });
  WL.saveWatchlist(slug, wl);
  assert.ok(existsSync(WL.watchlistPath(slug)));

  const reloaded = WL.loadWatchlist(slug, {});
  assert.deepEqual(reloaded.hashtags, ["brakes"]);
  assert.equal(reloaded.competitors[0].handle, "rival");
  assert.ok(reloaded.updated_at);

  const { watchlist: after, removed } = WL.removeFromWatchlist(reloaded, "rival");
  assert.deepEqual(removed, ["competitors"]);
  assert.equal(after.competitors.length, 0);
});

test("a corrupt watchlist HALTS rather than silently becoming an empty watchlist", () => {
  const slug = "e5-wl-corrupt";
  const dir = resolve(process.env.SMOS_DATA_ROOT, "clients", slug, "data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "listening_watchlist.json"), "{not json");
  assert.throws(() => WL.loadWatchlist(slug, {}), /unreadable/);
});

test("appendTimeseries is append-only and idempotent per captured_at", () => {
  let s = { client_slug: "x", points: [] };
  s = WL.appendTimeseries(s, { captured_at: "2026-09-02T00:00:00Z", mentions: 5 });
  s = WL.appendTimeseries(s, { captured_at: "2026-09-01T00:00:00Z", mentions: 3 });
  s = WL.appendTimeseries(s, { captured_at: "2026-09-02T00:00:00Z", mentions: 7 });
  assert.equal(s.points.length, 2, "a re-run of the same capture must not double-count into the baseline");
  assert.deepEqual(s.points.map((p) => p.mentions), [3, 7]);
});

// ───────────────────────── schema + web search ─────────────────────────

test("listeningSnapshot.validate rejects a non-null mentions count on an unreached source", () => {
  const base = { captured_at: "2026-09-09T00:00:00Z", competitors: [{ handle: "x" }] };
  assert.equal(listeningSnapshot.validate(base).ok, true, "pre-E5 snapshots still validate");
  const bad = listeningSnapshot.validate({ ...base, coverage: [{ source: "tiktok_none", status: "unavailable", mentions: 0 }] });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(" "), /must report null, never 0/);
  assert.equal(listeningSnapshot.validate({ ...base, coverage: [{ source: "ig_tags", status: "partial", mentions: 2 }] }).ok, true);
  assert.equal(listeningSnapshot.validate({ ...base, coverage: [{ source: "ig_tags", status: "partial" }] }).ok, false);
});

test("listeningSnapshot.normalize preserves the depth fields on a mention", () => {
  const n = listeningSnapshot.normalize({
    captured_at: "2026-09-09T00:00:00Z",
    mentions: [{ mention_id: "m_1", source: "ig_hashtag", platform: "instagram", discovery: "untagged", text: "hi", matched_terms: { keywords: ["k"] }, about_client: false }],
  });
  assert.equal(n.mentions[0].discovery, "untagged");
  assert.deepEqual(n.mentions[0].matched_terms, { keywords: ["k"] });
  assert.equal(n.mentions[0].about_client, false);
});

test("web search is key-gated and fail-soft — never throws, never fabricates", async () => {
  assert.equal(available({}), false);
  const gated = await searchWeb("acme", { env: {} });
  assert.equal(gated.ok, false);
  assert.deepEqual(gated.results, []);
  assert.match(gated.error, /TAVILY_API_KEY/);

  const boom = await searchWeb("acme", { env: { TAVILY_API_KEY: "k" }, fetchImpl: async () => { throw new Error("socket hang up"); } });
  assert.equal(boom.ok, false);
  assert.deepEqual(boom.results, []);
  assert.match(boom.error, /socket hang up/);

  const ok = await searchWeb("acme", {
    env: { TAVILY_API_KEY: "k" },
    fetchImpl: async () => ({ ok: true, json: async () => ({ results: [{ title: "T", url: "https://e/1", content: "Acme Care" }, { title: "no url" }] }) }),
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.results.length, 1, "a result with no url is dropped, not invented");
  assert.deepEqual(parseResults(null), []);
});
