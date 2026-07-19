// schemas/competitor_intel.js — canonical shape for /research output, consumed by
// /strategy-brief (which reads competitor_intel.angles to pick creative angles).
//
// Drift history:
//   - research wrote { competitors, gaps } but never an `angles` array;
//     strategy-brief reads `.angles` and got [] every time.
//   - Synthesis mode (generic_keyword_synthesis) wrote non-standard keys:
//     `gaps_for_blue_rose_to_exploit`, `winning_recipe_recommendation`,
//     `category_landscape`. normalize() now maps these to canonical keys.
//   - `gaps` was sometimes None/null — normalize() now always returns an array,
//     computing gaps from angle data when none are provided.

import { pick, asArray, isNonEmptyString, result } from "./_shared.js";

// The 6-theme angle taxonomy (from classifier.py / domain-standards).
const ANGLE_TAXONOMY = ["pain", "aspiration", "social_proof", "urgency", "price", "authority"];

// Gap type enum.
const GAP_TYPES = ["format", "angle", "offer", "voice"];

function normAngle(a) {
  if (isNonEmptyString(a)) return { angle: a.trim(), frequency: null, fit_for_client: null, use_for: [], notes: "" };
  const o = a || {};
  return {
    ...o,
    angle: pick(o, "angle", "name", "theme") ?? "",
    frequency: pick(o, "frequency") ?? null,
    fit_for_client: pick(o, "fit_for_client", "fit") ?? null,
    use_for: asArray(pick(o, "use_for")),
    notes: pick(o, "notes") ?? "",
  };
}

function normGap(g) {
  if (isNonEmptyString(g)) return { type: "angle", observation: g.trim(), recommended_angle: "", frequency_pct: null, fit_score: "medium" };
  const o = g || {};
  return {
    type: pick(o, "type") ?? "angle",
    observation: pick(o, "observation", "description", "gap") ?? "",
    recommended_angle: pick(o, "recommended_angle", "recommendation") ?? "",
    frequency_pct: pick(o, "frequency_pct") ?? null,
    fit_score: pick(o, "fit_score") ?? "medium",
  };
}

/** Detect mode from raw data: explicit field, or infer from shape. */
function detectMode(r) {
  if (isNonEmptyString(r.mode)) return r.mode;
  if (r.gaps_for_blue_rose_to_exploit || r.winning_recipe_recommendation || r.category_landscape) return "synthesis";
  if (Array.isArray(r.competitors) && r.competitors.length > 0) return "live";
  return "synthesis";
}

/**
 * Derive gaps from angles when no explicit gaps array is present. Identifies
 * under-served angles (frequency tagged as uncommon/uncommon_locally/rare/null)
 * with high or very_high client fit — these are whitespace the client should own.
 */
function deriveGapsFromAngles(angles) {
  const gaps = [];
  const LOW_FREQ = new Set(["uncommon", "uncommon_locally", "rare", null, undefined]);
  const HIGH_FIT = new Set(["high", "very_high"]);
  for (const a of angles) {
    const freq = typeof a.frequency === "string" ? a.frequency.toLowerCase() : a.frequency;
    const fit = typeof a.fit_for_client === "string" ? a.fit_for_client.toLowerCase() : a.fit_for_client;
    if (LOW_FREQ.has(freq) && HIGH_FIT.has(fit)) {
      gaps.push({
        type: "angle",
        observation: `"${a.angle}" is ${freq || "unobserved"} among competitors but fits the client well`,
        recommended_angle: a.angle,
        frequency_pct: null,
        fit_score: a.fit_for_client ?? "high",
      });
    }
  }
  return gaps;
}

export function normalize(raw) {
  const r = raw || {};
  const mode = detectMode(r);
  const competitors = asArray(pick(r, "competitors", "pages"));

  // ── Map synthesis-mode keys to canonical ones ──
  const landscapeSummary = pick(r, "landscape_summary", "category_landscape") ?? null;
  const recommendedStrategy = pick(r, "recommended_strategy", "winning_recipe_recommendation") ?? null;

  // ── Angles: always an array, never null ──
  let angles = asArray(pick(r, "angles"));
  if (angles.length === 0) {
    const seen = new Set();
    for (const c of competitors) {
      for (const a of asArray(pick(c, "angles"))) {
        const norm = normAngle(a);
        const key = (norm.angle || "").toUpperCase();
        if (key && !seen.has(key)) { seen.add(key); angles.push(norm); }
      }
    }
  } else {
    angles = angles.map(normAngle);
  }

  // ── Gaps: always an array, never null ──
  // Accept canonical `gaps` or the synthesis-mode `gaps_for_*_to_exploit` alias.
  let gaps = asArray(pick(r, "gaps", "gaps_for_blue_rose_to_exploit"));
  if (gaps.length > 0) {
    gaps = gaps.map(normGap);
  } else {
    // No gaps provided — derive from angle data.
    gaps = deriveGapsFromAngles(angles);
  }

  // Build canonical output. Spread first so canonical keys always win.
  const out = {
    ...r,
    client_slug: pick(r, "client_slug", "slug") ?? null,
    mode,
    competitors,
    angles,
    gaps,
  };

  // Attach mapped synthesis-mode fields under canonical names.
  if (landscapeSummary) out.landscape_summary = landscapeSummary;
  if (recommendedStrategy) out.recommended_strategy = recommendedStrategy;

  // Remove non-canonical aliases from output to prevent downstream confusion.
  delete out.gaps_for_blue_rose_to_exploit;
  delete out.winning_recipe_recommendation;
  delete out.category_landscape;
  delete out.pages; // alias for competitors

  return out;
}

export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["competitor_intel is not an object"]);
  if (!Array.isArray(obj.angles)) errors.push("competitor_intel.angles must be an array");
  if (!Array.isArray(obj.gaps)) errors.push("competitor_intel.gaps must be an array");
  // mode should be one of the known values when present.
  if (obj.mode && !["live", "synthesis", "generic_keyword_synthesis"].includes(obj.mode)) {
    errors.push(`competitor_intel.mode "${obj.mode}" is not a recognized mode`);
  }
  // angles MAY legitimately be empty when competitor URLs don't resolve; that is a
  // degraded-but-valid state. strategy-brief handles empty by using its defaults.
  return result(errors);
}
