// schemas/attribution_report.js — canonical shape for /attribution (Phase 3.1).
//
// Shifts reporting off naive last-click toward incrementality. Holds both the
// platform-reported incremental columns (Meta's Incremental Attribution / lift
// study output) and a derived comparison vs last-click so a report can show the
// gap honestly. Fail-closed validate refuses to publish a "lift" number that has
// no method attached — incrementality claims must be sourced.

import { pick, asArray, isFiniteNumber, isNonEmptyString, result } from "./_shared.js";

export const METHODS = ["meta_lift_study", "incremental_attribution", "geo_holdout", "ghost_ads", "modeled"];

export function normalizeCell(raw) {
  const r = raw || {};
  return {
    entity_id: pick(r, "entity_id", "campaign_id", "adset_id") ?? null,
    entity_name: pick(r, "entity_name", "name") ?? null,
    last_click_conversions: Number(pick(r, "last_click_conversions", "conversions") ?? 0) || 0,
    incremental_conversions: isFiniteNumber(pick(r, "incremental_conversions")) ? r.incremental_conversions : null,
    spend: Number(pick(r, "spend") ?? 0) || 0,
    incremental_cpa: isFiniteNumber(pick(r, "incremental_cpa")) ? r.incremental_cpa : null,
    incrementality_factor: isFiniteNumber(pick(r, "incrementality_factor", "lift")) ? pick(r, "incrementality_factor", "lift") : null,
    confidence: pick(r, "confidence") ?? null, // e.g. 0.9 or "p<0.05"
  };
}

export function normalize(raw) {
  const r = raw || {};
  return {
    ...r,
    client_slug: pick(r, "client_slug", "slug") ?? null,
    method: pick(r, "method") ?? null,
    period_start: pick(r, "period_start") ?? null,
    period_end: pick(r, "period_end") ?? null,
    rows: asArray(pick(r, "rows", "cells")).map(normalizeCell),
  };
}

export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["attribution_report is not an object"]);
  if (!isNonEmptyString(obj.method)) errors.push("method missing — an incrementality number must declare how it was measured");
  else if (!METHODS.includes(obj.method)) errors.push(`method "${obj.method}" not in ${METHODS.join("/")}`);
  const rows = asArray(obj.rows);
  if (rows.length === 0) errors.push("attribution_report.rows is empty");
  rows.forEach((raw, i) => {
    const c = normalizeCell(raw);
    if (!isNonEmptyString(c.entity_id)) errors.push(`rows[${i}] missing entity_id`);
    if (c.incremental_conversions == null && c.incrementality_factor == null) {
      errors.push(`rows[${i}] (${c.entity_name || c.entity_id}) has no incremental figure — would degrade to last-click`);
    }
  });
  return result(errors);
}
