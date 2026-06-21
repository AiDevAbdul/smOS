#!/usr/bin/env node
/**
 * /report companion script.
 *
 * Deterministic data-fetch + transform + template-fill for the weekly client
 * report. Claude invokes this, reviews the filled markdown, fills the
 * Claude-only placeholders (win/flag headline, recommendations), then runs
 * the distribution step (Discord/Drive/Gmail).
 *
 * Usage:
 *   node skills/report/report.js <client_slug> [--week-end YYYY-MM-DD]
 *
 * Reads:  clients/<slug>/client_profile.json
 *         clients/<slug>/baseline_snapshot.json  (optional)
 * Writes: clients/<slug>/reports/<week_end>_weekly.md
 *         clients/<slug>/reports/<week_end>_weekly_raw.json
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

const INSIGHT_FIELDS = "spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,actions,action_values,purchase_roas,cost_per_action_type,inline_link_clicks,inline_link_click_ctr";

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function parseDate(s) {
  return new Date(`${s}T00:00:00Z`);
}

function windowFromArgs(weekEndArg) {
  const weekEnd = weekEndArg ? parseDate(weekEndArg) : new Date();
  const weekStart = new Date(weekEnd.getTime() - 7 * 86400_000);
  const priorEnd = new Date(weekStart.getTime() - 1 * 86400_000);
  const priorStart = new Date(priorEnd.getTime() - 7 * 86400_000);
  return {
    week_start: isoDate(weekStart),
    week_end: isoDate(weekEnd),
    prior_start: isoDate(priorStart),
    prior_end: isoDate(priorEnd),
  };
}

function findAction(actions, types) {
  if (!Array.isArray(actions)) return 0;
  for (const t of types) {
    const m = actions.find((a) => a.action_type === t);
    if (m) return +m.value;
  }
  return 0;
}

function findActionValue(values, types) {
  if (!Array.isArray(values)) return 0;
  for (const t of types) {
    const m = values.find((a) => a.action_type === t);
    if (m) return +m.value;
  }
  return 0;
}

const PURCHASE_TYPES = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
const LEAD_TYPES = ["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped"];

function rollupInsights(rows, conversionTypes = PURCHASE_TYPES.concat(LEAD_TYPES)) {
  let spend = 0, impressions = 0, reach = 0, clicks = 0, linkClicks = 0, conversions = 0, revenue = 0;
  let freqWeighted = 0;
  for (const r of rows) {
    const sp = parseFloat(r.spend || 0);
    spend += sp;
    impressions += +r.impressions || 0;
    reach += +r.reach || 0;
    clicks += +r.clicks || 0;
    linkClicks += +r.inline_link_clicks || 0;
    conversions += findAction(r.actions, conversionTypes);
    revenue += findActionValue(r.action_values, conversionTypes);
    if (r.frequency) freqWeighted += parseFloat(r.frequency) * impressions;
  }
  const ctr = impressions ? (clicks / impressions) * 100 : 0;
  const linkCtr = impressions ? (linkClicks / impressions) * 100 : 0;
  const frequency = reach ? impressions / reach : 0;
  return {
    spend, impressions, reach, clicks, link_clicks: linkClicks,
    conversions, revenue,
    ctr, link_ctr: linkCtr, frequency,
    cpa: conversions ? spend / conversions : null,
    roas: spend ? revenue / spend : null,
  };
}

function deltaPct(now, prior) {
  if (!prior) return now ? "+∞" : "0";
  return `${((now - prior) / prior * 100).toFixed(1)}`;
}

function kpiStatus(actual, target, lowerIsBetter) {
  if (actual == null || target == null) return "—";
  const ok = lowerIsBetter ? actual <= target : actual >= target;
  return ok ? "✓ on target" : "⚠ off target";
}

async function fetchInsights(graph, actId, since, until, extras = {}) {
  const params = {
    fields: INSIGHT_FIELDS,
    time_range: JSON.stringify({ since, until }),
    level: "account",
    ...extras,
  };
  const res = await graph.get(`/${graph.act(actId)}/insights`, params);
  return res.data || [];
}

async function fetchPlacementBreakdown(graph, actId, since, until) {
  const res = await graph.get(`/${graph.act(actId)}/insights`, {
    fields: "spend,impressions,clicks,ctr",
    time_range: JSON.stringify({ since, until }),
    level: "account",
    breakdowns: "publisher_platform,platform_position",
  });
  return res.data || [];
}

async function fetchTopAd(graph, actId, since, until) {
  const res = await graph.get(`/${graph.act(actId)}/insights`, {
    fields: "ad_id,ad_name,spend,impressions,clicks,ctr,frequency,actions,action_values,purchase_roas",
    time_range: JSON.stringify({ since, until }),
    level: "ad",
    limit: 200,
    sort: "spend_descending",
  });
  const ads = res.data || [];
  if (!ads.length) return null;
  // Rank by ROAS first (if any), fall back to lowest CPA, fall back to highest CTR
  let best = null;
  for (const a of ads) {
    const conv = findAction(a.actions, PURCHASE_TYPES.concat(LEAD_TYPES));
    const rev = findActionValue(a.action_values, PURCHASE_TYPES.concat(LEAD_TYPES));
    const sp = parseFloat(a.spend || 0);
    if (sp < 20) continue;
    const roas = sp ? rev / sp : 0;
    const cpa = conv ? sp / conv : Infinity;
    const score = roas * 1000 - cpa; // crude composite
    if (!best || score > best.score) best = { ...a, score, roas, cpa, conversions: conv, format: a.ad_name || "—" };
  }
  return best || { ...ads[0], roas: 0, cpa: null, conversions: 0, format: "—" };
}

function placementRows(rows) {
  if (!rows.length) return "| — | — | — |";
  const totalSpend = rows.reduce((a, r) => a + parseFloat(r.spend || 0), 0);
  return rows
    .map((r) => {
      const label = `${r.publisher_platform || "?"} · ${r.platform_position || "?"}`;
      const ctr = (parseFloat(r.ctr || 0)).toFixed(2);
      const share = totalSpend ? ((parseFloat(r.spend || 0) / totalSpend) * 100).toFixed(1) : "0";
      return `| ${label} | ${ctr}% | ${share}% |`;
    })
    .join("\n");
}

function beforeAfterRows(profile, paidNow, baseline) {
  if (!baseline) return "| _(no baseline — run `/audit` first)_ | | | |";
  const rows = [];
  const add = (label, base, cur, unit = "", sign = false) => {
    if (base == null && cur == null) return;
    const fmt = (v) => (v == null ? "—" : unit === "$" ? `$${Number(v).toFixed(2)}` : `${Number(v).toFixed(unit === "%" || unit === "x" ? 2 : 0)}${unit}`);
    let change = "—";
    if (base != null && cur != null && base !== 0) {
      const pct = ((cur - base) / Math.abs(base)) * 100;
      change = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
    }
    rows.push(`| ${label} | ${fmt(base)} | ${fmt(cur)} | ${change} |`);
  };
  add("FB followers", baseline.followers_fb, null);
  add("IG followers", baseline.followers_ig, null);
  add("Avg engagement rate", baseline.avg_engagement_rate, null, "%");
  add("Posts / week", baseline.posts_per_week, null);
  add("Monthly ad spend", baseline.total_historical_spend, paidNow.spend * (30 / 7), "$");
  add("Best CPA", baseline.historical_best_cpa, paidNow.cpa, "$");
  add("Best ROAS", baseline.historical_best_roas, paidNow.roas, "x");
  return rows.length ? rows.join("\n") : "| _(baseline empty)_ | | | |";
}

function optimizerActionsTable(actions) {
  if (!actions || !actions.length) {
    return "_(No optimizer actions logged this week. Optimizer log will populate once Supabase is wired.)_";
  }
  const head = "| Date | Entity | Action | Rule |\n|---|---|---|---|";
  return [head, ...actions.map((a) => `| ${a.date} | ${a.entity} | ${a.action} | ${a.rule} |`)].join("\n");
}

function fillTemplate(template, vars) {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v == null ? `_${key}_` : String(v);
  });
}

function loadOptimizerActions(clientDir, weekStart, weekEnd) {
  // Until Supabase is back online, look for local optimizer logs the agent may have written.
  const localLog = resolve(clientDir, "optimizer_log.json");
  if (!existsSync(localLog)) return [];
  try {
    const all = JSON.parse(readFileSync(localLog, "utf8"));
    const start = parseDate(weekStart).getTime();
    const end = parseDate(weekEnd).getTime() + 86400_000;
    return (Array.isArray(all) ? all : []).filter((a) => {
      const t = new Date(a.date || a.timestamp || 0).getTime();
      return t >= start && t < end;
    });
  } catch {
    return [];
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const slug = argv[0];
  if (!slug) {
    console.error("Usage: node skills/report/report.js <slug> [--week-end YYYY-MM-DD]");
    process.exit(1);
  }
  const weArg = argv.includes("--week-end") ? argv[argv.indexOf("--week-end") + 1] : null;

  const clientDir = resolve(ROOT, "clients", slug);
  const profilePath = resolve(clientDir, "client_profile.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const acct = profile.accounts || {};
  // Unified KPI read (flat or nested) — same targets /analyze + /scale see.
  const kpis = normalizeKpis(profile);

  const window = windowFromArgs(weArg);
  const baselinePath = resolve(clientDir, "baseline_snapshot.json");
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;

  if (isTbd(acct.ad_account_id)) {
    console.error(`[report] ad_account_id is TBD for ${slug} — skipping Meta calls, writing skeleton.`);
  }

  const graph = createGraph();
  let nowRows = [], priorRows = [], placement = [], topAd = null;
  const errors = [];

  if (!isTbd(acct.ad_account_id)) {
    const tasks = [
      fetchInsights(graph, acct.ad_account_id, window.week_start, window.week_end)
        .then((r) => (nowRows = r))
        .catch((e) => errors.push(`current: ${e.message}`)),
      fetchInsights(graph, acct.ad_account_id, window.prior_start, window.prior_end)
        .then((r) => (priorRows = r))
        .catch((e) => errors.push(`prior: ${e.message}`)),
      fetchPlacementBreakdown(graph, acct.ad_account_id, window.week_start, window.week_end)
        .then((r) => (placement = r))
        .catch((e) => errors.push(`placement: ${e.message}`)),
      fetchTopAd(graph, acct.ad_account_id, window.week_start, window.week_end)
        .then((r) => (topAd = r))
        .catch((e) => errors.push(`topAd: ${e.message}`)),
    ];
    await Promise.all(tasks);
  }

  const now = rollupInsights(nowRows);
  const prior = rollupInsights(priorRows);

  const dailyBudget = (() => {
    // Best-effort: pull from profile.monthly_budget if confirmed
    const mb = profile.monthly_budget?.client_confirmed || profile.monthly_budget?.planning_assumption_high;
    return mb ? mb / 30 : null;
  })();
  const budgetPaced = dailyBudget && now.spend ? Math.round((now.spend / (dailyBudget * 7)) * 100) : null;

  const ctrTarget = kpis.ctr_target ?? null;
  const cpaTarget = kpis.cpa_target ?? null;
  const roasTarget = kpis.roas_target ?? null;

  const optimizerActions = loadOptimizerActions(clientDir, window.week_start, window.week_end);

  const vars = {
    client_name: profile.name,
    week_start: window.week_start,
    week_end: window.week_end,
    generated_at: new Date().toISOString(),
    spend_total: now.spend.toFixed(2),
    budget_paced_pct: budgetPaced ?? "—",
    conversions_total: now.conversions,
    roas: now.roas != null ? now.roas.toFixed(2) : "—",
    cpa: now.cpa != null ? now.cpa.toFixed(2) : "—",
    win_headline: "_(Claude to fill — strongest signal in the week)_",
    flag_headline: "_(Claude to fill — biggest concern this week)_",
    spend_prior: prior.spend.toFixed(2),
    spend_delta_pct: deltaPct(now.spend, prior.spend),
    impressions: now.impressions.toLocaleString(),
    impressions_prior: prior.impressions.toLocaleString(),
    impressions_delta_pct: deltaPct(now.impressions, prior.impressions),
    reach: now.reach.toLocaleString(),
    reach_prior: prior.reach.toLocaleString(),
    reach_delta_pct: deltaPct(now.reach, prior.reach),
    frequency: now.frequency.toFixed(2),
    frequency_prior: prior.frequency.toFixed(2),
    frequency_delta: (now.frequency - prior.frequency).toFixed(2),
    cpa_target: cpaTarget != null ? cpaTarget : "—",
    roas_target: roasTarget != null ? roasTarget : "—",
    ctr_target: ctrTarget != null ? ctrTarget : "—",
    ctr: now.link_ctr.toFixed(2),
    cpa_status: kpiStatus(now.cpa, cpaTarget, true),
    roas_status: kpiStatus(now.roas, roasTarget, false),
    ctr_status: kpiStatus(now.link_ctr, ctrTarget, false),
    placement_breakdown_rows: placementRows(placement),
    top_ad_name: topAd?.ad_name || "—",
    top_ad_format: topAd?.format || "—",
    top_ad_spend: topAd ? parseFloat(topAd.spend || 0).toFixed(2) : "—",
    top_ad_conversions: topAd?.conversions ?? "—",
    top_ad_roas: topAd && topAd.roas != null ? topAd.roas.toFixed(2) : "—",
    top_ad_cpa: topAd && topAd.cpa != null && isFinite(topAd.cpa) ? topAd.cpa.toFixed(2) : "—",
    top_ad_ctr: topAd ? parseFloat(topAd.ctr || 0).toFixed(2) : "—",
    top_ad_frequency: topAd ? parseFloat(topAd.frequency || 0).toFixed(2) : "—",
    optimizer_actions_table: optimizerActionsTable(optimizerActions),
    rec_1: "_(Claude to fill — concrete action for next week)_",
    rec_2: "_(Claude to fill)_",
    rec_3: "_(Claude to fill)_",
    baseline_date: baseline?.snapshot_date || baseline?.generated_at || "—",
    before_after_rows: beforeAfterRows(profile, now, baseline),
    drive_link: "_(set after Drive upload)_",
  };

  // H1 guard: refuse to emit a worthless all-zero report (no Meta data at all).
  // A report full of $0.00 / 0 conversions is not a deliverable — it means the
  // ad account is unconnected or the window is empty. Halt and tell the user,
  // unless they explicitly opt in with --allow-empty.
  const allowEmpty = process.argv.includes("--allow-empty");
  const hasData = (now.spend || 0) > 0 || (now.impressions || 0) > 0 || (now.conversions || 0) > 0;
  if (!hasData && !allowEmpty) {
    console.error(`[report] No performance data for ${slug} in ${window.week_start}…${window.week_end} ` +
      `(spend=${now.spend}, impressions=${now.impressions}). Refusing to emit an all-$0.00 report.`);
    if (errors.length) console.error(`[report] upstream errors:\n  - ${errors.join("\n  - ")}`);
    console.error(`[report] Connect the ad account / pick a window with spend, or pass --allow-empty to force.`);
    process.exit(5);
  }

  // Write output
  const reportsDir = resolve(clientDir, "reports");
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const template = readFileSync(resolve(ROOT, "templates/weekly-report.md"), "utf8");
  const filled = fillTemplate(template, vars);
  const mdPath = resolve(reportsDir, `${window.week_end}_weekly.md`);
  writeFileSync(mdPath, filled);

  // Ship HTML + PDF alongside the markdown (every client-facing report does).
  const { htmlPath, pdfOk } = writeHtmlAndPdf(mdPath, filled, {
    title: `${profile.name || slug} — Weekly Report`,
    subtitle: `${window.week_start} → ${window.week_end}`,
  });
  console.error(`[report] wrote ${htmlPath}${pdfOk ? " + PDF" : " (PDF skipped)"}`);

  const rawPath = resolve(reportsDir, `${window.week_end}_weekly_raw.json`);
  writeFileSync(rawPath, JSON.stringify({
    slug, window, vars,
    metrics: { now, prior },
    placement_breakdown: placement,
    top_ad: topAd,
    optimizer_actions: optimizerActions,
    errors,
  }, null, 2));

  console.error(`[report] wrote ${mdPath}`);
  console.error(`[report] wrote ${rawPath}`);
  console.log(JSON.stringify({
    slug,
    week_start: window.week_start,
    week_end: window.week_end,
    spend: now.spend,
    conversions: now.conversions,
    roas: now.roas,
    cpa: now.cpa,
    ctr: now.link_ctr,
    week_over_week_spend_delta_pct: deltaPct(now.spend, prior.spend),
    report_path: mdPath,
    raw_path: rawPath,
    errors,
  }, null, 2));
}

main().catch((e) => {
  console.error("[report] FATAL:", e.message);
  process.exit(1);
});
