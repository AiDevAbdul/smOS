// scripts/lib/opportunity.js — account-level Opportunity Score (0–100).
//
// One headline number for "how much unrealized upside is sitting in this account
// right now", with an explainable component breakdown. It does NOT grade past
// performance (that's the report) — it quantifies actionable opportunity:
//   • proven winners with budget headroom (scale)
//   • spend bleeding on losers (reclaim)
//   • fatigued creative dragging efficiency (refresh)
// Higher = more money currently left on the table.
//
// Pure + deterministic so /analyze and tests share one definition.

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} a
 *   a.adsets  [{id, metrics:{last_7d:{spend,roas,frequency}}}]
 *   a.ads     [{id, metrics:{last_7d:{spend}}}]
 *   a.flags   [{entity_id, flag}]  (from classifyFlags / classifyAdsetFlags)
 *   a.kpis    normalized KPIs (for the frequency ceiling)
 * @returns {{score, components, reclaimable_spend, scalable_spend, fatigued_spend, recommendations}}
 */
export function opportunityScore({ adsets = [], ads = [], flags = [], kpis = {} }) {
  const adSpend = (id, rows) => {
    const e = rows.find((x) => x.id === id);
    return e?.metrics?.last_7d?.spend || 0;
  };
  const flagsOf = (set) => new Set(flags.filter((f) => set.includes(f.flag)).map((f) => f.entity_id));

  const totalSpend =
    adsets.reduce((s, x) => s + (x.metrics?.last_7d?.spend || 0), 0) ||
    ads.reduce((s, x) => s + (x.metrics?.last_7d?.spend || 0), 0) ||
    0;

  // Spend currently bleeding on pause candidates (ad-level flags).
  const pauseIds = flagsOf(["PAUSE_CANDIDATE_CPA", "PAUSE_CANDIDATE_ROAS", "PAUSE_CANDIDATE_CTR", "PAUSE_CANDIDATE_FREQUENCY"]);
  const reclaimable = [...pauseIds].reduce((s, id) => s + adSpend(id, ads), 0);

  // Spend on proven, significant winners (adset-level) — push budget here.
  const scaleIds = flagsOf(["SCALE_CANDIDATE"]);
  const scalable = [...scaleIds].reduce((s, id) => s + adSpend(id, adsets), 0);

  // Spend on fatigued creative — refresh to recover efficiency.
  const fatigueIds = flagsOf(["CREATIVE_FATIGUE"]);
  const fatigued = [...fatigueIds].reduce((s, id) => s + adSpend(id, ads), 0);

  // Ratios of total spend (0 when no spend yet → score 0, not NaN).
  const scaleRatio = totalSpend ? clamp01(scalable / totalSpend) : 0;
  const wasteRatio = totalSpend ? clamp01(reclaimable / totalSpend) : 0;
  const fatigueRatio = totalSpend ? clamp01(fatigued / totalSpend) : 0;

  const components = {
    scale: { weight: 0.45, ratio: r2(scaleRatio), points: r2(45 * scaleRatio) },
    reclaim: { weight: 0.35, ratio: r2(wasteRatio), points: r2(35 * wasteRatio) },
    refresh: { weight: 0.2, ratio: r2(fatigueRatio), points: r2(20 * fatigueRatio) },
  };
  const score = Math.round(components.scale.points + components.reclaim.points + components.refresh.points);

  const recommendations = [];
  if (scalable > 0) recommendations.push(`Scale $${r2(scalable)}/7d of proven winners (${scaleIds.size} adset${scaleIds.size === 1 ? "" : "s"}).`);
  if (reclaimable > 0) recommendations.push(`Reclaim $${r2(reclaimable)}/7d bleeding on ${pauseIds.size} pause candidate${pauseIds.size === 1 ? "" : "s"}.`);
  if (fatigued > 0) recommendations.push(`Refresh ${fatigueIds.size} fatigued creative${fatigueIds.size === 1 ? "" : "s"} ($${r2(fatigued)}/7d).`);
  if (!recommendations.length) recommendations.push("No major structural opportunity detected this window — maintain and monitor.");

  return {
    score,
    components,
    total_spend_7d: r2(totalSpend),
    reclaimable_spend_7d: r2(reclaimable),
    scalable_spend_7d: r2(scalable),
    fatigued_spend_7d: r2(fatigued),
    recommendations,
  };
}
