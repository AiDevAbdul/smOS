#!/usr/bin/env node
/**
 * /launch companion script.
 *
 * Consumes approved strategy_brief.json + audience_map.json + ad_copy.json
 * and builds the full campaign/adset/ad tree on Meta. Everything PAUSED.
 *
 * Defaults to DRY RUN — prints the plan as JSON without hitting Meta. Pass
 * --execute to actually create entities.
 *
 * IMPORTANT: This script hits Graph API directly. The naming-check,
 * budget-guard, pixel-check, creative-compliance, and utm-enforcer hooks
 * are wired to the MCP server — they will NOT fire from this script. The
 * --dry-run plan should be reviewed by Claude (or a human) before --execute.
 *
 * Usage:
 *   node skills/launch/launch.js <client_slug> [--execute] [--phase A|B|C]
 *
 * Reads:  clients/<slug>/client_profile.json
 *         clients/<slug>/strategy_brief.json
 *         clients/<slug>/audience_map.json
 *         clients/<slug>/ad_copy.json
 * Writes: clients/<slug>/campaign_log.json
 *         clients/<slug>/launch_plan.json (always written, even in dry-run)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

// Naming convention regexes (mirrors hooks/naming-check.js)
const CAMPAIGN_NAME_RE = /^[A-Z]+_[A-Z0-9]+_\d{6}$/;
const ADSET_NAME_RE = /^[A-Z]+_\d{4}_[A-Z0-9]+$/;
const AD_NAME_RE = /^[A-Z]+_[A-Z0-9]+_v\d+$/;

const OBJECTIVE_CODE = {
  OUTCOME_SALES: "CONV",
  OUTCOME_LEADS: "LEADS",
  OUTCOME_TRAFFIC: "TRAFFIC",
  OUTCOME_ENGAGEMENT: "ENGAGE",
  OUTCOME_AWARENESS: "AWARE",
  OUTCOME_APP_PROMOTION: "APP",
};

const OPTIMIZATION_GOAL = {
  OUTCOME_SALES: "OFFSITE_CONVERSIONS",
  OUTCOME_LEADS: "LEAD_GENERATION",
  OUTCOME_TRAFFIC: "LINK_CLICKS",
  OUTCOME_ENGAGEMENT: "POST_ENGAGEMENT",
  OUTCOME_AWARENESS: "REACH",
};

const FORMAT_PLACEMENTS = {
  reels_15_30s: { publisher_platforms: ["facebook", "instagram"], facebook_positions: ["facebook_reels"], instagram_positions: ["reels", "story"] },
  carousel: { publisher_platforms: ["facebook", "instagram"], facebook_positions: ["feed"], instagram_positions: ["stream"] },
  single_image: { publisher_platforms: ["facebook", "instagram"], facebook_positions: ["feed"], instagram_positions: ["stream", "story"] },
  single_video: { publisher_platforms: ["facebook", "instagram"], facebook_positions: ["feed"], instagram_positions: ["stream", "reels"] },
};

const FORMAT_CODE = {
  reels_15_30s: "VID",
  single_video: "VID",
  carousel: "CAR",
  single_image: "IMG",
};

function yyyymm(d = new Date()) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function sanitizeCode(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16) || "AUD";
}

function audienceCodeFor(audience) {
  return sanitizeCode(audience.id);
}

function placementCode(format) {
  if (/reel/i.test(format)) return "REELS";
  if (/story/i.test(format)) return "STORY";
  return "FEED";
}

function buildCampaignName(phase, audience) {
  const objCode = OBJECTIVE_CODE[phase.objective] || "CUSTOM";
  const audCode = audienceCodeFor(audience);
  return `${objCode}_${audCode}_${yyyymm()}`;
}

function buildAdsetName(format, ageMin, ageMax, audience) {
  return `${placementCode(format)}_${ageMin}${ageMax}_${audienceCodeFor(audience)}`;
}

function buildAdName(format, hookCode, version) {
  return `${FORMAT_CODE[format] || "IMG"}_${sanitizeCode(hookCode)}_v${version}`;
}

function buildTargeting(audience, audienceMap, profile) {
  const map = audienceMap || {};
  const ageMin = map.age_gender?.age_min || profile.audience?.age_range?.[0] || 18;
  const ageMax = map.age_gender?.age_max || profile.audience?.age_range?.[1] || 65;
  const targeting = {
    age_min: ageMin,
    age_max: ageMax,
    genders: map.age_gender?.genders?.includes("all") || !map.age_gender?.genders ? undefined : (map.age_gender.genders.includes("male") ? [1] : [2]),
  };

  // Geo
  const geo = map.geo?.primary;
  if (geo?.type === "radius" && geo.center) {
    // Meta accepts custom_locations: [{address, radius, distance_unit}] — but you must geocode first.
    // Without geocoding here, fall back to country + ZIP whitelist if provided.
    if (map.geo.zip_whitelist_optional?.length) {
      targeting.geo_locations = { zips: map.geo.zip_whitelist_optional.map((zip) => ({ key: zip, country: profile.location?.country || "US" })) };
    } else {
      targeting.geo_locations = { countries: [profile.location?.country || "US"] };
    }
  } else if (Array.isArray(profile.audience?.geo_targets)) {
    targeting.geo_locations = { countries: profile.audience.geo_targets };
  } else {
    targeting.geo_locations = { countries: [profile.location?.country || "US"] };
  }

  // Source-specific layers
  if (audience.source === "broad") {
    // No interest layer
  } else if (audience.source === "interest_cluster") {
    const cluster = map.clusters?.find((c) => c.id === audience.id);
    if (cluster) {
      targeting.flexible_spec = [
        {
          interests: (cluster.interest_stack || []).map((name) => ({ name })),
          behaviors: (cluster.behavioral_add_ons || []).map((name) => ({ name })),
        },
      ];
    }
  } else if (audience.source === "retargeting" || audience.source === "lookalike") {
    targeting.custom_audiences = [{ id: `<TBD_${audience.id}>` }];
  }

  return targeting;
}

function buildAdsetPayload({ campaignId, adsetEntry, audience, audienceMap, profile, brief, angle }) {
  const acct = profile.accounts || {};
  const format = angle?.format || "single_image";
  const targeting = buildTargeting(audience, audienceMap, profile);
  const placement = FORMAT_PLACEMENTS[format] || FORMAT_PLACEMENTS.single_image;
  Object.assign(targeting, placement);

  const name = buildAdsetName(format, targeting.age_min, targeting.age_max, audience);
  const phase = brief.objective_hierarchy.find((p) => true);
  const objective = phase?.objective || "OUTCOME_TRAFFIC";

  const payload = {
    campaign_id: campaignId,
    name,
    status: "PAUSED",
    daily_budget: String(Math.round(adsetEntry.daily_budget * 100)), // cents
    billing_event: "IMPRESSIONS",
    optimization_goal: OPTIMIZATION_GOAL[objective] || "LINK_CLICKS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting,
    attribution_spec: [
      { event_type: "CLICK_THROUGH", window_days: 7 },
      { event_type: "VIEW_THROUGH", window_days: 1 },
    ],
  };

  if (objective === "OUTCOME_SALES" && !isTbd(acct.pixel_id)) {
    payload.promoted_object = {
      pixel_id: acct.pixel_id,
      custom_event_type: (profile.business?.conversion_events?.[0] || "PURCHASE").toUpperCase(),
    };
  }

  return payload;
}

function buildCampaignPayload({ phase, audience, profile, brief, dailyBudget }) {
  const name = buildCampaignName(phase, audience);
  return {
    ad_account_id: profile.accounts?.ad_account_id,
    name,
    objective: phase.objective,
    status: "PAUSED",
    daily_budget: String(Math.round(dailyBudget * 100)),
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    special_ad_categories: [],
  };
}

function buildCreativePayload({ profile, angle, copyVariant, adset }) {
  const acct = profile.accounts || {};
  return {
    name: `${angle.name}_${adset.name}`,
    object_story_spec: {
      page_id: acct.facebook_page_id,
      instagram_actor_id: acct.instagram_business_id,
      link_data: {
        message: copyVariant?.text || copyVariant?.primary_text || "",
        link: ensureUtms(profile.accounts?.website || profile.business?.primary_url || "", angle, adset),
        name: copyVariant?.headline || "",
        description: copyVariant?.description || "",
        call_to_action: { type: copyVariant?.cta || "LEARN_MORE" },
      },
    },
    degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: "OPT_OUT" } } },
  };
}

function ensureUtms(url, angle, adset) {
  if (!url) return url;
  const u = new URL(url, "https://example.invalid");
  if (u.host === "example.invalid") return url; // bail if not parseable
  if (!u.searchParams.get("utm_source")) u.searchParams.set("utm_source", "meta");
  if (!u.searchParams.get("utm_medium")) u.searchParams.set("utm_medium", "paid_social");
  if (!u.searchParams.get("utm_campaign")) u.searchParams.set("utm_campaign", adset.name);
  if (!u.searchParams.get("utm_content")) u.searchParams.set("utm_content", angle.name);
  return u.toString();
}

function validateNames(plan) {
  const issues = [];
  for (const c of plan.campaigns) {
    if (!CAMPAIGN_NAME_RE.test(c.payload.name)) issues.push(`campaign name '${c.payload.name}' violates convention`);
    for (const s of c.adsets) {
      if (!ADSET_NAME_RE.test(s.payload.name)) issues.push(`adset name '${s.payload.name}' violates convention`);
      for (const a of s.ads) {
        if (!AD_NAME_RE.test(a.name)) issues.push(`ad name '${a.name}' violates convention`);
      }
    }
  }
  return issues;
}

function selectTopCopy(angle, adCopy) {
  // Look up the angle in ad_copy.angles by name match
  const found = (adCopy?.angles || []).find((a) => {
    const tag = (a.angle_id || a.name || "").toUpperCase();
    return tag.includes(angle.name) || (angle.angle || "").toUpperCase().includes(tag);
  });
  if (!found) return null;
  const primary = (found.primary_text || []).sort((a, b) => (b.score?.composite || 0) - (a.score?.composite || 0))[0];
  const hook = (found.hooks || [])[0];
  const headline = (found.headlines || [])[0];
  return {
    text: primary?.text || hook || "",
    primary_text: primary?.text,
    headline,
    description: found.descriptions?.[0],
    cta: found.cta?.[0] || "LEARN_MORE",
    angle_id: found.angle_id,
  };
}

function buildPlan({ profile, brief, audienceMap, adCopy, phaseFilter }) {
  const phases = phaseFilter ? brief.objective_hierarchy.filter((p) => p.phase === phaseFilter) : brief.objective_hierarchy;
  // Only Phase A is launched on day 0; B/C are scheduled documents, not live entities yet.
  // For deterministic build, we still construct one campaign per audience for the current phase only.
  const livePhase = phases[0];
  const audiences = brief.audience_priority || [];
  const adsets = brief.budget_allocation?.adsets || [];
  const angles = brief.creative_angles || [];

  const campaigns = [];
  for (const a of audiences) {
    const adsetEntry = adsets.find((s) => s.audience_id === a.id);
    if (!adsetEntry) continue; // audience without budget allocation → skip

    const audience = a;
    const campaignPayload = buildCampaignPayload({
      phase: livePhase,
      audience,
      profile,
      brief,
      dailyBudget: adsetEntry.daily_budget,
    });

    // One adset per (audience × creative angle format)? Standard pattern: one adset per audience, multiple ads inside.
    const adsetPayload = buildAdsetPayload({
      campaignId: "<pending>",
      adsetEntry,
      audience,
      audienceMap,
      profile,
      brief,
      angle: angles[0],
    });

    const ads = angles.map((angle, idx) => {
      const copy = selectTopCopy(angle, adCopy);
      return {
        name: buildAdName(angle.format, angle.name, 1),
        angle: angle.name,
        format: angle.format,
        creative_payload: buildCreativePayload({ profile, angle, copyVariant: copy, adset: adsetPayload }),
        copy_used: copy ? { angle_id: copy.angle_id, headline: copy.headline, cta: copy.cta, score_composite: copy.score_composite } : null,
        warnings: copy ? [] : [`no matching ad_copy entry for angle '${angle.name}'`],
      };
    });

    campaigns.push({
      audience_id: audience.id,
      phase: livePhase.phase,
      payload: campaignPayload,
      adsets: [{ payload: adsetPayload, ads, audience_id: audience.id }],
    });
  }

  return { live_phase: livePhase, deferred_phases: phases.slice(1), campaigns };
}

async function executePlan(graph, plan, profile) {
  const acct = profile.accounts || {};
  const created = { campaigns: [], adsets: [], ads: [], errors: [] };

  for (const c of plan.campaigns) {
    try {
      const campRes = await graph.post(`/${graph.act(acct.ad_account_id)}/campaigns`, c.payload);
      created.campaigns.push({ id: campRes.id, name: c.payload.name });

      for (const s of c.adsets) {
        s.payload.campaign_id = campRes.id;
        // Serialize nested JSON fields per Meta's expectation
        const adsetBody = {};
        for (const [k, v] of Object.entries(s.payload)) {
          adsetBody[k] = v != null && typeof v === "object" ? JSON.stringify(v) : v;
        }
        try {
          const adsetRes = await graph.post(`/${graph.act(acct.ad_account_id)}/adsets`, adsetBody);
          created.adsets.push({ id: adsetRes.id, name: s.payload.name, campaign_id: campRes.id });

          for (const ad of s.ads) {
            try {
              // Create creative first
              const creativeBody = { name: ad.creative_payload.name };
              for (const [k, v] of Object.entries(ad.creative_payload)) {
                creativeBody[k] = v != null && typeof v === "object" ? JSON.stringify(v) : v;
              }
              const creativeRes = await graph.post(`/${graph.act(acct.ad_account_id)}/adcreatives`, creativeBody);

              const adRes = await graph.post(`/${graph.act(acct.ad_account_id)}/ads`, {
                name: ad.name,
                adset_id: adsetRes.id,
                creative: JSON.stringify({ creative_id: creativeRes.id }),
                status: "PAUSED",
              });
              created.ads.push({ id: adRes.id, name: ad.name, adset_id: adsetRes.id, creative_id: creativeRes.id });
            } catch (e) {
              created.errors.push({ stage: "ad", name: ad.name, error: e.message });
            }
          }
        } catch (e) {
          created.errors.push({ stage: "adset", name: s.payload.name, error: e.message });
        }
      }
    } catch (e) {
      created.errors.push({ stage: "campaign", name: c.payload.name, error: e.message });
      // Don't continue creating adsets under a failed campaign
    }
  }

  return created;
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  const execute = args.includes("--execute");
  const phaseIdx = args.indexOf("--phase");
  const phaseFilter = phaseIdx >= 0 ? args[phaseIdx + 1] : null;
  if (!slug) {
    console.error("Usage: node skills/launch/launch.js <slug> [--execute] [--phase A|B|C]");
    process.exit(1);
  }

  const dir = resolve(ROOT, "clients", slug);
  const profile = JSON.parse(readFileSync(resolve(dir, "client_profile.json"), "utf8"));
  const brief = existsSync(resolve(dir, "strategy_brief.json")) ? JSON.parse(readFileSync(resolve(dir, "strategy_brief.json"), "utf8")) : null;
  const audienceMap = existsSync(resolve(dir, "audience_map.json")) ? JSON.parse(readFileSync(resolve(dir, "audience_map.json"), "utf8")) : null;
  const adCopy = existsSync(resolve(dir, "ad_copy.json")) ? JSON.parse(readFileSync(resolve(dir, "ad_copy.json"), "utf8")) : null;

  const missing = [];
  if (!brief) missing.push("strategy_brief.json (run /strategy-brief)");
  if (!audienceMap) missing.push("audience_map.json (run /audience-map)");
  if (!adCopy) missing.push("ad_copy.json (run /creative)");
  if (missing.length) {
    console.error(`Missing inputs: ${missing.join(", ")}`);
    process.exit(2);
  }

  // Validation: brief must be approved if executing
  if (execute && brief.approval?.status !== "approved") {
    console.error(`Cannot --execute: strategy_brief.approval.status is '${brief.approval?.status || "pending"}'. Get Discord approval first.`);
    process.exit(3);
  }
  if (execute && isTbd(profile.accounts?.ad_account_id)) {
    console.error("accounts.ad_account_id is TBD");
    process.exit(4);
  }

  console.error(`[launch] ${slug} — building plan (phase=${phaseFilter || "first"})…`);
  const plan = buildPlan({ profile, brief, audienceMap, adCopy, phaseFilter });

  const nameIssues = validateNames(plan);
  if (nameIssues.length) {
    console.error(`[launch] naming issues:\n  - ${nameIssues.join("\n  - ")}`);
    if (execute) {
      console.error("Refusing to --execute with name violations. Fix the inputs and retry.");
      process.exit(5);
    }
  }

  // Always write the plan
  const planPath = resolve(dir, "launch_plan.json");
  writeFileSync(planPath, JSON.stringify({
    slug,
    generated_at: new Date().toISOString(),
    live_phase: plan.live_phase,
    deferred_phases: plan.deferred_phases,
    campaigns: plan.campaigns,
    naming_issues: nameIssues,
    mode: execute ? "EXECUTE" : "DRY_RUN",
  }, null, 2));
  console.error(`[launch] wrote ${planPath}`);

  let created = null;
  if (execute) {
    const graph = createGraph();
    created = await executePlan(graph, plan, profile);
    const logPath = resolve(dir, "campaign_log.json");
    writeFileSync(logPath, JSON.stringify({
      slug,
      generated_at: new Date().toISOString(),
      brief_phase: plan.live_phase.phase,
      created,
      next: created.errors.length ? "review errors before activation" : `reply 'activate' in Discord to set PAUSED → ACTIVE`,
    }, null, 2));
    console.error(`[launch] wrote ${logPath}`);
  }

  const summary = {
    slug,
    mode: execute ? "EXECUTE" : "DRY_RUN",
    phase: plan.live_phase.phase,
    objective: plan.live_phase.objective,
    campaigns_planned: plan.campaigns.length,
    adsets_planned: plan.campaigns.reduce((s, c) => s + c.adsets.length, 0),
    ads_planned: plan.campaigns.reduce((s, c) => s + c.adsets.reduce((sa, a) => sa + a.ads.length, 0), 0),
    naming_issues: nameIssues.length,
    created: created ? { campaigns: created.campaigns.length, adsets: created.adsets.length, ads: created.ads.length, errors: created.errors.length } : null,
    next: execute
      ? (created?.errors.length ? "review campaign_log.json errors" : "reply 'activate' in Discord to flip PAUSED → ACTIVE")
      : "review launch_plan.json, then rerun with --execute",
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error("[launch] FATAL:", e.message);
  process.exit(1);
});
