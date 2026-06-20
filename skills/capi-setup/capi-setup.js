#!/usr/bin/env node
/**
 * /capi-setup companion script.
 *
 * Verifies pixel + CAPI redundancy for a client. Reads pixel stats,
 * dataset metadata, computes server-side share per event, and writes
 * a gap report. Optionally fires a test CAPI event via --test-event.
 *
 * Usage:
 *   node skills/capi-setup/capi-setup.js <client_slug> [--test-event TEST12345]
 */

import crypto from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";

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
  // Default /stats — gives event_name + count + last fire time
  return graph.get(`/${pixelId}/stats`, { start_time: isoDaysAgo(7) }).catch((e) => ({ error: e.message, data: [] }));
}

async function getSourceBreakdown(graph, pixelId) {
  // aggregation=event_name_and_method buckets by source (browser/server/app)
  return graph
    .get(`/${pixelId}/stats`, { start_time: isoDaysAgo(7), aggregation: "event_name_and_method" })
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

function buildEventStats(rawStats, sourceBreakdown, requiredEvents) {
  // /stats returns: { data: [{ value: N, event: 'Purchase', last_fire_time: <unix> }, ...] }
  // (Schema has shifted over versions — handle both `value` and `count`, both `event` and `event_name`.)
  const counts = {};
  for (const row of rawStats.data || []) {
    const name = row.event || row.event_name;
    const v = row.value ?? row.count ?? 0;
    if (!name) continue;
    counts[name] = counts[name] || { count: 0, last_fired: null };
    counts[name].count += v;
    const lf = row.last_fire_time || row.last_fired_time;
    if (lf && (!counts[name].last_fired || lf > counts[name].last_fired)) counts[name].last_fired = lf;
  }

  // Source breakdown: same shape but with `method` ∈ { 'browser','server','app' }
  const bySource = {};
  for (const row of sourceBreakdown.data || []) {
    const name = row.event || row.event_name;
    const method = (row.method || row.source || "").toLowerCase();
    const v = row.value ?? row.count ?? 0;
    if (!name) continue;
    bySource[name] = bySource[name] || { browser: 0, server: 0, app: 0 };
    if (method === "server" || method === "s2s") bySource[name].server += v;
    else if (method === "app") bySource[name].app += v;
    else bySource[name].browser += v;
  }

  const events = requiredEvents.map((name) => {
    const c = counts[name] || {};
    const s = bySource[name] || { browser: 0, server: 0 };
    const total = (s.browser || 0) + (s.server || 0);
    const serverShare = total ? s.server / total : 0;
    const stat = {
      name,
      firing: !!c.count,
      count_7d: c.count || 0,
      last_fired: c.last_fired || null,
      client_count_7d: s.browser || 0,
      server_count_7d: s.server || 0,
      server_share: Math.round(serverShare * 1000) / 1000,
    };
    stat.status = classifyEvent(stat);
    return stat;
  });

  return events;
}

function deriveGaps(events, dataset) {
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

function buildNextSteps(events) {
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

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  const testIdx = args.indexOf("--test-event");
  const testEventCode = testIdx >= 0 ? args[testIdx + 1] : null;
  if (!slug) {
    console.error("Usage: node skills/capi-setup/capi-setup.js <slug> [--test-event TEST12345]");
    process.exit(1);
  }

  const profilePath = resolve(ROOT, "clients", slug, "client_profile.json");
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

  const graph = createGraph();
  console.error(`[capi-setup] ${slug} — inspecting pixel ${pixelId}…`);

  const [stats, sourceBreakdown, dataset] = await Promise.all([
    getPixelStats(graph, pixelId),
    getSourceBreakdown(graph, pixelId),
    getDatasetInfo(graph, pixelId),
  ]);

  const events = buildEventStats(stats, sourceBreakdown, requiredEvents);

  let testEvent = { fired: false, event_id: null };
  if (testEventCode) {
    try {
      console.error(`[capi-setup] firing test event with code=${testEventCode}…`);
      testEvent = await fireTestEvent(graph, pixelId, testEventCode);
    } catch (e) {
      testEvent = { fired: false, error: e.message };
    }
  }

  const gaps = deriveGaps(events, dataset);
  const nextSteps = buildNextSteps(events);

  const out = {
    slug,
    generated_at: new Date().toISOString(),
    pixel_id: pixelId,
    events,
    dataset: dataset.error ? { error: dataset.error } : dataset,
    test_event: testEvent,
    gaps,
    next_steps: nextSteps,
  };

  const outPath = resolve(ROOT, "clients", slug, "capi_report.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.error(`[capi-setup] wrote ${outPath}`);

  const counts = events.reduce((m, e) => ({ ...m, [e.status]: (m[e.status] || 0) + 1 }), {});
  console.log(JSON.stringify({
    slug,
    pixel: { firing: counts.healthy || 0, partial: counts.partial || 0, missing: counts.missing || 0, stale: counts.stale || 0, never_fired: counts.never_fired || 0 },
    gaps_count: gaps.length,
    test_event_fired: testEvent.fired,
    path: outPath,
    next: gaps.length ? "share capi_report.json with the dev to close the gaps" : "CAPI redundancy looks healthy",
  }, null, 2));
}

main().catch((e) => {
  console.error("[capi-setup] FATAL:", e.message);
  process.exit(1);
});
