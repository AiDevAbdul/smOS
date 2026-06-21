// scripts/lib/metrics.js — ONE definition of every performance metric and KPI
// target, shared by /analyze, /report, /monthly-review, /scale.
//
// Before this, the four skills used three incompatible ROAS formulas, two CTR
// semantics, and read KPI targets from different shapes (analyze: flat
// kpis.cpa_target; report: nested kpis.leads.target_cpa; monthly: ignored them).
// That meant the same campaign could read as "scale" in one skill and "pause" in
// another. Everything now routes through here.

export function round(n, d) {
  if (n == null || !Number.isFinite(n)) return n;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/** First matching action_type value from a Meta actions/action_values array. */
export function findAction(actions, types) {
  if (!Array.isArray(actions)) return 0;
  for (const t of types) {
    const m = actions.find((a) => a.action_type === t);
    if (m) return +m.value;
  }
  return 0;
}

export const DEFAULT_PRIMARY_EVENTS = [
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "complete_registration",
  "lead",
];

/**
 * Canonical metric derivation from one Meta insights row.
 *
 * Semantics (fixed, single source of truth):
 *   - ctr / link_ctr: PERCENT (Meta's `ctr` field is already a percentage). When
 *     Meta omits it, we derive (clicks / impressions) * 100 so the unit matches.
 *   - roas: prefer Meta's purchase_roas; else conversion_value / spend.
 *   - cpa: spend / conversions (null when no conversions).
 */
export function deriveMetrics(ins, primaryEvents = DEFAULT_PRIMARY_EVENTS) {
  const spend = +ins?.spend || 0;
  const impressions = +ins?.impressions || 0;
  const clicks = +ins?.clicks || 0;
  const linkClicks = +ins?.inline_link_clicks || 0;
  const frequency = +ins?.frequency || 0;
  const reach = +ins?.reach || 0;
  // Prefer Meta's reported percentages; derive consistently (×100) if absent.
  const ctr = ins?.ctr != null ? +ins.ctr : (impressions ? (clicks / impressions) * 100 : 0);
  const linkCtr = ins?.inline_link_click_ctr != null
    ? +ins.inline_link_click_ctr
    : (impressions ? (linkClicks / impressions) * 100 : 0);
  const cpc = +ins?.cpc || 0;
  const cpm = +ins?.cpm || 0;
  const conversions = findAction(ins?.actions, primaryEvents);
  const conversionValue = findAction(ins?.action_values, primaryEvents);
  const cpa = conversions ? spend / conversions : null;
  const roas = +ins?.purchase_roas?.[0]?.value || (spend && conversionValue ? conversionValue / spend : null);

  return {
    spend: round(spend, 2),
    impressions,
    clicks,
    link_clicks: linkClicks,
    reach,
    frequency: round(frequency, 4),
    ctr: round(ctr, 4),
    link_ctr: round(linkCtr, 4),
    cpc: round(cpc, 2),
    cpm: round(cpm, 2),
    conversions,
    conversion_value: round(conversionValue, 2),
    cpa: cpa != null ? round(cpa, 2) : null,
    roas: roas != null ? round(roas, 4) : null,
  };
}

// Global fallbacks (mirror CLAUDE.md constitution thresholds + analyze.js defaults).
// NOTE: all CTR values are PERCENT (Meta's ctr / inline_link_click_ctr fields are
// already percentages). The old analyze.js default of 0.005 treated link_ctr as a
// fraction, so the CTR-floor pause never fired — corrected here to 0.5 (= 0.5%).
export const DEFAULT_KPIS = {
  cpa_target: 50,
  roas_target: 2.0,
  ctr_target: null, // percent; null = no explicit link-CTR goal
  pause_cpa_multiplier: 3,
  pause_cpa_min_spend: 50,
  pause_roas_floor: 1.0,
  pause_roas_min_spend: 100,
  pause_ctr_floor: 0.5, // percent (CLAUDE.md: CTR < 0.5%)
  pause_ctr_min_spend: 30,
  pause_frequency_ceiling: 4.0,
  scale_roas_floor: 3.0,
  fatigue_ctr_decay: 0.6,
  fatigue_frequency_min: 3.0,
};

const num = (v) => (v == null || v === "" || !Number.isFinite(+v) ? null : +v);

/**
 * Read KPI targets from a client profile regardless of whether they're stored
 * flat (kpis.cpa_target) or nested per-objective (kpis.leads.target_cpa). Returns
 * one canonical shape merged over DEFAULT_KPIS, so every skill sees the client's
 * real targets instead of silently falling back to globals.
 */
export function normalizeKpis(profile) {
  const k = profile?.kpis || {};
  const obj = k.leads || k.sales || k.conversions || {}; // nested objective block

  const cpa = num(k.cpa_target) ?? num(k.target_cpa) ?? num(obj.target_cpa) ?? num(obj.cpa_target);
  const roas = num(k.roas_target) ?? num(k.target_roas) ?? num(obj.target_roas) ?? num(obj.roas_target);
  const ctr =
    num(k.ctr_target) ?? num(k.target_ctr_link) ?? num(obj.target_ctr_link) ?? num(obj.ctr_target);

  return {
    ...DEFAULT_KPIS,
    ...k, // keep any extra flat overrides (pause multipliers etc.)
    cpa_target: cpa ?? DEFAULT_KPIS.cpa_target,
    roas_target: roas ?? DEFAULT_KPIS.roas_target,
    ctr_target: ctr ?? DEFAULT_KPIS.ctr_target,
  };
}
