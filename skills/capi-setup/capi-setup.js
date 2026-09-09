#!/usr/bin/env node
/**
 * /capi-setup companion script.
 *
 * Verifies pixel + CAPI redundancy for a client. Reads pixel stats,
 * dataset metadata, computes server-side share per event, and writes
 * a gap report. Optionally fires a test CAPI event via --test-event.
 *
 * E4 (measurement spine) added two things this skill is the natural owner of,
 * because it is the only skill that talks to the dataset:
 *
 *   1. Event Match Quality OVER TIME. Each run captures the Dataset Quality
 *      API's per-event composite score plus the match-key coverage breakdown
 *      and appends it to clients/<slug>/data/measurement_spine.json, so the
 *      question "did the dev's fix actually raise match quality?" has an
 *      answer. A score Meta does not return is null (unknown) — never 0.
 *   2. Modeled-vs-observed conversion reconciliation. The platform-reported
 *      (modeled) count comes from /analyze's performance_analysis.json (or
 *      --platform-conversions); the observed count is supplied by the operator
 *      from the CRM / server-side source. Both sides are labeled, and an
 *      unknown denominator yields null with the reason stated.
 *
 * /attribution then READS that spine (JSON handoff) instead of re-deriving it —
 * one spine, two skills.
 *
 * Usage:
 *   node skills/capi-setup/capi-setup.js <client_slug> [--test-event TEST12345]
 *        [--no-emq] [--observed N [--observed-source crm] [--observed-audited]]
 *        [--platform-conversions N] [--event Purchase] [--window last_7d]
 */

import crypto from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";
import { flattenStatsBuckets } from "../../scripts/lib/meta-stats.js";
import {
  parseDatasetQuality,
  buildEmqSnapshot,
  recordEmqSnapshot,
  emqGaps,
  matchKeyGaps,
  reconcileConversions,
  recordReconciliation,
  spineSummary,
  spinePath,
  persistSpineSnapshot,
  asCount,
} from "../../scripts/lib/measurement_spine.js";
import * as P from "../../scripts/lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const STALE_HOURS = 48;
const HEALTHY_SERVER_SHARE = 0.5;
const PARTIAL_SERVER_SHARE = 0.05;

function sha256(s) {
  return crypto.createHash("sha256").update(String(s).trim().toLowerCase()).digest("hex");
}

function isoDaysAgo(days) {
  return Math.floor(Date.now() / 1000) - days * 86400;
}

function hoursSince(ts) {
  if (!ts) return Infinity;
  const t = typeof ts === "number" ? ts * 1000 : new Date(ts).getTime();
  return (Date.now() - t) / 3_600_000;
}

function classifyEvent(stats) {
  if (!stats.last_fired) return "never_fired";
  if (hoursSince(stats.last_fired) > STALE_HOURS) return "stale";
  if (stats.server_share >= HEALTHY_SERVER_SHARE) return "healthy";
  if (stats.server_share >= PARTIAL_SERVER_SHARE) return "partial";
  return "missing"; // pixel firing but no CAPI
}

async function getPixelStats(graph, pixelId) {
  // aggregation=event buckets counts per event name (row.value = event name)
  return graph
    .get(`/${pixelId}/stats`, { start_time: isoDaysAgo(7), aggregation: "event" })
    .catch((e) => ({ error: e.message, data: [] }));
}

async function getSourceBreakdown(graph, pixelId, eventName) {
  // aggregation=event_source only splits BROWSER/SERVER for ALL events combined,
  // so it must be filtered to one event at a time via the `event` param.
  return graph
    .get(`/${pixelId}/stats`, { start_time: isoDaysAgo(7), aggregation: "event_source", event: eventName })
    .catch((e) => ({ error: e.message, data: [] }));
}

async function getDatasetInfo(graph, datasetId) {
  return graph
    .get(`/${datasetId}`, {
      fields:
        "id,name,last_fired_time,first_party_cookie_status,enable_automatic_matching,automatic_matching_fields,creation_time",
    })
    .catch((e) => ({ error: e.message }));
}

/**
 * Dataset Quality API — Event Match Quality.
 *
 * GET /dataset_quality?dataset_id=<pixel>&fields=web{event_name,
 *     event_match_quality{composite_score,match_key_feedback{identifier,coverage}}}
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api/dataset-quality-api/
 * Fails soft to an {error} payload: an EMQ read is diagnostic, and losing it
 * must not cost the client the rest of the gap report.
 */
export async function getDatasetQuality(graph, datasetId) {
  return graph
    .get(`/dataset_quality`, {
      dataset_id: datasetId,
      fields:
        "web{event_name,event_match_quality{composite_score,match_key_feedback{identifier,coverage,potential_aly_acr_increase}}}",
    })
    .catch((e) => ({ error: e.message }));
}

/** Events with no live data at all: status "unknown", not "never_fired". */
export function unknownEventStats(requiredEvents) {
  return requiredEvents.map((name) => ({
    name,
    firing: null,
    count_7d: null,
    last_fired: null,
    client_count_7d: null,
    server_count_7d: null,
    server_share: null,
    status: "unknown",
  }));
}

/**
 * The platform-reported (modeled) conversion count for the reconciliation.
 * Read from /analyze's handoff rather than re-pulled — Token Efficiency Rules.
 */
export function platformConversionsFromAnalysis(slug, { window = "last_7d" } = {}) {
  const p = P.clientFile(slug, "performance_analysis.json");
  if (!existsSync(p)) {
    return { value: null, source: null, reason: "no performance_analysis.json — run /analyze first, or pass --platform-conversions" };
  }
  try {
    const a = JSON.parse(readFileSync(p, "utf8"));
    const totals = a.window_summary?.last_7d_totals || {};
    const v = asCount(totals.conversions);
    return {
      value: v,
      source: `performance_analysis.json (window_summary.last_7d_totals, generated ${a.generated_at || "unknown"})`,
      reason: v == null ? "performance_analysis.json has no conversions total for the window" : null,
      window: window === "last_7d" ? "last_7d" : window,
    };
  } catch (e) {
    return { value: null, source: null, reason: `performance_analysis.json unreadable: ${e.message}` };
  }
}

async function fireTestEvent(graph, datasetId, testEventCode) {
  const eventId = `capi-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const event = {
    event_name: "Lead",
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "system_generated",
    user_data: {
      em: sha256("capi-test@smos.local"),
      client_user_agent: "smOS/capi-setup-test",
    },
    custom_data: { content_name: "smOS CAPI verification test" },
  };
  const res = await graph.post(`/${datasetId}/events`, { data: [event], test_event_code: testEventCode });
  return { fired: true, event_id: eventId, response: res };
}

export function buildEventStats(rawStats, sourceBreakdownByEvent, requiredEvents) {
  // rawStats is the raw /stats?aggregation=event response: hourly buckets, each
  // with a nested data array of { value: <event name>, count }. Flatten first.
  const rows = flattenStatsBuckets(rawStats);
  const counts = {};
  for (const { time, name, count } of rows) {
    if (!name) continue;
    counts[name] = counts[name] || { count: 0, last_fired: null };
    counts[name].count += count;
    if (count > 0 && (!counts[name].last_fired || time > counts[name].last_fired)) {
      counts[name].last_fired = time;
    }
  }

  const events = requiredEvents.map((name) => {
    const c = counts[name] || {};
    // sourceBreakdownByEvent[name] is a flattened { data: [{start_time, aggregation, data:[{value:'SERVER'|'BROWSER', count}]}] } response
    const srcRows = flattenStatsBuckets(sourceBreakdownByEvent[name] || { data: [] });
    let browser = 0, server = 0;
    for (const { name: source, count } of srcRows) {
      if (source === "SERVER") server += count;
      else if (source === "BROWSER") browser += count;
    }
    const total = browser + server;
    const serverShare = total ? server / total : 0;
    const stat = {
      name,
      firing: !!c.count,
      count_7d: c.count || 0,
      last_fired: c.last_fired || null,
      client_count_7d: browser,
      server_count_7d: server,
      server_share: Math.round(serverShare * 1000) / 1000,
    };
    stat.status = classifyEvent(stat);
    return stat;
  });

  return events;
}

export function deriveGaps(events, dataset) {
  const gaps = [];
  for (const e of events) {
    if (e.status === "never_fired") {
      gaps.push(`'${e.name}' has never fired — pixel may not be installed on the right page (check page source for fbq('track','${e.name}'))`);
    } else if (e.status === "stale") {
      gaps.push(`'${e.name}' last fired >${STALE_HOURS}h ago — check whether the triggering page/action still calls the pixel`);
    } else if (e.status === "missing") {
      gaps.push(`'${e.name}' has 0 server-side fires — implement CAPI for this event (target server_share ≥ 50%)`);
    } else if (e.status === "partial") {
      gaps.push(`'${e.name}' server_share is ${Math.round(e.server_share * 100)}% — CAPI fires for some traffic only; cover all paths`);
    }
  }
  if (dataset && !dataset.error && !dataset.enable_automatic_matching) {
    gaps.push("Automatic Advanced Matching is OFF — turn it on in Events Manager → Settings → Automatic Advanced Matching");
  }
  return gaps;
}

export function buildNextSteps(events) {
  const hasAnyMissing = events.some((e) => e.status === "missing" || e.status === "never_fired");
  const hasPartial = events.some((e) => e.status === "partial");
  const steps = [];
  if (hasAnyMissing) {
    steps.push("Set up a Conversions API Gateway (Stape, self-host, or Shopify/WooCommerce native) OR add server-side fires from your backend for missing events");
  }
  if (hasAnyMissing || hasPartial) {
    steps.push("Send the same event_id from pixel + CAPI for each event to enable deduplication (Meta will dedupe automatically)");
    steps.push("Send rich user_data (em, ph, fn, ln, ct, st, zp, country) hashed SHA-256 to maximize match quality");
  }
  steps.push("Re-run /capi-setup in 48h to verify the changes");
  return steps;
}

/** Read `--flag value` or `--flag=value`; returns null when absent. */
export function flagValue(args, name) {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  const testEventCode = flagValue(args, "--test-event");
  const wantEmq = !args.includes("--no-emq");
  const observedRaw = flagValue(args, "--observed");
  const observedSource = flagValue(args, "--observed-source") || (observedRaw != null ? "unstated" : null);
  const observedAudited = args.includes("--observed-audited");
  const platformOverride = flagValue(args, "--platform-conversions");
  const reconEvent = flagValue(args, "--event");
  const reconWindow = flagValue(args, "--window") || "last_7d";
  if (!slug) {
    console.error("Usage: node skills/capi-setup/capi-setup.js <slug> [--test-event TEST12345] [--no-emq] [--observed N --observed-source crm [--observed-audited]] [--platform-conversions N] [--event Purchase] [--window last_7d]");
    process.exit(1);
  }

  const profilePath = P.clientFile(slug, "client_profile.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const acct = profile.accounts || {};
  const pixelId = acct.pixel_id;
  if (isTbd(pixelId)) {
    console.error("accounts.pixel_id is TBD — set it before running /capi-setup");
    process.exit(3);
  }

  const requiredEvents = profile.business?.conversion_events?.length
    ? profile.business.conversion_events
    : ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Purchase", "Lead"];

  // Offline / no-token discipline (matches the sibling skills): never fabricate
  // API data. With no live read, every event's status is `unknown` — NOT
  // `never_fired`, which would be an assertion about a pixel we never queried.
  const offline = process.env.SMOS_OFFLINE === "1" || !process.env.META_ACCESS_TOKEN;
  const offlineReason = process.env.SMOS_OFFLINE === "1" ? "SMOS_OFFLINE=1" : "no META_ACCESS_TOKEN resolved";

  let events, dataset, quality;
  let testEvent = { fired: false, event_id: null };

  if (offline) {
    console.error(`[capi-setup] ${slug} — ${offlineReason}: skipping live pixel reads (statuses reported as unknown).`);
    events = unknownEventStats(requiredEvents);
    dataset = { error: `not fetched (${offlineReason})` };
    quality = { ok: false, reason: offlineReason, events: [] };
  } else {
    const graph = createGraph();
    console.error(`[capi-setup] ${slug} — inspecting pixel ${pixelId}…`);

    const [stats, ds, sourceBreakdownList, dq] = await Promise.all([
      getPixelStats(graph, pixelId),
      getDatasetInfo(graph, pixelId),
      Promise.all(requiredEvents.map((name) => getSourceBreakdown(graph, pixelId, name))),
      wantEmq ? getDatasetQuality(graph, pixelId) : Promise.resolve({ error: "skipped (--no-emq)" }),
    ]);
    dataset = ds;
    const sourceBreakdownByEvent = Object.fromEntries(requiredEvents.map((name, i) => [name, sourceBreakdownList[i]]));
    events = buildEventStats(stats, sourceBreakdownByEvent, requiredEvents);
    quality = parseDatasetQuality(dq);

    if (testEventCode) {
      try {
        console.error(`[capi-setup] firing test event with code=${testEventCode}…`);
        testEvent = await fireTestEvent(graph, pixelId, testEventCode);
      } catch (e) {
        testEvent = { fired: false, error: e.message };
      }
    }
  }

  // ── EMQ over time (spine) ───────────────────────────────────────────────
  const snapshot = buildEmqSnapshot({
    pixel_id: pixelId,
    events: quality.events,
    source: quality.ok ? "dataset_quality_api" : offline ? "offline" : "unavailable",
    unavailable_reason: quality.ok ? null : quality.reason,
  });
  const { appended, reason: appendReason, trends } = recordEmqSnapshot(slug, snapshot);

  // ── modeled vs observed reconciliation ─────────────────────────────────
  const fromAnalysis = platformConversionsFromAnalysis(slug, { window: reconWindow });
  const platformValue = platformOverride != null ? asCount(platformOverride) : fromAnalysis.value;
  const platformSource = platformOverride != null ? "--platform-conversions (operator-supplied)" : fromAnalysis.source;
  const reconciliation = reconcileConversions({
    platform_reported: platformValue,
    observed: observedRaw != null ? asCount(observedRaw) : null,
    platform_source: platformSource || fromAnalysis.reason,
    observed_source: observedSource,
    observed_audited: observedAudited,
    event: reconEvent,
    window: reconWindow,
    recorded_by: "capi-setup",
  });
  // Only a run that was actually GIVEN an observed number records a
  // reconciliation — otherwise every run would append a half-empty row and the
  // spine's reconciliation history would be mostly noise.
  let reconciliationRecorded = false;
  if (observedRaw != null) {
    recordReconciliation(slug, reconciliation);
    reconciliationRecorded = true;
  }

  const persisted = await persistSpineSnapshot(slug, {
    snapshot,
    reconciliation: reconciliationRecorded ? reconciliation : null,
  });

  const gaps = [
    ...(offline ? [`Pixel/CAPI status not verified this run (${offlineReason}) — statuses are unknown, not healthy`] : deriveGaps(events, dataset)),
    ...emqGaps(trends, snapshot),
    ...matchKeyGaps(snapshot),
  ];
  const nextSteps = offline
    ? [`Re-run with a token (and without SMOS_OFFLINE) to verify the pixel — this run reported no live data`]
    : buildNextSteps(events);

  const out = {
    slug,
    generated_at: new Date().toISOString(),
    pixel_id: pixelId,
    data_source: offline ? "offline" : "meta_graph_v25",
    events,
    dataset: dataset.error ? { error: dataset.error } : dataset,
    test_event: testEvent,
    // Measurement spine (E4): this run's EMQ capture + the trend across the
    // whole series, and the modeled-vs-observed reconciliation.
    emq: {
      captured: quality.ok,
      unavailable_reason: quality.ok ? null : quality.reason,
      snapshot,
      trends,
      appended_to_series: appended,
      not_appended_reason: appendReason,
    },
    reconciliation: { ...reconciliation, recorded: reconciliationRecorded },
    spine_path: spinePath(slug),
    supabase: persisted,
    gaps,
    next_steps: nextSteps,
  };

  const outPath = P.clientFile(slug, "capi_report.json", { forWrite: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.error(`[capi-setup] wrote ${outPath}`);

  const counts = events.reduce((m, e) => ({ ...m, [e.status]: (m[e.status] || 0) + 1 }), {});
  console.log(JSON.stringify({
    slug,
    data_source: out.data_source,
    pixel: {
      firing: counts.healthy || 0, partial: counts.partial || 0, missing: counts.missing || 0,
      stale: counts.stale || 0, never_fired: counts.never_fired || 0, unknown: counts.unknown || 0,
    },
    emq: {
      dataset_avg_score: snapshot.dataset_avg_score,
      scored_events: snapshot.scored_events,
      unknown_events: snapshot.unknown_events,
      snapshots_in_series: spineSummary(slug).samples.emq_snapshots,
      declining: trends.filter((t) => t.direction === "declining").map((t) => t.event_name),
    },
    reconciliation: reconciliationRecorded
      ? { coverage_ratio: reconciliation.coverage_ratio, gap: reconciliation.gap, verdict: reconciliation.verdict }
      : { recorded: false, reason: "no --observed count supplied; conversions in reports remain platform-reported" },
    gaps_count: gaps.length,
    test_event_fired: testEvent.fired,
    path: outPath,
    spine: out.spine_path,
    next: gaps.length ? "share capi_report.json with the dev to close the gaps" : "CAPI redundancy looks healthy",
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("[capi-setup] FATAL:", e.message);
    process.exit(1);
  });
}
