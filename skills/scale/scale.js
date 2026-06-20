#!/usr/bin/env node
/**
 * /scale companion script.
 *
 * Consumes clients/<slug>/performance_analysis.json and executes the
 * scaling rules: pause underperformers, scale winners +20%, flag
 * fatigue/anomalies for Slack. No Meta reads — this is execution only.
 *
 * Defaults to DRY RUN. Pass --execute to actually hit Meta.
 *
 * Usage:
 *   node skills/scale/scale.js <client_slug> [--execute] [--force]
 *
 * Reads:  clients/<slug>/client_profile.json
 *         clients/<slug>/performance_analysis.json
 * Writes: clients/<slug>/scaling_log.json
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph } from "../../scripts/lib/meta-graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const MAX_ANALYSIS_AGE_HOURS = 4;
const BUDGET_INCREASE_CEILING_CENTS = 50_000; // $500/day single-action ceiling
const SCALE_MULTIPLIER = 1.2;
const BUSINESS_HOURS = { start: 6, end: 21 }; // 6 AM – 9 PM

// SCALE auto-eligible only if delta ≤ this; otherwise → approval queue
const AUTO_SCALE_DELTA_CEILING_CENTS = 50_000;

function inBusinessHours(timezone) {
  if (!timezone) return true; // unknown tz → assume in-window
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(fmt.format(new Date()), 10);
    return hour >= BUSINESS_HOURS.start && hour < BUSINESS_HOURS.end;
  } catch {
    return true;
  }
}

function hoursOld(iso) {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function decisionFromFlag(flag, parentMap) {
  switch (flag.flag) {
    case "PAUSE_CANDIDATE_CPA":
    case "PAUSE_CANDIDATE_ROAS":
    case "PAUSE_CANDIDATE_CTR":
    case "PAUSE_CANDIDATE_FREQUENCY":
      return { action: "pause", entity_type: "ad", endpoint: `/${flag.entity_id}`, body: { status: "PAUSED" }, auto: true };
    case "SCALE_CANDIDATE": {
      const adset = parentMap.adsets.get(flag.entity_id);
      const currentBudgetCents = adset?.daily_budget != null ? Math.round(adset.daily_budget * 100) : null;
      if (!currentBudgetCents) {
        return { action: "flag", entity_type: "adset", auto: false, reason: "no daily_budget — cannot auto-scale (CBO campaign?)" };
      }
      const newBudgetCents = Math.round(currentBudgetCents * SCALE_MULTIPLIER);
      const deltaCents = newBudgetCents - currentBudgetCents;
      const exceedsCeiling = deltaCents > AUTO_SCALE_DELTA_CEILING_CENTS;
      return {
        action: "scale",
        entity_type: "adset",
        endpoint: `/${flag.entity_id}`,
        body: { daily_budget: String(newBudgetCents) },
        budget_before_cents: currentBudgetCents,
        budget_after_cents: newBudgetCents,
        delta_cents: deltaCents,
        auto: !exceedsCeiling,
        approval_reason: exceedsCeiling ? `delta $${deltaCents / 100} > $${AUTO_SCALE_DELTA_CEILING_CENTS / 100}/day ceiling` : null,
      };
    }
    case "CREATIVE_FATIGUE":
    case "ANOMALY_delivery_stall":
    case "ANOMALY_attribution":
      return { action: "flag", entity_type: flag.entity_type, auto: true };
    default:
      return { action: "flag", entity_type: flag.entity_type, auto: false };
  }
}

function resolveConflicts(decisionsByEntity) {
  // If an entity has both PAUSE and ANOMALY → pause wins
  // (Within a single entity, we already grouped — just preserve the most decisive action.)
  const priority = { pause: 3, scale: 2, duplicate: 2, flag: 1 };
  for (const [id, decisions] of decisionsByEntity) {
    if (decisions.length <= 1) continue;
    decisions.sort((a, b) => (priority[b.action] || 0) - (priority[a.action] || 0));
    decisionsByEntity.set(id, [decisions[0]]);
  }
}

function buildParentMap(analysis) {
  return {
    campaigns: new Map((analysis.by_campaign || []).map((c) => [c.id, c])),
    adsets: new Map((analysis.by_adset || []).map((s) => [s.id, s])),
    ads: new Map((analysis.by_ad || []).map((a) => [a.id, a])),
  };
}

async function executeDecision(graph, decision) {
  if (!decision.endpoint) return { ok: true, skipped: true, reason: "flag only" };
  try {
    const res = await graph.post(decision.endpoint, decision.body);
    return { ok: true, response: res };
  } catch (e) {
    return { ok: false, error: e.message, meta: e.metaError || null };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) {
    console.error("Usage: node skills/scale/scale.js <slug> [--execute] [--force]");
    process.exit(1);
  }
  const execute = args.includes("--execute");
  const force = args.includes("--force");

  const profilePath = resolve(ROOT, "clients", slug, "client_profile.json");
  const analysisPath = resolve(ROOT, "clients", slug, "performance_analysis.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  if (!existsSync(analysisPath)) {
    console.error(`performance_analysis.json not found — run /analyze first.`);
    process.exit(3);
  }

  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const analysis = JSON.parse(readFileSync(analysisPath, "utf8"));

  // Validation
  const ageHours = hoursOld(analysis.generated_at);
  if (ageHours > MAX_ANALYSIS_AGE_HOURS && !force) {
    console.error(`performance_analysis.json is ${ageHours.toFixed(1)}h old (> ${MAX_ANALYSIS_AGE_HOURS}h). Run /analyze first or pass --force.`);
    process.exit(4);
  }

  const tz = profile.accounts?.timezone || profile.location?.timezone || null;
  const inHours = inBusinessHours(tz);
  if (!inHours && !force) {
    console.error(`Outside business hours (6 AM – 9 PM ${tz || "UTC"}). Pass --force to override.`);
    process.exit(5);
  }

  const parentMap = buildParentMap(analysis);
  const flags = analysis.flags || [];

  // Group flags by entity_id
  const byEntity = new Map();
  for (const f of flags) {
    const decision = decisionFromFlag(f, parentMap);
    if (!decision) continue;
    const enriched = { ...decision, flag: f.flag, entity_id: f.entity_id, entity_name: f.name, reasoning: f.reasoning, metric: f.metric, threshold: f.threshold };
    const arr = byEntity.get(f.entity_id) || [];
    arr.push(enriched);
    byEntity.set(f.entity_id, arr);
  }
  resolveConflicts(byEntity);

  const allDecisions = [...byEntity.values()].flat();
  const autoActions = allDecisions.filter((d) => d.auto && d.endpoint);
  const approvalQueue = allDecisions.filter((d) => !d.auto && d.endpoint);
  const flagOnly = allDecisions.filter((d) => !d.endpoint);

  const graph = execute ? createGraph() : null;
  const results = [];

  for (const d of autoActions) {
    let result;
    if (execute) {
      result = await executeDecision(graph, d);
    } else {
      result = { ok: true, dry_run: true };
    }
    results.push({
      ...d,
      executed_at: new Date().toISOString(),
      status: result.ok ? (execute ? "applied" : "dry_run") : "error",
      error: result.error || null,
      meta_response: result.response || null,
    });
  }
  for (const d of approvalQueue) {
    results.push({ ...d, status: "awaiting_approval", queued_at: new Date().toISOString() });
  }
  for (const d of flagOnly) {
    results.push({ ...d, status: "flagged" });
  }

  const summary = {
    auto_paused: results.filter((r) => r.action === "pause" && r.status !== "error").length,
    auto_scaled: results.filter((r) => r.action === "scale" && r.status !== "error" && r.auto).length,
    awaiting_approval: approvalQueue.length,
    flagged: flagOnly.length,
    errors: results.filter((r) => r.status === "error").length,
    dry_run: !execute,
    business_hours_ok: inHours,
    analysis_age_hours: round(ageHours, 2),
  };

  const out = {
    slug,
    generated_at: new Date().toISOString(),
    analysis_generated_at: analysis.generated_at,
    summary,
    decisions: results,
  };

  const outPath = resolve(ROOT, "clients", slug, "scaling_log.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.error(`[scale] wrote ${outPath}`);

  console.log(JSON.stringify({
    slug,
    mode: execute ? "EXECUTE" : "DRY_RUN",
    ...summary,
    path: outPath,
    next: execute ? "review scaling_log.json + handle approval queue" : "rerun with --execute to apply auto actions",
  }, null, 2));
}

function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

main().catch((e) => {
  console.error("[scale] FATAL:", e.message);
  process.exit(1);
});
