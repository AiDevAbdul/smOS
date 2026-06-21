// scripts/lib/lift_study.js — map a Meta Conversion Lift study response to
// attribution_report rows. Pure + side-effect free so /attribution and its tests
// share one mapper.
//
// HONESTY CONTRACT: keep ONLY cells that carry a real incremental figure
// (incremental conversions or a lift factor). If the study's result shape
// doesn't expose one — still running, wrong study type, unexpected schema — the
// cell is skipped, so the caller HALTs rather than dressing last-click up as
// lift. We never synthesize an incremental number.

export function mapLiftStudy(study) {
  const cells = study?.cells?.data || study?.cells || [];
  const rows = [];
  for (const cell of cells) {
    // Lift studies expose results either as a results array/object or a
    // result_set blob depending on study type and API version.
    const r = cell.results || cell.result_set || {};
    const incremental = r.incremental_conversions ?? r.incremental ?? cell.incremental_conversions;
    const lift = r.lift ?? r.relative_lift ?? cell.lift;
    if (incremental == null && lift == null) continue; // not measurable → skip
    rows.push({
      entity_id: cell.id || cell.name || study.id || null,
      entity_name: cell.name || study.name || null,
      last_click_conversions: Number(r.control_conversions ?? r.last_click_conversions ?? 0) || 0,
      incremental_conversions: incremental != null ? Number(incremental) : null,
      spend: Number(r.spend ?? cell.spend ?? 0) || 0,
      incremental_cpa: r.incremental_cpa != null ? Number(r.incremental_cpa) : null,
      incrementality_factor: lift != null ? Number(lift) : null,
      confidence: r.confidence ?? r.p_value ?? null,
    });
  }
  return rows;
}
