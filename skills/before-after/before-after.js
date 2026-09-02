#!/usr/bin/env node
/**
 * /before-after companion script.
 *
 * Compares the locked baseline snapshot against current live state and
 * fills templates/before-after.md. Refuses to run if baseline is missing
 * or not yet locked.
 *
 * Usage:
 *   node skills/before-after/before-after.js <client_slug> [--paid-only]
 *
 * --paid-only narrows the report to the paid surface and relaxes the baseline
 * gate to the paid half only. Use it when the organic half of the baseline is
 * permanently null (e.g. the Page scopes for engagement were never granted), so
 * a paid comparison with real data on both sides is not blocked by an organic
 * gap that re-running /audit cannot fill. Organic is not estimated — it is
 * excluded, and the report says so.
 *
 * Reads:  clients/<slug>/client_profile.json
 *         clients/<slug>/baseline_snapshot.json
 * Writes: clients/<slug>/reports/<YYYY-MM-DD>_before_after.md
 *         clients/<slug>/reports/<YYYY-MM-DD>_before_after_raw.json
 *
 * PDF conversion: after this exits, run
 *   python scripts/render_pdf.py <md-or-html> --output <pdf>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";
import { baselineSnapshot as baselineSchema, clientProfile as profileSchema } from "../../schemas/index.js";
import { writeHtmlAndPdf } from "../../scripts/lib/md_to_html.js";
import * as P from "../../scripts/lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400_000);
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function findAction(actions, types) {
  if (!Array.isArray(actions)) return 0;
  for (const t of types) {
    const m = actions.find((a) => a.action_type === t);
    if (m) return +m.value;
  }
  return 0;
}

async function captureFacebookCurrent(graph, pageId) {
  if (isTbd(pageId)) return { skipped: true };
  const [page, posts] = await Promise.all([
    graph.get(`/${pageId}`, { fields: "id,name,fan_count,about,category,website,phone,emails,location,picture,cover" }),
    graph.paginate(
      `/${pageId}/posts`,
      {
        fields: "id,created_time,reactions.summary(true),comments.summary(true),shares,insights.metric(post_impressions)",
        since: isoDaysAgo(30),
        limit: 50,
      },
      50
    ).catch(() => []),
  ]);

  let eng = 0;
  let imp = 0;
  for (const p of posts) {
    const r = p.reactions?.summary?.total_count || 0;
    const c = p.comments?.summary?.total_count || 0;
    const sh = p.shares?.count || 0;
    eng += r + c + sh;
    imp += p.insights?.data?.find((m) => m.name === "post_impressions")?.values?.[0]?.value || 0;
  }

  const checks = [page.name, page.about, page.category, page.website, page.phone, page.emails?.length, page.location, page.picture?.data?.url, page.cover?.source];
  const completeness = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  return {
    followers: page.fan_count,
    posts_30d: posts.length,
    posts_per_week: Math.round((posts.length / (30 / 7)) * 10) / 10,
    engagement_rate: imp ? Math.round((eng / imp) * 10000) / 100 : 0,
    page_completeness_pct: completeness,
  };
}

async function captureInstagramCurrent(graph, igId) {
  if (isTbd(igId)) return { skipped: true };
  const [profile, media] = await Promise.all([
    graph.get(`/${igId}`, { fields: "id,username,followers_count,media_count" }),
    graph.paginate(
      `/${igId}/media`,
      {
        fields: "id,timestamp,like_count,comments_count,insights.metric(reach)",
        since: isoDaysAgo(30),
        limit: 50,
      },
      50
    ).catch(() => []),
  ]);

  let er = 0;
  for (const m of media) {
    const reach = m.insights?.data?.find((d) => d.name === "reach")?.values?.[0]?.value || 0;
    if (reach) er += ((m.like_count || 0) + (m.comments_count || 0)) / reach;
  }
  return {
    followers: profile.followers_count,
    posts_30d: media.length,
    posts_per_week: Math.round((media.length / (30 / 7)) * 10) / 10,
    engagement_rate: media.length ? Math.round((er / media.length) * 10000) / 100 : 0,
  };
}

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

/**
 * Account structure at the same granularity /audit records in the baseline, so
 * campaign counts / naming compliance / audience health are true before-vs-after
 * rows rather than "new". Naming regex and lifetime-spend method mirror
 * skills/audit/audit.js exactly — the two must stay comparable.
 */
async function capturePaidStructure(graph, act) {
  const [campaigns, audiences] = await Promise.all([
    graph
      .paginate(
        `/${act}/campaigns`,
        {
          fields: "id,name,status,effective_status,objective,insights.date_preset(maximum){spend,impressions}",
          limit: 100,
        },
        500
      )
      .catch((e) => {
        console.error(`[before-after] campaigns fetch failed: ${e.message}`);
        return [];
      }),
    graph.get(`/${act}/customaudiences`, { fields: "id,name,operation_status", limit: 200 }).catch(() => ({ data: [] })),
  ]);

  const nameRe = /^[A-Z]+_[A-Z0-9]+_\d{6}$/;
  let lifetimeSpend = 0;
  let active = 0;
  let archived = 0;
  let compliant = 0;
  let zombies = 0;
  for (const c of campaigns) {
    const ins = c.insights?.data?.[0];
    lifetimeSpend += parseFloat(ins?.spend || 0);
    if (c.effective_status === "ACTIVE") active++;
    if (c.effective_status === "ARCHIVED") archived++;
    if (nameRe.test(c.name || "")) compliant++;
    if (c.effective_status === "ACTIVE" && (!ins || +ins.impressions === 0)) zombies++;
  }

  const audItems = audiences.data || [];
  const healthy = audItems.filter((a) => a.operation_status?.code === 200).length;

  return {
    total_spend_lifetime: round2(lifetimeSpend),
    campaign_count_total: campaigns.length,
    campaign_count_active: active,
    campaign_count_archived: archived,
    naming_compliance_pct: campaigns.length ? pct(compliant, campaigns.length) : 0,
    zombie_campaign_count: zombies,
    custom_audience_count: audItems.length,
    custom_audience_healthy: healthy,
    custom_audience_broken: audItems.length - healthy,
  };
}

async function capturePaidCurrent(graph, adAccountId, pixelId, { withStructure = false } = {}) {
  if (isTbd(adAccountId)) return { skipped: true };
  const act = graph.act(adAccountId);

  const [account, insights, pixelStats, structure] = await Promise.all([
    graph.get(`/${act}`, { fields: "id,name,age,currency,timezone_name,balance,amount_spent" }).catch(() => ({})),
    graph
      .get(`/${act}/insights`, {
        fields: "spend,impressions,clicks,ctr,cpm,cpc,reach,frequency,actions,action_values,purchase_roas,cost_per_action_type",
        date_preset: "last_30d",
        level: "account",
      })
      .catch((e) => ({ error: e.message, data: [] })),
    !isTbd(pixelId) ? graph.get(`/${pixelId}/stats`, { start_time: isoDaysAgo(30) }).catch(() => ({ data: [] })) : Promise.resolve({ skipped: true }),
    withStructure ? capturePaidStructure(graph, act) : Promise.resolve({}),
  ]);

  const row = insights.data?.[0] || {};
  const spend = +row.spend || 0;
  const leads = findAction(row.actions, ["lead", "offsite_conversion.fb_pixel_lead", "complete_registration"]);
  const leadsOnMeta = findAction(row.actions, ["onsite_conversion.lead_grouped"]);
  const leadsPixel = findAction(row.actions, ["offsite_conversion.fb_pixel_lead"]);
  const purchases = findAction(row.actions, ["purchase", "offsite_conversion.fb_pixel_purchase"]);
  const revenue = findAction(row.action_values, ["purchase", "offsite_conversion.fb_pixel_purchase"]);
  const cpl = leads ? spend / leads : null;
  const roas = +row.purchase_roas?.[0]?.value || (spend && revenue ? revenue / spend : null);

  // /<pixel>/stats returns buckets, each with its OWN nested `data` array of
  // { value: <event name>, count }. Summing `bucket.count` (undefined) silently
  // yields 0 — same shape capi-setup.js flattens.
  const pixelEvents = (pixelStats.data || []).reduce(
    (sum, bucket) => sum + (bucket.data || []).reduce((n, row) => n + (Number(row.count) || 0), 0),
    0
  );

  return {
    ...structure,
    account_name: account.name ?? null,
    account_age_days: account.age != null ? round2(+account.age) : null,
    currency: account.currency ?? null,
    amount_spent_to_date: account.amount_spent != null ? round2(parseFloat(account.amount_spent) / 100) : null,
    balance: account.balance != null ? round2(parseFloat(account.balance) / 100) : null,
    monthly_ad_spend: round2(spend),
    impressions_30d: row.impressions != null ? +row.impressions : null,
    reach_30d: row.reach != null ? +row.reach : null,
    frequency_30d: row.frequency != null ? round2(+row.frequency) : null,
    clicks_30d: row.clicks != null ? +row.clicks : null,
    ctr_30d: row.ctr != null ? round2(+row.ctr) : null,
    cpm_30d: row.cpm != null ? round2(+row.cpm) : null,
    cpc_30d: row.cpc != null ? round2(+row.cpc) : null,
    leads_30d: leads,
    leads_on_meta_30d: leadsOnMeta,
    leads_pixel_30d: leadsPixel,
    cost_per_lead_on_meta: leadsOnMeta ? round2(spend / leadsOnMeta) : null,
    cost_per_lead_pixel: leadsPixel ? round2(spend / leadsPixel) : null,
    purchases_30d: purchases,
    cost_per_lead: round2(cpl),
    roas: round2(roas),
    pixel_events_30d: pixelEvents,
    pixel_id_used: isTbd(pixelId) ? null : pixelId,
    insights_window: row.date_start && row.date_stop ? `${row.date_start} → ${row.date_stop}` : null,
    insights_error: insights.error || null,
  };
}

function delta(baseline, current, { invertGood = false } = {}) {
  if (baseline == null || current == null) return { change: null, pct: null, direction: "new", arrow: "—", color: "neutral" };
  if (baseline === 0) return { change: current, pct: null, direction: current > 0 ? "new" : "flat", arrow: current > 0 ? "↑" : "—", color: current > 0 ? "green" : "neutral" };
  const change = current - baseline;
  const p = (change / baseline) * 100;
  const up = change > 0;
  const good = invertGood ? !up : up;
  return {
    change: Math.round(change * 100) / 100,
    pct: Math.round(p * 10) / 10,
    direction: up ? "up" : change < 0 ? "down" : "flat",
    arrow: up ? "↑" : change < 0 ? "↓" : "—",
    color: change === 0 ? "neutral" : good ? "green" : "red",
  };
}

function fmtDelta(d, suffix = "") {
  if (d.change == null) return "—";
  // Baseline was 0: no percentage is definable. Distinguish "still zero" from
  // "moved off zero" instead of labelling both "new".
  if (d.pct == null) {
    if (!d.change) return "— no change";
    return `${d.arrow} +${d.change}${suffix} (from 0)`;
  }
  const sign = d.change > 0 ? "+" : "";
  return `${d.arrow} ${sign}${d.change}${suffix} (${sign}${d.pct}%)`;
}

function fmtMoney(n) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

function buildHeadline(profile, baseline, current, deltas) {
  const days = daysBetween(baseline.snapshot_date, isoToday());
  const fbPct = deltas.fb_followers.pct;
  const erPct = deltas.engagement_rate.pct;
  const spend = current.paid.monthly_ad_spend ?? 0;
  const cpa = current.paid.cost_per_lead;
  const parts = [`In ${days} days since the ${baseline.snapshot_date} baseline, ${profile.name}`];
  const wins = [];
  if (fbPct != null) wins.push(`grew Facebook followers by ${fbPct > 0 ? "+" : ""}${fbPct}%`);
  if (erPct != null) wins.push(`lifted engagement ${erPct > 0 ? "+" : ""}${erPct}%`);
  if (spend > 0) wins.push(`drove $${fmtMoney(spend)}/mo in measurable ad performance${cpa != null ? ` at $${fmtMoney(cpa)} CPL` : ""}`);
  return parts[0] + " " + (wins.length ? wins.join(", ") + "." : "is collecting baseline data — full comparison available next cycle.");
}

function fillTemplate(template, vars) {
  return template.replace(/\{\{([a-z0-9_]+)\}\}/gi, (_, key) => (vars[key] != null ? String(vars[key]) : "—"));
}

/** First non-null of several aliases — absorbs /audit key drift across versions. */
function firstOf(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null) return v;
  }
  return null;
}

function fmtNum(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Currency with cents always shown — $731.40, not $731.4. */
function fmtUsd(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "not measured" rather than "0" — a baseline that recorded nothing is not a zero. */
const NOT_MEASURED = "_not measured_";

function buildPaidHeadline(profile, baseline, cur, deltas, days) {
  const name = profile.name || baseline.client_slug;
  const bits = [];
  const spendD = deltas.lifetime_spend;
  if (spendD.pct != null) {
    bits.push(`total ad investment moved from $${fmtUsd(baseline.paid?.total_spend_lifetime)} to $${fmtUsd(cur.total_spend_lifetime)} (${spendD.pct > 0 ? "+" : ""}${spendD.pct}%)`);
  }
  if (cur.monthly_ad_spend) {
    let perf = `the account is now delivering $${fmtUsd(cur.monthly_ad_spend)} of measured spend per 30 days`;
    if (cur.leads_30d) perf += ` against ${fmtNum(cur.leads_30d)} leads`;
    if (cur.cost_per_lead != null) perf += ` at a $${fmtUsd(cur.cost_per_lead)} cost per lead`;
    bits.push(perf);
  }
  if (!bits.length) {
    return `In ${days} days since the ${baseline.snapshot_date} baseline, ${name}'s paid account has no new measured delivery — comparison available next cycle.`;
  }
  return `In ${days} days since the ${baseline.snapshot_date} baseline, ${name} ${bits.join("; ")}. Baseline recorded no attributed performance, so the delivery metrics below are first measurements rather than regressions.`;
}

async function runPaidOnly({ slug, profile, baseline, graph }) {
  const acct = profile.accounts || {};
  const bp = baseline.paid || {};

  if (isTbd(acct.ad_account_id)) {
    console.error(`[before-after] ${slug} has no usable ad_account_id — nothing to report in --paid-only mode.`);
    process.exit(5);
  }

  console.error(`[before-after] ${slug} — paid-only: pulling current ad account state…`);
  const cur = await capturePaidCurrent(graph, acct.ad_account_id, acct.pixel_id, { withStructure: true });
  if (cur.skipped) {
    console.error(`[before-after] ad account capture skipped — cannot build a paid report.`);
    process.exit(5);
  }

  const today = isoToday();
  const days = daysBetween(baseline.snapshot_date, today);

  // Avg daily spend: lifetime spend / account age, computed identically on both
  // sides so the two rates are comparable.
  const bAgeDays = firstOf(bp, "account_age_days");
  const bLifetime = firstOf(bp, "total_spend_lifetime");
  const bDaily = bLifetime != null && bAgeDays ? Math.round((bLifetime / bAgeDays) * 100) / 100 : null;
  const cDaily =
    cur.total_spend_lifetime != null && cur.account_age_days
      ? Math.round((cur.total_spend_lifetime / cur.account_age_days) * 100) / 100
      : null;

  const b = {
    lifetime_spend: bLifetime,
    daily_spend: bDaily,
    campaigns_total: firstOf(bp, "campaign_count_total"),
    campaigns_active: firstOf(bp, "campaign_count_active"),
    naming: firstOf(bp, "naming_compliance_pct", "campaign_naming_compliance_pct"),
    zombies: firstOf(bp, "zombie_campaign_count", "zombie_count"),
    audiences: firstOf(bp, "custom_audience_count"),
    audiences_broken: firstOf(bp, "custom_audience_broken"),
    // Delivery/conversion: /audit recorded none of these at baseline.
    spend_30d: firstOf(bp, "monthly_ad_spend"),
    impressions: firstOf(bp, "impressions_30d"),
    reach: firstOf(bp, "reach_30d"),
    frequency: firstOf(bp, "frequency_30d"),
    clicks: firstOf(bp, "clicks_30d"),
    ctr: firstOf(bp, "ctr_30d"),
    cpm: firstOf(bp, "cpm_30d"),
    cpc: firstOf(bp, "cpc_30d"),
    leads: firstOf(bp, "leads_30d"),
    leads_on_meta: firstOf(bp, "leads_on_meta_30d"),
    leads_pixel: firstOf(bp, "leads_pixel_30d"),
    cpl: firstOf(bp, "cost_per_lead", "best_cpa"),
    cpl_on_meta: firstOf(bp, "cost_per_lead_on_meta"),
    cpl_pixel: firstOf(bp, "cost_per_lead_pixel"),
    roas: firstOf(bp, "roas", "best_roas"),
  };

  const c = {
    lifetime_spend: cur.total_spend_lifetime,
    daily_spend: cDaily,
    campaigns_total: cur.campaign_count_total,
    campaigns_active: cur.campaign_count_active,
    naming: cur.naming_compliance_pct,
    zombies: cur.zombie_campaign_count,
    audiences: cur.custom_audience_count,
    audiences_broken: cur.custom_audience_broken,
    spend_30d: cur.monthly_ad_spend,
    impressions: cur.impressions_30d,
    reach: cur.reach_30d,
    frequency: cur.frequency_30d,
    clicks: cur.clicks_30d,
    ctr: cur.ctr_30d,
    cpm: cur.cpm_30d,
    cpc: cur.cpc_30d,
    leads: cur.leads_30d,
    leads_on_meta: cur.leads_on_meta_30d,
    leads_pixel: cur.leads_pixel_30d,
    cpl: cur.cost_per_lead,
    cpl_on_meta: cur.cost_per_lead_on_meta,
    cpl_pixel: cur.cost_per_lead_pixel,
    roas: cur.roas,
  };

  const deltas = {
    lifetime_spend: delta(b.lifetime_spend, c.lifetime_spend),
    daily_spend: delta(b.daily_spend, c.daily_spend),
    campaigns_total: delta(b.campaigns_total, c.campaigns_total),
    campaigns_active: delta(b.campaigns_active, c.campaigns_active),
    naming: delta(b.naming, c.naming),
    zombies: delta(b.zombies, c.zombies, { invertGood: true }),
    audiences: delta(b.audiences, c.audiences),
    audiences_broken: delta(b.audiences_broken, c.audiences_broken, { invertGood: true }),
    spend_30d: delta(b.spend_30d, c.spend_30d),
    impressions: delta(b.impressions, c.impressions),
    reach: delta(b.reach, c.reach),
    frequency: delta(b.frequency, c.frequency, { invertGood: true }),
    clicks: delta(b.clicks, c.clicks),
    ctr: delta(b.ctr, c.ctr),
    cpm: delta(b.cpm, c.cpm, { invertGood: true }),
    cpc: delta(b.cpc, c.cpc, { invertGood: true }),
    leads: delta(b.leads, c.leads),
    leads_on_meta: delta(b.leads_on_meta, c.leads_on_meta),
    leads_pixel: delta(b.leads_pixel, c.leads_pixel),
    cpl: delta(b.cpl, c.cpl, { invertGood: true }),
    cpl_on_meta: delta(b.cpl_on_meta, c.cpl_on_meta, { invertGood: true }),
    cpl_pixel: delta(b.cpl_pixel, c.cpl_pixel, { invertGood: true }),
    roas: delta(b.roas, c.roas),
  };

  // A delivery row with no baseline is a first measurement, not a win or a loss.
  const firstMeasure = (bv, cv) => (bv == null ? (cv == null ? "—" : "first measurement") : null);
  const perfCell = (key, suffix = "") =>
    firstMeasure(b[key], c[key]) ?? fmtDelta(deltas[key], suffix);

  // The baseline pixel and the live pixel are different datasets whenever the
  // client has migrated — comparing their event counts would be meaningless.
  const basePixel = baseline.pixel?.pixel_id ?? null;
  const livePixel = cur.pixel_id_used ?? null;
  const pixelComparable = basePixel && livePixel && String(basePixel) === String(livePixel);
  const pixelNote = !livePixel
    ? "No pixel id on the client profile — pixel events not pulled."
    : pixelComparable
      ? `Pixel \`${livePixel}\` — same dataset at baseline and now, so the counts below are directly comparable.`
      : `**Not comparable.** The baseline was captured on pixel \`${basePixel ?? "—"}\`; the account now reports on pixel \`${livePixel}\`. These are different datasets, so no delta is shown — the current figure is a fresh count on the new pixel.`;

  const bPixelEvents = pixelComparable ? firstOf(baseline.pixel || {}, "events_30d", "pixel_events_30d") : null;
  const pixelDelta = pixelComparable ? delta(bPixelEvents, cur.pixel_events_30d) : { change: null, pct: null, arrow: "—", color: "neutral", direction: "n/a" };

  const headline = buildPaidHeadline(profile, baseline, cur, deltas, days);

  const vars = {
    client_name: profile.name || slug,
    baseline_date: baseline.snapshot_date,
    current_date: today,
    days_since_baseline: days,
    paid_only_reason: baseline.facebook?.engagement_blocked_reason
      ? `organic excluded (${baseline.facebook.engagement_blocked_reason})`
      : "organic excluded (no comparable organic baseline)",
    headline_summary: headline,
    baseline_account_age: bAgeDays != null ? Math.round(bAgeDays) : "—",

    lifetime_spend_baseline: fmtUsd(b.lifetime_spend),
    lifetime_spend_current: fmtUsd(c.lifetime_spend),
    lifetime_spend_delta: fmtDelta(deltas.lifetime_spend),
    daily_spend_baseline: fmtUsd(b.daily_spend),
    daily_spend_current: fmtUsd(c.daily_spend),
    daily_spend_delta: fmtDelta(deltas.daily_spend),
    campaigns_total_baseline: b.campaigns_total ?? "—",
    campaigns_total_current: c.campaigns_total ?? "—",
    campaigns_total_delta: fmtDelta(deltas.campaigns_total),
    campaigns_active_baseline: b.campaigns_active ?? "—",
    campaigns_active_current: c.campaigns_active ?? "—",
    campaigns_active_delta: fmtDelta(deltas.campaigns_active),
    naming_baseline: b.naming ?? "—",
    naming_current: c.naming ?? "—",
    naming_delta: fmtDelta(deltas.naming, "pp"),
    zombies_baseline: b.zombies ?? "—",
    zombies_current: c.zombies ?? "—",
    zombies_delta: fmtDelta(deltas.zombies),
    audiences_baseline: b.audiences ?? "—",
    audiences_current: c.audiences ?? "—",
    audiences_delta: fmtDelta(deltas.audiences),
    audiences_broken_baseline: b.audiences_broken ?? "—",
    audiences_broken_current: c.audiences_broken ?? "—",
    audiences_broken_delta: fmtDelta(deltas.audiences_broken),

    spend_30d_baseline: b.spend_30d != null ? `$${fmtUsd(b.spend_30d)}` : NOT_MEASURED,
    spend_30d_current: fmtUsd(c.spend_30d),
    spend_30d_delta: perfCell("spend_30d"),
    impressions_baseline: b.impressions != null ? fmtNum(b.impressions) : NOT_MEASURED,
    impressions_current: fmtNum(c.impressions),
    impressions_delta: perfCell("impressions"),
    reach_baseline: b.reach != null ? fmtNum(b.reach) : NOT_MEASURED,
    reach_current: fmtNum(c.reach),
    reach_delta: perfCell("reach"),
    frequency_baseline: b.frequency != null ? fmtNum(b.frequency) : NOT_MEASURED,
    frequency_current: fmtNum(c.frequency),
    frequency_delta: perfCell("frequency"),
    clicks_baseline: b.clicks != null ? fmtNum(b.clicks) : NOT_MEASURED,
    clicks_current: fmtNum(c.clicks),
    clicks_delta: perfCell("clicks"),
    ctr_baseline: b.ctr != null ? `${b.ctr}%` : NOT_MEASURED,
    ctr_current: fmtNum(c.ctr),
    ctr_delta: perfCell("ctr", "pp"),
    cpm_baseline: b.cpm != null ? `$${fmtUsd(b.cpm)}` : NOT_MEASURED,
    cpm_current: fmtUsd(c.cpm),
    cpm_delta: perfCell("cpm"),
    cpc_baseline: b.cpc != null ? `$${fmtUsd(b.cpc)}` : NOT_MEASURED,
    cpc_current: fmtUsd(c.cpc),
    cpc_delta: perfCell("cpc"),
    leads_baseline: b.leads != null ? fmtNum(b.leads) : NOT_MEASURED,
    leads_current: fmtNum(c.leads),
    leads_delta: perfCell("leads"),
    leads_on_meta_baseline: b.leads_on_meta != null ? fmtNum(b.leads_on_meta) : NOT_MEASURED,
    leads_on_meta_current: fmtNum(c.leads_on_meta),
    leads_on_meta_delta: perfCell("leads_on_meta"),
    leads_pixel_baseline: b.leads_pixel != null ? fmtNum(b.leads_pixel) : NOT_MEASURED,
    leads_pixel_current: fmtNum(c.leads_pixel),
    leads_pixel_delta: perfCell("leads_pixel"),
    cpl_on_meta_current: fmtUsd(c.cpl_on_meta),
    cpl_pixel_current: fmtUsd(c.cpl_pixel),
    cpl_baseline: b.cpl != null ? `$${fmtUsd(b.cpl)}` : NOT_MEASURED,
    cpl_current: fmtUsd(c.cpl),
    cpl_delta: perfCell("cpl"),
    roas_baseline: b.roas != null ? `${b.roas}x` : NOT_MEASURED,
    roas_current: c.roas != null ? `${c.roas}x` : "— (no purchase events)",
    roas_delta: perfCell("roas"),

    pixel_note: pixelNote,
    pixel_events_baseline: bPixelEvents != null ? fmtNum(bPixelEvents) : NOT_MEASURED,
    pixel_events_current: fmtNum(cur.pixel_events_30d),
    pixel_events_delta: pixelComparable ? fmtDelta(pixelDelta) : "n/a — different pixel",

    paid_summary: "_(Claude to fill — what drove paid performance)_",
    creative_summary: "_(Claude to fill — creative changes since baseline)_",
    optimization_summary: "_(Claude to fill — top optimizer actions)_",
    excluded_note: "_(Claude to fill — which surfaces are excluded and why)_",
    generated_at: new Date().toISOString(),
  };

  const template = readFileSync(resolve(ROOT, "templates/before-after-paid.md"), "utf8");
  const filled = fillTemplate(template, vars);

  const mdPath = P.ensureParent(P.clientReport(slug, today, "before-after-paid", "md"));
  const rawPath = P.ensureParent(P.clientReport(slug, today, "before-after-paid", "raw.json"));
  writeFileSync(mdPath, filled);
  writeFileSync(
    rawPath,
    JSON.stringify(
      {
        slug,
        mode: "paid-only",
        baseline_date: baseline.snapshot_date,
        current_date: today,
        days_since_baseline: days,
        excluded_surfaces: ["facebook", "instagram", "creative_quality"],
        exclusion_reason: vars.paid_only_reason,
        pixel_comparable: pixelComparable,
        baseline_pixel_id: basePixel,
        current_pixel_id: livePixel,
        insights_window: cur.insights_window,
        baseline: b,
        current: c,
        current_raw: cur,
        deltas,
        headline,
      },
      null,
      2
    )
  );

  const { htmlPath, pdfOk } = writeHtmlAndPdf(mdPath, filled, {
    title: `${profile.name || slug} — Before / After (Paid)`,
    subtitle: `Baseline ${baseline.snapshot_date || "—"} → ${today} · paid media only`,
  });

  console.error(`[before-after] wrote ${mdPath}`);
  console.error(`[before-after] wrote ${rawPath}`);
  console.error(`[before-after] wrote ${htmlPath}${pdfOk ? " + PDF" : " (PDF skipped)"}`);

  console.log(
    JSON.stringify(
      {
        slug,
        mode: "paid-only",
        baseline_date: baseline.snapshot_date,
        current_date: today,
        days_since_baseline: days,
        md_path: mdPath,
        html_path: htmlPath,
        raw_path: rawPath,
        headline,
        deltas_summary: Object.fromEntries(
          Object.entries(deltas).map(([k, v]) => [k, v.pct != null ? `${v.pct}%` : v.direction])
        ),
      },
      null,
      2
    )
  );
}

async function main() {
  const args = process.argv.slice(2);
  const paidOnly = args.includes("--paid-only");
  const slug = args.find((a) => !a.startsWith("--"));
  if (!slug) {
    console.error("Usage: node skills/before-after/before-after.js <slug> [--paid-only]");
    process.exit(1);
  }

  const profilePath = P.clientFile(slug, "client_profile.json");
  const baselinePath = P.clientFile(slug, "baseline_snapshot.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  if (!existsSync(baselinePath)) {
    console.error(`No baseline_snapshot.json for ${slug}. Run /audit first to capture one.`);
    process.exit(3);
  }

  const profile = profileSchema.normalize(JSON.parse(readFileSync(profilePath, "utf8")));
  // Normalize so audit's field names (avg_engagement_rate → engagement_rate_30d)
  // resolve, then fail-closed validate (also enforces the immutable lock).
  const baseline = baselineSchema.normalize(JSON.parse(readFileSync(baselinePath, "utf8")));
  // --paid-only narrows the gate to the paid half. The lock is still required;
  // only the organic completeness checks are dropped.
  const surfaces = paidOnly ? ["paid"] : ["organic"];
  const baselineCheck = baselineSchema.validate(baseline, { requireLock: true, surfaces });
  if (!baselineCheck.ok) {
    console.error(`Baseline snapshot for ${slug} is not usable:\n  - ${baselineCheck.errors.join("\n  - ")}`);
    if (!paidOnly) {
      console.error(`Re-run /audit with Meta API access, then re-capture and lock the baseline.`);
      console.error(`If the organic half cannot be filled (missing Page scopes), re-run with --paid-only.`);
    }
    process.exit(4);
  }

  const acct = profile.accounts || {};
  const graph = createGraph();

  if (paidOnly) {
    await runPaidOnly({ slug, profile, baseline, graph });
    return;
  }
  console.error(`[before-after] ${slug} — pulling current state…`);
  const [facebook, instagram, paid] = await Promise.all([
    captureFacebookCurrent(graph, acct.facebook_page_id).catch((e) => ({ error: e.message })),
    captureInstagramCurrent(graph, acct.instagram_business_id).catch((e) => ({ error: e.message })),
    capturePaidCurrent(graph, acct.ad_account_id, acct.pixel_id).catch((e) => ({ error: e.message })),
  ]);

  const current = { facebook, instagram, paid, captured_at: new Date().toISOString() };

  // Compute deltas — fields normalized against whatever the baseline stored
  const b = {
    fb_followers: baseline.facebook?.followers,
    ig_followers: baseline.instagram?.followers,
    engagement_rate: baseline.facebook?.engagement_rate_30d,
    posts_per_week: baseline.facebook?.posts_per_week_30d,
    content_score: baseline.creative_quality?.score_out_of_10,
    page_completeness: baseline.facebook?.page_completeness_pct,
    ad_spend: baseline.paid?.monthly_ad_spend,
    cpl: baseline.paid?.cost_per_lead,
    roas: baseline.paid?.roas,
    pixel_events: baseline.paid?.pixel_events_per_month,
  };
  const c = {
    fb_followers: facebook?.followers,
    ig_followers: instagram?.followers,
    engagement_rate: facebook?.engagement_rate,
    posts_per_week: facebook?.posts_per_week,
    content_score: null, // requires /audit-creative re-run
    page_completeness: facebook?.page_completeness_pct,
    ad_spend: paid?.monthly_ad_spend,
    cpl: paid?.cost_per_lead,
    roas: paid?.roas,
    pixel_events: paid?.pixel_events_30d,
  };

  const deltas = {
    fb_followers: delta(b.fb_followers, c.fb_followers),
    ig_followers: delta(b.ig_followers, c.ig_followers),
    engagement_rate: delta(b.engagement_rate, c.engagement_rate),
    posts_per_week: delta(b.posts_per_week, c.posts_per_week),
    content_score: delta(b.content_score, c.content_score),
    page_completeness: delta(b.page_completeness, c.page_completeness),
    ad_spend: delta(b.ad_spend, c.ad_spend),
    cpl: delta(b.cpl, c.cpl, { invertGood: true }), // lower is better
    roas: delta(b.roas, c.roas),
    pixel_events: delta(b.pixel_events, c.pixel_events),
  };

  const headline = buildHeadline(profile, baseline, current, deltas);

  const vars = {
    client_name: profile.name,
    baseline_date: baseline.snapshot_date,
    current_date: isoToday(),
    days_since_baseline: daysBetween(baseline.snapshot_date, isoToday()),
    headline_summary: headline,
    fb_followers_baseline: b.fb_followers ?? "—",
    fb_followers_current: c.fb_followers ?? "—",
    fb_followers_delta: fmtDelta(deltas.fb_followers),
    ig_followers_baseline: b.ig_followers ?? "—",
    ig_followers_current: c.ig_followers ?? "—",
    ig_followers_delta: fmtDelta(deltas.ig_followers),
    engagement_rate_baseline: b.engagement_rate ?? "—",
    engagement_rate_current: c.engagement_rate ?? "—",
    engagement_rate_delta: fmtDelta(deltas.engagement_rate, "%"),
    posts_per_week_baseline: b.posts_per_week ?? "—",
    posts_per_week_current: c.posts_per_week ?? "—",
    posts_per_week_delta: fmtDelta(deltas.posts_per_week),
    content_score_baseline: b.content_score ?? "—",
    content_score_current: c.content_score ?? "_(run /audit-creative)_",
    content_score_delta: fmtDelta(deltas.content_score),
    page_completeness_baseline: b.page_completeness ?? "—",
    page_completeness_current: c.page_completeness ?? "—",
    page_completeness_delta: fmtDelta(deltas.page_completeness, "%"),
    ad_spend_baseline: fmtMoney(b.ad_spend),
    ad_spend_current: fmtMoney(c.ad_spend),
    ad_spend_delta: fmtDelta(deltas.ad_spend),
    cpl_baseline: b.cpl != null ? `$${fmtUsd(b.cpl)}` : "—",
    cpl_current: fmtUsd(c.cpl),
    cpl_delta: fmtDelta(deltas.cpl),
    roas_baseline: b.roas ?? "—",
    roas_current: c.roas ?? "—",
    roas_delta: fmtDelta(deltas.roas),
    pixel_events_baseline: b.pixel_events ?? "—",
    pixel_events_current: c.pixel_events ?? "—",
    pixel_events_delta: fmtDelta(deltas.pixel_events),
    organic_summary: "_(Claude to fill — what drove the organic deltas)_",
    paid_summary: "_(Claude to fill — what drove paid performance)_",
    creative_summary: "_(Claude to fill — creative changes since baseline)_",
    optimization_summary: "_(Claude to fill — top optimizer actions)_",
    generated_at: new Date().toISOString(),
  };

  const template = readFileSync(resolve(ROOT, "templates/before-after.md"), "utf8");
  const filled = fillTemplate(template, vars);

  const today = isoToday();
  const mdPath = P.ensureParent(P.clientReport(slug, today, "before-after", "md"));
  const rawPath = P.ensureParent(P.clientReport(slug, today, "before-after", "raw.json"));
  writeFileSync(mdPath, filled);
  writeFileSync(
    rawPath,
    JSON.stringify({ slug, baseline_date: baseline.snapshot_date, current_date: today, baseline: b, current: c, deltas, headline }, null, 2)
  );

  const { htmlPath, pdfOk } = writeHtmlAndPdf(mdPath, filled, {
    title: `${profile.name || slug} — Before / After`,
    subtitle: `Baseline ${baseline.snapshot_date || "—"} → ${today}`,
  });

  console.error(`[before-after] wrote ${mdPath}`);
  console.error(`[before-after] wrote ${rawPath}`);
  console.error(`[before-after] wrote ${htmlPath}${pdfOk ? " + PDF" : " (PDF skipped)"}`);

  console.log(JSON.stringify({
    slug,
    baseline_date: baseline.snapshot_date,
    current_date: today,
    days_since_baseline: vars.days_since_baseline,
    md_path: mdPath,
    raw_path: rawPath,
    headline,
    deltas_summary: Object.fromEntries(Object.entries(deltas).map(([k, v]) => [k, v.pct != null ? `${v.pct}%` : v.direction])),
  }, null, 2));
}

main().catch((e) => {
  console.error("[before-after] FATAL:", e.message);
  process.exit(1);
});
