// schemas/baseline_snapshot.js — canonical shape for /audit baseline output,
// consumed by /before-after to compute deltas. before-after refuses to run unless
// immutable_locked_at is set (the snapshot must be frozen before the engagement).
//
// Drift this fixes:
//   audit wrote: facebook.avg_engagement_rate, facebook.posts_per_week
//   before-after read: facebook.engagement_rate_30d, facebook.posts_per_week_30d,
//                      creative_quality.score_out_of_10, paid.pixel_events_per_month

import { pick, isFiniteNumber, isNonEmptyString, result } from "./_shared.js";

function normFacebook(f) {
  const fb = f || {};
  return {
    ...fb,
    engagement_rate_30d: pick(fb, "engagement_rate_30d", "avg_engagement_rate") ?? null,
    posts_per_week_30d: pick(fb, "posts_per_week_30d", "posts_per_week") ?? null,
  };
}

function normInstagram(i) {
  const ig = i || {};
  return {
    ...ig,
    engagement_rate_30d: pick(ig, "engagement_rate_30d", "avg_engagement_rate") ?? null,
    posts_per_week_30d: pick(ig, "posts_per_week_30d", "posts_per_week") ?? null,
  };
}

export function normalize(raw) {
  const r = raw || {};
  return {
    ...r,
    client_slug: pick(r, "client_slug", "slug") ?? null,
    captured_at: pick(r, "captured_at", "generated_at") ?? null,
    immutable_locked_at: pick(r, "immutable_locked_at") ?? null,
    facebook: normFacebook(pick(r, "facebook")),
    instagram: normInstagram(pick(r, "instagram")),
    creative_quality: {
      ...(pick(r, "creative_quality") || {}),
      score_out_of_10:
        pick(pick(r, "creative_quality") || {}, "score_out_of_10", "score") ??
        pick(r, "creative_quality_score") ??
        null,
    },
    paid: {
      ...(pick(r, "paid") || {}),
      pixel_events_per_month:
        pick(pick(r, "paid") || {}, "pixel_events_per_month") ??
        pick(r, "pixel_events_per_month") ??
        null,
    },
  };
}

/** Validate the snapshot is COMPLETE and LOCKED — what before-after requires. */
export function validate(obj, { requireLock = true } = {}) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["baseline_snapshot is not an object"]);
  if (requireLock && !isNonEmptyString(obj.immutable_locked_at)) {
    errors.push("baseline_snapshot.immutable_locked_at is not set (snapshot is not frozen)");
  }
  if (!isFiniteNumber(obj.facebook?.engagement_rate_30d)) {
    errors.push("baseline_snapshot.facebook.engagement_rate_30d is missing/non-numeric");
  }
  if (!isFiniteNumber(obj.facebook?.posts_per_week_30d)) {
    errors.push("baseline_snapshot.facebook.posts_per_week_30d is missing/non-numeric");
  }
  return result(errors);
}
