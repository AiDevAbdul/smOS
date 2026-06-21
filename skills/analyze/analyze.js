#!/usr/bin/env node
/**
 * /analyze companion script.
 *
 * Pulls 7/14/30-day insights for every active campaign/adset/ad in the client's
 * ad account, runs segmentation breakdowns on active adsets, classifies flags
 * against KPI thresholds, ranks winners/losers, and writes the result to
 * clients/<slug>/performance_analysis.json.
 *
 * Persistence to Supabase (daily_metrics, reports) is intentionally deferred —
 * call scripts/baseline-snapshot.js style helpers once schema is verified.
 *
 * Usage:
 *   node skills/analyze/analyze.js <client_slug> [--no-breakdowns]
 *
 * Reads:  clients/<slug>/client_profile.json
 * Writes: clients/<slug>/performance_analysis.json
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";
import { deriveMetrics, findAction, round, normalizeKpis } from "../../scripts/lib/metrics.js";
import { twoProportionZ, scaleSignificance } from "../../scripts/lib/stats.js";
import { opportunityScore } from "../../scripts/lib/opportunity.js";
import { insert as sbInsert, clientIdBySlug, supabaseConfigured } from "../../scripts/lib/supabase.js";
import { writeHtmlAndPdf } from "../../scripts/lib/md_to_html.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const INSIGHT_FIELDS = [
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "inline_link_clicks",
  "inline_link_click_ctr",
  "actions",
  "action_values",
  "cost_per_action_type",
  "purchase_roas",
].join(",");

const WINDOWS = ["last_7d", "last_14d", "last_30d"];

// KPI targets/thresholds come from the shared metrics lib so /analyze, /report,
// /monthly-review and /scale all read the same client targets (flat or nested).
function mergeKpis(profile) {
  return normalizeKpis(profile);
}

// deriveMetrics / findAction / round now come from scripts/lib/metrics.js (imported).

async function getInsightsAtWindow(graph, entityId, datePreset, breakdowns = null) {
  const params = { fields: INSIGHT_FIELDS, date_preset: datePreset };
  if (breakdowns) params.breakdowns = breakdowns;
  try {
    const res = await graph.get(`/${entityId}/insights`, params);
    return res.data || [];
  } catch (e) {
    return { error: e.message };
  }
}

async function pullEntityWindows(graph, entityId) {
  const out = {};
  await Promise.all(
    WINDOWS.map(async (w) => {
      const rows = await getInsightsAtWindow(graph, entityId, w);
      if (rows.error) {
        out[w] = { error: rows.error };
      } else {
        out[w] = deriveMetrics(rows[0] || {});
      }
    })
  );
  return out;
}

async function pullBreakdowns(graph, adsetId) {
  const [placement, ageGender, device] = await Promise.all([
    getInsightsAtWindow(graph, adsetId, "last_14d", "publisher_platform,platform_position"),
    getInsightsAtWindow(graph, adsetId, "last_14d", "age,gender"),
    getInsightsAtWindow(graph, adsetId, "last_14d", "device_platform"),
  ]);
  return {
    placement: placement.error ? { error: placement.error } : placement.map((r) => ({
      publisher_platform: r.publisher_platform,
      platform_position: r.platform_position,
      ...deriveMetrics(r),
    })),
    age_gender: ageGender.error ? { error: ageGender.error } : ageGender.map((r) => ({
      age: r.age,
      gender: r.gender,
      ...deriveMetrics(r),
    })),
    device: device.error ? { error: device.error } : device.map((r) => ({
      device_platform: r.device_platform,
      ...deriveMetrics(r),
    })),
  };
}

async function inBatches(items, size, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const got = await Promise.all(batch.map(fn));
    results.push(...got);
  }
  return results;
}

function classifyFlags(ad, adset, kpis) {
  const flags = [];
  const m7 = ad.metrics?.last_7d || {};
  const m30 = ad.metrics?.last_30d || {};
  const cpaTarget = kpis.cpa_target;

  if (m7.spend >= kpis.pause_cpa_min_spend && m7.cpa != null && m7.cpa > kpis.pause_cpa_multiplier * cpaTarget) {
    flags.push({
      flag: "PAUSE_CANDIDATE_CPA",
      metric: m7.cpa,
      threshold: kpis.pause_cpa_multiplier * cpaTarget,
      reasoning: `7d CPA ${m7.cpa} > ${kpis.pause_cpa_multiplier}× target (${cpaTarget}) after $${m7.spend} spend`,
    });
  }
  if (m7.spend >= kpis.pause_roas_min_spend && m7.roas != null && m7.roas < kpis.pause_roas_floor) {
    flags.push({
      flag: "PAUSE_CANDIDATE_ROAS",
      metric: m7.roas,
      threshold: kpis.pause_roas_floor,
      reasoning: `7d ROAS ${m7.roas} < ${kpis.pause_roas_floor} after $${m7.spend} spend`,
    });
  }
  if (m7.spend >= kpis.pause_ctr_min_spend && m7.link_ctr != null && m7.link_ctr < kpis.pause_ctr_floor) {
    flags.push({
      flag: "PAUSE_CANDIDATE_CTR",
      metric: m7.link_ctr,
      threshold: kpis.pause_ctr_floor,
      reasoning: `7d link CTR ${m7.link_ctr.toFixed(2)}% < ${kpis.pause_ctr_floor.toFixed(2)}% after $${m7.spend} spend`,
    });
  }
  if (m7.frequency > kpis.pause_frequency_ceiling) {
    flags.push({
      flag: "PAUSE_CANDIDATE_FREQUENCY",
      metric: m7.frequency,
      threshold: kpis.pause_frequency_ceiling,
      reasoning: `7d frequency ${m7.frequency} > ${kpis.pause_frequency_ceiling}`,
    });
  }
  // Creative fatigue: CTR_7d < 0.6 × CTR_30d AND frequency_7d > 3.0.
  // Significance gate: the CTR drop must be statistically real (two-proportion
  // z-test on clicks/impressions), not small-sample noise. Without it, an ad
  // with a handful of impressions could be "fatigued" purely by variance.
  if (m7.link_ctr != null && m30.link_ctr != null && m30.link_ctr > 0) {
    const decay = m7.link_ctr / m30.link_ctr;
    if (decay < kpis.fatigue_ctr_decay && m7.frequency > kpis.fatigue_frequency_min) {
      const sig = twoProportionZ(m7.link_clicks || 0, m7.impressions || 0, m30.link_clicks || 0, m30.impressions || 0);
      if (sig.significant) {
        flags.push({
          flag: "CREATIVE_FATIGUE",
          metric: round(decay, 3),
          threshold: kpis.fatigue_ctr_decay,
          significance: { z: round(sig.z, 2), test: "two_proportion_z_95" },
          reasoning: `7d CTR is ${Math.round(decay * 100)}% of 30d CTR at frequency ${m7.frequency} (z=${round(sig.z, 2)}, significant)`,
        });
      }
    }
  }
  // Anomaly: spend spike — 7d daily-average spend far above the 30d daily average.
  // Catches a runaway adset (CBO reallocation, bid change) between optimizer runs.
  {
    const daily7 = (m7.spend || 0) / 7;
    const daily30 = (m30.spend || 0) / 30;
    if (daily30 > 0 && daily7 >= kpis.spend_spike_min_daily && daily7 > kpis.spend_spike_multiplier * daily30) {
      flags.push({
        flag: "ANOMALY_spend_spike",
        metric: round(daily7 / daily30, 2),
        threshold: kpis.spend_spike_multiplier,
        reasoning: `7d daily spend $${round(daily7, 2)} is ${round(daily7 / daily30, 1)}× the 30d daily avg $${round(daily30, 2)} — runaway delivery`,
      });
    }
  }
  // Anomaly: active ad with zero impressions last 7d
  if (ad.status === "ACTIVE" && (m7.impressions || 0) === 0) {
    flags.push({
      flag: "ANOMALY_delivery_stall",
      metric: 0,
      threshold: 1,
      reasoning: "Active ad has zero impressions in last 7 days",
    });
  }
  // Anomaly: attribution gap — ROAS=0 but link clicks healthy
  if (m7.spend > 50 && (m7.link_clicks || 0) > 50 && (m7.roas == null || m7.roas === 0)) {
    flags.push({
      flag: "ANOMALY_attribution",
      metric: m7.roas ?? 0,
      threshold: 0.1,
      reasoning: `${m7.link_clicks} link clicks and $${m7.spend} spend but no attributed revenue — pixel gap suspected`,
    });
  }

  return flags.map((f) => ({
    entity_type: "ad",
    entity_id: ad.id,
    name: ad.name,
    campaign_id: ad.campaign_id,
    adset_id: ad.adset_id,
    ...f,
  }));
}

function classifyAdsetFlags(adset, kpis) {
  const flags = [];
  const m7 = adset.metrics?.last_7d || {};
  if (m7.spend >= kpis.pause_roas_min_spend && m7.roas != null && m7.roas >= kpis.scale_roas_floor) {
    // Significance gate: a ROAS win on a handful of conversions is luck, not a
    // signal to push budget. Only a sufficiently-sampled winner becomes an
    // auto-eligible SCALE_CANDIDATE; a thin one downgrades to a SCALE_WATCH flag
    // a human can review.
    const sig = scaleSignificance(m7.conversions, kpis.scale_min_conversions);
    flags.push({
      entity_type: "adset",
      entity_id: adset.id,
      name: adset.name,
      campaign_id: adset.campaign_id,
      flag: sig.significant ? "SCALE_CANDIDATE" : "SCALE_WATCH",
      metric: m7.roas,
      threshold: kpis.scale_roas_floor,
      significance: sig,
      reasoning: `7d ROAS ${m7.roas} ≥ ${kpis.scale_roas_floor} after $${m7.spend} spend — ${sig.note}`,
    });
  }
  return flags;
}

function rankWinnersLosers(ads, kpis) {
  const minSpend = 50;
  const eligible = ads.filter((a) => (a.metrics?.last_7d?.spend || 0) >= minSpend);

  const byRoas = [...eligible]
    .filter((a) => a.metrics.last_7d.roas != null)
    .sort((a, b) => b.metrics.last_7d.roas - a.metrics.last_7d.roas);
  const byCpa = [...eligible]
    .filter((a) => a.metrics.last_7d.cpa != null)
    .sort((a, b) => a.metrics.last_7d.cpa - b.metrics.last_7d.cpa);

  const slim = (a) => ({
    id: a.id,
    name: a.name,
    spend: a.metrics.last_7d.spend,
    roas: a.metrics.last_7d.roas,
    cpa: a.metrics.last_7d.cpa,
    ctr: a.metrics.last_7d.link_ctr,
  });

  return {
    top_roas: byRoas.slice(0, 5).map(slim),
    lowest_cpa: byCpa.slice(0, 5).map(slim),
    bottom_roas: byRoas.slice(-5).reverse().map(slim),
  };
}

function topSegments(breakdowns) {
  const highlights = [];
  for (const [dim, rows] of Object.entries(breakdowns || {})) {
    if (!Array.isArray(rows) || !rows.length) continue;
    const totalConv = rows.reduce((s, r) => s + (r.conversions || 0), 0);
    if (!totalConv) continue;
    const top = [...rows].sort((a, b) => (b.conversions || 0) - (a.conversions || 0))[0];
    const share = top.conversions / totalConv;
    if (share > 0.5) {
      highlights.push({
        dimension: dim,
        top_segment: { ...top },
        conversion_share: round(share, 3),
        recommendation: `Concentrate spend — ${dim} segment owns ${Math.round(share * 100)}% of conversions`,
      });
    }
  }
  return highlights;
}

function summarizeWindow(rows) {
  const totals = rows.reduce(
    (s, r) => {
      const m = r.metrics?.last_7d;
      if (!m) return s;
      s.spend += m.spend || 0;
      s.impressions += m.impressions || 0;
      s.clicks += m.clicks || 0;
      s.conversions += m.conversions || 0;
      s.conversion_value += m.conversion_value || 0;
      return s;
    },
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 }
  );
  totals.cpa = totals.conversions ? round(totals.spend / totals.conversions, 2) : null;
  totals.roas = totals.spend ? round(totals.conversion_value / totals.spend, 4) : null;
  totals.spend = round(totals.spend, 2);
  totals.conversion_value = round(totals.conversion_value, 2);
  return totals;
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) {
    console.error("Usage: node skills/analyze/analyze.js <slug> [--no-breakdowns]");
    process.exit(1);
  }
  const noBreakdowns = args.includes("--no-breakdowns");

  const profilePath = resolve(ROOT, "clients", slug, "client_profile.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const acct = profile.accounts || {};
  if (isTbd(acct.ad_account_id)) {
    console.error(`ad_account_id is TBD for ${slug} — cannot analyze.`);
    process.exit(3);
  }

  const kpis = mergeKpis(profile);
  const graph = createGraph();
  const act = graph.act(acct.ad_account_id);

  console.error(`[analyze] ${slug} — pulling active tree…`);
  const campaigns = await graph.paginate(
    `/${act}/campaigns`,
    {
      fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time",
      filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED"] }]),
      limit: 100,
    },
    500
  );

  // Restrict to entities that ran in last 30 days
  const relevantCampaigns = campaigns;
  console.error(`[analyze] ${relevantCampaigns.length} campaigns; fetching insights (3 windows)…`);

  const campaignRows = await inBatches(relevantCampaigns, 5, async (c) => ({
    id: c.id,
    name: c.name,
    status: c.effective_status,
    objective: c.objective,
    daily_budget: c.daily_budget ? +c.daily_budget / 100 : null,
    metrics: await pullEntityWindows(graph, c.id),
  }));

  // Adsets under each campaign
  console.error(`[analyze] fetching adsets…`);
  const adsetsByCampaign = {};
  await inBatches(relevantCampaigns, 5, async (c) => {
    try {
      const sets = await graph.paginate(
        `/${c.id}/adsets`,
        { fields: "id,name,status,effective_status,daily_budget,targeting", limit: 100 },
        200
      );
      adsetsByCampaign[c.id] = sets;
    } catch (e) {
      adsetsByCampaign[c.id] = [];
    }
  });

  const allAdsets = Object.entries(adsetsByCampaign).flatMap(([cid, sets]) =>
    sets.map((s) => ({ ...s, campaign_id: cid }))
  );

  console.error(`[analyze] ${allAdsets.length} adsets; fetching insights…`);
  const adsetRows = await inBatches(allAdsets, 5, async (s) => ({
    id: s.id,
    name: s.name,
    status: s.effective_status,
    campaign_id: s.campaign_id,
    daily_budget: s.daily_budget ? +s.daily_budget / 100 : null,
    metrics: await pullEntityWindows(graph, s.id),
    breakdowns:
      !noBreakdowns && s.effective_status === "ACTIVE" ? await pullBreakdowns(graph, s.id) : null,
  }));

  // Ads under each adset
  console.error(`[analyze] fetching ads…`);
  const adsByAdset = {};
  await inBatches(allAdsets, 5, async (s) => {
    try {
      const ads = await graph.paginate(
        `/${s.id}/ads`,
        { fields: "id,name,status,effective_status,creative", limit: 100 },
        200
      );
      adsByAdset[s.id] = ads;
    } catch (e) {
      adsByAdset[s.id] = [];
    }
  });

  const allAds = Object.entries(adsByAdset).flatMap(([sid, ads]) => {
    const parent = allAdsets.find((s) => s.id === sid);
    return ads.map((a) => ({ ...a, adset_id: sid, campaign_id: parent?.campaign_id }));
  });

  console.error(`[analyze] ${allAds.length} ads; fetching insights…`);
  const adRows = await inBatches(allAds, 5, async (a) => ({
    id: a.id,
    name: a.name,
    status: a.effective_status,
    adset_id: a.adset_id,
    campaign_id: a.campaign_id,
    metrics: await pullEntityWindows(graph, a.id),
  }));

  // Flag classification
  console.error(`[analyze] classifying flags…`);
  const flags = [];
  for (const ad of adRows) {
    const parentAdset = adsetRows.find((s) => s.id === ad.adset_id);
    flags.push(...classifyFlags(ad, parentAdset, kpis));
  }
  for (const adset of adsetRows) {
    flags.push(...classifyAdsetFlags(adset, kpis));
  }

  // Winners / losers / segment highlights
  const ranking = rankWinnersLosers(adRows, kpis);
  const segmentHighlights = adsetRows
    .filter((s) => s.breakdowns)
    .flatMap((s) => topSegments(s.breakdowns).map((h) => ({ adset_id: s.id, adset_name: s.name, ...h })));

  // Opportunity Score — one explainable number for unrealized upside in the account.
  const opportunity = opportunityScore({ adsets: adsetRows, ads: adRows, flags, kpis });

  const out = {
    slug,
    generated_at: new Date().toISOString(),
    ad_account_id: acct.ad_account_id,
    currency: profile.accounts?.currency || null,
    kpis_used: kpis,
    window_summary: {
      last_7d_totals: summarizeWindow(campaignRows),
    },
    by_campaign: campaignRows,
    by_adset: adsetRows,
    by_ad: adRows,
    flags,
    opportunity,
    winners: { top_roas: ranking.top_roas, lowest_cpa: ranking.lowest_cpa },
    losers: { bottom_roas: ranking.bottom_roas },
    segment_highlights: segmentHighlights,
  };

  const outPath = resolve(ROOT, "clients", slug, "performance_analysis.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.error(`[analyze] wrote ${outPath}`);

  // Client-facing HTML + PDF summary (constitution: every report ships both).
  try {
    const ws = out.window_summary?.last_7d_totals || {};
    const fc = flags.reduce((m, f) => ({ ...m, [f.flag]: (m[f.flag] || 0) + 1 }), {});
    const md = [
      `# Performance Analysis — ${profile.name || slug}`,
      ``,
      `_7-day window · ${campaignRows.length} campaigns · ${adsetRows.length} adsets · ${adRows.length} ads_`,
      ``,
      `## Opportunity Score: ${opportunity.score}/100`,
      ``,
      opportunity.recommendations.map((r) => `- ${r}`).join("\n"),
      ``,
      `## Last 7 days`,
      ``,
      `| Metric | Value |`,
      `|---|---|`,
      `| Spend | $${ws.spend ?? "—"} |`,
      `| ROAS | ${ws.roas ?? "—"} |`,
      `| CPA | ${ws.cpa ?? "—"} |`,
      `| Link CTR | ${ws.link_ctr ?? "—"}% |`,
      `| Conversions | ${ws.conversions ?? "—"} |`,
      ``,
      `## Flags (${flags.length})`,
      ``,
      Object.keys(fc).length ? Object.entries(fc).map(([k, v]) => `- **${k}**: ${v}`).join("\n") : "_No threshold breaches._",
      ``,
      `## Winners`,
      ``,
      (ranking.top_roas || []).slice(0, 5).map((w) => `- ${w.name || w.id} — ROAS ${w.metrics?.last_7d?.roas ?? "—"}`).join("\n") || "_None yet._",
    ].join("\n");
    const mdPath = resolve(ROOT, "clients", slug, "performance_analysis.md");
    writeFileSync(mdPath, md);
    const { pdfOk } = writeHtmlAndPdf(mdPath, md, { title: `${profile.name || slug} — Performance Analysis`, subtitle: "Last 7 days" });
    console.error(`[analyze] wrote ${mdPath} + HTML${pdfOk ? " + PDF" : " (PDF skipped)"}`);
  } catch (e) {
    console.error(`[analyze] report render skipped: ${e.message}`);
  }

  // H4 persistence (best-effort): write TRUE daily rows to daily_metrics so the
  // optimizer's 3-consecutive-day ROAS rule has data. No-op without Supabase env.
  if (supabaseConfigured()) {
    try {
      const clientId = await clientIdBySlug(slug);
      const rows = [];
      await inBatches(campaignRows, 5, async (c) => {
        const daily = await getInsightsAtWindow(graph, c.id, "last_7d");
        // re-pull with time_increment=1 for per-day granularity
        const perDay = await graph.get(`/${c.id}/insights`, { fields: INSIGHT_FIELDS, date_preset: "last_7d", time_increment: 1 }).catch(() => ({ data: [] }));
        for (const r of perDay.data || []) {
          const m = deriveMetrics(r);
          rows.push({
            client_id: clientId, campaign_id: c.id, date: r.date_start,
            spend: m.spend, impressions: m.impressions, clicks: m.clicks, ctr: m.ctr,
            cpc: m.cpc, cpm: m.cpm, conversions: m.conversions, cpa: m.cpa, roas: m.roas,
            frequency: m.frequency, reach: m.reach, raw_actions: r.actions || [],
          });
        }
      });
      if (rows.length) { await sbInsert("daily_metrics", rows); console.error(`[analyze] persisted ${rows.length} daily_metrics rows`); }
    } catch (e) {
      console.error(`[analyze] daily_metrics persistence skipped: ${e.message}`);
    }
  }

  // One-line summary to stdout (per SKILL.md Pass 6 step 4)
  const flagCounts = flags.reduce((m, f) => ({ ...m, [f.flag]: (m[f.flag] || 0) + 1 }), {});
  console.log(
    JSON.stringify(
      {
        slug,
        ads: adRows.length,
        adsets: adsetRows.length,
        campaigns: campaignRows.length,
        flags: flags.length,
        flag_counts: flagCounts,
        opportunity_score: opportunity.score,
        winners: ranking.top_roas.length,
        losers: ranking.bottom_roas.length,
        path: outPath,
        next: "run /scale to execute pause/scale recommendations",
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error("[analyze] FATAL:", e.message);
  process.exit(1);
});
