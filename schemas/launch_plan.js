// schemas/launch_plan.js — canonical shape for /launch output (the executable plan).
// This is the artifact the E2E gate asserts on: every ad MUST have non-null
// copy_used, and no targeting may contain a <TBD_...> placeholder audience id.

import { pick, asArray, isNonEmptyString, result } from "./_shared.js";

const TBD_RE = /<?TBD[_>]/i;

function hasTbdAudience(adset) {
  const t = adset?.targeting || {};
  const ids = [
    ...asArray(t.custom_audiences).map((x) => pick(x, "id") ?? x),
    ...asArray(t.excluded_custom_audiences).map((x) => pick(x, "id") ?? x),
  ];
  return ids.some((id) => isNonEmptyString(id) && TBD_RE.test(id));
}

export function normalize(raw) {
  const r = raw || {};
  const campaigns = asArray(pick(r, "campaigns"));
  // launch writes a nested tree campaigns[].adsets[].ads[]; flatten to top-level
  // arrays so validation can sweep every ad/adset regardless of nesting. Explicit
  // top-level adsets/ads (if present) take precedence.
  let adsets = asArray(pick(r, "adsets"));
  let ads = asArray(pick(r, "ads"));
  if (adsets.length === 0 && ads.length === 0) {
    for (const c of campaigns) {
      for (const as of asArray(c.adsets)) {
        const aspay = as.payload || as;
        adsets.push({ ...aspay, name: aspay.name, targeting: aspay.targeting });
        for (const ad of asArray(as.ads)) ads.push(ad);
      }
    }
  }
  return { ...r, client_slug: pick(r, "client_slug", "slug") ?? null, campaigns, adsets, ads };
}

/**
 * Fail-closed launch validation. requireExecutable=true is the gate before a live
 * --execute: it rejects any ad without resolved copy and any adset with a TBD id.
 */
export function validate(obj, { requireExecutable = true } = {}) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["launch_plan is not an object"]);
  const ads = asArray(obj.ads);
  if (ads.length === 0) errors.push("launch_plan.ads is empty");

  if (requireExecutable) {
    ads.forEach((ad, i) => {
      const cu = ad.copy_used;
      if (!cu || typeof cu !== "object") {
        errors.push(`ads[${i}] (${ad.name || "?"}) has copy_used: null — creative→launch handoff failed`);
      } else if (!isNonEmptyString(cu.primary_text) && !isNonEmptyString(cu.headline)) {
        errors.push(`ads[${i}] (${ad.name || "?"}) copy_used has no primary_text or headline`);
      }
    });
    asArray(obj.adsets).forEach((as, i) => {
      if (hasTbdAudience(as)) {
        errors.push(`adsets[${i}] (${as.name || "?"}) references an unresolved <TBD_...> custom audience`);
      }
    });
  }
  return result(errors);
}
