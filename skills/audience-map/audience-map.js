#!/usr/bin/env node
/**
 * /audience-map companion script — builds an audience targeting plan.
 *
 * Workflow:
 *   1. Seed terms from product description + pain points + business model
 *   2. Resolve interests via Graph /search?type=adinterest (parallel)
 *   3. Cluster by theme (deterministic — labels passed in or inferred)
 *   4. Pull existing custom audiences (if ad_account real) → pick best LAL seed
 *   5. Build standard 4-layer retargeting plan
 *   6. Build default exclusions
 *   7. Write clients/<slug>/audience_map.json
 *
 * Direct Graph; MCP hooks do not fire.
 *
 * Usage:
 *   node skills/audience-map/audience-map.js <slug>
 *   node skills/audience-map/audience-map.js <slug> --offline    # skip Meta API, structure-only
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";
import { audienceMap as audienceMapSchema } from "../../schemas/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const MIN_INTEREST_SIZE = 100_000;
const MAX_INTEREST_SIZE = 50_000_000;
const MIN_CLUSTERS = 3;

// Lightweight stopword list for noun extraction.
const STOPWORDS = new Set([
  "the","and","for","with","that","this","from","are","our","you","your","but","not","can","will",
  "have","has","was","were","been","being","into","out","over","under","more","most","some","any",
  "all","one","two","each","also","just","only","very","much","such","than","then","also","here",
  "there","when","what","who","why","how","its","their","they","them","his","her","she","him","his",
  "service","services","product","products","customer","customers","business","businesses","based",
]);

function extractSeedTerms(profile) {
  const seeds = new Set();
  const addToken = (raw) => {
    const t = String(raw || "").toLowerCase().replace(/[^a-z\s-]/g, " ").trim();
    if (!t) return;
    for (const w of t.split(/\s+/)) {
      if (w.length >= 4 && !STOPWORDS.has(w)) seeds.add(w);
    }
    // Phrases (2-3 grams) tend to be much better interest matches
    const words = t.split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
    for (let i = 0; i < words.length - 1; i++) {
      seeds.add(`${words[i]} ${words[i + 1]}`);
      if (i < words.length - 2) seeds.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
  };

  addToken(profile.business?.product_description);
  addToken(profile.business?.usp);
  for (const p of profile.audience?.pain_points || []) addToken(p);
  // explicit interests
  for (const i of profile.audience?.interests || []) addToken(i);

  return Array.from(seeds).slice(0, 25);
}

async function searchInterest(graph, term) {
  // Graph endpoint: /search?type=adinterest&q=...
  try {
    const res = await graph.get("/search", {
      type: "adinterest",
      q: term,
      limit: 5,
    });
    return (res.data || []).map((r) => ({
      id: r.id,
      name: r.name,
      audience_size_lower: r.audience_size_lower_bound,
      audience_size_upper: r.audience_size_upper_bound,
      path: r.path,
      topic: r.topic,
      seed: term,
    }));
  } catch (e) {
    return [];
  }
}

function filterAndDedup(results) {
  const seen = new Map();
  for (const r of results) {
    if (!r.id) continue;
    if (r.audience_size_lower != null && r.audience_size_lower < MIN_INTEREST_SIZE) continue;
    if (r.audience_size_upper != null && r.audience_size_upper > MAX_INTEREST_SIZE) continue;
    if (!seen.has(r.id)) seen.set(r.id, r);
  }
  return Array.from(seen.values());
}

function clusterInterests(interests) {
  // Bucket by the first segment of path (Meta returns ["Interests", "Sports", ...])
  // Falls back to topic if path is missing.
  const buckets = new Map();
  for (const i of interests) {
    let key = "General";
    if (Array.isArray(i.path) && i.path.length >= 2) key = i.path[1];
    else if (i.topic) key = i.topic;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }
  // Sort buckets by size, take top 5
  const clusters = Array.from(buckets.entries())
    .filter(([, arr]) => arr.length >= 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5)
    .map(([name, arr], idx) => ({
      id: `INT_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 20)}`,
      label: name,
      interests: arr.slice(0, 8).map((x) => ({
        id: x.id,
        name: x.name,
        size_lower: x.audience_size_lower,
        size_upper: x.audience_size_upper,
      })),
      size_estimate_lower: arr.slice(0, 8).reduce((s, x) => s + (x.audience_size_lower || 0), 0),
      size_estimate_upper: arr.slice(0, 8).reduce((s, x) => s + (x.audience_size_upper || 0), 0),
      anchor_index: idx,
    }));
  return clusters;
}

function pickBehaviors(profile) {
  const model = String(profile.business?.business_model || "").toLowerCase();
  const out = [];
  // Default behavioral picks by business model
  if (/dtc|ecom|e-commerce/.test(model)) {
    out.push({ name: "Engaged Shoppers", rationale: "DTC — high purchase intent" });
    out.push({ name: "Online Spenders — Premium Brands", rationale: "Premium-AOV bias" });
  }
  if (/local|service/.test(model)) {
    out.push({ name: "Frequent Travelers", rationale: "Local service — disposable income proxy" });
    out.push({ name: "New Movers", rationale: "Local service — high need for vendor onboarding" });
  }
  if (/b2b/.test(model)) {
    out.push({ name: "Small Business Owners", rationale: "B2B SMB targeting" });
    out.push({ name: "Business Decision Makers", rationale: "B2B mid-market" });
  }
  if (!out.length) {
    out.push({ name: "Engaged Shoppers", rationale: "Default — general purchase intent" });
  }
  return out;
}

function buildRetargetingLayers(profile) {
  const acct = profile.accounts || {};
  const layers = [
    {
      name: "RT_PIX_30D",
      source: "pixel",
      source_id: acct.pixel_id,
      window_days: 30,
      rationale: "Recent site visitors — highest warm intent",
      verified: !isTbd(acct.pixel_id),
    },
    {
      name: "RT_PIX_90D",
      source: "pixel",
      source_id: acct.pixel_id,
      window_days: 90,
      rationale: "Mid-cycle warm pool",
      verified: !isTbd(acct.pixel_id),
    },
    {
      name: "RT_PIX_180D",
      source: "pixel",
      source_id: acct.pixel_id,
      window_days: 180,
      rationale: "Long-cycle re-engagement",
      verified: !isTbd(acct.pixel_id),
    },
    {
      name: "RT_PAGE_365D",
      source: "page_and_ig_engagers",
      source_id: { page: acct.page_id || acct.facebook_page_id, ig: acct.ig_account_id || acct.instagram_business_id },
      window_days: 365,
      rationale: "Organic engagement → paid retarget",
      verified: !isTbd(acct.page_id || acct.facebook_page_id),
    },
  ];
  // Add ATC layer only if conversion event is purchase-like
  const conv = profile.business?.conversion_event || (profile.business?.conversion_events || [])[0] || "";
  if (/purchase|atc|cart|checkout/i.test(conv)) {
    layers.push({
      name: "RT_ATC_30D_NONPURCH",
      source: "pixel_atc_minus_purchase",
      source_id: acct.pixel_id,
      window_days: 30,
      rationale: "High-intent cart abandoners",
      verified: !isTbd(acct.pixel_id),
    });
  }
  return layers;
}

async function loadCustomAudiences(graph, adAccountId) {
  if (!adAccountId || isTbd(adAccountId)) return null;
  try {
    const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    const res = await graph.get(`/${id}/customaudiences`, {
      fields: "id,name,approximate_count_lower_bound,approximate_count_upper_bound,subtype,operation_status",
      limit: 100,
    });
    return res.data || [];
  } catch (e) {
    return null;
  }
}

function pickLookalikeSeed(customAudiences, profile) {
  if (!customAudiences || !customAudiences.length) {
    return {
      seed: null,
      health: "missing",
      fallback_note: "No custom audiences found. Recommend creating a purchasers_365d list once pixel has fired 1000+ purchases.",
    };
  }
  // Prefer purchaser-named audiences
  const priorityRegex = [
    /purchas/i,
    /buyer/i,
    /customer/i,
    /atc|add.?to.?cart/i,
    /video.*7[05]/i,
    /engag/i,
  ];
  for (const re of priorityRegex) {
    const match = customAudiences.find((c) => re.test(c.name) && c.operation_status?.code === 200);
    if (match) {
      return {
        seed: {
          audience_id: match.id,
          name: match.name,
          size_lower: match.approximate_count_lower_bound,
          size_upper: match.approximate_count_upper_bound,
          subtype: match.subtype,
        },
        health: "healthy",
        fallback_note: null,
      };
    }
  }
  const first = customAudiences[0];
  return {
    seed: {
      audience_id: first.id,
      name: first.name,
      size_lower: first.approximate_count_lower_bound,
      size_upper: first.approximate_count_upper_bound,
      subtype: first.subtype,
    },
    health: first.operation_status?.code === 200 ? "healthy" : "degraded",
    fallback_note: "No purchase-tagged seed; using best available engagement source.",
  };
}

function buildExclusions(profile) {
  const out = [];
  out.push({
    type: "custom_audience",
    name: "all_time_purchasers",
    rationale: "Avoid re-prospecting buyers in cold campaigns",
  });
  if (profile.voice?.restricted_words?.length) {
    out.push({
      type: "creative_constraint",
      value: profile.voice.restricted_words,
      rationale: "Restricted words from brand voice — enforced by creative-compliance hook",
    });
  }
  // Internal-team exclusion suggestion
  out.push({
    type: "custom_audience",
    name: "employees_and_insiders",
    rationale: "Exclude staff if available (skip if profile doesn't specify)",
  });
  return out;
}

async function main() {
  const [slug, ...rest] = process.argv.slice(2);
  if (!slug) {
    console.error("Usage: node skills/audience-map/audience-map.js <slug> [--offline]");
    process.exit(1);
  }
  const offline = rest.includes("--offline");

  const profilePath = resolve(ROOT, "clients", slug, "client_profile.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const acct = profile.accounts || {};

  const seeds = extractSeedTerms(profile);
  if (!seeds.length) throw new Error("Could not derive any seed terms from profile");

  let clusters = [];
  let customAudiences = null;
  let lookalike = { seed: null, health: "skipped_offline", fallback_note: "offline mode" };

  if (!offline && !isTbd(acct.ad_account_id)) {
    const graph = createGraph();
    // Pass 2: resolve interests in parallel
    const searchResults = await Promise.all(seeds.map((s) => searchInterest(graph, s)));
    const interests = filterAndDedup(searchResults.flat());
    clusters = clusterInterests(interests);

    // Pass 4: custom audiences
    customAudiences = await loadCustomAudiences(graph, acct.ad_account_id);
    lookalike = pickLookalikeSeed(customAudiences, profile);
  }

  // Lookalike sizes fixed
  const geoTargets = profile.audience?.geo_targets || (profile.location?.country ? [profile.location.country] : ["US"]);
  const lookalikeBlock = {
    ...lookalike,
    sizes_pct: [1, 3, 5],
    countries: geoTargets,
  };

  const behaviors = pickBehaviors(profile);
  const retargeting = buildRetargetingLayers(profile);
  const exclusions = buildExclusions(profile);

  const rawMap = {
    client_slug: slug,
    generated_at: new Date().toISOString(),
    mode: offline ? "offline_structure_only" : "live",
    geo: {
      primary: geoTargets[0] || (profile.location?.city ? `${profile.location.city}, ${profile.location.state || ""}`.trim() : null) || profile.location?.country || null,
      targets: geoTargets,
      radius: profile.location?.service_radius_miles || null,
      center: profile.location?.city ? `${profile.location.city}, ${profile.location.state || ""}`.trim() : null,
    },
    age_gender: {
      age_min: profile.audience?.age_low || profile.audience?.age_range?.[0] || 18,
      age_max: profile.audience?.age_high || profile.audience?.age_range?.[1] || 65,
      genders: profile.audience?.gender === "all" || profile.audience?.gender === "balanced" ? ["all"] : [profile.audience?.gender || "all"],
    },
    seed_terms_used: seeds,
    interest_clusters: clusters,
    behavior_segments: behaviors,
    retargeting_layers: retargeting,
    lookalike_strategy: lookalikeBlock,
    exclusions,
    diagnostics: {
      seed_count: seeds.length,
      cluster_count: clusters.length,
      custom_audiences_found: customAudiences?.length ?? null,
      issues: [],
    },
  };
  // Emit in canonical shape (clusters / geo.primary / cluster.interest_stack) so
  // /launch and /strategy-brief read the field names they expect.
  const map = audienceMapSchema.normalize(rawMap);

  if (clusters.length < MIN_CLUSTERS && !offline) {
    map.diagnostics.issues.push(`Fewer than ${MIN_CLUSTERS} clusters assembled — broaden product description or add explicit interests in profile.audience.interests`);
  }
  if (isTbd(acct.ad_account_id)) {
    map.diagnostics.issues.push("ad_account_id is TBD — ran in offline mode; rerun once real ID is set");
  }
  // Soft schema check — surface contract gaps in diagnostics without hard-failing
  // an offline/structure-only run. The launch-side gate enforces hard.
  const v = audienceMapSchema.validate(map);
  if (!v.ok) map.diagnostics.issues.push(...v.errors.map((e) => `schema: ${e}`));

  const outPath = resolve(ROOT, "clients", slug, "audience_map.json");
  writeFileSync(outPath, JSON.stringify(map, null, 2));

  console.log(JSON.stringify({
    slug,
    mode: map.mode,
    seeds: seeds.length,
    clusters: clusters.length,
    behaviors: behaviors.length,
    retargeting_layers: retargeting.length,
    lookalike_seed: lookalike.seed?.name || null,
    lookalike_health: lookalike.health,
    issues: map.diagnostics.issues,
    output: outPath,
  }, null, 2));
}

main().catch((e) => {
  console.error("[audience-map] FATAL:", e.message);
  process.exit(1);
});
