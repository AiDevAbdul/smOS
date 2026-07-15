// scripts/lib/refresh-loop.js — creative refresh loop (G5).
//
// /creative-intel already computes a fatigue-ranked refresh_queue but nothing
// consumed it. This closes the loop up to the human gate: for each fatiguing ad,
// build a refresh brief (angle inferred from the fatigue flag + the account's best
// historical hooks from the DAM), file a fail-closed approval request via
// scripts/lib/approvals.js, and once a human approves it, hand off a ready-to-draft
// brief that /creative reads to write copy and /launch turns into PAUSED replacement
// ads. This module never calls /launch itself and never auto-approves — the
// approval gate is the whole point (an untouched fatiguing ad keeps spending until
// a human clears its replacement).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import * as P from "./paths.js";
import { requestApproval, isApproved } from "./approvals.js";
import { loadIndex, topPerformers } from "./dam.js";

const REFRESH_ACTION = "creative_refresh";

// Fatigue flag → the creative angle worth trying next. Not a copy generator itself —
// /creative turns this into actual hooks/primary text/headlines.
const ANGLE_BY_FLAG = {
  FATIGUE_HIGH: "new_hook_same_offer",
  FATIGUE_MEDIUM: "new_hook_same_offer",
  STREAK_DECLINE: "reframe_pain_point",
  BURNOUT_SOON: "format_swap", // e.g. image -> video, or new visual treatment
};

function refreshBriefsPath(slug) {
  return P.clientFile(slug, "refresh_briefs.json", { forWrite: true });
}

function loadBriefs(slug) {
  const p = refreshBriefsPath(slug);
  if (!existsSync(p)) return { slug, briefs: [] };
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return { slug, briefs: [] }; }
}

function saveBriefs(slug, doc) {
  writeFileSync(refreshBriefsPath(slug), JSON.stringify(doc, null, 2));
  return doc;
}

/**
 * Build one refresh brief for a fatiguing ad. Pure except for the DAM read (local
 * file, no network) — asset history is the account's current best hooks by
 * hook_rate, since assets aren't joined 1:1 to a specific ad id in the DAM index.
 */
export function buildRefreshBrief(slug, ad) {
  const angle = ANGLE_BY_FLAG[ad.flag] || "new_hook_same_offer";
  const bestHooks = topPerformers(slug, { by: "hook_rate", limit: 5 }).map((a) => ({
    asset_id: a.asset_id,
    tags: a.tags,
    hook_rate: a.metrics?.hook_rate ?? null,
  }));
  return {
    ad_id: ad.id,
    ad_name: ad.name,
    campaign_id: ad.campaign_id,
    adset_id: ad.adset_id,
    flag: ad.flag,
    refresh_priority_score: ad.refresh_priority_score,
    angle,
    asset_history: bestHooks,
    status: "pending_approval",
    approval_id: null,
  };
}

/**
 * For the top N ads in creative_intel.json's refresh_queue, file (or reuse) an
 * approval request and persist a refresh_briefs.json entry per ad. Idempotent —
 * re-running does not file a duplicate request for an ad that already has one
 * pending/approved.
 */
export async function spawnRefreshQueue(slug, creativeIntel, { limit = 5 } = {}) {
  const queue = (creativeIntel?.refresh_queue || []).slice(0, limit);
  const doc = loadBriefs(slug);
  const existingByAd = new Map(doc.briefs.map((b) => [b.ad_id, b]));
  const spawned = [];

  for (const ad of queue) {
    let brief = existingByAd.get(ad.id);
    if (brief && brief.status !== "rejected" && brief.status !== "expired") {
      spawned.push(brief);
      continue;
    }
    brief = buildRefreshBrief(slug, ad);
    const rec = await requestApproval({
      slug,
      action: REFRESH_ACTION,
      summary: `Refresh fatiguing ad "${ad.name}" (${ad.flag}, priority ${ad.refresh_priority_score})`,
      payload: { ad_id: ad.id, angle: brief.angle, flag: ad.flag },
    });
    brief.approval_id = rec.approval_id;
    existingByAd.set(ad.id, brief);
    spawned.push(brief);
  }

  doc.slug = slug;
  doc.generated_at = new Date().toISOString();
  doc.briefs = [...existingByAd.values()];
  saveBriefs(slug, doc);
  return { spawned, path: refreshBriefsPath(slug) };
}

/**
 * Promote any brief whose approval has since been granted to "ready_for_creative"
 * so /creative can pick it up. Never auto-approves — only reflects decisions
 * already recorded via approvals.decide().
 */
export function collectApprovedRefreshes(slug) {
  const doc = loadBriefs(slug);
  let changed = false;
  for (const brief of doc.briefs) {
    if (brief.status !== "pending_approval") continue;
    if (brief.approval_id && isApproved(brief.approval_id)) {
      brief.status = "ready_for_creative";
      changed = true;
    }
  }
  if (changed) saveBriefs(slug, doc);
  return doc.briefs.filter((b) => b.status === "ready_for_creative");
}

export { REFRESH_ACTION };
