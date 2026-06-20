#!/usr/bin/env node
/**
 * /rules companion script — Meta-native automated rules.
 *
 * Manages a curated set of conservative guardrail rules on the client's ad
 * account. Rules execute on Meta's servers (semi-hourly), so they catch
 * disasters between optimizer runs.
 *
 * Usage:
 *   node skills/rules/rules.js <slug> list
 *   node skills/rules/rules.js <slug> install [--dry-run]
 *   node skills/rules/rules.js <slug> preview <template>
 *   node skills/rules/rules.js <slug> disable <name>
 *   node skills/rules/rules.js <slug> enable <name>
 *   node skills/rules/rules.js <slug> history <name>
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

// CPA field in Meta filters — pixel purchase by default. Override per client if needed.
const CPA_FIELD = "cost_per_action_type:offsite_conversion.fb_pixel_purchase";

function buildTemplates(kpis) {
  const cpaTarget = kpis.cpa_target ?? 50;
  return [
    {
      name: "PAUSE_RUNAWAY_CPA",
      evaluation_spec: {
        evaluation_type: "SCHEDULE",
        filters: [
          { field: "spent", operator: "GREATER_THAN", value: 5000 }, // cents
          { field: CPA_FIELD, operator: "GREATER_THAN", value: cpaTarget * 5 },
        ],
        time_window: "LAST_3_DAYS",
      },
      execution_spec: { execution_type: "PAUSE", execution_options: [] },
      schedule_spec: { schedule_type: "SEMI_HOURLY" },
      entities: { entity_type: "AD" },
    },
    {
      name: "PAUSE_LOW_CTR_LIVE",
      evaluation_spec: {
        evaluation_type: "SCHEDULE",
        filters: [
          { field: "spent", operator: "GREATER_THAN", value: 5000 },
          { field: "ctr", operator: "LESS_THAN", value: 0.3 }, // Meta returns CTR as percent
        ],
        time_window: "LAST_3_DAYS",
      },
      execution_spec: { execution_type: "PAUSE", execution_options: [] },
      schedule_spec: { schedule_type: "SEMI_HOURLY" },
      entities: { entity_type: "AD" },
    },
    {
      name: "PAUSE_HIGH_FREQ",
      evaluation_spec: {
        evaluation_type: "SCHEDULE",
        filters: [{ field: "frequency", operator: "GREATER_THAN", value: 5.0 }],
        time_window: "LAST_7_DAYS",
      },
      execution_spec: { execution_type: "PAUSE", execution_options: [] },
      schedule_spec: { schedule_type: "SEMI_HOURLY" },
      entities: { entity_type: "AD" },
    },
    {
      name: "NOTIFY_BUDGET_OVERRUN",
      evaluation_spec: {
        evaluation_type: "SCHEDULE",
        filters: [{ field: "spent", operator: "GREATER_THAN", value: "{daily_budget}*1.5" }],
        time_window: "TODAY",
      },
      execution_spec: { execution_type: "NOTIFICATION", execution_options: [] },
      schedule_spec: { schedule_type: "SEMI_HOURLY" },
      entities: { entity_type: "ADSET" },
    },
    {
      name: "NOTIFY_ZERO_DELIVERY",
      evaluation_spec: {
        evaluation_type: "SCHEDULE",
        filters: [
          { field: "impressions", operator: "LESS_THAN", value: 1 },
          { field: "effective_status", operator: "EQUAL", value: "ACTIVE" },
        ],
        time_window: "YESTERDAY",
      },
      execution_spec: { execution_type: "NOTIFICATION", execution_options: [] },
      schedule_spec: { schedule_type: "DAILY" },
      entities: { entity_type: "ADSET" },
    },
  ];
}

function serializeBody(input) {
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (v != null && typeof v === "object") out[k] = JSON.stringify(v);
    else if (v != null) out[k] = v;
  }
  return out;
}

async function listRules(graph, act) {
  return graph.get(`/${act}/adrules_library`, {
    fields: "id,name,status,evaluation_spec,execution_spec,schedule_spec,created_time,updated_time",
    limit: 200,
  });
}

async function installRules(graph, act, kpis, dryRun) {
  const templates = buildTemplates(kpis);
  const existing = await listRules(graph, act);
  const existingNames = new Set((existing.data || []).map((r) => r.name));

  const log = { slug: null, installed: [], skipped: [], errors: [], dry_run: dryRun };

  for (const t of templates) {
    if (existingNames.has(t.name)) {
      log.skipped.push({ name: t.name, reason: "already exists" });
      continue;
    }
    if (dryRun) {
      log.installed.push({ name: t.name, dry_run: true, body: t });
      continue;
    }
    try {
      const res = await graph.post(`/${act}/adrules_library`, serializeBody(t));
      log.installed.push({ name: t.name, rule_id: res.id });
    } catch (e) {
      log.errors.push({ name: t.name, error: e.message });
    }
  }
  return log;
}

async function findRuleByName(graph, act, name) {
  const res = await listRules(graph, act);
  return (res.data || []).find((r) => r.name === name);
}

async function setRuleStatus(graph, act, name, status) {
  const rule = await findRuleByName(graph, act, name);
  if (!rule) throw new Error(`Rule '${name}' not found`);
  return graph.post(`/${rule.id}`, { status });
}

async function previewTemplate(graph, act, templateName, kpis) {
  const templates = buildTemplates(kpis);
  const template = templates.find((t) => t.name === templateName);
  if (!template) throw new Error(`Unknown template: ${templateName}. Available: ${templates.map((t) => t.name).join(", ")}`);
  const rule = await findRuleByName(graph, act, templateName);
  if (!rule) throw new Error(`Template '${templateName}' is not installed yet — run 'install' first`);
  return graph.post(`/${rule.id}/preview`, {});
}

async function ruleHistory(graph, act, name) {
  const rule = await findRuleByName(graph, act, name);
  if (!rule) throw new Error(`Rule '${name}' not found`);
  return graph.get(`/${rule.id}/history`, {
    fields: "evaluation_type,results,timestamp,object_count,action,error_code,error_message",
    limit: 200,
  });
}

async function main() {
  const [slug, mode, ...rest] = process.argv.slice(2);
  if (!slug || !mode) {
    console.error("Usage: node skills/rules/rules.js <slug> <list|install|preview|disable|enable|history> [args]");
    process.exit(1);
  }
  const dryRun = rest.includes("--dry-run");

  const profilePath = resolve(ROOT, "clients", slug, "client_profile.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const acct = profile.accounts || {};
  const kpis = profile.kpis || {};
  if (isTbd(acct.ad_account_id)) {
    console.error("accounts.ad_account_id is TBD");
    process.exit(3);
  }

  const graph = createGraph();
  const act = graph.act(acct.ad_account_id);

  let result;
  try {
    switch (mode) {
      case "list":
        result = await listRules(graph, act);
        break;
      case "install":
        result = await installRules(graph, act, kpis, dryRun);
        result.slug = slug;
        writeFileSync(resolve(ROOT, "clients", slug, "rules_log.json"), JSON.stringify(result, null, 2));
        break;
      case "preview": {
        const name = rest.find((x) => !x.startsWith("--"));
        if (!name) throw new Error("preview requires a template name");
        result = await previewTemplate(graph, act, name, kpis);
        break;
      }
      case "disable": {
        const name = rest.find((x) => !x.startsWith("--"));
        if (!name) throw new Error("disable requires a rule name");
        result = await setRuleStatus(graph, act, name, "DISABLED");
        break;
      }
      case "enable": {
        const name = rest.find((x) => !x.startsWith("--"));
        if (!name) throw new Error("enable requires a rule name");
        result = await setRuleStatus(graph, act, name, "ENABLED");
        break;
      }
      case "history": {
        const name = rest.find((x) => !x.startsWith("--"));
        if (!name) throw new Error("history requires a rule name");
        result = await ruleHistory(graph, act, name);
        writeFileSync(resolve(ROOT, "clients", slug, `rule_history_${name}.json`), JSON.stringify(result, null, 2));
        break;
      }
      default:
        throw new Error(`Unknown mode: ${mode}`);
    }
  } catch (e) {
    console.error(`[rules] ${mode} failed: ${e.message}`);
    process.exit(1);
  }

  console.log(JSON.stringify({ slug, mode, result }, null, 2));
}

main().catch((e) => {
  console.error("[rules] FATAL:", e.message);
  process.exit(1);
});
