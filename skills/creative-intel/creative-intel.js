#!/usr/bin/env node
/**
 * /creative-intel companion script.
 *
 * Per-ad creative fatigue detection over a 30-day window.
 *
 * Usage:
 *   node skills/creative-intel/creative-intel.js <client_slug> [--window 30]
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const DEFAULT_WINDOW = 30;

const FATIGUE_RULES = {
  high: { freq_min: 4, ctr_decay_max: -0.3 },
  medium: { freq_min: 3, ctr_decay_max: -0.2 },
  burnout_soon: { freq_min: 3.5, days_active_min: 14 },
  streak_decline: { consecutive_days: 3 },
};

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

function round(n, d) {
  if (n == null || !isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, n) => s + n, 0) / arr.length;
}

function tailMean(arr, n) {
  return mean(arr.slice(-n));
}

function countTrailingDecline(arr) {
  let count = 0;
  for (let i = arr.length - 1; i > 0; i--) {
    if (arr[i] < arr[i - 1]) count++;
    else break;
  }
  return count;
}

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...(await Promise.all(batch.map(fn))));
  }
  return out;
}

async function fetchAdDaily(graph, adId, windowDays) {
  try {
    const res = await graph.get(`/${adId}/insights`, {
      fields: "impressions,clicks,inline_link_clicks,inline_link_click_ctr,frequency,spend,reach",
      time_increment: 1,
      date_preset: `last_${windowDays}d`,
    });
    return res.data || [];
  } catch (e) {
    return { error: e.message };
  }
}

function classify(ad) {
  if (ad.status === "insufficient_data") return "INSUFFICIENT_DATA";
  if (ad.frequency_7d > FATIGUE_RULES.high.freq_min && ad.ctr_delta != null && ad.ctr_delta < FATIGUE_RULES.high.ctr_decay_max) {
    return "FATIGUE_HIGH";
  }
  if (ad.frequency_7d > FATIGUE_RULES.medium.freq_min && ad.ctr_delta != null && ad.ctr_delta < FATIGUE_RULES.medium.ctr_decay_max) {
    return "FATIGUE_MEDIUM";
  }
  if (ad.consecutive_ctr_decline_days >= FATIGUE_RULES.streak_decline.consecutive_days) {
    return "STREAK_DECLINE";
  }
  if (ad.frequency_7d > FATIGUE_RULES.burnout_soon.freq_min && ad.days_active > FATIGUE_RULES.burnout_soon.days_active_min) {
    return "BURNOUT_SOON";
  }
  return "HEALTHY";
}

function refreshPriority(ad) {
  const decay = Math.abs(ad.ctr_delta || 0);
  return round((ad.spend_7d || 0) * (1 + decay), 2);
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  const windowIdx = args.indexOf("--window");
  const windowDays = windowIdx >= 0 ? parseInt(args[windowIdx + 1], 10) : DEFAULT_WINDOW;
  if (!slug) {
    console.error("Usage: node skills/creative-intel/creative-intel.js <slug> [--window 30]");
    process.exit(1);
  }

  const profilePath = resolve(ROOT, "clients", slug, "client_profile.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const acct = profile.accounts || {};
  if (isTbd(acct.ad_account_id)) {
    console.error(`ad_account_id is TBD for ${slug}`);
    process.exit(3);
  }

  const graph = createGraph();
  const act = graph.act(acct.ad_account_id);

  console.error(`[creative-intel] ${slug} — pulling ads that ran in last ${windowDays}d…`);
  const ads = await graph.paginate(
    `/${act}/ads`,
    {
      fields: "id,name,status,effective_status,creative{id},adset_id,campaign_id",
      filtering: JSON.stringify([
        { field: "ad.impressions", operator: "GREATER_THAN", value: 0 },
      ]),
      limit: 100,
      date_preset: `last_${windowDays}d`,
    },
    1000
  ).catch(async () => {
    // Fallback: pull all non-archived ads if filtered query is rejected
    return graph.paginate(
      `/${act}/ads`,
      { fields: "id,name,status,effective_status,creative{id},adset_id,campaign_id", limit: 100 },
      1000
    );
  });

  console.error(`[creative-intel] ${ads.length} ads; fetching daily insights…`);
  const enriched = await inBatches(ads, 10, async (a) => {
    const daily = await fetchAdDaily(graph, a.id, windowDays);
    if (daily.error) return { ...a, status: "error", error: daily.error };
    if (!Array.isArray(daily) || daily.length === 0) return { ...a, status: "no_data" };
    if (daily.length < 7) return { ...a, status: "insufficient_data", days_active: daily.length };

    daily.sort((x, y) => (x.date_start || x.date_stop || "").localeCompare(y.date_start || y.date_stop || ""));

    const ctrs = daily.map((d) => +d.inline_link_click_ctr || 0);
    const freqs = daily.map((d) => +d.frequency || 0);
    const spends = daily.map((d) => +d.spend || 0);
    const impressions = daily.map((d) => +d.impressions || 0);

    const ctr30 = mean(ctrs);
    const ctr7 = tailMean(ctrs, 7);
    const ctrDelta = ctr30 ? (ctr7 - ctr30) / ctr30 : null;
    const freq7 = freqs.slice(-7).reduce((s, n) => Math.max(s, n), 0); // freq is cumulative-ish — take max in window
    const spend7 = spends.slice(-7).reduce((s, n) => s + n, 0);

    return {
      id: a.id,
      name: a.name,
      status: a.effective_status,
      campaign_id: a.campaign_id,
      adset_id: a.adset_id,
      creative_id: a.creative?.id || null,
      days_active: impressions.filter((n) => n > 0).length,
      ctr_30d_avg: round(ctr30, 5),
      ctr_7d_avg: round(ctr7, 5),
      ctr_delta: round(ctrDelta, 4),
      frequency_7d: round(freq7, 3),
      spend_7d: round(spend7, 2),
      consecutive_ctr_decline_days: countTrailingDecline(ctrs),
    };
  });

  // Classify
  for (const ad of enriched) {
    if (ad.status === "error" || ad.status === "no_data") {
      ad.flag = "ERROR";
      continue;
    }
    ad.flag = classify(ad);
    ad.refresh_priority_score = ad.flag === "HEALTHY" || ad.flag === "INSUFFICIENT_DATA" ? 0 : refreshPriority(ad);
  }

  const flagged = enriched.filter((a) => !["HEALTHY", "INSUFFICIENT_DATA", "ERROR", "no_data", "error"].includes(a.flag));
  const refreshQueue = [...flagged]
    .sort((a, b) => (b.refresh_priority_score || 0) - (a.refresh_priority_score || 0))
    .slice(0, 10);

  const flagCounts = enriched.reduce((m, a) => ({ ...m, [a.flag]: (m[a.flag] || 0) + 1 }), {});

  const out = {
    slug,
    generated_at: new Date().toISOString(),
    window_days: windowDays,
    ad_account_id: acct.ad_account_id,
    ads_analyzed: enriched.length,
    ads_flagged: flagged.length,
    by_ad: enriched,
    refresh_queue: refreshQueue,
    flag_counts: flagCounts,
  };

  const outPath = resolve(ROOT, "clients", slug, "creative_intel.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.error(`[creative-intel] wrote ${outPath}`);

  console.log(JSON.stringify({
    slug,
    ads_analyzed: enriched.length,
    ads_flagged: flagged.length,
    flag_counts: flagCounts,
    top_refresh: refreshQueue[0] ? { id: refreshQueue[0].id, name: refreshQueue[0].name, score: refreshQueue[0].refresh_priority_score } : null,
    path: outPath,
    next: refreshQueue.length ? "feed refresh_queue into /creative" : "no fatigue detected",
  }, null, 2));
}

main().catch((e) => {
  console.error("[creative-intel] FATAL:", e.message);
  process.exit(1);
});
