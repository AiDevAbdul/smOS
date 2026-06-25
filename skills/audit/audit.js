#!/usr/bin/env node
/**
 * /audit companion script.
 *
 * Deterministic data-fetch + transform + template-fill for the audit skill.
 * Claude invokes this, reads audit_raw.json, and adds qualitative analysis
 * to the filled audit_report.md before persisting the baseline snapshot.
 *
 * Usage:
 *   node skills/audit/audit.js <client_slug> [--no-paid] [--no-ig]
 *
 * Reads:  clients/<slug>/client_profile.json
 * Writes: clients/<slug>/audit_raw.json
 *         clients/<slug>/audit_report.md (template-filled, Claude appends analysis)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";
import { baselineSnapshot as baselineSchema } from "../../schemas/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

// Meta deprecated page_fans / page_fan_adds / page_fan_removes / page_impressions_unique
// (they 400 with "must be a valid insights metric"). page_daily_follows is the live
// replacement for follower growth; page_views_total + page_post_engagements still work.
const PAGE_INSIGHT_METRICS = [
  "page_post_engagements",
  "page_views_total",
  "page_daily_follows",
];

// Locate the prospect-stage pre-audit artifacts for this client. Public-only data
// (website tracking, Ad Library verdict, scraped IG) that the Graph API never exposes
// — never re-derived, only carried forward and clearly labeled. Resolution order:
//   1. explicit profile.accounts.pre_audit_slug
//   2. prospects/<client slug>/
//   3. any prospects/* whose page_audit.json website/FB-handle matches the profile
function loadPreAudit(slug, profile, readdirSync) {
  const acct = profile.accounts || {};
  const tryDir = (d) => {
    const p = resolve(ROOT, "prospects", d, "page_audit.json");
    if (!existsSync(p)) return null;
    try {
      const page = JSON.parse(readFileSync(p, "utf8"));
      const synthPath = resolve(ROOT, "prospects", d, "synthesis.json");
      const synthesis = existsSync(synthPath) ? JSON.parse(readFileSync(synthPath, "utf8")) : null;
      return { source_dir: d, page_audit: page, synthesis };
    } catch { return null; }
  };

  if (acct.pre_audit_slug) { const hit = tryDir(acct.pre_audit_slug); if (hit) return hit; }
  const direct = tryDir(slug);
  if (direct) return direct;

  // Match across all prospects by website host or FB handle.
  const norm = (s) => String(s || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "");
  const wantSite = norm(acct.website);
  const wantHandle = String(acct.facebook_handle || "").toLowerCase();
  const prospectsDir = resolve(ROOT, "prospects");
  if (!existsSync(prospectsDir)) return null;
  for (const d of readdirSync(prospectsDir)) {
    const hit = tryDir(d);
    if (!hit) continue;
    const pa = hit.page_audit;
    if ((wantSite && norm(pa.website) === wantSite) ||
        (wantHandle && String(pa.facebook?.handle || "").toLowerCase() === wantHandle)) {
      return hit;
    }
  }
  return null;
}

// Distill the carry-forward fields from a loaded pre-audit. These are website/public
// signals the Graph API can't return for /audit — the genuine reuse payload.
function preAuditCarryForward(pre) {
  if (!pre) return null;
  const pa = pre.page_audit || {};
  return {
    source_dir: pre.source_dir,
    captured_hint: pa.captured_at || null,
    website_tracking: {
      meta_pixel_on_site: pa.tracking?.meta_pixel ?? null,
      meta_pixel_id_on_site: pa.tracking?.pixel_id ?? null,
      conversion_events_on_site: pa.tracking?.conversion_events ?? null,
      ga4: pa.tracking?.ga4 ?? null,
      ga4_id: pa.tracking?.ga4_id ?? null,
      google_tag: pa.tracking?.google_tag ?? null,
      google_tag_id: pa.tracking?.google_tag_id ?? null,
      mobile_responsive: pa.tracking?.mobile_responsive ?? null,
    },
    ad_library: { verdict: pa.ads?.verdict ?? null, active_count: pa.ads?.active_count ?? null, notes: pa.ads?.notes ?? null },
    instagram_public: pa.instagram || null,   // fallback only when live IG is blocked
    services: pa.services || null,
    website_meta: pa.website_meta || null,
  };
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

// Rich post fetch needs the review-gated `pages_read_user_content` permission. When the
// app lacks it Meta returns code 10; we fall back to a minimal published_posts pull that
// still yields cadence + format mix (just not per-post engagement). engagement_available
// records which path we took so the report can label depth honestly.
async function fetchPagePosts(graph, pageId) {
  const richFields =
    "id,message,created_time,status_type,attachments{media_type,type}," +
    "reactions.summary(true),comments.summary(true),shares," +
    "insights.metric(post_impressions,post_engaged_users)";
  try {
    const posts = await graph.paginate(`/${pageId}/published_posts`, { fields: richFields, since: isoDaysAgo(60), limit: 50 }, 60);
    return { posts, engagement_available: true };
  } catch (e) {
    if (e.metaError?.code !== 10) throw e; // only the permission gap falls back
    const posts = await graph
      .paginate(`/${pageId}/published_posts`, { fields: "id,created_time,status_type,attachments{media_type,type}", since: isoDaysAgo(60), limit: 50 }, 60)
      .catch(() => []);
    return { posts, engagement_available: false, engagement_blocked_reason: "pages_read_user_content not granted (code 10)" };
  }
}

// Page Insights / published_posts require a PAGE access token, not the user token
// (Meta error 210 otherwise). Resolve it from /me/accounts; if the user has no role on
// the page, fall back to the user token (public fields still resolve).
async function resolvePageGraph(userGraph, pageId) {
  try {
    const accts = await userGraph.paginate("/me/accounts", { fields: "id,access_token", limit: 200 }, 500);
    const row = accts.find((p) => p.id === String(pageId));
    if (row?.access_token) return { graph: createGraph(row.access_token), hasPageToken: true };
  } catch { /* fall through to user token */ }
  return { graph: userGraph, hasPageToken: false };
}

async function auditFacebookPage(userGraph, pageId) {
  if (isTbd(pageId)) return { skipped: true, reason: "page_id is TBD" };

  const { graph, hasPageToken } = await resolvePageGraph(userGraph, pageId);

  // Window-independent dormancy probe: the single most-recent post regardless of the
  // 60-day analysis window. Without this, a page dormant longer than the window reports
  // "0 posts / unknown last post" — losing the most important organic signal.
  const latestPost = await graph
    .get(`/${pageId}/published_posts`, { fields: "created_time", limit: 1 })
    .then((r) => r.data?.[0]?.created_time || null)
    .catch(() => null);

  const [page, postsResult, insights] = await Promise.all([
    graph.get(`/${pageId}`, { fields: "id,name,fan_count,about,category,website,phone,emails,location,picture,cover" }),
    fetchPagePosts(graph, pageId),
    graph.get(`/${pageId}/insights`, {
      metric: PAGE_INSIGHT_METRICS.join(","),
      period: "day",
      since: isoDaysAgo(90),
    }).catch((e) => ({ error: e.message, data: [] })),
  ]);
  const { posts, engagement_available } = postsResult;

  // Format mix
  const formats = { video: 0, image: 0, carousel: 0, link: 0, status: 0, other: 0 };
  let totalEngagement = 0;
  let totalImpressions = 0;
  const scored = [];
  for (const p of posts) {
    const mediaType = p.attachments?.data?.[0]?.media_type || p.status_type || "status";
    if (/video/i.test(mediaType)) formats.video++;
    else if (/album|carousel/i.test(mediaType)) formats.carousel++;
    else if (/photo|image/i.test(mediaType)) formats.image++;
    else if (/link/i.test(mediaType)) formats.link++;
    else if (/status|added_photos/i.test(mediaType)) formats.status++;
    else formats.other++;

    const reactions = p.reactions?.summary?.total_count || 0;
    const comments = p.comments?.summary?.total_count || 0;
    const shares = p.shares?.count || 0;
    const eng = reactions + comments + shares;
    const imps = p.insights?.data?.find((m) => m.name === "post_impressions")?.values?.[0]?.value || 0;
    totalEngagement += eng;
    totalImpressions += imps;
    scored.push({ id: p.id, created_time: p.created_time, message: (p.message || "").slice(0, 120), reactions, comments, shares, eng, impressions: imps, er: imps ? eng / imps : 0 });
  }
  scored.sort((a, b) => b.er - a.er);

  // Follower growth (90d). Net delta (adds − removes) is no longer exposed by Meta;
  // page_daily_follows gives new follows only — labeled accordingly.
  const sumMetric = (name) =>
    (insights.data || []).find((m) => m.name === name)?.values?.reduce((a, v) => a + (v.value || 0), 0) || 0;
  const newFollows90d = sumMetric("page_daily_follows");

  // Most recent post → dormancy signal. Prefer the window-independent probe so a page
  // dormant longer than the analysis window still reports its true last-post age.
  const newestInWindow = posts.reduce((acc, p) => (!acc || p.created_time > acc ? p.created_time : acc), null);
  const newest = latestPost || newestInWindow;
  const daysSinceLastPost = newest ? Math.round((Date.now() - new Date(newest).getTime()) / 86400_000) : null;

  const windowDays = 60;
  return {
    page_id: page.id,
    page_name: page.name,
    has_page_token: hasPageToken,
    followers: page.fan_count,
    new_follows_90d: newFollows90d,
    followers_delta_90d: null, // net delta deprecated by Meta; see new_follows_90d
    page_completeness: scorePageCompleteness(page),
    page_completeness_table: completenessTable(page),
    post_count: posts.length,
    posts_per_week: Math.round((posts.length / (windowDays / 7)) * 10) / 10,
    days_since_last_post: daysSinceLastPost,
    format_mix_pct: {
      video: pct(formats.video, posts.length),
      image: pct(formats.image, posts.length),
      carousel: pct(formats.carousel, posts.length),
      link: pct(formats.link, posts.length),
      status: pct(formats.status, posts.length),
    },
    engagement_available,
    engagement_blocked_reason: postsResult.engagement_blocked_reason || null,
    avg_engagement_rate: engagement_available && totalImpressions ? Math.round((totalEngagement / totalImpressions) * 10000) / 100 : null,
    best_post: engagement_available ? scored[0] || null : null,
    worst_post: engagement_available ? scored[scored.length - 1] || null : null,
    insights_error: insights.error || null,
  };
}

function scorePageCompleteness(page) {
  const checks = [
    !!page.name,
    !!page.about,
    !!page.category,
    !!page.website,
    !!page.phone,
    !!(page.emails && page.emails.length),
    !!page.location,
    !!page.picture?.data?.url,
    !!page.cover?.source,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function completenessTable(page) {
  const rows = [
    ["Name", !!page.name],
    ["About", !!page.about],
    ["Category", !!page.category],
    ["Website", !!page.website],
    ["Phone", !!page.phone],
    ["Email", !!(page.emails && page.emails.length)],
    ["Address", !!page.location],
    ["Profile picture", !!page.picture?.data?.url],
    ["Cover photo", !!page.cover?.source],
  ];
  return ["| Field | Set |", "|---|---|", ...rows.map(([k, v]) => `| ${k} | ${v ? "✓" : "✗"} |`)].join("\n");
}

async function auditInstagram(graph, igId) {
  if (isTbd(igId)) return { skipped: true, reason: "ig_business_id is TBD" };

  const [profile, media, insights] = await Promise.all([
    graph.get(`/${igId}`, { fields: "id,username,followers_count,media_count,profile_picture_url,biography,website" }),
    graph.paginate(`/${igId}/media`, {
      fields: "id,caption,media_type,media_product_type,timestamp,like_count,comments_count,insights.metric(reach,impressions)",
      since: isoDaysAgo(60),
      limit: 50,
    }, 50).catch(() => []),
    graph.get(`/${igId}/insights`, {
      metric: "reach,profile_views,website_clicks",
      period: "day",
      since: isoDaysAgo(28),
    }).catch((e) => ({ error: e.message, data: [] })),
  ]);

  const formats = { reel: 0, image: 0, carousel: 0, video: 0 };
  let er = 0;
  for (const m of media) {
    const t = m.media_product_type || m.media_type;
    if (/reels?/i.test(t)) formats.reel++;
    else if (/carousel/i.test(t)) formats.carousel++;
    else if (/video/i.test(t)) formats.video++;
    else formats.image++;
    const reach = m.insights?.data?.find((d) => d.name === "reach")?.values?.[0]?.value || 0;
    if (reach) er += ((m.like_count || 0) + (m.comments_count || 0)) / reach;
  }

  const sumMetric = (name) =>
    (insights.data || []).find((m) => m.name === name)?.values?.reduce((a, v) => a + (v.value || 0), 0) || 0;

  return {
    ig_id: profile.id,
    username: profile.username,
    followers: profile.followers_count,
    media_count_total: profile.media_count,
    post_count_60d: media.length,
    posts_per_week: Math.round((media.length / (60 / 7)) * 10) / 10,
    format_mix_pct: {
      reels: pct(formats.reel, media.length),
      image: pct(formats.image, media.length),
      carousel: pct(formats.carousel, media.length),
      video: pct(formats.video, media.length),
    },
    avg_engagement_rate: media.length ? Math.round((er / media.length) * 10000) / 100 : 0,
    reach_28d: sumMetric("reach"),
    profile_views_28d: sumMetric("profile_views"),
    insights_error: insights.error || null,
  };
}

async function auditAdAccount(graph, adAccountId, pixelId) {
  if (isTbd(adAccountId)) return { skipped: true, reason: "ad_account_id is TBD" };
  const act = graph.act(adAccountId);

  const [account, campaigns, audiences, pixelStats] = await Promise.all([
    graph.get(`/${act}`, { fields: "id,name,account_status,age,currency,timezone_name,balance,amount_spent,funding_source_details" }),
    graph.paginate(`/${act}/campaigns`, {
      fields: "id,name,status,effective_status,objective,created_time,insights.date_preset(lifetime){spend,impressions,clicks,actions,action_values,cost_per_action_type,purchase_roas,frequency}",
      limit: 100,
    }, 500).catch(() => []),
    graph.get(`/${act}/customaudiences`, {
      fields: "id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,operation_status,time_updated",
      limit: 200,
    }).catch(() => ({ data: [] })),
    !isTbd(pixelId)
      ? graph.get(`/${pixelId}/stats`, { start_time: isoDaysAgo(7) }).catch((e) => ({ error: e.message }))
      : Promise.resolve({ skipped: true }),
  ]);

  // Campaign metrics
  let totalSpend = 0;
  let bestCpa = Infinity;
  let bestRoas = 0;
  let zombies = 0;
  let activeCount = 0;
  let archivedCount = 0;
  let namingCompliant = 0;
  const nameRe = /^[A-Z]+_[A-Z0-9]+_\d{6}$/;
  for (const c of campaigns) {
    const ins = c.insights?.data?.[0];
    const spend = parseFloat(ins?.spend || 0);
    totalSpend += spend;
    if (c.effective_status === "ACTIVE") activeCount++;
    if (c.effective_status === "ARCHIVED") archivedCount++;
    if (nameRe.test(c.name || "")) namingCompliant++;

    if (ins && spend > 50) {
      const purchaseAction = (ins.actions || []).find((a) => /purchase/i.test(a.action_type));
      if (purchaseAction && +purchaseAction.value > 0) {
        const cpa = spend / +purchaseAction.value;
        if (cpa < bestCpa) bestCpa = cpa;
      }
      const roas = parseFloat(ins.purchase_roas?.[0]?.value || 0);
      if (roas > bestRoas) bestRoas = roas;
    }
    if (c.effective_status === "ACTIVE" && (!ins || +ins.impressions === 0)) zombies++;
  }

  // Audience health
  const audItems = audiences.data || [];
  const healthy = audItems.filter((a) => a.operation_status?.code === 200).length;
  const broken = audItems.length - healthy;

  return {
    account_id: account.id,
    account_name: account.name,
    account_status: account.account_status,
    account_age_days: account.age,
    currency: account.currency,
    timezone: account.timezone_name,
    total_spend_lifetime: Math.round(totalSpend * 100) / 100,
    amount_spent_to_date: parseFloat(account.amount_spent || 0) / 100,
    balance: parseFloat(account.balance || 0) / 100,
    campaign_count_total: campaigns.length,
    campaign_count_active: activeCount,
    campaign_count_archived: archivedCount,
    best_cpa: bestCpa === Infinity ? null : Math.round(bestCpa * 100) / 100,
    best_roas: bestRoas || null,
    zombie_count: zombies,
    naming_compliance_pct: campaigns.length ? pct(namingCompliant, campaigns.length) : 0,
    custom_audience_count: audItems.length,
    custom_audience_healthy: healthy,
    custom_audience_broken: broken,
    audience_issues: audItems
      .filter((a) => a.operation_status?.code !== 200)
      .slice(0, 10)
      .map((a) => `${a.name} (${a.operation_status?.description || "unknown"})`),
    pixel_health: classifyPixelHealth(pixelStats),
    pixel_stats: pixelStats,
  };
}

function classifyPixelHealth(stats) {
  if (!stats || stats.skipped) return "none";
  if (stats.error) return "none";
  const events = (stats.data || []).filter((e) => e.count > 0);
  if (!events.length) return "none";
  const hasPv = events.some((e) => /PageView/i.test(e.event));
  const hasConv = events.some((e) => /Purchase|Lead|Subscribe|CompleteRegistration/i.test(e.event));
  if (hasPv && hasConv) return "full";
  if (hasPv) return "partial";
  return "partial";
}

function computeHealthScore(d) {
  const fb = d.organic.facebook || {};
  const paid = d.paid || {};
  const pixelMap = { full: 100, partial: 60, none: 0 };

  // Each component is [score, weight, available]. Unavailable components (e.g. engagement
  // rate when pages_read_user_content is missing) are dropped and the remaining weights
  // renormalized — a permission gap shouldn't be scored as a zero.
  const components = [
    [fb.page_completeness ?? 0, 0.15, fb.page_completeness != null],
    [pixelMap[paid.pixel_health || "none"], 0.2, !paid.skipped],
    [paid.custom_audience_count ? (paid.custom_audience_healthy / paid.custom_audience_count) * 100 : 0, 0.15, !paid.skipped],
    [paid.naming_compliance_pct ?? 0, 0.1, !paid.skipped && (paid.campaign_count_total ?? 0) > 0],
    [Math.min(((fb.posts_per_week ?? 0) / 3) * 100, 100), 0.1, fb.posts_per_week != null],
    [Math.min(((fb.avg_engagement_rate ?? 0) / 3) * 100, 100), 0.15, fb.avg_engagement_rate != null], // 3% ER = 100; dropped if engagement blocked
    [paid.account_status === 1 ? 100 : 50, 0.15, !paid.skipped],
  ];

  const live = components.filter(([, , ok]) => ok);
  const totalWeight = live.reduce((a, [, w]) => a + w, 0) || 1;
  return Math.round(live.reduce((a, [s, w]) => a + s * (w / totalWeight), 0));
}

function fillTemplate(template, vars) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => (vars[key] != null ? String(vars[key]) : `_${key.toLowerCase()}_`));
}

function buildVars(profile, data, healthScore) {
  const fb = data.organic.facebook || {};
  const ig = data.organic.instagram || {};
  const paid = data.paid || {};
  const acct = profile.accounts || {};
  const wt = data.website_tracking || {};

  const fmt = (n, d = 0) => (n == null ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
  const money = (n) => (n == null ? "—" : `${acct.currency || "$"} ${fmt(n, 2)}`);
  const yn = (v) => (v == null ? "unknown" : v ? "✓ yes" : "✗ no");

  return {
    CLIENT_NAME: profile.name,
    AUDIT_DATE: new Date().toISOString().slice(0, 10),
    AD_ACCOUNT_ID: acct.ad_account_id || "TBD",
    CURRENCY: acct.currency || paid.currency || "—",
    TIMEZONE: acct.timezone || paid.timezone || "—",
    HEALTH_SCORE: healthScore,
    WIN_1: "_(Claude to fill — top win from organic data)_",
    WIN_2: "_(Claude to fill)_",
    WIN_3: "_(Claude to fill)_",
    ISSUE_1: "_(Claude to fill — highest-impact gap)_",
    ISSUE_2: "_(Claude to fill)_",
    ISSUE_3: "_(Claude to fill)_",
    PAGE_NAME: fb.page_name || "—",
    FB_FOLLOWERS: fmt(fb.followers),
    FB_FOLLOWERS_DELTA: fmt(fb.followers_delta_90d),
    FB_NEW_FOLLOWS_90D: fb.new_follows_90d != null ? fmt(fb.new_follows_90d) : "—",
    FB_DAYS_SINCE_LAST_POST: fb.days_since_last_post ?? "—",
    FB_ENGAGEMENT_NOTE: fb.engagement_available === false
      ? ` _(per-post engagement unavailable — ${fb.engagement_blocked_reason || "permission gap"}; cadence & format mix are live)_`
      : "",
    PAGE_COMPLETENESS: fb.page_completeness ?? "—",
    FB_POST_COUNT: fb.post_count ?? "—",
    FB_POSTS_PER_WEEK: fb.posts_per_week ?? "—",
    FB_VIDEO_PCT: fb.format_mix_pct?.video ?? 0,
    FB_IMAGE_PCT: fb.format_mix_pct?.image ?? 0,
    FB_CAROUSEL_PCT: fb.format_mix_pct?.carousel ?? 0,
    FB_LINK_PCT: fb.format_mix_pct?.link ?? 0,
    FB_AVG_ER: fb.avg_engagement_rate ?? "—",
    FB_BEST_POST_LINK: fb.best_post ? `https://facebook.com/${fb.best_post.id}` : "—",
    FB_BEST_POST_ER: fb.best_post ? Math.round(fb.best_post.er * 10000) / 100 : "—",
    FB_WORST_POST_LINK: fb.worst_post ? `https://facebook.com/${fb.worst_post.id}` : "—",
    FB_WORST_POST_ER: fb.worst_post ? Math.round(fb.worst_post.er * 10000) / 100 : "—",
    PAGE_COMPLETENESS_TABLE: fb.page_completeness_table || "_(no data)_",
    IG_FOLLOWERS: fmt(ig.followers),
    IG_POST_COUNT: ig.post_count_60d ?? "—",
    IG_POSTS_PER_WEEK: ig.posts_per_week ?? "—",
    IG_REELS_PCT: ig.format_mix_pct?.reels ?? 0,
    IG_IMAGE_PCT: ig.format_mix_pct?.image ?? 0,
    IG_CAROUSEL_PCT: ig.format_mix_pct?.carousel ?? 0,
    IG_AVG_ER: ig.avg_engagement_rate ?? 0,
    IG_REACH_28D: fmt(ig.reach_28d),
    IG_PROFILE_VIEWS_28D: fmt(ig.profile_views_28d),
    ACCOUNT_STATUS: paid.account_status === 1 ? "ACTIVE" : `code=${paid.account_status ?? "—"}`,
    ACCOUNT_AGE_DAYS: paid.account_age_days ?? "—",
    TOTAL_SPEND: money(paid.total_spend_lifetime),
    BALANCE_STATUS: paid.balance != null ? money(paid.balance) : "—",
    TOTAL_CAMPAIGNS: paid.campaign_count_total ?? "—",
    ACTIVE_CAMPAIGNS: paid.campaign_count_active ?? "—",
    BEST_CPA: money(paid.best_cpa),
    BEST_ROAS: paid.best_roas != null ? `${paid.best_roas.toFixed(2)}×` : "—",
    PIXEL_ID: acct.pixel_id || "—",
    PIXEL_STATUS: paid.pixel_health || "—",
    PIXEL_LAST_FIRED: paid.pixel_stats?.skipped ? "n/a" : "—",
    PIXEL_ON_SITE: yn(wt.meta_pixel_on_site),
    PIXEL_EVENTS_FIRING: paid.pixel_stats?.data?.filter((e) => e.count > 0).map((e) => e.event).join(", ") || "—",
    PIXEL_EVENTS_MISSING: paid.pixel_health === "full" ? "—" : "_(review Standard Events list)_",
    PIXEL_CROSSREF_FINDING: data.pixel_cross_reference?.corroborated_finding
      ? `\n> 🔴 **Corroborated:** ${data.pixel_cross_reference.corroborated_finding}`
      : "",
    PRE_AUDIT_SOURCE: data.pre_audit_source || "none found",
    TRACKING_PIXEL_ID_NOTE: wt.meta_pixel_id_on_site ? ` (id \`${wt.meta_pixel_id_on_site}\`)` : "",
    TRACKING_CONV_EVENTS: yn(wt.conversion_events_on_site),
    TRACKING_GA4: wt.ga4 ? `✓ yes${wt.ga4_id ? ` (\`${wt.ga4_id}\`)` : ""}` : yn(wt.ga4),
    TRACKING_GTM: wt.google_tag ? `✓ yes${wt.google_tag_id ? ` (\`${wt.google_tag_id}\`)` : ""}` : yn(wt.google_tag),
    TRACKING_MOBILE: yn(wt.mobile_responsive),
    AD_LIBRARY_VERDICT: data.ad_library_history?.verdict
      ? `${data.ad_library_history.verdict}${data.ad_library_history.notes ? ` — ${data.ad_library_history.notes}` : ""}`
      : "—",
    CA_COUNT: paid.custom_audience_count ?? 0,
    CA_HEALTHY: paid.custom_audience_healthy ?? 0,
    CA_BROKEN: paid.custom_audience_broken ?? 0,
    LAL_COUNT: "_(see audiences)_",
    LAL_HEALTHY: "—",
    LAL_BROKEN: "—",
    AUDIENCE_ISSUES: (paid.audience_issues || []).map((s) => `- ${s}`).join("\n  ") || "_(none)_",
    NAMING_COMPLIANT_PCT: paid.naming_compliance_pct ?? 0,
    ZOMBIE_COUNT: paid.zombie_count ?? 0,
    FREQ_ISSUES: "_(see /analyze)_",
    CREATIVE_AUDIT_SECTION: "_(Run `/audit-creative` to populate.)_",
    NEXT_STEP_1: "_(Claude to fill)_",
    NEXT_STEP_2: "_(Claude to fill)_",
    NEXT_STEP_3: "_(Claude to fill)_",
    SNAPSHOT_ID: "_(set after baseline-snapshot.js)_",
    SNAPSHOT_TIMESTAMP: new Date().toISOString(),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) {
    console.error("Usage: node skills/audit/audit.js <slug> [--no-paid] [--no-ig]");
    process.exit(1);
  }
  const noPaid = args.includes("--no-paid");
  const noIg = args.includes("--no-ig");

  const profilePath = resolve(ROOT, "clients", slug, "client_profile.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const acct = profile.accounts || {};

  const graph = createGraph();

  console.error(`[audit] ${slug} — running passes…`);
  const [facebook, instagram, paid] = await Promise.all([
    auditFacebookPage(graph, acct.facebook_page_id).catch((e) => ({ error: e.message })),
    noIg ? Promise.resolve({ skipped: true }) : auditInstagram(graph, acct.instagram_business_id).catch((e) => ({ error: e.message })),
    noPaid ? Promise.resolve({ skipped: true }) : auditAdAccount(graph, acct.ad_account_id, acct.pixel_id).catch((e) => ({ error: e.message })),
  ]);

  // Reuse the prospect-stage pre-audit (public-only) instead of re-deriving it. Never
  // overrides live API data — it supplies website/tracking signals the Graph API can't
  // return, fills IG when live IG is blocked, and corroborates the pixel finding.
  const pre = loadPreAudit(slug, profile, readdirSync);
  const carry = preAuditCarryForward(pre);
  if (carry) console.error(`[audit] reusing pre-audit from prospects/${carry.source_dir}/ (no re-fetch)`);
  else console.error(`[audit] no pre-audit found — live data only`);

  // IG fallback: if live IG was skipped/blocked but pre-audit scraped public IG stats,
  // carry them forward, clearly labeled as a public estimate (never as live insight).
  let instagramOut = instagram;
  const igLive = instagram && !instagram.skipped && !instagram.error;
  if (!igLive && carry?.instagram_public) {
    instagramOut = {
      source: "pre_audit_public_estimate",
      source_dir: carry.source_dir,
      followers: carry.instagram_public.followers ?? null,
      media_count_total: carry.instagram_public.posts_total ?? null,
      posts_per_week: carry.instagram_public.posts_per_week ?? null,
      days_since_last_post: carry.instagram_public.days_since_last_post ?? null,
      is_business_account: carry.instagram_public.is_business_account ?? null,
      bio: carry.instagram_public.bio ?? null,
      note: "Live IG insights unavailable (not linked / blocked); values scraped at pre-audit — treat as public estimate, not baseline.",
      live_skip_reason: instagram?.reason || instagram?.error || null,
    };
  }

  // Pixel cross-reference: combine live account-side health with the website-side scrape.
  let pixelCrossRef = null;
  if (!paid.skipped && carry?.website_tracking) {
    const onSite = carry.website_tracking.meta_pixel_on_site;
    pixelCrossRef = {
      account_side_health: paid.pixel_health ?? null,
      installed_on_site: onSite,
      corroborated_finding:
        onSite === false && (paid.pixel_health === "none" || paid.pixel_health === "partial")
          ? "Pixel exists in the ad account but is NOT installed on the website (confirmed by pre-audit scrape) — it cannot track real traffic. Top conversion-tracking blocker."
          : null,
    };
  }

  const data = {
    slug,
    generated_at: new Date().toISOString(),
    organic: { facebook, instagram: instagramOut },
    paid,
    website_tracking: carry?.website_tracking || null,
    ad_library_history: carry?.ad_library || null,
    pixel_cross_reference: pixelCrossRef,
    pre_audit_source: carry?.source_dir || null,
    creative: null,
  };
  const healthScore = computeHealthScore(data);
  data.health_score = healthScore;

  // Write raw
  const rawPath = resolve(ROOT, "clients", slug, "audit_raw.json");
  writeFileSync(rawPath, JSON.stringify(data, null, 2));

  // Fill template
  const template = readFileSync(resolve(ROOT, "templates/audit-report.md"), "utf8");
  const vars = buildVars(profile, data, healthScore);
  const filled = fillTemplate(template, vars);
  const reportPath = resolve(ROOT, "clients", slug, "audit_report.md");
  writeFileSync(reportPath, filled);

  console.error(`[audit] wrote ${rawPath}`);
  console.error(`[audit] wrote ${reportPath}`);

  // Canonical baseline_snapshot.json — the artifact /before-after compares against.
  // Locked (immutable_locked_at) ONLY when real FB engagement was captured; an
  // unlocked snapshot makes /before-after refuse to run (its safety gate).
  const fbReal = !facebook?.error && Number.isFinite(facebook?.avg_engagement_rate);
  const baselinePath = resolve(ROOT, "clients", slug, "baseline_snapshot.json");
  if (existsSync(baselinePath)) {
    console.error(`[audit] baseline_snapshot.json already exists — baselines are immutable, NOT overwriting`);
  } else {
    const snapshot = baselineSchema.normalize({
      client_slug: slug,
      captured_at: data.generated_at,
      immutable_locked_at: fbReal ? new Date().toISOString() : null,
      facebook,
      instagram,
      creative_quality: { score_out_of_10: data.creative?.overall_score ?? null },
      paid: { pixel_events_per_month: paid?.pixel_events_per_month ?? null },
    });
    writeFileSync(baselinePath, JSON.stringify(snapshot, null, 2));
    console.error(`[audit] wrote ${baselinePath}${fbReal ? " (locked)" : " (UNLOCKED — re-run with Meta access to lock)"}`);
  }
  console.log(JSON.stringify({
    slug,
    health_score: healthScore,
    fb_followers: facebook?.followers ?? null,
    ig_followers: instagram?.followers ?? null,
    total_spend: paid?.total_spend_lifetime ?? null,
    pixel_health: paid?.pixel_health ?? null,
    raw_path: rawPath,
    report_path: reportPath,
    errors: [facebook?.error, instagram?.error, paid?.error].filter(Boolean),
  }, null, 2));
}

main().catch((e) => {
  console.error("[audit] FATAL:", e.message);
  process.exit(1);
});
