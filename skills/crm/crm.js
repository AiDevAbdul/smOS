#!/usr/bin/env node
/**
 * /crm companion — the agency pipeline (Phase 5, Agency OS foundation).
 *
 * One deal record per company moving lead → … → won → active client / churned.
 * Unifies the previously-fragmented prospects/ (pre-audit) and clients/ (signed)
 * worlds into one queryable pipeline. /proposal, /contract, /billing all read and
 * write deal.links + deal.deal terms.
 *
 * Storage: crm/pipeline.json (array of deals) + best-effort Supabase `deals` table.
 *
 * Usage:
 *   node skills/crm/crm.js add <slug> --name "Acme Co" [--email a@b.co --stage lead --retainer 2000 --currency USD --source referral]
 *   node skills/crm/crm.js list [--stage proposed]
 *   node skills/crm/crm.js show <slug>
 *   node skills/crm/crm.js stage <slug> <newstage> [--note "..."] [--force]
 *   node skills/crm/crm.js log <slug> --type call --note "left voicemail"
 *   node skills/crm/crm.js set <slug> next_action="send deck" next_action_due=2026-06-25
 *   node skills/crm/crm.js sync     # import existing prospects/ + clients/ into the pipeline
 *   node skills/crm/crm.js next     # deals needing attention (due/overdue next actions)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { deal as dealSchema } from "../../schemas/index.js";
import { upsert, supabaseConfigured } from "../../scripts/lib/supabase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const PIPELINE = resolve(ROOT, "crm", "pipeline.json");
const nowIso = () => new Date().toISOString();

function loadPipeline() {
  if (!existsSync(PIPELINE)) return [];
  try { return JSON.parse(readFileSync(PIPELINE, "utf8")).map(dealSchema.normalize); } catch { return []; }
}
function savePipeline(deals) {
  mkdirSync(dirname(PIPELINE), { recursive: true });
  writeFileSync(PIPELINE, JSON.stringify(deals.map(dealSchema.normalize), null, 2));
}
function findDeal(deals, slug) { return deals.find((d) => d.slug === slug); }

// Parse --flag value pairs and key=value pairs from argv tail.
function parseFlags(args) {
  const flags = {}; const kv = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) { flags[a.slice(2)] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true; }
    else if (a.includes("=")) { const [k, ...v] = a.split("="); kv[k] = v.join("="); }
  }
  return { flags, kv };
}

async function persist(d) {
  if (!supabaseConfigured()) return { skipped: true };
  try {
    // Mirror the deal to Supabase `deals` (upsert on slug). Best-effort.
    await upsert("deals", {
      slug: d.slug, company_name: d.company_name, stage: d.stage,
      monthly_retainer: d.deal.monthly_retainer, currency: d.deal.currency,
      probability: d.probability, owner: d.owner, contact: d.contact,
      links: d.links, updated_at: d.updated_at,
    }, "slug");
    return { ok: true };
  } catch (e) { return { error: e.message }; }
}

function summarize(deals) {
  const active = deals.filter((d) => !["lost", "churned"].includes(d.stage));
  const byStage = {};
  for (const s of dealSchema.STAGES) byStage[s] = deals.filter((d) => d.stage === s).length;
  const weighted = active.reduce((sum, d) => sum + dealSchema.weightedValue(d), 0);
  const won = deals.filter((d) => d.stage === "won");
  const mrr = won.reduce((s, d) => s + d.deal.monthly_retainer, 0);
  return { total: deals.length, by_stage: byStage, weighted_pipeline_annual: weighted, active_mrr: mrr };
}

async function main() {
  const [cmd, slugArg, ...rest] = process.argv.slice(2);
  const { flags, kv } = parseFlags(rest);
  let deals = loadPipeline();

  if (cmd === "list") {
    const filtered = flags.stage ? deals.filter((d) => d.stage === flags.stage) : deals;
    const rows = filtered.map((d) => ({ slug: d.slug, company: d.company_name, stage: d.stage, prob: d.probability, retainer: `${d.deal.currency} ${d.deal.monthly_retainer}`, next: d.next_action || "—" }));
    console.log(JSON.stringify({ pipeline: summarize(deals), deals: rows }, null, 2));
    return;
  }

  if (cmd === "show") {
    const d = findDeal(deals, slugArg);
    if (!d) { console.error(`No deal for "${slugArg}". Add it with: crm add ${slugArg} --name "..."`); process.exit(2); }
    console.log(JSON.stringify(d, null, 2));
    return;
  }

  if (cmd === "next") {
    const today = nowIso().slice(0, 10);
    const due = deals
      .filter((d) => !["lost", "churned"].includes(d.stage) && d.next_action)
      .map((d) => ({ slug: d.slug, stage: d.stage, action: d.next_action, due: d.next_action_due, overdue: d.next_action_due ? d.next_action_due < today : false }))
      .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    console.log(JSON.stringify({ today, needs_attention: due }, null, 2));
    return;
  }

  if (cmd === "add") {
    if (!slugArg) { console.error("add requires a slug"); process.exit(1); }
    if (findDeal(deals, slugArg)) { console.error(`Deal "${slugArg}" already exists — use 'stage'/'set' to update.`); process.exit(2); }
    const d = dealSchema.normalize({
      slug: slugArg,
      company_name: flags.name || slugArg,
      contact: { email: flags.email || null, name: flags["contact-name"] || null, phone: flags.phone || null },
      stage: flags.stage || "lead",
      source: flags.source || null,
      deal: { monthly_retainer: Number(flags.retainer) || 0, currency: flags.currency || "USD", setup_fee: Number(flags["setup-fee"]) || 0 },
      owner: flags.owner || null,
      created_at: nowIso(), updated_at: nowIso(),
      activities: [{ at: nowIso(), type: "stage", note: `created at stage ${flags.stage || "lead"}` }],
    });
    const v = dealSchema.validate(d);
    if (!v.ok) { console.error(`Invalid deal:\n  - ${v.errors.join("\n  - ")}`); process.exit(3); }
    deals.push(d); savePipeline(deals); await persist(d);
    console.log(JSON.stringify({ added: d.slug, stage: d.stage, pipeline: summarize(deals) }, null, 2));
    return;
  }

  if (cmd === "stage") {
    const d = findDeal(deals, slugArg);
    if (!d) { console.error(`No deal for "${slugArg}".`); process.exit(2); }
    const to = (rest[0] || "").toLowerCase();
    if (!dealSchema.STAGES.includes(to)) { console.error(`Invalid stage "${to}". One of: ${dealSchema.STAGES.join(", ")}`); process.exit(1); }
    if (!dealSchema.isValidTransition(d.stage, to) && !flags.force) {
      console.error(`Blocked transition ${d.stage} → ${to}. Allowed from ${d.stage}: ${(dealSchema.TRANSITIONS[d.stage] || []).join(", ") || "(none)"}. Use --force to override.`);
      process.exit(4);
    }
    const from = d.stage;
    d.stage = to;
    d.probability = dealSchema.STAGE_PROBABILITY[to] ?? d.probability;
    if (to === "won") d.won_at = nowIso();
    if (to === "lost") { d.lost_at = nowIso(); if (flags.reason) d.lost_reason = flags.reason; }
    d.updated_at = nowIso();
    d.activities.push({ at: nowIso(), type: "stage", note: flags.note || `${from} → ${to}` });
    const v = dealSchema.validate(d);
    if (!v.ok) { console.error(`Cannot move to ${to}:\n  - ${v.errors.join("\n  - ")}`); process.exit(3); }
    savePipeline(deals); await persist(d);
    console.log(JSON.stringify({ slug: d.slug, from, to, probability: d.probability, next: to === "won" ? "Run /intake to onboard, then /contract + /billing" : null }, null, 2));
    return;
  }

  if (cmd === "log") {
    const d = findDeal(deals, slugArg);
    if (!d) { console.error(`No deal for "${slugArg}".`); process.exit(2); }
    d.activities.push({ at: nowIso(), type: (flags.type || "note").toLowerCase(), note: flags.note || "" });
    d.updated_at = nowIso();
    savePipeline(deals); await persist(d);
    console.log(JSON.stringify({ slug: d.slug, logged: d.activities[d.activities.length - 1] }, null, 2));
    return;
  }

  if (cmd === "set") {
    const d = findDeal(deals, slugArg);
    if (!d) { console.error(`No deal for "${slugArg}".`); process.exit(2); }
    for (const [k, val] of Object.entries(kv)) {
      if (k.startsWith("link.")) d.links[k.slice(5)] = val;
      else if (k === "retainer") d.deal.monthly_retainer = Number(val) || 0;
      else if (k === "currency") d.deal.currency = val;
      else if (["next_action", "next_action_due", "owner", "source", "expected_close", "company_name"].includes(k)) d[k] = val;
      else if (k === "email") d.contact.email = val;
      else { console.error(`Unknown field "${k}"`); process.exit(1); }
    }
    d.updated_at = nowIso();
    const v = dealSchema.validate(d);
    if (!v.ok) { console.error(`Invalid after update:\n  - ${v.errors.join("\n  - ")}`); process.exit(3); }
    savePipeline(deals); await persist(d);
    console.log(JSON.stringify({ slug: d.slug, updated: Object.keys(kv) }, null, 2));
    return;
  }

  if (cmd === "sync") {
    // Import existing prospects/ (audited) and clients/ (won/active) that aren't
    // already in the pipeline — so the CRM reflects reality on first run.
    let added = 0;
    const ensure = (slug, patch) => {
      if (findDeal(deals, slug)) return;
      const d = dealSchema.normalize({ slug, company_name: slug, created_at: nowIso(), updated_at: nowIso(), ...patch });
      deals.push(d); added++;
    };
    const prospectsDir = resolve(ROOT, "prospects");
    if (existsSync(prospectsDir)) for (const slug of readdirSync(prospectsDir)) {
      const hasAudit = existsSync(resolve(prospectsDir, slug, "pre_audit.html"));
      ensure(slug, { stage: hasAudit ? "audited" : "lead", source: "pre-audit", links: { pre_audit: hasAudit ? `prospects/${slug}/pre_audit.html` : null } });
    }
    const clientsDir = resolve(ROOT, "clients");
    if (existsSync(clientsDir)) for (const slug of readdirSync(clientsDir)) {
      const profile = resolve(clientsDir, slug, "client_profile.json");
      if (!existsSync(profile)) continue;
      const existing = findDeal(deals, slug);
      if (existing) { existing.links.client_profile = `clients/${slug}/client_profile.json`; continue; }
      // a signed client with no proposal link → mark won but force (skips the proposal gate)
      ensure(slug, { stage: "won", source: "intake", won_at: nowIso(), links: { client_profile: `clients/${slug}/client_profile.json`, proposal: `clients/${slug}/` } });
    }
    savePipeline(deals);
    console.log(JSON.stringify({ synced: true, added, pipeline: summarize(deals) }, null, 2));
    return;
  }

  console.error("Usage: crm <add|list|show|stage|log|set|sync|next> ... (see header)");
  process.exit(1);
}

main().catch((e) => { console.error("[crm] FATAL:", e.message); process.exit(1); });
