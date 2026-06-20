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
  const profilePath = resolve(ROOT, "clients", slug, "client_profile.json");
  if (!existsSync(profilePath)) throw new Error(`Profile not found: ${profilePath}`);
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const acct = profile.accounts || {};

  const graph = createGraph();
  const pageId = acct.page_id || acct.facebook_page_id;
  const adAccountId = acct.ad_account_id;

  const [organic, ads] = await Promise.all([
    fetchOrganicPosts(graph, pageId),
    fetchAdCreatives(graph, adAccountId),
  ]);

  const all = [...organic, ...ads]
    .filter((a) => a.image_url) // status posts excluded
    .filter((a) => !a.created_at || daysAgo(a.created_at) <= MAX_AGE_DAYS);

  const restricted = [...(profile.voice?.restricted_words || []), ...(profile.voice?.avoid || [])].map((w) => String(w).toLowerCase());

  const enriched = all.map((a) => ({
    ...a,
    copy_length: (a.copy || "").length,
    restricted_word_hits: checkRestricted(a.copy, restricted),
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

  const outPath = resolve(ROOT, "clients", slug, "creative_assets.json");
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
  const s = a.vision_scores || {};
  if (s.visual_quality == null) return -1;
  let score = (s.visual_quality + s.brand_consistency + s.messaging_clarity) / 3;
  if (s.cta_present) score += 0.5;
  if (typeof s.text_density_pct === "number" && s.text_density_pct < TEXT_DENSITY_BEST) score += 0.5;
  return score;
}

function aggregate(slug) {
  const assetsPath = resolve(ROOT, "clients", slug, "creative_assets.json");
  if (!existsSync(assetsPath)) throw new Error(`Run collect first: ${assetsPath} not found`);
  const data = JSON.parse(readFileSync(assetsPath, "utf8"));
  const assets = data.assets || [];
  const scored = assets.filter((a) => a.vision_scores?.visual_quality != null);

  if (!scored.length) {
    throw new Error("No assets have vision_scores filled — have Claude run the batch prompts first");
  }

  const byFormat = (fmt) => scored.filter((a) => a.format === fmt);
  const formats = ["image", "video", "carousel"];
  const formatStats = Object.fromEntries(formats.map((f) => {
    const items = byFormat(f);
    return [f, {
      count: items.length,
      visual_quality: average(items, "visual_quality"),
      brand_consistency: average(items, "brand_consistency"),
      cta_present_pct: pctTrue(items, "cta_present"),
      text_density_compliant_pct: pctUnder(items, "text_density_pct", TEXT_DENSITY_BEST),
      messaging_clarity: average(items, "messaging_clarity"),
    }];
  }));

  const ranked = scored.map((a) => ({ ...a, _w: weightedScore(a) })).sort((a, b) => b._w - a._w);
  const top3 = ranked.slice(0, 3).map((a) => ({ asset_id: a.asset_id, permalink: a.permalink, weighted: Math.round(a._w * 10) / 10, notes: a.vision_scores.notes }));
  const bottom3 = ranked.slice(-3).reverse().map((a) => ({ asset_id: a.asset_id, permalink: a.permalink, weighted: Math.round(a._w * 10) / 10, notes: a.vision_scores.notes }));

  const overall = Math.round((average(scored, "visual_quality") + average(scored, "brand_consistency") + average(scored, "messaging_clarity")) / 3 * 10) / 10;
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
  const reportPath = resolve(ROOT, "clients", slug, "audit_report.md");
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
  const summaryPath = resolve(ROOT, "clients", slug, "creative_audit_summary.json");
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
