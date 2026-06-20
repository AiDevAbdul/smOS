#!/usr/bin/env node
/**
 * /before-after companion script.
 *
 * Compares the locked baseline snapshot against current live state and
 * fills templates/before-after.md. Refuses to run if baseline is missing
 * or not yet locked.
 *
 * Usage:
 *   node skills/before-after/before-after.js <client_slug>
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

async function capturePaidCurrent(graph, adAccountId, pixelId) {
  if (isTbd(adAccountId)) return { skipped: true };
  const act = graph.act(adAccountId);

  const [insights, pixelStats] = await Promise.all([
    graph
      .get(`/${act}/insights`, {
        fields: "spend,impressions,clicks,actions,action_values,purchase_roas,cost_per_action_type",
        date_preset: "last_30d",
        level: "account",
      })
      .catch((e) => ({ error: e.message, data: [] })),
    !isTbd(pixelId) ? graph.get(`/${pixelId}/stats`, { start_time: isoDaysAgo(30) }).catch(() => ({ data: [] })) : Promise.resolve({ skipped: true }),
  ]);

  const row = insights.data?.[0] || {};
  const spend = +row.spend || 0;
  const leads = findAction(row.actions, ["lead", "offsite_conversion.fb_pixel_lead", "complete_registration"]);
  const purchases = findAction(row.actions, ["purchase", "offsite_conversion.fb_pixel_purchase"]);
  const revenue = findAction(row.action_values, ["purchase", "offsite_conversion.fb_pixel_purchase"]);
  const cpl = leads ? spend / leads : null;
  const roas = +row.purchase_roas?.[0]?.value || (spend && revenue ? revenue / spend : null);

  const pixelEvents = (pixelStats.data || []).reduce((s, e) => s + (e.count || 0), 0);

  return {
    monthly_ad_spend: Math.round(spend * 100) / 100,
    leads_30d: leads,
    purchases_30d: purchases,
    cost_per_lead: cpl != null ? Math.round(cpl * 100) / 100 : null,
    roas: roas != null ? Math.round(roas * 100) / 100 : null,
    pixel_events_30d: pixelEvents,
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
  if (d.pct == null) return `${d.arrow} new (${d.change}${suffix})`;
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

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: node skills/before-after/before-after.js <slug>");
    process.exit(1);
  }

  const profilePath = resolve(ROOT, "clients", slug, "client_profile.json");
  const baselinePath = resolve(ROOT, "clients", slug, "baseline_snapshot.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  if (!existsSync(baselinePath)) {
    console.error(`No baseline_snapshot.json for ${slug}. Run /audit first to capture one.`);
    process.exit(3);
  }

  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

  // SKILL.md: refuse to run if baseline isn't immutably locked
  if (!baseline.immutable_locked_at) {
    console.error(`Baseline snapshot for ${slug} is not locked (immutable_locked_at is null). Refuse to run.`);
    console.error(`Re-run /audit with Meta API access, then re-capture and lock the baseline.`);
    process.exit(4);
  }

  const acct = profile.accounts || {};
  const graph = createGraph();
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
    cpl_baseline: b.cpl != null ? `$${fmtMoney(b.cpl)}` : "—",
    cpl_current: fmtMoney(c.cpl),
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

  const reportsDir = resolve(ROOT, "clients", slug, "reports");
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const today = isoToday();
  const mdPath = resolve(reportsDir, `${today}_before_after.md`);
  const rawPath = resolve(reportsDir, `${today}_before_after_raw.json`);
  writeFileSync(mdPath, filled);
  writeFileSync(
    rawPath,
    JSON.stringify({ slug, baseline_date: baseline.snapshot_date, current_date: today, baseline: b, current: c, deltas, headline }, null, 2)
  );

  console.error(`[before-after] wrote ${mdPath}`);
  console.error(`[before-after] wrote ${rawPath}`);
  console.error(`[before-after] next: python scripts/render_pdf.py ${mdPath} --output ${mdPath.replace(/\.md$/, ".pdf")}`);

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
