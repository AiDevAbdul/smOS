// scripts/lib/video_scoring.js — score video creative on HOOK + RETENTION (B3).
//
// A video ad lives or dies in the first 3 seconds and on how many viewers it
// holds — NOT on its thumbnail (what the image vision-scorer measures). This
// turns Meta video-play metrics into the numbers that actually predict winners:
//
//   hook_rate      = 3s views / impressions      (did the thumb-stop work?)
//   thruplay_rate  = thruplays / impressions      (15s or full-video view)
//   hold_rate      = p75 watched / video plays    (kept them past the midpoint?)
//   completion     = p100 watched / video plays
//   avg_pct        = avg seconds watched / length  (depth of attention)
//
// Everything degrades to null when its inputs are absent — never fabricated.
// Pure + side-effect free so the scoring is unit-testable.

const HOOK_GOOD = 0.25; // ≥25% 3s-view rate is a strong hook (industry rule of thumb)
const HOOK_OK = 0.15;
const HOLD_GOOD = 0.4; // ≥40% reach p75 = strong retention
const HOLD_OK = 0.2;

/**
 * @param {object} m raw Meta video metrics (already summed to numbers):
 *   { impressions, video_3s_views, thruplays, video_plays,
 *     p25, p50, p75, p100, avg_time_watched_sec, video_length_sec }
 * @returns {object} scored block with a 1–10 composite + a plain-English diagnosis
 */
export function computeVideoScore(m = {}) {
  const impressions = num(m.impressions);
  const v3s = num(m.video_3s_views);
  const thru = num(m.thruplays);
  const plays = num(m.video_plays) ?? v3s; // fall back to 3s views as the play base
  const p75 = num(m.p75);
  const p100 = num(m.p100);
  const avgWatched = num(m.avg_time_watched_sec);
  const length = num(m.video_length_sec);

  const hook_rate = ratio(v3s, impressions);
  const thruplay_rate = ratio(thru, impressions);
  const hold_rate = ratio(p75, plays);
  const completion_rate = ratio(p100, plays);
  const avg_pct_watched = ratio(avgWatched, length);

  // Composite 1–10: hook (40%) + hold (40%) + completion (20%), each mapped to a
  // 0–10 sub-score against the thresholds above. Skip a component if its input is
  // missing and renormalize the weights so a partial signal still scores.
  const parts = [];
  if (hook_rate != null) parts.push({ w: 0.4, v: band(hook_rate, HOOK_OK, HOOK_GOOD) });
  if (hold_rate != null) parts.push({ w: 0.4, v: band(hold_rate, HOLD_OK, HOLD_GOOD) });
  if (completion_rate != null) parts.push({ w: 0.2, v: band(completion_rate, 0.05, 0.2) });
  let score = null;
  if (parts.length) {
    const wsum = parts.reduce((s, p) => s + p.w, 0);
    score = round(parts.reduce((s, p) => s + p.w * p.v, 0) / wsum, 1);
  }

  return {
    hook_rate: pct(hook_rate),
    thruplay_rate: pct(thruplay_rate),
    hold_rate: pct(hold_rate),
    completion_rate: pct(completion_rate),
    avg_pct_watched: pct(avg_pct_watched),
    score,
    diagnosis: diagnose(hook_rate, hold_rate),
  };
}

function diagnose(hook, hold) {
  if (hook == null && hold == null) return "no video metrics available";
  if (hook != null && hook < HOOK_OK) return "weak hook — viewers scroll past in the first 3s; rework the opening frame";
  if (hold != null && hold < HOLD_OK) return "hook lands but retention collapses by the midpoint — tighten the middle / add pattern interrupts";
  if (hook != null && hook >= HOOK_GOOD && hold != null && hold >= HOLD_GOOD) return "strong hook + retention — a scaling candidate";
  return "solid; iterate on the weaker of hook vs hold";
}

// 0–10 sub-score: <ok → 0–4, ok..good → 4–7, ≥good → 7–10 (linear within bands).
function band(v, ok, good) {
  if (v <= 0) return 0;
  if (v < ok) return round((v / ok) * 4, 2);
  if (v < good) return round(4 + ((v - ok) / (good - ok)) * 3, 2);
  return round(Math.min(10, 7 + ((v - good) / good) * 3), 2);
}

function ratio(a, b) {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}
function pct(v) {
  return v == null ? null : round(v * 100, 1);
}
function num(v) {
  if (v == null || v === "" || Number.isNaN(Number(v))) return null;
  return Number(v);
}
function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
