#!/usr/bin/env node
/**
 * /scale companion script.
 *
 * Consumes clients/<slug>/performance_analysis.json and executes the
 * scaling rules: pause underperformers, scale winners +20%, flag
 * fatigue/anomalies for Discord. No Meta reads — this is execution only.
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
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";
import { insert as sbInsert, clientIdBySlug, supabaseConfigured } from "../../scripts/lib/supabase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const MAX_ANALYSIS_AGE_HOURS = 4;
const BUDGET_INCREASE_CEILING_CENTS = 50_000; // $500/day single-action ceiling
const SCALE_MULTIPLIER = 1.2;
const DUPLICATE_BUDGET_MULTIPLIER = 0.5; // clone a top performer at half budget for a budget test
const BUSINESS_HOURS = { start: 6, end: 21 }; // 6 AM – 9 PM

// SCALE auto-eligible only if delta ≤ this; otherwise → approval queue
const AUTO_SCALE_DELTA_CEILING_CENTS = 50_000;

// ---- run-level circuit breaker (refuse a mass mutation from garbage data) ----
const MAX_AUTO_ACTIONS_ABS = 25;       // never auto-execute more than this many actions in one run
const MAX_AUTO_ACTIONS_PCT = 0.5;      // ...nor more than this fraction of active entities
// ---- per-action metric sanity gate (reject acting on implausible metrics) ----
const MIN_IMPRESSIONS_FOR_ACTION = 100; // below this the sample is too small to trust

// inBusinessHours: fail-CLOSED in autonomous mode (unknown tz / error → outside window).
// Pass autonomous=false (operator with --force) to keep the lenient legacy behavior.
function inBusinessHours(timezone, autonomous = true) {
  if (!timezone) return autonomous ? false : true; // unknown tz: autonomous → refuse
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(fmt.format(new Date()), 10);
    if (Number.isNaN(hour)) return autonomous ? false : true;
    return hour >= BUSINESS_HOURS.start && hour < BUSINESS_HOURS.end;
  } catch {
    return autonomous ? false : true; // error: autonomous → refuse
  }
}

// Metrics must be present and plausible before any auto pause/scale.
// Guards against the "API returned null/zero → every ad reads as a breach" failure.
function metricsArePlausible(entity) {
  if (!entity) return true; // entity not in analysis rollup — trust the analyzer (can't second-guess)
  const spend = Number(entity.spend);
  const impressions = Number(entity.impressions);
  if (!Number.isFinite(spend) || spend <= 0) return false;
  if (Number.isFinite(impressions) && impressions < MIN_IMPRESSIONS_FOR_ACTION) return false;
  return true;
}

function hoursOld(iso) {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function decisionFromFlag(flag, parentMap) {
  switch (flag.flag) {
    case "PAUSE_CANDIDATE_CPA":
    case "PAUSE_CANDIDATE_ROAS":
    case "PAUSE_CANDIDATE_CTR":
    case "PAUSE_CANDIDATE_FREQUENCY": {
      if (!metricsArePlausible(parentMap.ads.get(flag.entity_id))) {
        return { action: "flag", entity_type: "ad", auto: false, reason: "metrics missing/zero — refusing auto-pause (bad-data guard)" };
      }
      return { action: "pause", entity_type: "ad", endpoint: `/${flag.entity_id}`, body: { status: "PAUSED" }, auto: true };
    }
    case "SCALE_CANDIDATE": {
      const adset = parentMap.adsets.get(flag.entity_id);
      if (!metricsArePlausible(adset)) {
        return { action: "flag", entity_type: "adset", auto: false, reason: "metrics missing/zero — refusing auto-scale (bad-data guard)" };
      }
      // Defense-in-depth: /analyze only emits SCALE_CANDIDATE when the ROAS win is
      // significant, but if a stale/hand-edited analysis carries an insignificant
      // one through, refuse to auto-scale on it.
      if (flag.significance && flag.significance.significant === false) {
        return { action: "flag", entity_type: "adset", auto: false, reason: `not significant (${flag.significance.note}) — refusing auto-scale` };
      }
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
    case "DUPLICATE_CANDIDATE": {
      // Top ROAS performer in its campaign (>2× next-best) — clone the adset at
      // half budget, PAUSED, as a budget test. The new adset is created PAUSED so
      // nothing goes live without a human; this is consequence-free in the
      // default-PAUSED sense and so is auto-eligible under --execute (still gated
      // by the circuit breaker, business hours, and the metric-sanity guard).
      const adset = parentMap.adsets.get(flag.entity_id);
      if (!metricsArePlausible(adset)) {
        return { action: "flag", entity_type: "adset", auto: false, reason: "metrics missing/zero — refusing auto-duplicate (bad-data guard)" };
      }
      const currentBudgetCents = adset?.daily_budget != null ? Math.round(adset.daily_budget * 100) : null;
      if (!currentBudgetCents) {
        return { action: "flag", entity_type: "adset", auto: false, reason: "no daily_budget — cannot clone at 0.5× (CBO campaign?)" };
      }
      const newBudgetCents = Math.max(1, Math.round(currentBudgetCents * DUPLICATE_BUDGET_MULTIPLIER));
      return {
        action: "duplicate",
        entity_type: "adset",
        // No endpoint to flip on the source — the clone is built at execute time
        // from the source adset's live spec (see cloneAdset). source_id marks an
        // actionable (non-flag-only) decision for the circuit-breaker / counters.
        source_id: flag.entity_id,
        budget_before_cents: currentBudgetCents,
        budget_after_cents: newBudgetCents,
        auto: true,
      };
    }
    case "SCALE_WATCH":
      // Significant-enough to watch, too thin to auto-scale. Human review.
      return { action: "flag", entity_type: "adset", auto: false, reason: flag.significance?.note || "watch — sample too thin to scale" };
    case "CREATIVE_FATIGUE":
    case "ANOMALY_delivery_stall":
    case "ANOMALY_attribution":
    case "ANOMALY_spend_spike":
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

// A decision is actionable (counts toward the circuit breaker, runs in the
// execute loop) when it carries either an endpoint to mutate or a source_id to
// clone. Everything else is flag-only.
function isActionable(d) {
  return !!d.endpoint || !!d.source_id;
}

// Derive the clone's name from the source, bumping the trailing version token so
// it stays inside the [PLACEMENT]_[AGE_RANGE]_[INTEREST_CODE] convention and is
// distinguishable from its parent. Falls back to a "_DUP" suffix.
function duplicateName(sourceName) {
  if (!sourceName) return "DUP_ADSET";
  const m = sourceName.match(/^(.*?)(?:_v(\d+))?$/);
  if (m && m[2] != null) return `${m[1]}_v${Number(m[2]) + 1}`;
  return `${sourceName}_DUP`;
}

// Clone a top-performing adset at half budget, PAUSED, in the same campaign.
// performance_analysis.json only carries a slim adset row (no targeting /
// optimization_goal / billing_event), so we fetch the source's full live spec
// through the SAME guarded graph and POST a new adset built from it.
async function cloneAdset(graph, accountId, decision) {
  const src = await graph.get(`/${decision.source_id}`, {
    fields: "name,campaign_id,optimization_goal,billing_event,bid_strategy,bid_amount,targeting,promoted_object,attribution_spec,destination_type",
  });
  const body = {
    name: duplicateName(decision.entity_name || src.name),
    campaign_id: src.campaign_id,
    daily_budget: String(decision.budget_after_cents),
    optimization_goal: src.optimization_goal,
    billing_event: src.billing_event,
    targeting: src.targeting,
    status: "PAUSED", // default-PAUSED: the clone never goes live without a human
  };
  if (src.bid_strategy) body.bid_strategy = src.bid_strategy;
  if (src.bid_amount != null) body.bid_amount = src.bid_amount;
  if (src.promoted_object) body.promoted_object = src.promoted_object;
  if (src.attribution_spec) body.attribution_spec = src.attribution_spec;
  if (src.destination_type) body.destination_type = src.destination_type;
  const res = await graph.post(`/${graph.act(accountId)}/adsets`, body);
  return { ok: true, response: res, created_name: body.name, created_id: res?.id || null };
}

async function executeDecision(graph, decision, accountId) {
  if (decision.action === "duplicate") {
    try {
      return await cloneAdset(graph, accountId, decision);
    } catch (e) {
      return { ok: false, error: e.message, meta: e.metaError || null };
    }
  }
  if (!decision.endpoint) return { ok: true, skipped: true, reason: "flag only" };
  try {
    const res = await graph.post(decision.endpoint, decision.body);
    return { ok: true, response: res };
  } catch (e) {
    return { ok: false, error: e.message, meta: e.metaError || null };
  }
}

// Reverse a prior run: un-pause paused entities, restore pre-scale budgets.
function reverseDecision(d) {
  if (d.status !== "applied") return null;
  if (d.action === "pause" && d.entity_id) {
    return { endpoint: `/${d.entity_id}`, body: { status: "ACTIVE" }, note: `un-pause ${d.entity_name || d.entity_id}` };
  }
  if (d.action === "scale" && d.entity_id && d.budget_before_cents != null) {
    return { endpoint: `/${d.entity_id}`, body: { daily_budget: String(d.budget_before_cents) }, note: `restore budget $${d.budget_before_cents / 100}/day` };
  }
  return null;
}

async function rollback(logPath, execute) {
  if (!existsSync(logPath)) {
    console.error(`[scale] rollback: log not found: ${logPath}`);
    process.exit(7);
  }
  const log = JSON.parse(readFileSync(logPath, "utf8"));
  const reversals = (log.decisions || []).map(reverseDecision).filter(Boolean);
  if (!reversals.length) {
    console.log(JSON.stringify({ mode: "ROLLBACK", reversed: 0, note: "no applied actions to reverse" }, null, 2));
    return;
  }
  const graph = execute ? createGraph() : null;
  const results = [];
  for (const r of reversals) {
    if (execute) {
      try {
        await graph.post(r.endpoint, r.body);
        results.push({ ...r, status: "reversed" });
      } catch (e) {
        results.push({ ...r, status: "error", error: e.message });
      }
    } else {
      results.push({ ...r, status: "dry_run" });
    }
  }
  console.log(JSON.stringify({
    mode: execute ? "ROLLBACK_EXECUTE" : "ROLLBACK_DRY_RUN",
    from_log: logPath,
    reversed: results.filter((r) => r.status === "reversed").length,
    errors: results.filter((r) => r.status === "error").length,
    actions: results,
  }, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) {
    console.error("Usage: node skills/scale/scale.js <slug> [--execute] [--force] [--rollback [log]]");
    process.exit(1);
  }
  const execute = args.includes("--execute");
  const force = args.includes("--force");

  const rbIdx = args.indexOf("--rollback");
  if (rbIdx !== -1) {
    const next = args[rbIdx + 1];
    const logPath = next && !next.startsWith("--")
      ? resolve(ROOT, next)
      : resolve(ROOT, "clients", slug, "scaling_log.json");
    await rollback(logPath, execute);
    return;
  }

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
  const inHours = inBusinessHours(tz, !force);
  if (!inHours && !force) {
    console.error(`Outside business hours (6 AM – 9 PM ${tz || "unknown tz → fail-closed"}). Pass --force to override.`);
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
  const autoActions = allDecisions.filter((d) => d.auto && isActionable(d));
  const approvalQueue = allDecisions.filter((d) => !d.auto && isActionable(d));
  const flagOnly = allDecisions.filter((d) => !isActionable(d));

  // Run-level circuit breaker: a garbage performance_analysis.json (all entities
  // reading as breaches) must not auto-mutate the whole account. Refuse the run
  // when auto-actions exceed an absolute count or a fraction of active entities.
  const activeCount = Math.max(parentMap.ads.size + parentMap.adsets.size, 1);
  const pctCap = Math.floor(activeCount * MAX_AUTO_ACTIONS_PCT);
  const breachesAbs = autoActions.length > MAX_AUTO_ACTIONS_ABS;
  const breachesPct = autoActions.length > pctCap;
  if (execute && (breachesAbs || breachesPct) && !force) {
    console.error(
      `[scale] CIRCUIT BREAKER: ${autoActions.length} auto-actions ` +
      `(abs cap ${MAX_AUTO_ACTIONS_ABS}, ${Math.round(MAX_AUTO_ACTIONS_PCT * 100)}%-of-${activeCount} cap ${pctCap}). ` +
      `Likely bad analysis data. Inspect performance_analysis.json, or pass --force to override.`
    );
    process.exit(6);
  }

  const graph = execute ? createGraph() : null;
  const accountId = profile.accounts?.ad_account_id || null;
  const results = [];

  for (const d of autoActions) {
    let result;
    if (execute) {
      if (d.action === "duplicate" && (!accountId || isTbd(accountId))) {
        result = { ok: false, error: "accounts.ad_account_id missing/TBD — cannot clone adset" };
      } else {
        result = await executeDecision(graph, d, accountId);
      }
    } else {
      result = { ok: true, dry_run: true };
    }
    results.push({
      ...d,
      executed_at: new Date().toISOString(),
      status: result.ok ? (execute ? "applied" : "dry_run") : "error",
      error: result.error || null,
      meta_response: result.response || null,
      created_id: result.created_id || null,
      created_name: result.created_name || null,
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
    auto_duplicated: results.filter((r) => r.action === "duplicate" && r.status !== "error" && r.auto).length,
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

  // H4 persistence (best-effort): one optimizer_log row per run. No-op offline.
  if (supabaseConfigured()) {
    try {
      const clientId = await clientIdBySlug(slug);
      const actionsTaken = results
        .filter((r) => r.status === "applied" || r.status === "dry_run")
        .map((r) => ({ type: r.action, entity_id: r.entity_id, reason: r.reason || r.approval_reason || null,
          before: r.budget_before_cents ?? null, after: r.budget_after_cents ?? null, status: r.status }));
      const flagsRaised = results
        .filter((r) => r.status === "flagged" || r.status === "awaiting_approval")
        .map((r) => ({ type: r.action, entity_id: r.entity_id, reason: r.reason || r.approval_reason || null, status: r.status }));
      await sbInsert("optimizer_log", [{
        client_id: clientId,
        run_date: new Date().toISOString().slice(0, 10),
        actions_taken: actionsTaken,
        flags_raised: flagsRaised,
        digest_sent: false,
      }]);
      console.error(`[scale] persisted optimizer_log (${actionsTaken.length} actions, ${flagsRaised.length} flags)`);
    } catch (e) {
      console.error(`[scale] optimizer_log persistence skipped: ${e.message}`);
    }
  }

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

// Exported for unit tests; main() only runs when invoked directly.
export { inBusinessHours, metricsArePlausible, decisionFromFlag, reverseDecision, buildParentMap,
  isActionable, duplicateName, cloneAdset,
  MAX_AUTO_ACTIONS_ABS, MAX_AUTO_ACTIONS_PCT, MIN_IMPRESSIONS_FOR_ACTION };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("[scale] FATAL:", e.message);
    process.exit(1);
  });
}
