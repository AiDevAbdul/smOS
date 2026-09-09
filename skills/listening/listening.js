#!/usr/bin/env node
/**
 * /listening companion script — social listening + organic competitor
 * benchmarking, with the E5 "listening depth" layer:
 *
 *   * untagged-mention monitoring (IG Hashtag Search + FB own-post comments +
 *     key-gated web search) alongside the tagged-only IG /tags edge
 *   * a persisted per-client watchlist (brand terms / keywords / hashtags /
 *     competitor handles) tracked as an append-only time series
 *   * one cross-platform mention schema with an explicit per-source `coverage`
 *     row — a platform with no reachable API reports `null`, never 0
 *   * share of voice computed ONLY over the platforms that produced data, with
 *     the platform basis, a confidence share, and a floor label
 *   * rule-based crisis detection (volume spike vs rolling baseline + negative
 *     sentiment skew + velocity) that refuses to fire without a baseline
 *
 * Usage:
 *   node skills/listening/listening.js <slug> [flags]
 *
 * Watchlist management (no capture, no API calls):
 *   --show-watchlist
 *   --add-brand-term <t>  --add-keyword <t>  --add-hashtag <t>  --add-competitor <h>
 *   --remove <term>
 *
 * Capture flags:
 *   --hashtag-search     query IG Hashtag Search for each watchlist hashtag
 *                        (untagged discovery; burns the 30-hashtag/7-day quota)
 *   --fb-comments        scan the client's own FB Page post comments for terms
 *   --web-search         key-gated indexed public-page search (TAVILY_API_KEY)
 *   --baseline-window N  rolling-baseline window in points (default 14)
 *   --no-timeseries      do not append this run to the time series
 *
 * Offline-safe: SMOS_OFFLINE=1 or a missing token skips every live pull and
 * records each unreached source as `unavailable`/`skipped` with `mentions: null`.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { listeningSnapshot as schema } from "../../schemas/index.js";
import { resolveToken } from "../../scripts/lib/tokens.js";
import { createGraph } from "../../scripts/lib/meta-graph.js";
import { benchmarkFromMedia } from "../../scripts/lib/organic_bench.js";
import { applySentiment, pendingSentiment } from "../../scripts/lib/sentiment.js";
import { insert, clientIdBySlug, supabaseConfigured } from "../../scripts/lib/supabase.js";
import * as P from "../../scripts/lib/paths.js";
import {
  loadWatchlist, saveWatchlist, addToWatchlist, removeFromWatchlist,
  isWatchlistEmpty, loadTimeseries, appendTimeseries, saveTimeseries,
} from "../../scripts/lib/listening_watchlist.js";
import {
  normalizeMention, dedupeMentions, coverageRow, noApiCoverage,
  mentionTotal, shareOfVoice, detectCrisis, LISTENING_SOURCES,
} from "../../scripts/lib/listening_depth.js";
import { searchWeb, available as webSearchAvailable, unavailableReason as webSearchReason } from "../../scripts/lib/web_search.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ silent: true });

const argv = process.argv.slice(2);
const slug = argv.find((a) => !a.startsWith("--"));
if (!slug) {
  console.error("usage: listening.js <slug> [--hashtag-search] [--fb-comments] [--web-search] [--show-watchlist] [--add-keyword T] [--add-hashtag T] [--add-competitor H] [--add-brand-term T] [--remove T] [--baseline-window N] [--no-timeseries]");
  process.exit(2);
}

/** Collect every `--flag value` occurrence (repeatable). */
function multi(name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1] && !argv[i + 1].startsWith("--")) out.push(argv[i + 1]);
    else if (argv[i].startsWith(`${name}=`)) out.push(argv[i].slice(name.length + 1));
  }
  return out;
}
const has = (name) => argv.includes(name);
function one(name, fallback) {
  const v = multi(name)[0];
  return v === undefined ? fallback : v;
}

const OFFLINE = process.env.SMOS_OFFLINE === "1";

const profilePath = P.clientFile(slug, "client_profile.json");
if (!existsSync(profilePath)) { console.error(`HALT: ${profilePath} not found.`); process.exit(3); }
const profile = JSON.parse(readFileSync(profilePath, "utf8"));

// ───────────────────────── watchlist management ─────────────────────────

let watchlist;
try {
  watchlist = loadWatchlist(slug, profile);
} catch (e) {
  console.error(`HALT: ${e.message}`);
  process.exit(6);
}
watchlist.client_name = profile?.business_name || profile?.name || slug;

const adds = {
  brand_terms: multi("--add-brand-term"),
  keywords: multi("--add-keyword"),
  hashtags: multi("--add-hashtag"),
  competitors: multi("--add-competitor"),
};
const removes = multi("--remove");
const mutating = removes.length > 0 || Object.values(adds).some((a) => a.length);

if (mutating) {
  let wl = addToWatchlist(watchlist, adds);
  const removedReport = [];
  for (const term of removes) {
    const r = removeFromWatchlist(wl, term);
    wl = r.watchlist;
    removedReport.push({ term, removed_from: r.removed });
  }
  const saved = saveWatchlist(slug, wl);
  console.log(JSON.stringify({ watchlist: saved, added: adds, removed: removedReport, path: `clients/${slug}/data/listening_watchlist.json` }, null, 2));
  process.exit(0);
}

if (has("--show-watchlist")) {
  console.log(JSON.stringify({ watchlist, seeded_from_profile: !existsSync(P.clientData(slug, "listening_watchlist.json")) }, null, 2));
  process.exit(0);
}

if (isWatchlistEmpty(watchlist)) {
  console.error(
    `HALT: nothing to listen for — the watchlist for ${slug} is empty and the profile carried no brand name, keywords, hashtags or competitors.\n` +
    `  Add terms first, e.g.: node skills/listening/listening.js ${slug} --add-brand-term "Acme" --add-keyword "acme repair" --add-hashtag acmecare`
  );
  process.exit(7);
}

// ───────────────────────────── capture ─────────────────────────────

const capturePath = P.clientFile(slug, "listening_capture.json");
const capture = existsSync(capturePath) ? JSON.parse(readFileSync(capturePath, "utf8")) : {};

const handles = watchlist.competitors.map((c) => c.handle);
const igId = profile?.accounts?.instagram_business_id;
const pageId = profile?.accounts?.facebook_page_id;

/**
 * Live competitor benchmark via IG Business Discovery. From OUR ig business
 * account we can read any public business/creator account's followers + recent
 * media engagement — no scraping, fully within Graph. Returns one normalized
 * competitor row per handle that resolves; handles that error fall through to a
 * stub so a single private/typo account never sinks the snapshot.
 */
async function pullLiveCompetitors(graph, ourIgId, names) {
  const out = [];
  for (const raw of names) {
    const handle = String(raw).replace(/^@/, "").trim();
    if (!handle) continue;
    try {
      const res = await graph.get(`/${ourIgId}`, {
        fields: `business_discovery.username(${handle}){followers_count,media_count,media.limit(20){like_count,comments_count,timestamp,media_type}}`,
      });
      const bd = res.business_discovery || {};
      const media = bd.media?.data || [];
      out.push({ handle, platform: "instagram", followers: bd.followers_count || 0, ...benchmarkFromMedia(media, bd.followers_count) });
    } catch (e) {
      console.error(`business_discovery(${handle}) failed:`, e.message);
      out.push({ handle, platform: "instagram" });
    }
  }
  return out;
}

/**
 * Tagged mentions — the IG /tags edge. Structurally tagged-only: it returns
 * media in which the client's IG account was @-tagged and CANNOT return an
 * untagged post, which is exactly why the hashtag/web paths below exist.
 */
async function pullIgTags(graph, ourIgId) {
  const res = await graph.get(`/${ourIgId}/tags`, { fields: "id,caption,permalink,timestamp,username", limit: 25 });
  return (res.data || []).map((t) => ({
    platform: "instagram", tagged: true, text: t.caption || "",
    url: t.permalink, at: t.timestamp, author: t.username,
  }));
}

/**
 * UNTAGGED discovery on Instagram: IG Hashtag Search. Two hops per hashtag —
 * `/ig_hashtag_search` resolves the tag to an id, `/{id}/recent_media` returns
 * recent PUBLIC top-level posts carrying it. Coverage limits (documented in the
 * coverage row, not hidden): public accounts only, top-level media only, ~24h
 * recency, and 30 unique hashtags per IG user per rolling 7 days.
 */
async function pullIgHashtags(graph, ourIgId, hashtags) {
  const out = [];
  const errors = [];
  for (const tag of hashtags) {
    try {
      const found = await graph.get("/ig_hashtag_search", { user_id: ourIgId, q: tag });
      const id = found.data?.[0]?.id;
      if (!id) { errors.push(`#${tag}: not resolvable`); continue; }
      const media = await graph.get(`/${id}/recent_media`, {
        user_id: ourIgId,
        fields: "id,caption,permalink,timestamp,media_type,like_count,comments_count",
        limit: 25,
      });
      for (const m of media.data || []) {
        out.push({
          platform: "instagram", tagged: false, text: m.caption || "",
          url: m.permalink, at: m.timestamp, author: null, hashtag: tag,
        });
      }
    } catch (e) {
      errors.push(`#${tag}: ${e.message}`);
    }
  }
  return { rows: out, errors };
}

/**
 * UNTAGGED discovery on Facebook, as far as the API allows: comments on the
 * client's OWN Page posts. Facebook exposes no public keyword/mention search,
 * so this is the ceiling — a mention on a stranger's Page is unreachable.
 */
async function pullFbComments(graph, ourPageId) {
  const feed = await graph.get(`/${ourPageId}/feed`, {
    fields: "id,permalink_url,comments.limit(25){id,message,from,created_time}", limit: 15,
  });
  const out = [];
  for (const post of feed.data || []) {
    for (const cm of post.comments?.data || []) {
      out.push({
        platform: "facebook", tagged: false, text: cm.message || "",
        url: post.permalink_url || null, at: cm.created_time, author: cm.from?.name || null,
      });
    }
  }
  return out;
}

const coverage = [];
let competitors = capture.competitors || handles.map((h) => ({ handle: h, platform: "instagram" }));
const rawBySource = { ig_tags: [], ig_hashtag: [], fb_own_comments: [], web_search: [], capture: [] };

// Operator/3rd-party capture is always merged when present.
if (Array.isArray(capture.mentions) && capture.mentions.length) {
  rawBySource.capture = capture.mentions;
  coverage.push(coverageRow("capture", { status: "partial", mentions: capture.mentions.length, queried: "listening_capture.json" }));
} else {
  coverage.push(coverageRow("capture", { status: "skipped", reason: "no listening_capture.json supplied" }));
}

const tok = resolveToken("page", slug, { profile, require: false });
const canPullLive = !OFFLINE && Boolean(tok.token);

if (canPullLive && igId) {
  const graph = createGraph(tok.token);

  if (!capture.competitors && handles.length) {
    try {
      competitors = await pullLiveCompetitors(graph, igId, handles);
    } catch (e) { console.error("competitor benchmark failed, using stubs:", e.message); }
  }

  try {
    rawBySource.ig_tags = await pullIgTags(graph, igId);
    coverage.push(coverageRow("ig_tags", { status: "partial", mentions: rawBySource.ig_tags.length }));
  } catch (e) {
    console.error("IG /tags pull failed:", e.message);
    coverage.push(coverageRow("ig_tags", { status: "error", reason: e.message }));
  }

  if (has("--hashtag-search")) {
    if (!watchlist.hashtags.length) {
      coverage.push(coverageRow("ig_hashtag", { status: "skipped", reason: "no hashtags on the watchlist — add them with --add-hashtag" }));
    } else {
      const { rows, errors } = await pullIgHashtags(graph, igId, watchlist.hashtags);
      rawBySource.ig_hashtag = rows;
      coverage.push(coverageRow("ig_hashtag", {
        status: rows.length || !errors.length ? "partial" : "error",
        mentions: rows.length,
        queried: watchlist.hashtags.map((h) => `#${h}`).join(", "),
        reason: errors.length
          ? `${LISTENING_SOURCES.ig_hashtag.limitation}; failed: ${errors.join(" | ")}`
          : null,
      }));
    }
  } else {
    coverage.push(coverageRow("ig_hashtag", { status: "skipped", reason: "--hashtag-search not passed (it consumes the 30-hashtag/7-day IG quota)" }));
  }

  if (has("--fb-comments")) {
    if (!pageId) {
      coverage.push(coverageRow("fb_own_comments", { status: "unavailable", reason: "no accounts.facebook_page_id on the profile" }));
    } else {
      try {
        rawBySource.fb_own_comments = await pullFbComments(graph, pageId);
        coverage.push(coverageRow("fb_own_comments", { status: "partial", mentions: rawBySource.fb_own_comments.length }));
      } catch (e) {
        console.error("FB comment scan failed:", e.message);
        coverage.push(coverageRow("fb_own_comments", { status: "error", reason: e.message }));
      }
    }
  } else {
    coverage.push(coverageRow("fb_own_comments", { status: "skipped", reason: "--fb-comments not passed" }));
  }
} else {
  const reason = OFFLINE
    ? "SMOS_OFFLINE=1 — no live pull attempted"
    : !tok.token
      ? `no page token for ${slug} (${tok.tried?.join(", ") || "none tried"})`
      : "no accounts.instagram_business_id on the profile";
  if (!OFFLINE && !tok.token) console.error(`note: ${reason} — emitting competitor stubs (no live benchmark).`);
  for (const s of ["ig_tags", "ig_hashtag", "fb_own_comments"]) {
    coverage.push(coverageRow(s, { status: OFFLINE ? "skipped" : "unavailable", reason }));
  }
}

// Web search: key-gated untagged discovery over indexed public pages. Not a
// per-platform census, and it says so in its own coverage row.
if (has("--web-search")) {
  if (OFFLINE) {
    coverage.push(coverageRow("web_search", { status: "skipped", reason: "SMOS_OFFLINE=1" }));
  } else if (!webSearchAvailable()) {
    coverage.push(coverageRow("web_search", { status: "unavailable", reason: webSearchReason() }));
  } else {
    const queries = [...watchlist.brand_terms, ...watchlist.keywords].slice(0, 5);
    const rows = [];
    const failures = [];
    for (const q of queries) {
      const res = await searchWeb(q);
      if (!res.ok) { failures.push(`${q}: ${res.error}`); continue; }
      for (const r of res.results) {
        rows.push({ platform: "web", tagged: false, text: `${r.title || ""} ${r.content || ""}`.trim(), url: r.url, at: r.published_date, author: null });
      }
    }
    rawBySource.web_search = rows;
    // Every query failing means we learned nothing — that is `error`, not zero.
    if (failures.length === queries.length && queries.length) {
      coverage.push(coverageRow("web_search", { status: "error", reason: failures.join(" | ") }));
    } else {
      coverage.push(coverageRow("web_search", {
        status: "partial", mentions: rows.length, queried: queries.join(", "),
        reason: failures.length ? `${LISTENING_SOURCES.web_search.limitation}; failed: ${failures.join(" | ")}` : null,
      }));
    }
  }
} else {
  coverage.push(coverageRow("web_search", { status: "skipped", reason: "--web-search not passed" }));
}

// Platforms with no reachable listening API at all — present so their absence
// can never be read as zero mentions.
coverage.push(...noApiCoverage());

// ───────────────────── normalize + depth computations ─────────────────────

let mentions = dedupeMentions(
  Object.entries(rawBySource).flatMap(([source, rows]) =>
    (rows || []).map((r) => normalizeMention(r, { watchlist, source }))
  )
);

// Keep everything that is attributable to the client, plus anything that hit a
// watchlist term (a competitor/keyword mention is signal for share of voice).
const hitAnything = (m) => {
  const t = m.matched_terms || {};
  return m.about_client || (t.keywords?.length || t.hashtags?.length || t.competitors?.length);
};
const discarded = mentions.filter((m) => !hitAnything(m)).length;
mentions = mentions.filter(hitAnything);

// Sentiment (G8): this script never classifies text itself — the agent running
// /listening reads each new mention's text and drops its verdicts into
// listening_capture.json's `sentiment_judgments` (keyed by mention_id, or by
// url for pre-E5 capture files). Merge is fail-closed: anything not exactly
// positive/neutral/negative collapses to null, and an existing verdict is never
// overwritten.
if (capture.sentiment_judgments) {
  mentions = applySentiment(mentions, capture.sentiment_judgments, { idField: "mention_id" });
  mentions = applySentiment(mentions, capture.sentiment_judgments, { idField: "url" });
}

const totals = mentionTotal(coverage);
const sov = shareOfVoice({ mentions, coverage, watchlist });

// Time series + crisis. The baseline comes from the PRIOR points only; the
// current capture is appended after detection so it cannot inflate its own
// baseline. Volume is brand-attributable mentions — the thing a crisis is about.
const brandMentions = mentions.filter((m) => m.about_client).length;
const series = loadTimeseries(slug);
const capturedAt = new Date().toISOString();
const priorPoints = (series.points || []).filter((p) => p.captured_at !== capturedAt);
const crisis = detectCrisis({
  current: brandMentions,
  priorPoints,
  mentions,
  baselineWindow: Number(one("--baseline-window", 14)) || 14,
});
if (series.corrupt) {
  crisis.reasons = [...(crisis.reasons || []), "listening_timeseries.json was unreadable — treated as NO baseline, not a zero baseline"];
}

const snapshot = schema.normalize({
  client_slug: slug,
  captured_at: capturedAt,
  keywords: watchlist.keywords,
  hashtags: watchlist.hashtags,
  watchlist,
  mentions,
  competitors,
  coverage,
  mention_total: totals,
  share_of_voice: sov,
  crisis,
  discarded_unmatched: discarded,
});

const needsSentiment = pendingSentiment(snapshot.mentions, { idField: "mention_id" });
if (needsSentiment.length) {
  console.error(`[listening] ${needsSentiment.length} mention(s) still need a sentiment judgment — write mention_id→sentiment into clients/${slug}/listening_capture.json's sentiment_judgments and re-run (negative-skew crisis scoring is EXCLUDED, not zeroed, until then)`);
}

const v = schema.validate(snapshot);
if (!v.ok) { console.error("listening_snapshot INVALID:\n  - " + v.errors.join("\n  - ")); process.exit(4); }

writeFileSync(P.clientFile(slug, "listening_snapshot.json", { forWrite: true }), JSON.stringify(snapshot, null, 2));

if (!has("--no-timeseries")) {
  saveTimeseries(slug, appendTimeseries(series, {
    captured_at: capturedAt,
    mentions: brandMentions,
    all_matched_mentions: snapshot.mentions.length,
    untagged: snapshot.mentions.filter((m) => m.discovery === "untagged").length,
    classified: snapshot.mentions.filter((m) => m.sentiment != null).length,
    negative: snapshot.mentions.filter((m) => m.sentiment === "negative").length,
    sources_measured: coverage.filter((c) => c.mentions != null).map((c) => c.source),
    is_floor: totals.is_floor,
  }));
}

if (supabaseConfigured()) {
  try {
    const client_id = await clientIdBySlug(slug);
    await insert("listening_snapshots", [{ client_id, slug, captured_at: snapshot.captured_at, snapshot }]);
  } catch (e) { console.error("supabase persist skipped:", e.message); }
}

const sovLine = sov.status === "computed"
  ? `SoV ${sov.entities.find((e) => e.is_client)?.share_pct ?? "?"}%${sov.is_floor ? " (floor)" : ""} on ${sov.basis_platforms.join("+") || "—"}`
  : `SoV ${sov.status}`;
const crisisLine = crisis.severity == null ? `crisis ${crisis.status}` : `crisis ${crisis.severity}${crisis.severity_provisional ? " (provisional)" : ""}`;
console.log(
  `listening: ${snapshot.competitors.length} competitors · ${snapshot.mentions.length} matched mentions ` +
  `(${snapshot.mentions.filter((m) => m.discovery === "untagged").length} untagged, ${brandMentions} brand) · ` +
  `total ${totals.total ?? "unknown"}${totals.is_floor ? " (floor)" : ""} · ${sovLine} · ${crisisLine} → listening_snapshot.json`
);
