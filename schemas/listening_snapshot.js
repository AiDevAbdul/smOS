// schemas/listening_snapshot.js — canonical shape for Social Listening + organic
// competitor benchmarking (Phase 3.3).
//
// Today competitor tracking is ads-only (Ad Library). This adds the ORGANIC side:
// follower growth, posting cadence, engagement rate per competitor, plus brand
// mentions/keywords tracked over time. Producer = /listening; consumers =
// strategy-brief (feeds the next brief) + portal.

import { pick, asArray, isFiniteNumber, isNonEmptyString, result } from "./_shared.js";

export function normalizeCompetitor(raw) {
  const r = raw || {};
  return {
    handle: pick(r, "handle", "username", "name") ?? null,
    platform: (pick(r, "platform") || "instagram").toLowerCase(),
    followers: Number(pick(r, "followers", "follower_count") ?? 0) || 0,
    follower_growth_30d: isFiniteNumber(pick(r, "follower_growth_30d")) ? r.follower_growth_30d : null,
    posts_per_week: isFiniteNumber(pick(r, "posts_per_week", "cadence")) ? pick(r, "posts_per_week", "cadence") : null,
    engagement_rate: isFiniteNumber(pick(r, "engagement_rate")) ? r.engagement_rate : null,
    top_formats: asArray(pick(r, "top_formats")),
  };
}

export function normalize(raw) {
  const r = raw || {};
  return {
    ...r,
    client_slug: pick(r, "client_slug", "slug") ?? null,
    captured_at: pick(r, "captured_at", "generated_at") ?? null,
    keywords: asArray(pick(r, "keywords", "tracked_terms")),
    mentions: asArray(pick(r, "mentions")).map((m) => ({
      source: pick(m, "source", "platform") ?? null,
      text: pick(m, "text", "message") ?? "",
      sentiment: pick(m, "sentiment") ?? null,
      url: pick(m, "url", "link") ?? null,
      at: pick(m, "at", "timestamp", "created_time") ?? null,
    })),
    competitors: asArray(pick(r, "competitors")).map(normalizeCompetitor),
  };
}

export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["listening_snapshot is not an object"]);
  if (!isNonEmptyString(obj.captured_at)) errors.push("captured_at missing — a snapshot must be timestamped to trend it");
  if (asArray(obj.competitors).length === 0 && asArray(obj.mentions).length === 0) {
    errors.push("listening_snapshot has neither competitors nor mentions — nothing captured");
  }
  asArray(obj.competitors).forEach((c, i) => {
    if (!isNonEmptyString(normalizeCompetitor(c).handle)) errors.push(`competitors[${i}] missing handle`);
  });
  return result(errors);
}
