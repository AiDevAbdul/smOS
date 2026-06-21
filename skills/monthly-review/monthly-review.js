#!/usr/bin/env node
/**
 * /monthly-review companion script — 30-day strategic review.
 *
 * Pulls last 60d of insights from Meta, computes:
 *   - Trend regression per metric (improving / flat / declining)
 *   - Audience fatigue (frequency vs CTR curves)
 *   - Creative lifecycle (ramping / peak / declining / expired)
 *   - Audience cluster ranking (joins with audience_map.json)
 *   - Budget efficiency by placement / cluster / format
 *
 * Pass 7 (concrete recommendations) needs Claude to synthesize — script
 * emits the structured inputs and a stub recommendations skeleton.
 *
 * Usage:
 *   node skills/monthly-review/monthly-review.js <slug>
 *   node skills/monthly-review/monthly-review.js <slug> --days 30
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";
import { normalizeKpis } from "../../scripts/lib/metrics.js";
import { writeHtmlAndPdf } from "../../scripts/lib/md_to_html.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const DEFAULT_DAYS = 30;
// Frequency fatigue ceiling defaults to the constitution's 4.0 but is overridden
// per-client via normalizeKpis(profile).pause_frequency_ceiling.

function argVal(args, flag, fallback = null) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function daysAgoStr(n) {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function ymd(d) { return new Date(d).toISOString().slice(0, 10); }

// Linear regression slope on (x_idx, y) pairs
function slope(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function direction(s, ys) {
  const mean = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
  if (mean === 0) return "flat";
  const pctSlope = (s * ys.length) / mean;
  if (pctSlope > 0.05) return "improving";
  if (pctSlope < -0.05) return "declining";
  return "flat";
}

async function fetchDailyInsights(graph, adAccountId, days) {
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const params = {
    fields: "spend,impressions,clicks,ctr,cpm,frequency,actions,action_values,reach",
    time_range: JSON.stringify({ since: daysAgoStr(days), until: daysAgoStr(1) }),
    time_increment: 1,
    level: "account",
    limit: 500,
  };
  const res = await graph.get(`/${id}/insights`, params);
  return res.data || [];
}

async function fetchAdsetInsights(graph, adAccountId, days) {
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const res = await graph.get(`/${id}/insights`, {
    fields: "adset_id,adset_name,spend,impressions,clicks,ctr,cpm,frequency,actions,action_values",
    time_range: JSON.stringify({ since: daysAgoStr(days), until: daysAgoStr(1) }),
    level: "adset",
    limit: 500,
  });
  return res.data || [];
}

async function fetchAdInsights(graph, adAccountId, days) {
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const res = await graph.get(`/${id}/insights`, {
    fields: "ad_id,ad_name,spend,impressions,clicks,ctr,frequency",
    time_range: JSON.stringify({ since: daysAgoStr(days), until: daysAgoStr(1) }),
    time_increment: 1,
    level: "ad",
    limit: 500,
  });
  return res.data || [];
}

async function fetchPlacementBreakdown(graph, adAccountId, days) {
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  try {
    const res = await graph.get(`/${id}/insights`, {
      fields: "spend,impressions,clicks,ctr,cpm,actions",
      time_range: JSON.stringify({ since: daysAgoStr(days), until: daysAgoStr(1) }),
      breakdowns: "publisher_platform,platform_position",
      level: "account",
      limit: 100,
    });
    return res.data || [];
  } catch (e) {
    return [];
  }
}

function purchases(row) {
  const a = (row.actions || []).find((x) => /purchase|complete_registration|lead/.test(x.action_type));
  return a ? Number(a.value) : 0;
}

function purchaseValue(row) {
  const a = (row.action_values || []).find((x) => /purchase/.test(x.action_type));
  return a ? Number(a.value) : 0;
}

function trendAnalysis(daily) {
  const sorted = daily.slice().sort((a, b) => (a.date_start < b.date_start ? -1 : 1));
  const xs = sorted.map((_, i) => i);
  const metrics = {};
  const series = (key, calc) => sorted.map(calc);

  metrics.spend = series(null, (r) => Number(r.spend || 0));
  metrics.impressions = series(null, (r) => Number(r.impressions || 0));
  metrics.ctr = series(null, (r) => Number(r.ctr || 0));
  metrics.cpm = series(null, (r) => Number(r.cpm || 0));
  metrics.frequency = series(null, (r) => Number(r.frequency || 0));
  metrics.conversions = series(null, (r) => purchases(r));
  metrics.revenue = series(null, (r) => purchaseValue(r));
  metrics.roas = sorted.map((r, i) => {
    const spend = Number(r.spend || 0);
    return spend ? purchaseValue(r) / spend : 0;
  });
  metrics.cpa = sorted.map((r) => {
    const conv = purchases(r);
    return conv ? Number(r.spend || 0) / conv : 0;
  });

  const out = {};
  for (const [k, ys] of Object.entries(metrics)) {
    const s = slope(xs, ys);
    out[k] = {
      slope: Math.round(s * 1000) / 1000,
      direction: direction(s, ys),
      mean: Math.round((ys.reduce((a, b) => a + b, 0) / (ys.length || 1)) * 100) / 100,
      first_7d_avg: Math.round((ys.slice(0, 7).reduce((a, b) => a + b, 0) / 7) * 100) / 100,
      last_7d_avg: Math.round((ys.slice(-7).reduce((a, b) => a + b, 0) / 7) * 100) / 100,
    };
  }
  return out;
}

function fatigueByAdset(adsetRows, freqCeiling) {
  // Group by adset_id, get freq + ctr; flag rising freq + falling ctr is harder
  // without daily breakdown — use aggregate threshold heuristic.
  const byId = new Map();
  for (const r of adsetRows) {
    if (!byId.has(r.adset_id)) byId.set(r.adset_id, { adset_name: r.adset_name, freq: 0, ctr: 0 });
    byId.get(r.adset_id).freq = Math.max(byId.get(r.adset_id).freq, Number(r.frequency || 0));
    byId.get(r.adset_id).ctr = Number(r.ctr || 0);
  }
  return Array.from(byId.entries()).map(([id, v]) => ({
    adset_id: id,
    adset_name: v.adset_name,
    frequency: Math.round(v.freq * 100) / 100,
    ctr: v.ctr,
    fatigue: v.freq >= freqCeiling ? "saturated" : v.freq >= 3 ? "warming" : "ok",
    needs_refresh: v.freq >= freqCeiling,
  })).sort((a, b) => b.frequency - a.frequency);
}

function lifecycleByAd(adRows) {
  // Group ad daily rows by ad_id
  const byAd = new Map();
  for (const r of adRows) {
    if (!byAd.has(r.ad_id)) byAd.set(r.ad_id, { ad_name: r.ad_name, days: [] });
    byAd.get(r.ad_id).days.push({ date: r.date_start, ctr: Number(r.ctr || 0), spend: Number(r.spend || 0) });
  }
  const out = [];
  for (const [adId, data] of byAd) {
    const days = data.days.sort((a, b) => (a.date < b.date ? -1 : 1));
    if (days.length < 3) continue;
    let peakIdx = 0;
    for (let i = 1; i < days.length; i++) if (days[i].ctr > days[peakIdx].ctr) peakIdx = i;
    const peakCtr = days[peakIdx].ctr;
    const currentCtr = days[days.length - 1].ctr;
    const sincePeak = days.length - 1 - peakIdx;
    const pctOfPeak = peakCtr ? currentCtr / peakCtr : 0;
    let stage;
    if (days.length < 7) stage = "ramping";
    else if (sincePeak < 14 && pctOfPeak >= 0.8) stage = "peak";
    else if (pctOfPeak >= 0.6) stage = "declining";
    else stage = "expired";
    out.push({
      ad_id: adId,
      ad_name: data.ad_name,
      days_active: days.length,
      peak_ctr: Math.round(peakCtr * 1000) / 1000,
      current_ctr: Math.round(currentCtr * 1000) / 1000,
      pct_of_peak: Math.round(pctOfPeak * 100),
      days_since_peak: sincePeak,
      stage,
    });
  }
  return out.sort((a, b) => a.pct_of_peak - b.pct_of_peak);
}

function rankAdsets(adsetRows, audienceMap) {
  const byId = new Map();
  for (const r of adsetRows) {
    if (!byId.has(r.adset_id)) byId.set(r.adset_id, { adset_name: r.adset_name, spend: 0, conv: 0, value: 0, impressions: 0, clicks: 0 });
    const a = byId.get(r.adset_id);
    a.spend += Number(r.spend || 0);
    a.conv += purchases(r);
    a.value += purchaseValue(r);
    a.impressions += Number(r.impressions || 0);
    a.clicks += Number(r.clicks || 0);
  }
  const clusters = audienceMap?.interest_clusters || audienceMap?.clusters || [];
  const matchCluster = (name) => {
    const n = (name || "").toUpperCase();
    return clusters.find((c) => n.includes((c.id || "").toUpperCase()) || n.includes((c.label || "").toUpperCase()))?.label || null;
  };
  return Array.from(byId.entries()).map(([id, v]) => ({
    adset_id: id,
    adset_name: v.adset_name,
    cluster: matchCluster(v.adset_name),
    spend: Math.round(v.spend * 100) / 100,
    conversions: v.conv,
    roas: v.spend ? Math.round((v.value / v.spend) * 100) / 100 : 0,
    cpa: v.conv ? Math.round((v.spend / v.conv) * 100) / 100 : 0,
    ctr: v.impressions ? Math.round((v.clicks / v.impressions) * 10000) / 100 : 0,
  })).sort((a, b) => b.roas - a.roas);
}

function efficiencyByPlacement(placementRows) {
  return placementRows.map((r) => ({
    placement: `${r.publisher_platform}/${r.platform_position}`,
    spend: Math.round(Number(r.spend || 0) * 100) / 100,
    ctr: Number(r.ctr || 0),
    cpm: Number(r.cpm || 0),
    conversions: purchases(r),
    cpa: purchases(r) ? Math.round((Number(r.spend || 0) / purchases(r)) * 100) / 100 : null,
  })).sort((a, b) => (a.cpa ?? 9e9) - (b.cpa ?? 9e9));
}

async function main() {
  const argv = process.argv.slice(2);
  const slug = argv[0];
  if (!slug) {
    console.error("Usage: node skills/monthly-review/monthly-review.js <slug> [--days 30]");
    process.exit(1);
  }
  const days = parseInt(argVal(argv, "--days", String(DEFAULT_DAYS)), 10);

  const profilePath = resolve(ROOT, "clients", slug, "client_profile.json");
  if (!existsSync(profilePath)) throw new Error(`Profile not found: ${profilePath}`);
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const acct = profile.accounts || {};
  const adAccountId = acct.ad_account_id;
  if (!adAccountId || isTbd(adAccountId)) {
    throw new Error(`accounts.ad_account_id is TBD or missing — monthly-review needs live insights`);
  }

  const audienceMap = (() => {
    const p = resolve(ROOT, "clients", slug, "audience_map.json");
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  })();

  const graph = createGraph();
  console.error(`[monthly-review] fetching ${days}d insights for ${slug}…`);
  const [daily, adsets, ads, placements] = await Promise.all([
    fetchDailyInsights(graph, adAccountId, days),
    fetchAdsetInsights(graph, adAccountId, days),
    fetchAdInsights(graph, adAccountId, days),
    fetchPlacementBreakdown(graph, adAccountId, days),
  ]);

  const kpis = normalizeKpis(profile);
  const freqCeiling = kpis.pause_frequency_ceiling;
  const trends = trendAnalysis(daily);
  const fatigue = fatigueByAdset(adsets, freqCeiling);
  const lifecycle = lifecycleByAd(ads);
  const ranking = rankAdsets(adsets, audienceMap);
  const placementRanked = efficiencyByPlacement(placements);

  const refreshNeeded = lifecycle.filter((l) => l.stage === "declining" || l.stage === "expired");
  const fatigued = fatigue.filter((f) => f.needs_refresh);
  const topAdset = ranking[0];
  const worstAdset = ranking[ranking.length - 1];
  const topPlacement = placementRanked.find((p) => p.cpa != null);

  const recommendationsSkeleton = [
    fatigued.length ? { id: 1, action: `Refresh creative for ${fatigued.length} saturated adset(s)`, rationale: `frequency ≥ ${freqCeiling}`, impact: "reduce CPM drag", budget_delta: 0, owner: "creative" } : null,
    refreshNeeded.length ? { id: 2, action: `Replace ${refreshNeeded.length} declining/expired ads`, rationale: `current CTR < 60% of peak`, impact: "stabilize CTR, lower CPC", budget_delta: 0, owner: "creative" } : null,
    topAdset ? { id: 3, action: `Reallocate budget toward "${topAdset.adset_name}"`, rationale: `top ROAS ${topAdset.roas}`, impact: "lift account ROAS", budget_delta: "+20%", owner: "optimizer" } : null,
    worstAdset && worstAdset.spend > 50 ? { id: 4, action: `Pause "${worstAdset.adset_name}"`, rationale: `ROAS ${worstAdset.roas} after $${worstAdset.spend}`, impact: "free up budget", budget_delta: `-$${worstAdset.spend}`, owner: "optimizer" } : null,
    topPlacement ? { id: 5, action: `Bias placement mix toward ${topPlacement.placement}`, rationale: `lowest CPA $${topPlacement.cpa}`, impact: "compound efficiency", budget_delta: 0, owner: "human" } : null,
  ].filter(Boolean);

  const month = ymd(new Date(Date.now() - 86_400_000)).slice(0, 7);
  const reportsDir = resolve(ROOT, "clients", slug, "reports");
  mkdirSync(reportsDir, { recursive: true });

  const recPath = resolve(ROOT, "clients", slug, "strategy_recommendations.json");
  writeFileSync(recPath, JSON.stringify({
    client_slug: slug,
    month,
    generated_at: new Date().toISOString(),
    recommendations: recommendationsSkeleton,
    note: "Recommendations are heuristic-generated. Have Claude review + add qualitative actions before sending to client.",
  }, null, 2));

  const inputsPath = resolve(reportsDir, `${month}_monthly_inputs.json`);
  writeFileSync(inputsPath, JSON.stringify({
    client_slug: slug,
    month,
    days_window: days,
    trends,
    fatigue,
    lifecycle,
    adset_ranking: ranking,
    placement_ranking: placementRanked,
    counts: {
      daily_rows: daily.length,
      adsets: adsets.length,
      ads: ads.length,
      placements: placements.length,
    },
  }, null, 2));

  // Render markdown skeleton (Claude can elaborate)
  const mdPath = resolve(reportsDir, `${month}_monthly_review.md`);
  const md = renderMd({ slug, profile, month, days, trends, fatigue, lifecycle, ranking, placementRanked, recommendations: recommendationsSkeleton, daily });
  writeFileSync(mdPath, md);

  // Ship HTML + PDF alongside the markdown.
  const { htmlPath, pdfOk } = writeHtmlAndPdf(mdPath, md, {
    title: `${profile.name || slug} — Monthly Review`,
    subtitle: `${month} · ${days}-day window`,
  });
  console.error(`[monthly-review] wrote ${htmlPath}${pdfOk ? " + PDF" : " (PDF skipped)"}`);

  console.log(JSON.stringify({
    slug,
    month,
    days_window: days,
    inputs_path: inputsPath,
    review_md_path: mdPath,
    recommendations_path: recPath,
    counts: {
      daily_rows: daily.length,
      adsets_seen: ranking.length,
      ads_seen: lifecycle.length,
      placements: placementRanked.length,
    },
    fatigued_adsets: fatigued.length,
    refresh_needed_ads: refreshNeeded.length,
    top_adset: topAdset?.adset_name,
    worst_adset: worstAdset?.adset_name,
    next: "have Claude expand recommendations + the narrative in the .md, then render PDF via scripts/render_pdf.py",
  }, null, 2));
}

function renderMd({ slug, profile, month, days, trends, fatigue, lifecycle, ranking, placementRanked, recommendations, daily }) {
  const trendLine = (k, label) => {
    const t = trends[k]; if (!t) return "";
    return `- **${label}:** ${t.direction} · mean ${t.mean} · first 7d ${t.first_7d_avg} → last 7d ${t.last_7d_avg}`;
  };
  return `# Monthly Review — ${profile.name || slug}

**Month:** ${month}  ·  **Days analyzed:** ${days}  ·  **Daily rows:** ${daily.length}

## Trend snapshot

${trendLine("spend", "Spend")}
${trendLine("ctr", "CTR")}
${trendLine("cpm", "CPM")}
${trendLine("frequency", "Frequency")}
${trendLine("conversions", "Conversions")}
${trendLine("roas", "ROAS")}
${trendLine("cpa", "CPA")}

## Audience fatigue

${fatigue.length ? fatigue.slice(0, 10).map((f) => `- **${f.adset_name}** — freq ${f.frequency} · ctr ${f.ctr} · ${f.fatigue}${f.needs_refresh ? " · ⚠️ refresh" : ""}`).join("\n") : "_No adset rows in window._"}

## Creative lifecycle

| Ad | Days | Peak CTR | Current | % of peak | Stage |
|---|---|---|---|---|---|
${lifecycle.slice(0, 12).map((l) => `| ${l.ad_name || l.ad_id} | ${l.days_active} | ${l.peak_ctr} | ${l.current_ctr} | ${l.pct_of_peak}% | ${l.stage} |`).join("\n")}

## Adset ranking

| Adset | Cluster | Spend | Conv | ROAS | CPA | CTR |
|---|---|---|---|---|---|---|
${ranking.slice(0, 10).map((r) => `| ${r.adset_name} | ${r.cluster || "—"} | $${r.spend} | ${r.conversions} | ${r.roas} | $${r.cpa} | ${r.ctr}% |`).join("\n")}

## Placement efficiency

| Placement | Spend | CTR | CPM | CPA |
|---|---|---|---|---|
${placementRanked.slice(0, 10).map((p) => `| ${p.placement} | $${p.spend} | ${p.ctr}% | $${p.cpm} | ${p.cpa != null ? "$" + p.cpa : "—"} |`).join("\n")}

## Recommendations (heuristic — Claude to expand)

${recommendations.length ? recommendations.map((r) => `${r.id}. **${r.action}** — ${r.rationale}. Impact: ${r.impact}. Budget Δ: ${r.budget_delta}. Owner: ${r.owner}.`).join("\n") : "_No recommendations triggered by heuristics._"}

---
*Generated by smOS · raw inputs at \`reports/${month}_monthly_inputs.json\`. Run \`/before-after\` for the comparison block.*
`;
}

main().catch((e) => {
  console.error("[monthly-review] FATAL:", e.message);
  process.exit(1);
});
