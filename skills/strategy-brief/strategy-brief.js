#!/usr/bin/env node
/**
 * /strategy-brief companion script.
 *
 * Pure synthesis — no Meta API calls. Reads the 4 input artifacts, reconciles
 * conflicts, computes deterministic outputs (budget split, audience priority,
 * calendar), and writes strategy_brief.json + .md. Claude appends qualitative
 * judgment (creative angle phrasing, calendar narrative) and runs the Discord
 * approval gate.
 *
 * Usage:
 *   node skills/strategy-brief/strategy-brief.js <client_slug>
 *
 * Reads:  clients/<slug>/client_profile.json
 *         clients/<slug>/audit_raw.json (optional)
 *         clients/<slug>/competitor_intel.json
 *         clients/<slug>/audience_map.json
 * Writes: clients/<slug>/strategy_brief.json
 *         clients/<slug>/strategy_brief.md
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { competitorIntel as competitorSchema, audienceMap as audienceMapSchema, strategyBrief as briefSchema, assertValid } from "../../schemas/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const DEFAULT_BUDGET_SPLIT = { cold_pct: 0.6, warm_pct: 0.25, lal_pct: 0.15 };
const ADSET_LARGE_DAILY = 200; // > this triggers Discord approval per global guardrails

function loadJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function decideObjectiveHierarchy(profile, audit) {
  const events = profile.business?.conversion_events || [];
  const pixelHealth = audit?.paid?.pixel_health || "unknown";
  const hasPurchaseHistory = (audit?.paid?.best_roas || 0) > 0;

  // Cold pixel / no purchase history → start at LEADS or TRAFFIC, graduate
  if (pixelHealth !== "full" || !hasPurchaseHistory) {
    return [
      { phase: "A", start_day: 0, objective: events.includes("Purchase") ? "OUTCOME_LEADS" : "OUTCOME_TRAFFIC", reason: "pixel learning — start lighter-funnel, graduate after 200+ events" },
      { phase: "B", start_day: 14, objective: "OUTCOME_SALES", reason: "promote to conversion objective once pixel has signal" },
      { phase: "C", start_day: 21, objective: "OUTCOME_SALES", reason: "scale into lookalike + second cluster" },
    ];
  }
  return [
    { phase: "A", start_day: 0, objective: "OUTCOME_SALES", reason: "healthy pixel + purchase history; conversion-objective from day 1" },
    { phase: "B", start_day: 14, objective: "OUTCOME_SALES", reason: "layer retargeting once Phase A has data" },
    { phase: "C", start_day: 28, objective: "OUTCOME_SALES", reason: "scale into LAL 1% + second interest cluster after 3-day ROAS gate" },
  ];
}

function rankAudiences(audienceMap) {
  const clusters = audienceMap?.clusters || [];
  const ranked = [];

  // Broad (no interest layer) always first
  ranked.push({ priority: 1, id: "BROAD", source: "broad", reason: "no-interest baseline" });

  // Largest interest cluster aligned with primary USP
  const sortedClusters = [...clusters].sort((a, b) => {
    const sizeA = sizeMidpoint(a.size_estimate);
    const sizeB = sizeMidpoint(b.size_estimate);
    return sizeB - sizeA;
  });
  for (let i = 0; i < Math.min(2, sortedClusters.length); i++) {
    ranked.push({
      priority: ranked.length + 1,
      id: sortedClusters[i].id,
      source: "interest_cluster",
      label: sortedClusters[i].label,
      size_estimate: sortedClusters[i].size_estimate,
    });
  }

  // Retargeting layers
  const rtLayers = audienceMap?.retargeting_layers || audienceMap?.retargeting || [];
  for (const layer of rtLayers.slice(0, 2)) {
    ranked.push({
      priority: ranked.length + 1,
      id: layer.id || layer.name,
      source: "retargeting",
      label: layer.label || layer.name,
    });
  }

  // Lookalike from strongest seed
  const lalSpec = audienceMap?.lookalike || audienceMap?.lookalikes;
  if (lalSpec) {
    const lal = Array.isArray(lalSpec) ? lalSpec[0] : lalSpec;
    if (lal) ranked.push({ priority: ranked.length + 1, id: lal.id || "LAL_1PCT", source: "lookalike", label: lal.label || "LAL 1% from strongest seed" });
  }

  return ranked.slice(0, 5);
}

function sizeMidpoint(sizeStr) {
  if (!sizeStr) return 0;
  const m = String(sizeStr).match(/(\d+)\s*k?\s*-\s*(\d+)\s*k?/i);
  if (!m) return 0;
  return (parseInt(m[1], 10) + parseInt(m[2], 10)) / 2;
}

function allocateBudgets(profile, ranked) {
  const kpis = profile.kpis || {};
  const monthlyLow = kpis.monthly_budget_low || kpis.monthly_budget || 3000;
  const dailyTotal = monthlyLow / 30;

  const split = DEFAULT_BUDGET_SPLIT;
  const coldDaily = dailyTotal * split.cold_pct;
  const warmDaily = dailyTotal * split.warm_pct;
  const lalDaily = dailyTotal * split.lal_pct;

  const adsets = [];
  const coldAudiences = ranked.filter((r) => r.source === "broad" || r.source === "interest_cluster");
  const perColdAdset = coldAudiences.length ? coldDaily / coldAudiences.length : 0;
  for (const a of coldAudiences) {
    adsets.push({
      audience_id: a.id,
      audience_label: a.label || a.id,
      role: "cold",
      daily_budget: round(perColdAdset, 2),
      needs_approval: perColdAdset > ADSET_LARGE_DAILY,
    });
  }
  const warmAudiences = ranked.filter((r) => r.source === "retargeting");
  const perWarmAdset = warmAudiences.length ? warmDaily / warmAudiences.length : 0;
  for (const a of warmAudiences) {
    adsets.push({
      audience_id: a.id,
      audience_label: a.label || a.id,
      role: "warm",
      daily_budget: round(perWarmAdset, 2),
      needs_approval: perWarmAdset > ADSET_LARGE_DAILY,
    });
  }
  const lalAudiences = ranked.filter((r) => r.source === "lookalike");
  for (const a of lalAudiences) {
    adsets.push({
      audience_id: a.id,
      audience_label: a.label || a.id,
      role: "lal",
      daily_budget: round(lalDaily, 2),
      needs_approval: lalDaily > ADSET_LARGE_DAILY,
    });
  }

  return {
    monthly_budget: monthlyLow,
    daily_total: round(dailyTotal, 2),
    split,
    adsets,
  };
}

function pickCreativeAngles(competitorIntel, profile) {
  const angles = competitorIntel?.angles || [];
  const restricted = (profile.voice?.restricted_words || profile.voice?.avoid || []).map((w) => w.toLowerCase());

  // Score angles: highest fit + (bonus for rare or differentiator) - (penalty for restricted match)
  const scored = angles.map((a) => {
    let score = 0;
    if (a.fit_for_client === "high") score += 3;
    if (a.fit_for_client === "medium") score += 1;
    if (a.frequency === "rare" || a.frequency === "uncommon") score += 2;
    if (a.frequency === "very_common") score -= 0.5;
    const label = (a.angle || a.name || "").toLowerCase();
    for (const w of restricted) {
      if (w && label.includes(w)) {
        score -= 5;
      }
    }
    return { ...a, _score: score };
  });

  scored.sort((a, b) => b._score - a._score);
  const top = scored.slice(0, 3);

  // Categorize into pain / aspiration / proof
  const buckets = { pain: null, aspiration: null, proof: null };
  for (const a of top) {
    const label = (a.angle || "").toLowerCase();
    if (!buckets.proof && /trust|credential|review|testimonial|proof|certif/.test(label)) buckets.proof = a;
    else if (!buckets.aspiration && /transform|result|outcome|before.*after|future/.test(label)) buckets.aspiration = a;
    else if (!buckets.pain && /problem|pain|fix|repair|broken|issue/.test(label)) buckets.pain = a;
  }
  // Fill any missing bucket with whatever remains
  const remaining = top.filter((a) => !Object.values(buckets).includes(a));
  for (const key of ["pain", "aspiration", "proof"]) {
    if (!buckets[key] && remaining.length) buckets[key] = remaining.shift();
  }

  const formatForAngle = (a) => {
    const useFor = (a.use_for || []).join(",");
    const winFormat = competitorIntel?.format_mix?.winning_format_signal || "";
    if (/cosmetic|ceramic|PPF|detail|wraps|paint/i.test(useFor)) return /short.*video|reel/i.test(winFormat) ? "reels_15_30s" : "carousel";
    if (/repair|mechanical|diagnostic/i.test(useFor)) return "single_image";
    return "single_image";
  };

  // angle_id is the stable join key /creative stamps onto ad_copy and /launch
  // matches on. name is already a canonical uppercase slug, so id == name here.
  return [
    buckets.pain && { angle_id: "PAIN", name: "PAIN", angle: buckets.pain.angle, hook_archetype: "Problem-led question", format: formatForAngle(buckets.pain), prompt: `Lead with the pain in '${buckets.pain.angle}'. ${buckets.pain.notes || ""}` },
    buckets.aspiration && { angle_id: "ASPIRATION", name: "ASPIRATION", angle: buckets.aspiration.angle, hook_archetype: "Outcome-led visual", format: formatForAngle(buckets.aspiration), prompt: `Show the outcome from '${buckets.aspiration.angle}'. ${buckets.aspiration.notes || ""}` },
    buckets.proof && { angle_id: "PROOF", name: "PROOF", angle: buckets.proof.angle, hook_archetype: "Authority / social proof", format: formatForAngle(buckets.proof), prompt: `Establish credibility via '${buckets.proof.angle}'. ${buckets.proof.notes || ""}` },
  ].filter(Boolean);
}

function buildSuccessMetrics(profile) {
  const k = profile.kpis || {};
  const cpaTarget = k.cpa_target ?? 50;
  return {
    cold: {
      ctr_target: k.cold_ctr_target ?? 0.01,
      cpm_ceiling: k.cold_cpm_ceiling ?? 30,
      cpa_target: cpaTarget,
      roas_target: k.cold_roas_target ?? 1.5,
    },
    warm: {
      cpa_target: round(cpaTarget * 0.6, 2),
      roas_target: k.warm_roas_target ?? 3.0,
    },
    scale_gate: {
      rule: "3 consecutive days ROAS > target before any budget increase",
      consecutive_days: 3,
      target_metric: "roas",
    },
    pause_floors: {
      cpa_multiplier: k.pause_cpa_multiplier ?? 3,
      ctr_floor: k.pause_ctr_floor ?? 0.005,
      frequency_ceiling: k.pause_frequency_ceiling ?? 4,
    },
  };
}

function buildCalendar(hierarchy) {
  // Map phases to weeks
  const phaseByWeek = {};
  for (const phase of hierarchy) {
    const week = Math.floor(phase.start_day / 7) + 1;
    phaseByWeek[week] = phase;
  }
  return [
    { week: 1, actions: [`Launch Phase ${hierarchy[0]?.phase || "A"} — ${hierarchy[0]?.objective || ""}`, "3 creatives × 2 audiences", "Daily monitoring; no scaling decisions"] },
    { week: 2, actions: ["Kill underperformers per pause thresholds", "Refresh worst-performing creative", "Begin reviewing audience-level signals"] },
    { week: 3, actions: [phaseByWeek[3] ? `Begin Phase ${phaseByWeek[3].phase} — ${phaseByWeek[3].objective}` : "Layer retargeting", "Continue cold prospecting", "Evaluate scaling gate (3-day ROAS > target)"] },
    { week: 4, actions: [phaseByWeek[4] ? `Begin Phase ${phaseByWeek[4].phase} — ${phaseByWeek[4].objective}` : "Scale-gate evaluation", "Launch LAL 1% if gate passed", "Plan month-2 budget and creative refresh"] },
  ];
}

function reconcileAssumptions(profile, audit) {
  const out = [];
  const kpiCpa = profile.kpis?.cpa_target;
  const auditCpa = audit?.paid?.best_cpa;
  if (kpiCpa && auditCpa && Math.abs(auditCpa - kpiCpa) / kpiCpa > 0.3) {
    out.push(`Profile CPA target (${kpiCpa}) and audit best-CPA (${auditCpa}) diverge by >30%. Defaulting to profile target.`);
  }
  if (audit?.paid?.pixel_health && audit.paid.pixel_health !== "full") {
    out.push(`Pixel health is '${audit.paid.pixel_health}' per audit — Phase A uses lighter-funnel objective until pixel learns.`);
  }
  if (!audit) {
    out.push("No audit_raw.json found — running with profile-only assumptions; audit signals not factored in.");
  }
  return out;
}

function excludedAngles(competitorIntel, profile) {
  const restricted = (profile.voice?.restricted_words || profile.voice?.avoid || []).map((w) => w.toLowerCase());
  const out = [];
  for (const a of competitorIntel?.angles || []) {
    const label = (a.angle || "").toLowerCase();
    const hit = restricted.find((w) => w && label.includes(w));
    if (hit) out.push(`'${a.angle}' — contains restricted word '${hit}'`);
  }
  return out;
}

function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function renderMarkdown(brief, profile) {
  const lines = [];
  lines.push(`# Strategy Brief — ${profile.name}`);
  lines.push(``);
  lines.push(`**Generated:** ${brief.generated_at}`);
  lines.push(`**Monthly budget:** ${brief.budget_allocation.monthly_budget}`);
  lines.push(`**Daily total:** ${brief.budget_allocation.daily_total}`);
  lines.push(``);
  lines.push(`> Reply 'approve' in Discord to lock this brief, or 'reject [reason]' to revise.`);
  lines.push(``);

  lines.push(`## Objective hierarchy`);
  for (const p of brief.objective_hierarchy) {
    lines.push(`- **Phase ${p.phase}** — Day ${p.start_day}+ — \`${p.objective}\` · ${p.reason}`);
  }
  lines.push(``);

  lines.push(`## Budget allocation`);
  lines.push(`Cold: ${Math.round(brief.budget_allocation.split.cold_pct * 100)}% · Warm: ${Math.round(brief.budget_allocation.split.warm_pct * 100)}% · LAL: ${Math.round(brief.budget_allocation.split.lal_pct * 100)}%`);
  lines.push(``);
  lines.push(`| Adset | Role | Daily | Approval needed |`);
  lines.push(`|---|---|---|---|`);
  for (const a of brief.budget_allocation.adsets) {
    lines.push(`| ${a.audience_label || a.audience_id} | ${a.role} | $${a.daily_budget} | ${a.needs_approval ? "⚠️ yes" : "no"} |`);
  }
  lines.push(``);

  lines.push(`## Audience priority (launch order)`);
  for (const a of brief.audience_priority) {
    lines.push(`${a.priority}. \`${a.id}\` — ${a.label || a.source}${a.size_estimate ? ` (${a.size_estimate})` : ""}`);
  }
  lines.push(``);

  lines.push(`## Creative angles (3-way test)`);
  for (const c of brief.creative_angles) {
    lines.push(`### ${c.name} — ${c.angle}`);
    lines.push(`- Hook: ${c.hook_archetype}`);
    lines.push(`- Format: \`${c.format}\``);
    lines.push(`- Direction: ${c.prompt}`);
    lines.push(``);
  }

  lines.push(`## Success metrics`);
  lines.push(`**Cold:** CTR ≥ ${(brief.success_metrics.cold.ctr_target * 100).toFixed(2)}% · CPM ≤ $${brief.success_metrics.cold.cpm_ceiling} · CPA ≤ $${brief.success_metrics.cold.cpa_target} · ROAS ≥ ${brief.success_metrics.cold.roas_target}`);
  lines.push(`**Warm:** CPA ≤ $${brief.success_metrics.warm.cpa_target} · ROAS ≥ ${brief.success_metrics.warm.roas_target}`);
  lines.push(`**Scale gate:** ${brief.success_metrics.scale_gate.rule}`);
  lines.push(``);

  lines.push(`## 30-day calendar`);
  for (const w of brief.calendar) {
    lines.push(`### Week ${w.week}`);
    for (const a of w.actions) lines.push(`- ${a}`);
    lines.push(``);
  }

  if (brief.assumptions?.length) {
    lines.push(`## Assumptions / divergences`);
    for (const a of brief.assumptions) lines.push(`- ${a}`);
    lines.push(``);
  }
  if (brief.excluded_angles?.length) {
    lines.push(`## Excluded angles`);
    for (const e of brief.excluded_angles) lines.push(`- ${e}`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*Generated by smOS · brief is deterministic from inputs; Claude appends qualitative reasoning above.*`);
  return lines.join("\n");
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: node skills/strategy-brief/strategy-brief.js <slug>");
    process.exit(1);
  }
  const dir = resolve(ROOT, "clients", slug);
  const profile = loadJsonIfExists(resolve(dir, "client_profile.json"));
  if (!profile) {
    console.error(`Profile not found: ${dir}/client_profile.json`);
    process.exit(2);
  }
  const competitorRaw = loadJsonIfExists(resolve(dir, "competitor_intel.json"));
  const competitor = competitorRaw ? competitorSchema.normalize(competitorRaw) : null;
  const audienceMapRaw = loadJsonIfExists(resolve(dir, "audience_map.json"));
  const audienceMap = audienceMapRaw ? audienceMapSchema.normalize(audienceMapRaw) : null;
  const audit = loadJsonIfExists(resolve(dir, "audit_raw.json"));

  const missing = [];
  if (!competitor) missing.push("competitor_intel.json (run /research)");
  if (!audienceMap) missing.push("audience_map.json (run /audience-map)");
  if (missing.length) {
    console.error(`Missing inputs: ${missing.join(", ")}`);
    process.exit(3);
  }

  console.error(`[strategy-brief] ${slug} — synthesizing…`);
  const objectiveHierarchy = decideObjectiveHierarchy(profile, audit);
  const audiencePriority = rankAudiences(audienceMap);
  const budgetAllocation = allocateBudgets(profile, audiencePriority);
  const creativeAngles = pickCreativeAngles(competitor, profile);
  const successMetrics = buildSuccessMetrics(profile);
  const calendar = buildCalendar(objectiveHierarchy);
  const assumptions = reconcileAssumptions(profile, audit);
  const excluded = excludedAngles(competitor, profile);

  const brief = {
    slug,
    generated_at: new Date().toISOString(),
    inputs_used: {
      profile: true,
      audit: !!audit,
      competitor_intel: true,
      audience_map: true,
    },
    objective_hierarchy: objectiveHierarchy,
    budget_allocation: budgetAllocation,
    audience_priority: audiencePriority,
    creative_angles: creativeAngles,
    success_metrics: successMetrics,
    calendar,
    assumptions,
    excluded_angles: excluded,
    approval: { status: "pending", approved_by: null, approved_at: null, discord_message_id: null },
  };

  // Fail-closed: refuse to write a brief whose angles lack join keys.
  assertValid("strategy_brief", briefSchema.normalize(brief), briefSchema.validate);

  const jsonPath = resolve(dir, "strategy_brief.json");
  const mdPath = resolve(dir, "strategy_brief.md");
  writeFileSync(jsonPath, JSON.stringify(brief, null, 2));
  writeFileSync(mdPath, renderMarkdown(brief, profile));

  console.error(`[strategy-brief] wrote ${jsonPath}`);
  console.error(`[strategy-brief] wrote ${mdPath}`);

  console.log(JSON.stringify({
    slug,
    daily_total: brief.budget_allocation.daily_total,
    phases: brief.objective_hierarchy.length,
    audiences: brief.audience_priority.length,
    creative_angles: brief.creative_angles.length,
    adsets_needing_approval: brief.budget_allocation.adsets.filter((a) => a.needs_approval).length,
    assumptions: brief.assumptions.length,
    json: jsonPath,
    md: mdPath,
    next: "post strategy_brief.md to Discord for approval, then run /creative",
  }, null, 2));
}

main().catch((e) => {
  console.error("[strategy-brief] FATAL:", e.message);
  process.exit(1);
});
