#!/usr/bin/env node
/**
 * /auditor companion script (G13) — monthly structural-health agent.
 *
 * Implements the 8-step loop documented in agents/auditor.md against the
 * guarded Meta chokepoint: naming drift, audience overlap, creative fatigue
 * curves, pixel completeness, budget allocation efficiency, and zombie
 * campaigns. Never mutates anything — every check is read-only; pause/scale
 * decisions stay with /optimizer, targeting/audience changes stay with a human.
 *
 * Usage:
 *   node skills/auditor/auditor.js <client_slug>
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";
import { checkNaming } from "../../scripts/lib/guards.js";
import { deriveMetrics, normalizeKpis } from "../../scripts/lib/metrics.js";
import * as P from "../../scripts/lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const OVERLAP_FLAG_PCT = 40; // > 40% overlap cannibalizes spend (agents/auditor.md Step 3)
const FATIGUE_MIN_DAYS = 14;
const FATIGUE_CTR_RATIO = 0.6; // fatigued when CTR_7d < 0.6 × CTR_30d
const FATIGUE_FREQ_MIN = 4.0;
const ZOMBIE_LOOKBACK_DAYS = 7;
const BUDGET_MISALLOC_ROAS_QUARTILE = 0.25; // bottom quartile by ROAS
const BUDGET_MISALLOC_SPEND_SHARE = 0.10; // still holding > 10% of total spend

function round(n, d) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// ---------- Step 2: naming drift ----------
// Reuses the exact regex the naming-check hook enforces at create time, so a
// pre-hook leftover or an import is flagged the same way a live create would be.
function auditNaming(campaigns, adsets, ads) {
  const violations = [];
  for (const c of campaigns) {
    const r = checkNaming("create_campaign", { name: c.name });
    if (!r.ok) violations.push({ level: "campaign", id: c.id, name: c.name, reason: r.reason });
  }
  for (const a of adsets) {
    const r = checkNaming("create_adset", { name: a.name });
    if (!r.ok) violations.push({ level: "adset", id: a.id, name: a.name, reason: r.reason });
  }
  for (const a of ads) {
    const r = checkNaming("create_ad", { name: a.name });
    if (!r.ok) violations.push({ level: "ad", id: a.id, name: a.name, reason: r.reason });
  }
  return violations;
}

// ---------- Step 3: audience overlap ----------
async function auditAudienceOverlap(graph, adAccountId, activeAdsets) {
  // Only adsets with a resolved custom-audience id can be checked pairwise —
  // interest-only/broad adsets have no audience_id to overlap against.
  const withAudience = activeAdsets.filter((a) => a.audience_id);
  const pairs = [];
  for (let i = 0; i < withAudience.length; i++) {
    for (let j = i + 1; j < withAudience.length; j++) {
      pairs.push([withAudience[i], withAudience[j]]);
    }
  }
  const flagged = [];
  for (const [a, b] of pairs) {
    try {
      const res = await graph.get(`/${graph.act(adAccountId)}/audienceoverlap`, {
        audiences: JSON.stringify([{ id: a.audience_id }, { id: b.audience_id }]),
        fields: "overlap_estimate",
      });
      const pct = +(res.overlap_estimate ?? res.data?.[0]?.overlap_estimate ?? 0) * 100;
      if (pct > OVERLAP_FLAG_PCT) {
        flagged.push({ adset_a: a.id, adset_b: b.id, overlap_pct: round(pct, 1) });
      }
    } catch (e) {
      flagged.push({ adset_a: a.id, adset_b: b.id, error: e.message });
    }
  }
  return flagged;
}

// ---------- Step 4: creative fatigue curves ----------
function auditFatigue(ads, insightsByAd) {
  const fatigued = [];
  for (const ad of ads) {
    const ins = insightsByAd.get(ad.id);
    if (!ins || ins.days_active < FATIGUE_MIN_DAYS) continue;
    const isFatigued = (ins.ctr_7d != null && ins.ctr_30d && ins.ctr_7d < FATIGUE_CTR_RATIO * ins.ctr_30d)
      || (ins.frequency_7d != null && ins.frequency_7d > FATIGUE_FREQ_MIN);
    if (isFatigued) {
      fatigued.push({ id: ad.id, name: ad.name, ctr_7d: ins.ctr_7d, ctr_30d: ins.ctr_30d, frequency_7d: ins.frequency_7d, days_active: ins.days_active });
    }
  }
  return fatigued;
}

// ---------- Step 5: pixel completeness ----------
async function auditPixel(graph, pixelId, expectedEvents) {
  if (isTbd(pixelId)) return { checked: false, reason: "pixel_id is TBD", missing_events: expectedEvents };
  try {
    const stats = await graph.get(`/${pixelId}/stats`, { aggregation: "event" });
    const seen = new Set((stats.data || []).map((r) => r.event));
    const missing = expectedEvents.filter((e) => !seen.has(e));
    return { checked: true, missing_events: missing };
  } catch (e) {
    return { checked: false, reason: e.message, missing_events: expectedEvents };
  }
}

// ---------- Step 6: budget allocation efficiency ----------
function auditBudgetAllocation(adsetSpend) {
  const withSpend = adsetSpend.filter((a) => a.spend_30d > 0);
  if (withSpend.length < 4) return []; // quartiles are meaningless below this
  const totalSpend = withSpend.reduce((s, a) => s + a.spend_30d, 0);
  const sortedByRoas = [...withSpend].sort((a, b) => (a.roas ?? -Infinity) - (b.roas ?? -Infinity));
  const quartileCount = Math.max(1, Math.floor(sortedByRoas.length * BUDGET_MISALLOC_ROAS_QUARTILE));
  const bottomQuartile = new Set(sortedByRoas.slice(0, quartileCount).map((a) => a.id));
  return withSpend
    .filter((a) => bottomQuartile.has(a.id) && a.spend_30d / totalSpend > BUDGET_MISALLOC_SPEND_SHARE)
    .map((a) => ({ id: a.id, name: a.name, roas: a.roas, spend_share_pct: round((a.spend_30d / totalSpend) * 100, 1) }));
}

// ---------- Step 7: zombie campaigns ----------
function auditZombies(campaigns, insightsByCampaign) {
  return campaigns
    .filter((c) => c.status === "ACTIVE" || c.effective_status === "ACTIVE")
    .filter((c) => (insightsByCampaign.get(c.id)?.impressions_7d ?? 0) === 0)
    .map((c) => ({ id: c.id, name: c.name }));
}

// ---------- Step 8: score ----------
function computeScore({ naming, overlap, fatigue, pixel, budget, zombies }) {
  let score = 100;
  score -= naming.length * 5;
  score -= overlap.length * 10;
  score -= fatigue.length * 3;
  score -= (pixel.missing_events?.length || 0) * 15;
  score -= budget.length * 8;
  score -= zombies.length * 10;
  return Math.max(0, round(score, 0));
}

async function fetchAdInsights7d30d(graph, adId) {
  try {
    const [d7, d30] = await Promise.all([
      graph.get(`/${adId}/insights`, { fields: "impressions,inline_link_click_ctr,frequency", date_preset: "last_7d" }),
      graph.get(`/${adId}/insights`, { fields: "inline_link_click_ctr", date_preset: "last_30d" }),
    ]);
    const r7 = d7.data?.[0] || {};
    const r30 = d30.data?.[0] || {};
    const daysActive = (await graph.get(`/${adId}/insights`, { fields: "impressions", date_preset: "last_30d", time_increment: 1 })).data?.filter((r) => +r.impressions > 0).length || 0;
    return {
      ctr_7d: r7.inline_link_click_ctr != null ? +r7.inline_link_click_ctr : null,
      ctr_30d: r30.inline_link_click_ctr != null ? +r30.inline_link_click_ctr : null,
      frequency_7d: r7.frequency != null ? +r7.frequency : null,
      days_active: daysActive,
    };
  } catch {
    return null;
  }
}

async function fetchCampaignImpressions7d(graph, campaignId) {
  try {
    const res = await graph.get(`/${campaignId}/insights`, { fields: "impressions", date_preset: "last_7d" });
    return +(res.data?.[0]?.impressions || 0);
  } catch {
    return null;
  }
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: node skills/auditor/auditor.js <slug>");
    process.exit(1);
  }

  const profilePath = P.clientFile(slug, "client_profile.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const acct = profile.accounts || {};
  if (isTbd(acct.ad_account_id)) {
    console.error(`ad_account_id is TBD for ${slug} — nothing to audit yet.`);
    process.exit(3);
  }

  const graph = createGraph();
  const actId = acct.ad_account_id;

  console.error(`[auditor] ${slug} — pulling structure…`);
  const campaigns = await graph.paginate(`/${graph.act(actId)}/campaigns`, {
    fields: "id,name,status,effective_status", limit: 100,
  }, 1000);

  const adsets = (await Promise.all(campaigns.map((c) =>
    graph.get(`/${c.id}/adsets`, { fields: "id,name,status,effective_status,targeting" }).catch(() => ({ data: [] }))
  ))).flatMap((r) => r.data || []).map((a) => ({
    ...a,
    audience_id: a.targeting?.custom_audiences?.[0]?.id || null,
  }));

  const ads = (await Promise.all(adsets.map((a) =>
    graph.get(`/${a.id}/ads`, { fields: "id,name,status,effective_status,adset_id,campaign_id" }).catch(() => ({ data: [] }))
  ))).flatMap((r) => r.data || []);

  console.error(`[auditor] ${campaigns.length} campaigns, ${adsets.length} adsets, ${ads.length} ads — running checks…`);

  const naming = auditNaming(campaigns, adsets, ads);

  const activeAdsets = adsets.filter((a) => a.status === "ACTIVE" || a.effective_status === "ACTIVE");
  const overlap = await auditAudienceOverlap(graph, actId, activeAdsets);

  const eligibleAds = ads.filter((a) => a.status === "ACTIVE" || a.effective_status === "ACTIVE");
  const insightsByAd = new Map();
  for (const ad of eligibleAds) {
    const ins = await fetchAdInsights7d30d(graph, ad.id);
    if (ins) insightsByAd.set(ad.id, ins);
  }
  const fatigue = auditFatigue(eligibleAds, insightsByAd);

  const kpis = normalizeKpis(profile);
  const expectedEvents = profile.conversion_events || ["PageView", "Lead", "Purchase"];
  const pixel = await auditPixel(graph, acct.pixel_id, expectedEvents);

  const adsetSpend = [];
  for (const a of activeAdsets) {
    try {
      const res = await graph.get(`/${a.id}/insights`, { fields: "spend,purchase_roas,action_values", date_preset: "last_30d" });
      const row = res.data?.[0];
      if (row) adsetSpend.push({ id: a.id, name: a.name, spend_30d: +row.spend || 0, roas: deriveMetrics(row).roas });
    } catch { /* skip — reported spend for this adset stays unknown, never fabricated */ }
  }
  const budget = auditBudgetAllocation(adsetSpend);

  const insightsByCampaign = new Map();
  for (const c of campaigns) {
    const imp = await fetchCampaignImpressions7d(graph, c.id);
    if (imp != null) insightsByCampaign.set(c.id, { impressions_7d: imp });
  }
  const zombies = auditZombies(campaigns, insightsByCampaign);

  const summary = {
    score: computeScore({ naming, overlap, fatigue, pixel, budget, zombies }),
    headline_issues: [
      naming.length && `${naming.length} naming violation(s)`,
      overlap.length && `${overlap.length} audience-overlap pair(s) > ${OVERLAP_FLAG_PCT}%`,
      fatigue.length && `${fatigue.length} fatigued ad(s)`,
      pixel.missing_events?.length && `${pixel.missing_events.length} pixel event(s) missing`,
      budget.length && `${budget.length} misallocated adset(s)`,
      zombies.length && `${zombies.length} zombie campaign(s)`,
    ].filter(Boolean),
  };

  const report = {
    slug,
    generated_at: new Date().toISOString(),
    ad_account_id: actId,
    kpis_used: kpis,
    naming_violations: naming,
    audience_overlap_pairs: overlap,
    fatigued_ads: fatigue,
    pixel_gaps: pixel,
    budget_misallocations: budget,
    zombie_campaigns: zombies,
    summary,
  };

  const outPath = P.clientFile(slug, "monthly_health_report.json", { forWrite: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.error(`[auditor] wrote ${outPath}`);

  console.log(JSON.stringify({
    slug, score: summary.score, headline_issues: summary.headline_issues, path: outPath,
  }, null, 2));
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((e) => {
    console.error("[auditor] FATAL:", e.message);
    process.exit(1);
  });
}

export {
  auditNaming, auditAudienceOverlap, auditFatigue, auditPixel,
  auditBudgetAllocation, auditZombies, computeScore,
};
