// scripts/lib/economics.js — account-level economics (B2).
//
// Turns raw platform totals (spend, conversions, conversion_value) plus the
// client's unit_economics (gross_margin, AOV, …) into the numbers a business
// owner actually cares about:
//
//   - blended MER       = total revenue / total ad spend (account-wide efficiency)
//   - breakeven ROAS    = 1 / gross_margin (below this, ads lose money on margin)
//   - target ROAS       = breakeven / desired margin-of-safety (default 1.0 ⇒ breakeven)
//   - new-customer CAC  = spend / new customers (when new-vs-returning is known)
//
// Every output is null when its inputs are absent — the caller renders "—" and
// never fabricates a number. This is intentionally pure + side-effect free so the
// math is unit-testable.

import { round } from "./metrics.js";

/**
 * @param {object} totals   { spend, conversions, conversion_value, new_customers? }
 * @param {object} economics normalized client_profile.unit_economics
 * @returns {object} economics block for the analysis/report
 */
export function computeEconomics(totals = {}, economics = {}) {
  const spend = num(totals.spend);
  const revenue = num(totals.conversion_value);
  const conversions = num(totals.conversions);
  const newCustomers = num(totals.new_customers);

  const gm = clampFraction(economics.gross_margin);
  const targetMer = num(economics.target_mer);
  const targetCac = num(economics.target_cac);

  // Blended MER = revenue / spend. (At a single-account level this equals ROAS,
  // but it is the canonical business metric and is named so the report reads in
  // owner language; once other channels feed `revenue` it generalizes cleanly.)
  const blended_mer = spend > 0 && revenue != null ? round(revenue / spend, 2) : null;

  // Margin-aware ROAS targets.
  const breakeven_roas = gm != null && gm > 0 ? round(1 / gm, 2) : null;
  // target ROAS = breakeven (a client can raise it via target_mer if they want profit headroom)
  const target_roas = targetMer != null ? targetMer : breakeven_roas;

  // Gross profit from ad-driven revenue, and profit AFTER ad spend (POAS-style).
  const gross_profit = gm != null && revenue != null ? round(revenue * gm, 2) : null;
  const profit_after_ads =
    gross_profit != null && spend != null ? round(gross_profit - spend, 2) : null;

  // New-customer CAC: prefer true new-customer count; fall back to all conversions
  // (flagged via cac_basis so the report never silently conflates the two).
  let nCAC = null;
  let cac_basis = null;
  if (spend > 0 && newCustomers > 0) {
    nCAC = round(spend / newCustomers, 2);
    cac_basis = "new_customers";
  } else if (spend > 0 && conversions > 0) {
    nCAC = round(spend / conversions, 2);
    cac_basis = "all_conversions";
  }

  return {
    blended_mer,
    target_mer: targetMer,
    breakeven_roas,
    target_roas,
    gross_margin: gm,
    gross_profit,
    profit_after_ads,
    nCAC,
    target_cac: targetCac,
    cac_basis,
    // verdicts: only when both sides exist
    mer_verdict:
      blended_mer != null && target_roas != null
        ? blended_mer >= target_roas
          ? "above_target"
          : "below_target"
        : null,
    cac_verdict:
      nCAC != null && targetCac != null ? (nCAC <= targetCac ? "healthy" : "over_target") : null,
  };
}

function num(v) {
  if (v == null || v === "" || Number.isNaN(Number(v))) return null;
  return Number(v);
}
function clampFraction(v) {
  const n = num(v);
  if (n == null) return null;
  return n > 1 ? n / 100 : n;
}
