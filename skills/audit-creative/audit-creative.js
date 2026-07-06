#!/usr/bin/env node
/**
 * /audit-creative companion script — creative quality audit harness.
 *
 * Vision scoring requires Claude (multimodal). This script:
 *   - collect: gathers last 90d organic posts + ad creatives, builds a batched
 *              prompt-ready asset list. Output: clients/<slug>/creative_assets.json
 *              with vision_scores left blank for Claude to fill.
 *   - aggregate: reads filled scores back, computes per-format averages,
 *                identifies tops/bottoms, restricted-word violations, and
 *                updates audit_report.md by replacing {{CREATIVE_AUDIT_SECTION}}.
 *
 * Usage:
 *   node skills/audit-creative/audit-creative.js <slug> collect
 *   node skills/audit-creative/audit-creative.js <slug> aggregate
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";
import { computeVideoScore } from "../../scripts/lib/video_scoring.js";
import * as P from "../../scripts/lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const MAX_AGE_DAYS = 90;
const BATCH_SIZE = 6;
const TEXT_DENSITY_BEST = 20;

function daysAgo(iso) {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function classifyFormat(item) {
  if (item.attachments?.data?.[0]?.subattachments) return "carousel";
  if (item.attachments?.data?.[0]?.type === "video_inline" || item.video_id || item.source) return "video";
  if (item.image_url || item.full_picture || item.attachments?.data?.[0]?.media?.image) return "image";
  return "unknown";
}

async function fetchOrganicPosts(graph, pageId) {
  if (!pageId || isTbd(pageId)) return [];
  try {
    const res = await graph.get(`/${pageId}/posts`, {
      fields: "id,message,created_time,full_picture,permalink_url,attachments{type,media,subattachments}",
      limit: 50,
    });
    return (res.data || []).map((p) => ({
      asset_id: p.id,
      type: "organic",
      format: classifyFormat(p),
      image_url: p.full_picture || p.attachments?.data?.[0]?.media?.image?.src,
      permalink: p.permalink_url,
      copy: p.message || "",
      created_at: p.created_time,
    }));
  } catch (e) {
    console.error(`[audit-creative] organic fetch failed: ${e.message}`);
    return [];
  }
}

async function fetchAdCreatives(graph, adAccountId) {
  if (!adAccountId || isTbd(adAccountId)) return [];
  try {
    const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    const res = await graph.get(`/${id}/adcreatives`, {
      fields: "id,name,image_url,thumbnail_url,object_story_spec,effective_object_story_id,body,title",
      limit: 50,
    });
    return (res.data || []).map((c) => ({
      asset_id: c.id,
      type: "ad",
      format: c.object_story_spec?.video_data ? "video" : c.object_story_spec?.link_data?.child_attachments ? "carousel" : "image",
      image_url: c.image_url || c.thumbnail_url,
      copy: c.body || c.object_story_spec?.link_data?.message || c.title || "",
      created_at: null,
    }));
  } catch (e) {
    console.error(`[audit-creative] ad creative fetch failed: ${e.message}`);
    return [];
  }
}

// Sum a Meta "actions"-style array ([{action_type, value}, …]) to a number.
function sumActions(arr) {
  if (!Array.isArray(arr)) return null;
  return arr.reduce((s, a) => s + (Number(a.value) || 0), 0);
}

// B3: pull ad-level video-play metrics and key them by creative id, so video
// assets are scored on hook + retention (not their thumbnail). Best-effort — any
// failure returns an empty map and the skill falls back to thumbnail scoring.
async function fetchVideoInsights(graph, adAccountId) {
  if (!adAccountId || isTbd(adAccountId)) return {};
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  try {
    const res = await graph.get(`/${id}/ads`, {
      fields:
        "id,creative{id},insights.date_preset(last_30d){impressions,video_play_actions,video_thruplay_watched_actions,video_p75_watched_actions,video_p100_watched_actions,video_avg_time_watched_actions,video_30_sec_watched_actions}",
      limit: 100,
    });
    const byCreative = {};
    for (const ad of res.data || []) {
      const cid = ad.creative?.id;
      const ins = ad.insights?.data?.[0];
      if (!cid || !ins) continue;
      const m = {
        impressions: Number(ins.impressions) || null,
        video_plays: sumActions(ins.video_play_actions),
        thruplays: sumActions(ins.video_thruplay_watched_actions),
        // 3s views aren't a first-class field; thruplay is the closest hook proxy
        // Meta still returns, so use it as the 3s base when present.
        video_3s_views: sumActions(ins.video_play_actions),
        p75: sumActions(ins.video_p75_watched_actions),
        p100: sumActions(ins.video_p100_watched_actions),
        avg_time_watched_sec: sumActions(ins.video_avg_time_watched_actions),
      };
      // Accumulate across ads sharing a creative.
      const prev = byCreative[cid] || {};
      byCreative[cid] = Object.fromEntries(
        Object.keys(m).map((k) => [k, (prev[k] || 0) + (m[k] || 0)]),
      );
    }
    return byCreative;
  } catch (e) {
    console.error(`[audit-creative] video insights fetch failed: ${e.message}`);
    return {};
  }
}

function checkRestricted(copy, restricted) {
  const t = String(copy || "").toLowerCase();
  return restricted.filter((w) => {
    if (!w) return false;
    const re = new RegExp(`\\b${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return re.test(t);
  });
}

function buildBatches(assets) {
  const batches = [];
  for (let i = 0; i < assets.length; i += BATCH_SIZE) {
    batches.push(assets.slice(i, i + BATCH_SIZE));
  }
  return batches;
}

async function collect(slug) {
  const profilePath = P.clientFile(slug, "client_profile.json");
  if (!existsSync(profilePath)) throw new Error(`Profile not found: ${profilePath}`);
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const acct = profile.accounts || {};

  const graph = createGraph();
  const pageId = acct.page_id || acct.facebook_page_id;
  const adAccountId = acct.ad_account_id;

  const [organic, ads, videoInsights] = await Promise.all([
    fetchOrganicPosts(graph, pageId),
    fetchAdCreatives(graph, adAccountId),
    fetchVideoInsights(graph, adAccountId),
  ]);

  const all = [...organic, ...ads]
    // Keep videos even without a thumbnail (image_url) — they're scored on
    // retention, not the still. Other formats still require an image.
    .filter((a) => a.image_url || a.format === "video")
    .filter((a) => !a.created_at || daysAgo(a.created_at) <= MAX_AGE_DAYS);

  const restricted = [...(profile.voice?.restricted_words || []), ...(profile.voice?.avoid || [])].map((w) => String(w).toLowerCase());

  const enriched = all.map((a) => ({
    ...a,
    copy_length: (a.copy || "").length,
    restricted_word_hits: checkRestricted(a.copy, restricted),
    // B3: videos carry a hook+retention score from play metrics (null until
    // metrics exist); images/carousels stay on the thumbnail vision-scorer.
    video_score: a.format === "video" && videoInsights[a.asset_id]
      ? computeVideoScore(videoInsights[a.asset_id])
      : null,
    vision_scores: {
      visual_quality: null,
      brand_consistency: null,
      cta_present: null,
      text_density_pct: null,
      messaging_clarity: null,
      notes: null,
    },
  }));

  const batches = buildBatches(enriched);

  const out = {
    client_slug: slug,
    generated_at: new Date().toISOString(),
    brand_colors: profile.assets?.brand_colors || profile.voice?.brand_colors || [],
    restricted_words: restricted,
    asset_count: enriched.length,
    organic_count: enriched.filter((a) => a.type === "organic").length,
    ad_count: enriched.filter((a) => a.type === "ad").length,
    batches: batches.map((b, i) => ({
      batch_id: i,
      asset_ids: b.map((a) => a.asset_id),
      vision_prompt: buildVisionPrompt(b, profile),
    })),
    assets: enriched,
    instructions: "For each batch, send the vision_prompt + the batch's image URLs to Claude. Claude returns a JSON array; merge each result into assets[].vision_scores. Then run: node skills/audit-creative/audit-creative.js " + slug + " aggregate",
  };

  const outPath = P.clientFile(slug, "creative_assets.json", { forWrite: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log(JSON.stringify({
    slug,
    mode: "collect",
    asset_count: out.asset_count,
    organic: out.organic_count,
    ads: out.ad_count,
    batches: batches.length,
    output: outPath,
    next: "have Claude fill assets[].vision_scores per the batch prompts, then run aggregate",
  }, null, 2));
}

function buildVisionPrompt(batch, profile) {
  const brand = (profile.assets?.brand_colors || []).join(", ") || "not specified";
  const restricted = [...(profile.voice?.restricted_words || []), ...(profile.voice?.avoid || [])].join(", ") || "none";
  return `For each image in this batch, score on:
1. visual_quality (1-10): composition, clarity, lighting, production value
2. brand_consistency (1-10): does it match brand colors ${brand}?
3. cta_present (true/false): clear call-to-action visible?
4. text_density_pct (0-100): % of image covered by overlaid text
5. messaging_clarity (1-10): is the value prop legible at thumbnail size?
6. notes (string, <140 chars): one-line observation

Restricted words to flag if visible: ${restricted}
Return JSON array, one object per image, in the same order as provided. asset_ids: ${batch.map((a) => a.asset_id).join(", ")}`;
}

function average(arr, key) {
  const vals = arr.map((a) => a.vision_scores?.[key]).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
}

function pctTrue(arr, key) {
  const vals = arr.map((a) => a.vision_scores?.[key]).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return null;
  return Math.round((vals.filter((v) => v === true).length / vals.length) * 100);
}

function pctUnder(arr, key, threshold) {
  const vals = arr.map((a) => a.vision_scores?.[key]).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return Math.round((vals.filter((v) => v < threshold).length / vals.length) * 100);
}

function weightedScore(a) {
  // B3: rank videos by their hook+retention score (1–10), NOT their thumbnail.
  if (a.format === "video" && a.video_score?.score != null) {
    return a.video_score.score;
  }
  const s = a.vision_scores || {};
  if (s.visual_quality == null) return -1;
  let score = (s.visual_quality + s.brand_consistency + s.messaging_clarity) / 3;
  if (s.cta_present) score += 0.5;
  if (typeof s.text_density_pct === "number" && s.text_density_pct < TEXT_DENSITY_BEST) score += 0.5;
  return score;
}

function avgVideoMetric(items, key) {
  const vals = items.map((a) => a.video_score?.[key]).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
}

function aggregate(slug) {
  const assetsPath = P.clientFile(slug, "creative_assets.json");
  if (!existsSync(assetsPath)) throw new Error(`Run collect first: ${assetsPath} not found`);
  const data = JSON.parse(readFileSync(assetsPath, "utf8"));
  const assets = data.assets || [];
  // An asset counts as "scored" if Claude filled its vision_scores OR (for video)
  // it carries a hook+retention score from play metrics.
  const scored = assets.filter(
    (a) => a.vision_scores?.visual_quality != null || a.video_score?.score != null,
  );

  if (!scored.length) {
    throw new Error("No assets scored — fill vision_scores (images) or supply video metrics (collect)");
  }

  const byFormat = (fmt) => scored.filter((a) => a.format === fmt);
  const formats = ["image", "video", "carousel"];
  const formatStats = Object.fromEntries(formats.map((f) => {
    const items = byFormat(f);
    const base = {
      count: items.length,
      visual_quality: average(items, "visual_quality"),
      brand_consistency: average(items, "brand_consistency"),
      cta_present_pct: pctTrue(items, "cta_present"),
      text_density_compliant_pct: pctUnder(items, "text_density_pct", TEXT_DENSITY_BEST),
      messaging_clarity: average(items, "messaging_clarity"),
    };
    // B3: videos get hook + retention rollups instead of thumbnail-only stats.
    if (f === "video") {
      base.avg_retention_score = avgVideoMetric(items, "score");
      base.avg_hook_rate_pct = avgVideoMetric(items, "hook_rate");
      base.avg_hold_rate_pct = avgVideoMetric(items, "hold_rate");
      base.avg_completion_pct = avgVideoMetric(items, "completion_rate");
    }
    return [f, base];
  }));

  const ranked = scored.map((a) => ({ ...a, _w: weightedScore(a) })).sort((a, b) => b._w - a._w);
  const top3 = ranked.slice(0, 3).map((a) => ({ asset_id: a.asset_id, permalink: a.permalink, weighted: Math.round(a._w * 10) / 10, notes: a.vision_scores.notes }));
  const bottom3 = ranked.slice(-3).reverse().map((a) => ({ asset_id: a.asset_id, permalink: a.permalink, weighted: Math.round(a._w * 10) / 10, notes: a.vision_scores.notes }));

  // Overall health: average the three vision metrics across thumbnail-scored
  // assets; if the account is video-only, fall back to the avg retention score.
  const visionScored = scored.filter((a) => a.vision_scores?.visual_quality != null);
  const overall = visionScored.length
    ? Math.round((average(visionScored, "visual_quality") + average(visionScored, "brand_consistency") + average(visionScored, "messaging_clarity")) / 3 * 10) / 10
    : (avgVideoMetric(scored, "score") ?? 0);
  const violations = scored.filter((a) => a.restricted_word_hits?.length).map((a) => ({ asset_id: a.asset_id, hits: a.restricted_word_hits }));

  const md = renderSection({
    n: scored.length,
    organic_n: scored.filter((a) => a.type === "organic").length,
    ad_n: scored.filter((a) => a.type === "ad").length,
    overall,
    formatStats,
    top3,
    bottom3,
    violations,
  });

  // Patch audit_report.md
  const reportPath = P.clientFile(slug, "audit_report.md");
  let patched = false;
  if (existsSync(reportPath)) {
    const original = readFileSync(reportPath, "utf8");
    if (original.includes("{{CREATIVE_AUDIT_SECTION}}")) {
      writeFileSync(reportPath, original.replace("{{CREATIVE_AUDIT_SECTION}}", md));
      patched = true;
    } else {
      // Append if slot missing
      writeFileSync(reportPath, original + "\n\n" + md);
      patched = true;
    }
  }

  // Also write a standalone JSON summary
  const summaryPath = P.clientFile(slug, "creative_audit_summary.json", { forWrite: true });
  writeFileSync(summaryPath, JSON.stringify({
    client_slug: slug,
    generated_at: new Date().toISOString(),
    overall_score: overall,
    formats: formatStats,
    top3, bottom3, violations,
    scored_count: scored.length,
    total_count: assets.length,
  }, null, 2));

  console.log(JSON.stringify({
    slug,
    mode: "aggregate",
    overall_score: overall,
    scored: scored.length,
    total: assets.length,
    top_pick: top3[0]?.asset_id,
    worst_pick: bottom3[0]?.asset_id,
    violation_count: violations.length,
    audit_report_patched: patched,
    summary_path: summaryPath,
  }, null, 2));
}

// B3: video hook+retention rollup (only when we have video metrics).
function videoRetentionBlock(v) {
  if (!v || v.avg_retention_score == null) return "";
  return `
**Video hook & retention** (scored on play metrics, not thumbnail):
- Avg retention score: ${v.avg_retention_score}/10
- Avg hook rate (3s): ${v.avg_hook_rate_pct ?? "—"}% · hold rate (p75): ${v.avg_hold_rate_pct ?? "—"}% · completion: ${v.avg_completion_pct ?? "—"}%
`;
}

function renderSection({ n, organic_n, ad_n, overall, formatStats, top3, bottom3, violations }) {
  const row = (f) => `| ${f} | ${formatStats[f.toLowerCase()].visual_quality ?? "—"} | ${formatStats[f.toLowerCase()].brand_consistency ?? "—"} | ${formatStats[f.toLowerCase()].cta_present_pct ?? "—"}% | ${formatStats[f.toLowerCase()].text_density_compliant_pct ?? "—"}% | ${formatStats[f.toLowerCase()].messaging_clarity ?? "—"} |`;
  return `### Creative Audit

**Assets scored:** ${n} (${organic_n} organic, ${ad_n} ads)
**Overall creative health score:** ${overall}/10

| Format | Visual quality | Brand consistency | CTA presence | Text density compliant | Messaging clarity |
|---|---|---|---|---|---|
${row("Image")}
${row("Video")}
${row("Carousel")}
${videoRetentionBlock(formatStats.video)}
**Top 3 best performers:**
${top3.map((a, i) => `${i + 1}. ${a.permalink || a.asset_id} — ${a.notes || ""} (weighted ${a.weighted})`).join("\n")}

**Top 3 worst performers (replace):**
${bottom3.map((a, i) => `${i + 1}. ${a.permalink || a.asset_id} — ${a.notes || ""} (weighted ${a.weighted})`).join("\n")}

**Brand voice violations:** ${violations.length ? violations.map((v) => `${v.asset_id} → ${v.hits.join(", ")}`).join("; ") : "none"}
`;
}

async function main() {
  const [slug, mode] = process.argv.slice(2);
  if (!slug || !mode) {
    console.error("Usage: node skills/audit-creative/audit-creative.js <slug> <collect|aggregate>");
    process.exit(1);
  }
  if (mode === "collect") await collect(slug);
  else if (mode === "aggregate") aggregate(slug);
  else throw new Error(`Unknown mode: ${mode}`);
}

main().catch((e) => {
  console.error("[audit-creative] FATAL:", e.message);
  process.exit(1);
});
