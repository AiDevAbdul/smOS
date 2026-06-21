// scripts/lib/organic_bench.js — derive organic competitor benchmark metrics
// from a list of recent IG media (as returned by IG Business Discovery). Pure +
// side-effect free so /listening and its tests share one calculator.

/**
 * @param {Array} media  recent posts: {like_count, comments_count, timestamp, media_type}
 * @param {number} followers  account follower count (for engagement rate)
 * @returns {{engagement_rate:number|null, posts_per_week:number|null, top_formats:string[]}}
 */
export function benchmarkFromMedia(media, followers) {
  if (!Array.isArray(media) || !media.length) return {};
  const eng = media.map((m) => (m.like_count || 0) + (m.comments_count || 0));
  const avgEng = eng.reduce((a, b) => a + b, 0) / eng.length;
  const engagement_rate = followers ? Number(((avgEng / followers) * 100).toFixed(2)) : null;

  // posting cadence: posts per week across the captured window
  const times = media.map((m) => Date.parse(m.timestamp)).filter(Number.isFinite).sort((a, b) => a - b);
  let posts_per_week = null;
  if (times.length >= 2) {
    const weeks = (times[times.length - 1] - times[0]) / (7 * 86400_000);
    posts_per_week = weeks > 0 ? Number((media.length / weeks).toFixed(1)) : null;
  }

  // top formats by frequency
  const fmt = {};
  for (const m of media) { const t = (m.media_type || "").toUpperCase(); if (t) fmt[t] = (fmt[t] || 0) + 1; }
  const top_formats = Object.entries(fmt).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);

  return { engagement_rate, posts_per_week, top_formats };
}
