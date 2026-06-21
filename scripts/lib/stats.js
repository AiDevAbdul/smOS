// scripts/lib/stats.js — statistical-significance helpers shared by /analyze and
// /scale. The optimizer previously acted on any ROAS/CTR breach regardless of
// sample size, so a winner crowned on 2 conversions or a "fatigue" call on 80
// impressions could trigger a real budget move. These gates make the engine
// refuse to act on noise.
//
// Pure, dependency-free, deterministic.

const Z_95 = 1.959963984540054; // two-sided 95%

/**
 * Wilson score interval lower bound for a proportion (e.g. CTR). More honest
 * than the normal approximation at small n. Returns a fraction in [0,1].
 */
export function wilsonLowerBound(successes, n, z = Z_95) {
  if (!n || n <= 0) return 0;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (center - margin) / denom);
}

/**
 * Two-proportion z-test. Returns { z, significant } at the given confidence.
 * Used to decide whether a 7d-vs-30d CTR change is real or just variance.
 * n1/n2 = impressions, x1/x2 = clicks (successes).
 */
export function twoProportionZ(x1, n1, x2, n2, z = Z_95) {
  if (!n1 || !n2 || n1 <= 0 || n2 <= 0) return { z: 0, significant: false };
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pPool = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, significant: false };
  const zStat = (p1 - p2) / se;
  return { z: zStat, significant: Math.abs(zStat) >= z };
}

/**
 * Minimum-conversions gate: is there enough conversion volume for a ROAS/CPA
 * read to be trustworthy enough to ACT on (scale budget / kill)? Below `min`
 * the metric is real but the sample is too thin to move money on.
 */
export function enoughConversions(conversions, min) {
  return Number.isFinite(conversions) && conversions >= min;
}

/**
 * Decision helper: should this adset's ROAS win trigger an AUTO scale, or only
 * a watch flag? Auto requires both the spend floor (caller's responsibility) and
 * a conversion-count floor so we never 1.2× a budget on a lucky single sale.
 */
export function scaleSignificance(conversions, minConversions) {
  const significant = enoughConversions(conversions, minConversions);
  return {
    significant,
    conversions: Number.isFinite(conversions) ? conversions : 0,
    min_conversions: minConversions,
    note: significant
      ? `${conversions} conversions ≥ ${minConversions} — sample sufficient`
      : `${conversions ?? 0} conversions < ${minConversions} — too thin to auto-scale`,
  };
}
