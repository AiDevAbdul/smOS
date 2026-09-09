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

/**
 * A mention's depth fields (E5) are preserved when present but never invented:
 * `discovery` says whether we found it because the client was @-tagged or
 * because a keyword/hashtag/web query surfaced it untagged; `matched_terms`
 * records which watchlist terms it hit; `about_client` says whether the mention
 * is attributable to the client at all. `null` for any of them means unknown.
 */
export function normalizeMentionRow(m) {
  const row = {
    mention_id: pick(m, "mention_id", "id") ?? null,
    source: pick(m, "source", "platform") ?? null,
    platform: pick(m, "platform") ?? null,
    discovery: pick(m, "discovery") ?? null,
    text: pick(m, "text", "message") ?? "",
    sentiment: pick(m, "sentiment") ?? null,
    url: pick(m, "url", "link") ?? null,
    at: pick(m, "at", "timestamp", "created_time") ?? null,
    author: pick(m, "author") ?? null,
    matched_terms: pick(m, "matched_terms") ?? null,
    about_client: typeof m?.about_client === "boolean" ? m.about_client : null,
  };
  return row;
}

export function normalize(raw) {
  const r = raw || {};
  return {
    ...r,
    client_slug: pick(r, "client_slug", "slug") ?? null,
    captured_at: pick(r, "captured_at", "generated_at") ?? null,
    keywords: asArray(pick(r, "keywords", "tracked_terms")),
    hashtags: asArray(pick(r, "hashtags")),
    mentions: asArray(pick(r, "mentions")).map(normalizeMentionRow),
    competitors: asArray(pick(r, "competitors")).map(normalizeCompetitor),
    // Depth layers (E5). Absent → null, which reads as "not computed", not "zero".
    coverage: asArray(pick(r, "coverage")),
    mention_total: pick(r, "mention_total") ?? null,
    share_of_voice: pick(r, "share_of_voice") ?? null,
    crisis: pick(r, "crisis") ?? null,
  };
}

export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["listening_snapshot is not an object"]);
  if (!isNonEmptyString(obj.captured_at)) errors.push("captured_at missing — a snapshot must be timestamped to trend it");
  if (asArray(obj.competitors).length === 0 && asArray(obj.mentions).length === 0 && asArray(obj.coverage).length === 0) {
    errors.push("listening_snapshot has neither competitors nor mentions nor coverage — nothing captured");
  }
  asArray(obj.competitors).forEach((c, i) => {
    if (!isNonEmptyString(normalizeCompetitor(c).handle)) errors.push(`competitors[${i}] missing handle`);
  });
  // Coverage honesty (E5): a source that did not run must report `mentions: null`.
  // A 0 there would read as "we looked and found nothing", which is a lie.
  asArray(obj.coverage).forEach((c, i) => {
    if (!isNonEmptyString(c?.status)) { errors.push(`coverage[${i}] missing status`); return; }
    const ran = c.status === "ok" || c.status === "partial";
    if (!ran && c.mentions != null) {
      errors.push(`coverage[${i}] (${c.source}) has status "${c.status}" but a non-null mentions count — an unreached source must report null, never 0`);
    }
    if (ran && !Number.isFinite(c.mentions)) {
      errors.push(`coverage[${i}] (${c.source}) ran but has no mentions count`);
    }
  });
  return result(errors);
}
