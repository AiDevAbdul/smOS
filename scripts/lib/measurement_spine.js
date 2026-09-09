// scripts/lib/measurement_spine.js — ONE measurement spine shared by
// /capi-setup and /attribution (Group E, task E4).
//
// Why this exists. smOS had two disconnected halves of the same question:
//
//   /capi-setup  knew whether events fired and how much of the traffic was
//                covered server-side, but only as a point-in-time snapshot —
//                nothing recorded whether match quality was getting better or
//                worse after the dev "fixed" it.
//   /attribution knew about incrementality, but re-derived its own view of
//                conversion quality and had no idea what the pixel's Event
//                Match Quality was, so a lift number could be published on top
//                of a dataset matching 2.1/10 without a word about it.
//
// This module is the single record both skills read and write:
//
//   clients/<slug>/data/measurement_spine.json
//     { version, slug, emq_series: [snapshot…], reconciliations: [rec…] }
//
// /capi-setup appends (it is the skill that talks to the dataset), /attribution
// consumes (JSON handoff, per the Token Efficiency Rules — it never re-pulls).
//
// The honesty rules encoded here, because each one is a way a confident wrong
// number could ship:
//
//   - An EMQ score Meta did not return is `null` ("unknown"), never 0 and never
//     an assumed default. A 0 would read as "catastrophically bad matching" and
//     trigger work on a dataset that may be perfectly healthy.
//   - A trend needs two real samples. One snapshot has no direction; a second
//     snapshot whose score is unknown does not become "flat".
//   - A coverage ratio with a zero or unknown denominator is `null` WITH a
//     stated reason — never 1.0, never Infinity, never silently dropped.
//   - Every conversion count carries which side it came from and whether that
//     side is platform-reported (Meta's modeled/attributed number) or audited
//     (a CRM/server-side count a human can trace to records). CLAUDE.md
//     requires reports to say which; that can only survive if the record says.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import * as P from "./paths.js";

export const SPINE_VERSION = 1;

/** Keep a year of daily snapshots; older ones are pruned (count reported). */
export const SERIES_MAX = 365;

/**
 * Meta's own Event Match Quality bands (Events Manager / Dataset Quality API).
 * Encoded as data so a band never gets hand-waved in prose.
 */
export const EMQ_BANDS = [
  { band: "great", min: 8.0 },
  { band: "good", min: 6.0 },
  { band: "ok", min: 4.0 },
  { band: "poor", min: 0 },
];

/** Below this an EMQ score is worth a gap line of its own. */
export const EMQ_ACTION_THRESHOLD = 6.0;

/** How far a score must move before it is a direction rather than noise. */
export const EMQ_NOISE_FLOOR = 0.1;

/** A coverage ratio inside ±5% of 1.0 counts as aligned. */
export const COVERAGE_TOLERANCE = 0.05;

const round = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);

/** `null` for anything that is not a real, finite, non-negative count. */
export function asCount(v) {
  const n = num(v);
  return n != null && n >= 0 ? n : null;
}

export function emqBand(score) {
  if (!Number.isFinite(score)) return null; // unknown stays unknown
  for (const b of EMQ_BANDS) if (score >= b.min) return b.band;
  return null;
}

// ─────────────────────────── storage ───────────────────────────

export function spinePath(slug, { forWrite = false } = {}) {
  return P.clientFile(slug, "measurement_spine.json", { forWrite });
}

export function emptySpine(slug) {
  return { version: SPINE_VERSION, slug, updated_at: null, emq_series: [], reconciliations: [] };
}

export function loadSpine(slug) {
  const p = spinePath(slug);
  if (!existsSync(p)) return emptySpine(slug);
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    if (!raw || typeof raw !== "object") return emptySpine(slug);
    return {
      ...emptySpine(slug),
      ...raw,
      emq_series: Array.isArray(raw.emq_series) ? raw.emq_series : [],
      reconciliations: Array.isArray(raw.reconciliations) ? raw.reconciliations : [],
    };
  } catch {
    // A corrupt spine must not block a verification run, but it must not be
    // reported as "no history" either — the caller sees `corrupt: true`.
    return { ...emptySpine(slug), corrupt: true };
  }
}

export function saveSpine(slug, spine) {
  const p = spinePath(slug, { forWrite: true });
  writeFileSync(p, JSON.stringify({ ...spine, updated_at: new Date().toISOString() }, null, 2));
  return p;
}

function prune(series) {
  if (series.length <= SERIES_MAX) return { series, pruned: 0 };
  return { series: series.slice(series.length - SERIES_MAX), pruned: series.length - SERIES_MAX };
}

// ──────────────────── Meta Dataset Quality parsing ────────────────────

/**
 * Normalize a Dataset Quality API response into per-event EMQ.
 *
 * Meta has shipped this payload in several shapes (a flat `data[]` of events, a
 * `data[0].web[]` split by channel, and a bare `web[]`), so the parser walks all
 * of them rather than assuming one. Anything it cannot find is `null` with a
 * reason — it never substitutes a default.
 *
 * Endpoint (v25.0):
 *   GET /dataset_quality?dataset_id=<pixel>&fields=web{event_name,
 *       event_match_quality{composite_score,match_key_feedback{identifier,coverage}}}
 *
 * @returns {{ok: boolean, reason: string|null, events: Array}}
 */
export function parseDatasetQuality(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "no_response", events: [] };
  if (raw.error) {
    const msg = typeof raw.error === "string" ? raw.error : raw.error.message || "api_error";
    return { ok: false, reason: `api_error: ${msg}`, events: [] };
  }

  // Collect every object that looks like an event-quality node.
  const nodes = [];
  const visit = (v, depth = 0) => {
    if (!v || depth > 4) return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    if (typeof v !== "object") return;
    if (v.event_name || v.event_match_quality) nodes.push(v);
    for (const key of ["data", "web", "app", "offline", "channels"]) {
      if (v[key]) visit(v[key], depth + 1);
    }
  };
  visit(raw);

  if (!nodes.length) return { ok: false, reason: "no_event_match_quality_in_response", events: [] };

  const events = nodes.map((n) => normalizeEmqEvent(n)).filter((e) => e.event_name || e.composite_score != null);
  if (!events.length) return { ok: false, reason: "no_event_match_quality_in_response", events: [] };
  return { ok: true, reason: null, events };
}

function normalizeEmqEvent(node) {
  const q = node.event_match_quality && typeof node.event_match_quality === "object" ? node.event_match_quality : {};
  const rawScore = q.composite_score ?? q.score ?? (typeof node.event_match_quality === "number" ? node.event_match_quality : null);
  const score = num(rawScore);
  const feedback = Array.isArray(q.match_key_feedback) ? q.match_key_feedback : [];
  const match_keys = feedback.map((k) => {
    const cov = k?.coverage;
    const pct = num(typeof cov === "object" && cov ? (cov.percentage ?? cov.value) : cov);
    return {
      identifier: k?.identifier ?? k?.match_key ?? null,
      // Reported verbatim in the API's own unit (a percentage per the docs).
      // Guessing between 0–1 and 0–100 would silently move a coverage figure by
      // two orders of magnitude, so an unparseable coverage is null.
      coverage_pct: pct,
      potential_increase: num(k?.potential_aly_acr_increase ?? k?.potential_increase),
    };
  });
  return {
    event_name: node.event_name ?? null,
    composite_score: score, // null = Meta did not return it
    band: emqBand(score),
    match_keys,
    match_keys_available: match_keys.length > 0,
  };
}

// ──────────────────────── EMQ time series ────────────────────────

/**
 * Build (but do not persist) one EMQ snapshot.
 * `source` says how it was obtained: "dataset_quality_api" | "offline" | "manual".
 */
export function buildEmqSnapshot({ pixel_id, events = [], source = "dataset_quality_api", captured_at = new Date().toISOString(), unavailable_reason = null } = {}) {
  const scored = events.filter((e) => Number.isFinite(e.composite_score));
  return {
    captured_at,
    pixel_id: pixel_id ?? null,
    source,
    unavailable_reason: unavailable_reason ?? null,
    events: events.map((e) => ({
      event_name: e.event_name ?? null,
      composite_score: Number.isFinite(e.composite_score) ? round(e.composite_score, 2) : null,
      band: emqBand(e.composite_score),
      match_keys: Array.isArray(e.match_keys) ? e.match_keys : [],
      match_keys_available: !!e.match_keys_available,
    })),
    // A dataset-level average is only meaningful over the events that HAVE a
    // score; averaging unknowns as zero would drag it toward "poor".
    dataset_avg_score: scored.length ? round(scored.reduce((s, e) => s + e.composite_score, 0) / scored.length, 2) : null,
    scored_events: scored.length,
    unknown_events: events.length - scored.length,
  };
}

/** Identity of a snapshot for dedupe: same pixel, same day, same scores. */
function snapshotFingerprint(s) {
  const day = String(s.captured_at || "").slice(0, 10);
  const scores = (s.events || []).map((e) => `${e.event_name}=${e.composite_score ?? "null"}`).sort().join(",");
  return `${s.pixel_id || ""}|${day}|${s.source}|${scores}`;
}

/**
 * Append an EMQ snapshot to the client's series.
 *
 * Re-running /capi-setup twice in a day with identical scores does NOT create a
 * second point (it would fake a denser history and a fake "flat" trend), unless
 * the caller passes `dedupe:false`.
 */
export function recordEmqSnapshot(slug, snapshot, { dedupe = true, spine = null } = {}) {
  const current = spine || loadSpine(slug);
  const series = [...current.emq_series];
  if (dedupe) {
    const fp = snapshotFingerprint(snapshot);
    if (series.some((s) => snapshotFingerprint(s) === fp)) {
      return { spine: current, appended: false, reason: "duplicate_snapshot", trends: summarizeEmqTrends(series) };
    }
  }
  series.push(snapshot);
  const { series: kept, pruned } = prune(series);
  const next = { ...current, emq_series: kept };
  saveSpine(slug, next);
  return { spine: next, appended: true, reason: null, pruned, trends: summarizeEmqTrends(kept) };
}

/**
 * Trend for one event across the series.
 *
 * Only snapshots with a real score for that event count as samples: a run where
 * Meta returned nothing does not become a data point, and cannot manufacture a
 * direction. Fewer than two samples ⇒ `direction: null`, `delta: null`.
 */
export function emqTrend(series, eventName) {
  const points = (series || [])
    .map((s) => {
      const e = (s.events || []).find((x) => x.event_name === eventName);
      return e && Number.isFinite(e.composite_score)
        ? { captured_at: s.captured_at, score: e.composite_score, band: e.band ?? emqBand(e.composite_score) }
        : null;
    })
    .filter(Boolean);

  if (!points.length) {
    return {
      event_name: eventName, samples: 0, current: null, current_band: null,
      previous: null, delta: null, direction: null,
      best: null, worst: null, mean: null,
      first_captured_at: null, last_captured_at: null,
      note: "no EMQ score has ever been returned for this event — unknown, not zero",
    };
  }

  const scores = points.map((p) => p.score);
  const current = points[points.length - 1];
  const previous = points.length > 1 ? points[points.length - 2] : null;
  const delta = previous ? round(current.score - previous.score, 2) : null;
  let direction = null;
  if (delta != null) direction = delta > EMQ_NOISE_FLOOR ? "improving" : delta < -EMQ_NOISE_FLOOR ? "declining" : "flat";

  return {
    event_name: eventName,
    samples: points.length,
    current: current.score,
    current_band: current.band,
    previous: previous ? previous.score : null,
    delta,
    direction,
    best: round(Math.max(...scores), 2),
    worst: round(Math.min(...scores), 2),
    mean: round(scores.reduce((a, b) => a + b, 0) / scores.length, 2),
    first_captured_at: points[0].captured_at,
    last_captured_at: current.captured_at,
    note: points.length < 2 ? "single sample — no direction yet (re-run /capi-setup to build the series)" : null,
  };
}

/** Trends for every event that has ever appeared in the series. */
export function summarizeEmqTrends(series) {
  const names = [];
  for (const s of series || []) {
    for (const e of s.events || []) {
      if (e.event_name && !names.includes(e.event_name)) names.push(e.event_name);
    }
  }
  return names.map((n) => emqTrend(series, n));
}

/** Gap lines derived from EMQ (kept data-driven, like capi-setup's other gaps). */
export function emqGaps(trends = [], latest = null) {
  const gaps = [];
  if (latest && latest.source !== "dataset_quality_api") {
    gaps.push(`Event Match Quality is unknown (${latest.unavailable_reason || latest.source}) — no EMQ claim can be made for this run`);
    return gaps;
  }
  for (const t of trends) {
    if (t.current == null) continue; // unknown ≠ bad; never gap on a null
    if (t.current < EMQ_ACTION_THRESHOLD) {
      gaps.push(`'${t.event_name}' Event Match Quality is ${t.current}/10 (${t.current_band}) — send more hashed user_data (em, ph, fn, ln, ct, st, zp, country, external_id) to lift it above ${EMQ_ACTION_THRESHOLD}`);
    }
    if (t.direction === "declining") {
      gaps.push(`'${t.event_name}' EMQ fell ${Math.abs(t.delta)} pts (${t.previous} → ${t.current}) since ${t.first_captured_at ? t.last_captured_at : "the last run"} — a match key likely stopped being sent`);
    }
  }
  return gaps;
}

/** Match-key coverage lines, only for keys the API actually reported. */
export function matchKeyGaps(latest, { floorPct = 50 } = {}) {
  const gaps = [];
  for (const e of latest?.events || []) {
    for (const k of e.match_keys || []) {
      if (k.coverage_pct == null || !k.identifier) continue;
      if (k.coverage_pct < floorPct) {
        gaps.push(`'${e.event_name}' match key ${k.identifier} covers only ${k.coverage_pct}% of events — include it on every send`);
      }
    }
  }
  return gaps;
}

// ──────────────── modeled vs observed reconciliation ────────────────

/**
 * Reconcile a platform-reported (modeled/attributed) conversion count against an
 * observed one (server-side events, CRM records, POS).
 *
 * Neither side is assumed. Either can be `null`, and a null propagates with the
 * reason it is null instead of collapsing to 0.
 *
 * Direction of the verdict, stated plainly so a report can't invert it:
 *   coverage_ratio = observed / platform_reported
 *     ≈ 1     → aligned
 *     < 1     → `platform_over_reported`: Meta claims more conversions than the
 *               audited source can show (modeling, view-through, cross-device).
 *     > 1     → `platform_under_reported`: the business recorded more than Meta
 *               saw — signal loss, i.e. exactly the CAPI gap /capi-setup fixes.
 */
export function reconcileConversions({
  platform_reported = null,
  observed = null,
  platform_source = null,
  observed_source = null,
  observed_audited = false,
  event = null,
  window = null,
  recorded_at = new Date().toISOString(),
  recorded_by = null,
} = {}) {
  const p = asCount(platform_reported);
  const o = asCount(observed);
  const notes = [];

  if (p == null) notes.push(`platform-reported conversions unknown${platform_source ? ` (${platform_source} had none)` : ""} — run /analyze for the window, or pass the number explicitly`);
  if (o == null) notes.push("observed conversions unknown — supply the CRM / server-side count to reconcile");
  if (!observed_audited && o != null) notes.push("the observed side is NOT declared audited — treat it as an unverified count until someone traces it to records");

  const gap = p != null && o != null ? round(o - p, 2) : null;
  let coverage_ratio = null;
  let gap_pct = null;
  if (p != null && o != null) {
    if (p === 0) {
      notes.push("coverage_ratio is null: platform-reported conversions are 0 for this window, so there is no denominator to divide by");
    } else {
      coverage_ratio = round(o / p, 4);
      gap_pct = round(((o - p) / p) * 100, 1);
    }
  }

  let verdict = "unknown";
  if (coverage_ratio != null) {
    if (Math.abs(coverage_ratio - 1) <= COVERAGE_TOLERANCE) verdict = "aligned";
    else if (coverage_ratio < 1) verdict = "platform_over_reported";
    else verdict = "platform_under_reported";
  }

  return {
    recorded_at,
    recorded_by,
    event: event ?? null,
    window: window ?? null,
    platform_reported: {
      value: p,
      source: platform_source ?? null,
      basis: "platform_reported", // Meta's own attributed/modeled number
      audited: false,
    },
    observed: {
      value: o,
      source: observed_source ?? null,
      basis: observed_audited ? "audited" : "observed_unverified",
      audited: !!observed_audited,
    },
    gap,
    gap_pct,
    coverage_ratio,
    verdict,
    notes,
  };
}

export function recordReconciliation(slug, rec, { spine = null } = {}) {
  const current = spine || loadSpine(slug);
  const list = [...current.reconciliations, rec];
  const { series: kept, pruned } = prune(list);
  const next = { ...current, reconciliations: kept };
  saveSpine(slug, next);
  return { spine: next, appended: true, pruned, reconciliation: rec };
}

// ──────────────────────── the handoff summary ────────────────────────

export function latestEmq(spine) {
  const s = spine?.emq_series || [];
  return s.length ? s[s.length - 1] : null;
}

export function latestReconciliation(spine) {
  const r = spine?.reconciliations || [];
  return r.length ? r[r.length - 1] : null;
}

/**
 * The single JSON handoff /attribution consumes instead of re-deriving anything.
 * Shape is stable: consumers read `emq` + `reconciliation` and never the series.
 */
export function spineSummary(slugOrSpine) {
  const spine = typeof slugOrSpine === "string" ? loadSpine(slugOrSpine) : slugOrSpine || emptySpine(null);
  const latest = latestEmq(spine);
  const trends = summarizeEmqTrends(spine.emq_series);
  const rec = latestReconciliation(spine);
  return {
    slug: spine.slug ?? null,
    available: !!(latest || rec),
    corrupt: !!spine.corrupt,
    updated_at: spine.updated_at ?? null,
    emq: latest
      ? {
          captured_at: latest.captured_at,
          pixel_id: latest.pixel_id,
          source: latest.source,
          unavailable_reason: latest.unavailable_reason ?? null,
          dataset_avg_score: latest.dataset_avg_score,
          scored_events: latest.scored_events,
          unknown_events: latest.unknown_events,
          trends,
        }
      : { captured_at: null, source: null, dataset_avg_score: null, trends: [], unavailable_reason: "no EMQ snapshot recorded yet — run /capi-setup" },
    reconciliation: rec,
    samples: { emq_snapshots: (spine.emq_series || []).length, reconciliations: (spine.reconciliations || []).length },
    source_of_record: "clients/<slug>/data/measurement_spine.json (written by /capi-setup, read by /attribution)",
  };
}

/**
 * Render the spine as the "Measurement quality" section of a report.
 *
 * Lives here so /attribution and any future report render the SAME words —
 * particularly the platform-reported-vs-audited labels, which CLAUDE.md requires
 * and which would drift instantly if each renderer wrote its own.
 */
export function measurementSpineMarkdown(summary) {
  const lines = ["## Measurement quality (measurement spine)", ""];
  if (!summary || !summary.available) {
    lines.push("_No measurement spine recorded yet — run `/capi-setup <slug>` to capture Event Match Quality and reconcile conversions. Not reported as healthy; reported as unknown._");
    return lines.join("\n");
  }

  const emq = summary.emq || {};
  if (emq.source === "dataset_quality_api") {
    lines.push(`**Event Match Quality** · captured ${emq.captured_at} · dataset avg **${emq.dataset_avg_score ?? "unknown"}**${emq.dataset_avg_score != null ? "/10" : ""} · ${emq.scored_events ?? 0} scored, ${emq.unknown_events ?? 0} unknown · ${summary.samples?.emq_snapshots ?? 0} snapshot(s) in the series`);
  } else {
    lines.push(`**Event Match Quality:** unknown — ${emq.unavailable_reason || emq.source || "not captured"}. No EMQ claim is made for this report.`);
  }
  lines.push("");
  if ((emq.trends || []).length) {
    lines.push("| Event | EMQ | Band | Δ vs previous | Direction | Samples |");
    lines.push("|---|--:|---|--:|---|--:|");
    for (const t of emq.trends) {
      lines.push(`| ${t.event_name} | ${t.current ?? "unknown"} | ${t.current_band ?? "—"} | ${t.delta ?? "—"} | ${t.direction ?? "—"} | ${t.samples} |`);
    }
    lines.push("");
  }

  const r = summary.reconciliation;
  lines.push("### Modeled vs observed conversions");
  lines.push("");
  if (!r) {
    lines.push("_Not reconciled. The conversion counts in this report are **platform-reported** and have not been checked against an audited source._");
    return lines.join("\n");
  }
  lines.push(`**Window:** ${r.window || "unstated"}  ·  **Event:** ${r.event || "account total"}  ·  **Recorded:** ${r.recorded_at}`);
  lines.push("");
  lines.push("| Side | Conversions | Source | Basis |");
  lines.push("|---|--:|---|---|");
  lines.push(`| Platform-reported (modeled) | ${r.platform_reported?.value ?? "unknown"} | ${r.platform_reported?.source || "—"} | platform-reported |`);
  lines.push(`| Observed | ${r.observed?.value ?? "unknown"} | ${r.observed?.source || "—"} | ${r.observed?.audited ? "audited" : "observed, not audited"} |`);
  lines.push("");
  lines.push(`**Gap:** ${r.gap ?? "unknown"}${r.gap_pct != null ? ` (${r.gap_pct}%)` : ""}  ·  **Coverage ratio (observed ÷ platform):** ${r.coverage_ratio ?? "null — no denominator"}  ·  **Verdict:** ${r.verdict}`);
  if ((r.notes || []).length) {
    lines.push("");
    for (const n of r.notes) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}

/**
 * Best-effort Supabase persistence, mirroring the pattern every other skill
 * uses: attempted only when configured, never fatal, never retried, and the
 * on-disk spine remains the source of record.
 *
 * The `measurement_snapshots` DDL is in scripts/schema.sql. If the table has not
 * been created in the project, the insert fails and this returns
 * `{persisted:false, reason}` — it does NOT claim a persist that did not happen.
 */
export async function persistSpineSnapshot(slug, { snapshot = null, reconciliation = null } = {}) {
  let supa;
  try {
    supa = await import("./supabase.js");
  } catch (e) {
    return { persisted: false, reason: `supabase module unavailable: ${e.message}` };
  }
  if (!supa.supabaseConfigured()) return { persisted: false, reason: "supabase not configured" };
  try {
    const client_id = await supa.clientIdBySlug(slug);
    await supa.insert("measurement_snapshots", [{
      client_id,
      slug,
      captured_at: snapshot?.captured_at || reconciliation?.recorded_at || new Date().toISOString(),
      emq: snapshot || null,
      reconciliation: reconciliation || null,
    }]);
    return { persisted: true, reason: null };
  } catch (e) {
    return { persisted: false, reason: e.message };
  }
}
