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
 *   node skills/crm/crm.js next     # deals needing attention (next actions + retention risk)
 *
 * Group D3 adds the retention layer:
 *   node skills/crm/crm.js health [<slug>]   # client health score + renewal status
 *   node skills/crm/crm.js set <slug> engagement_start=2026-06-18 term_months=6
 *   node skills/crm/crm.js set <slug> risk_note="champion left the company"
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { deal as dealSchema } from "../../schemas/index.js";
import { upsert, supabaseConfigured } from "../../scripts/lib/supabase.js";
import { crmPipeline } from "../../scripts/lib/paths.js";
import * as P from "../../scripts/lib/paths.js";
import { listInvoices } from "../../scripts/lib/billing-store.js";
import { clientHealth, retentionQueue, mrrByCurrency } from "../../scripts/lib/client-health.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

// Via paths.js so this honors SMOS_DATA_ROOT, and resolved per call so a value set
// after import still applies. NOTE: these two functions duplicate
// scripts/lib/crm-store.js's loadPipeline/savePipeline — both must keep pointing at
// this same helper, or /crm and /billing would read different pipelines.
const PIPELINE = () => crmPipeline();
const nowIso = () => new Date().toISOString();

function loadPipeline() {
  const p = PIPELINE();
  if (!existsSync(p)) return [];
  try { return JSON.parse(readFileSync(p, "utf8")).map(dealSchema.normalize); } catch { return []; }
}
function savePipeline(deals) {
  const p = PIPELINE();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(deals.map(dealSchema.normalize), null, 2));
}
function findDeal(deals, slug) { return deals.find((d) => d.slug === slug); }

/**
 * Gather the artifacts a health score needs for one client, then score them
 * (Group D3). Every lookup is best-effort: a missing artifact becomes a MISSING
 * SIGNAL that lowers the reported confidence, never a zero that fakes bad news.
 */
function healthFor(d, today) {
  // Latest /monthly-review trends, if one has ever run.
  let trends = null;
  try {
    const reportsRoot = P.clientReportsRoot(d.slug);
    if (existsSync(reportsRoot)) {
      const dates = readdirSync(reportsRoot).filter((x) => /^\d{4}-\d{2}/.test(x)).sort().reverse();
      for (const date of dates) {
        const raw = P.clientReport(d.slug, date, "monthly-review", "raw.json");
        if (existsSync(raw)) { trends = JSON.parse(readFileSync(raw, "utf8")).trends || null; break; }
      }
    }
  } catch { /* leave trends null — reported as a missing signal */ }

  // Most recent report of any kind actually delivered to the client.
  let lastReport = null;
  try {
    const reportsRoot = P.clientReportsRoot(d.slug);
    if (existsSync(reportsRoot)) {
      const dates = readdirSync(reportsRoot).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
      lastReport = dates.length ? dates[dates.length - 1] : null;
    }
  } catch { /* null */ }

  let invoices = [];
  try { invoices = listInvoices(d.slug); } catch { /* [] */ }

  return clientHealth({ deal: d, trends, invoices, lastReport, today });
}

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
  const won = deals.filter((d) => d.stage === "won");
  // Both of these used to be single blended numbers summed across EUR, USD and PKR
  // deals — arithmetic on incommensurable units, so the headline figure was
  // meaningless. Reported per currency now. `_blended` is kept only so an existing
  // reader doesn't break, and is explicitly labelled as not a real amount.
  const perCurrency = (list, value) => {
    const by = {};
    for (const d of list) {
      const c = d.deal.currency || "USD";
      by[c] = Math.round(((by[c] || 0) + value(d)) * 100) / 100;
    }
    return by;
  };
  const weightedBy = perCurrency(active, (d) => dealSchema.weightedValue(d));
  const mrrBy = perCurrency(won, (d) => d.deal.monthly_retainer);
  const blend = (by) => Math.round(Object.values(by).reduce((a, b) => a + b, 0) * 100) / 100;
  return {
    total: deals.length,
    by_stage: byStage,
    weighted_pipeline_annual: weightedBy,
    active_mrr: mrrBy,
    clients_without_retainer: won.filter((d) => !(d.deal.monthly_retainer > 0)).length,
    _blended_note: "weighted_pipeline_annual and active_mrr are per-currency. Do not add them together — these deals are in different currencies.",
    _blended: { weighted_pipeline_annual: blend(weightedBy), active_mrr: blend(mrrBy) },
  };
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

    // Retention (D3): a pipeline that only surfaces sales next-actions will let a
    // paying client churn quietly. Won deals are scored and the risky ones listed.
    const queue = retentionQueue(deals.filter((d) => d.stage === "won").map((d) => healthFor(d, today)));
    console.log(JSON.stringify({
      today,
      needs_attention: due,
      retention: {
        at_risk_or_due: queue.length,
        clients: queue.map((h) => ({
          slug: h.slug, score: h.score, band: h.band, provisional: h.band_provisional, confidence: `${h.confidence}%`,
          renewal: h.renewal, mrr: h.mrr, reasons: h.reasons,
        })),
      },
    }, null, 2));
    return;
  }

  if (cmd === "health") {
    const today = nowIso().slice(0, 10);
    const targets = slugArg
      ? deals.filter((d) => d.slug === slugArg)
      : deals.filter((d) => d.stage === "won");
    if (!targets.length) {
      console.error(slugArg ? `No deal "${slugArg}".` : "No won deals to score.");
      process.exit(2);
    }
    const healths = targets.map((d) => healthFor(d, today));
    const scored = healths.filter((h) => h.score !== null);
    console.log(JSON.stringify({
      as_of: today,
      clients: healths,
      // Only average what was actually scored — an unscoreable client must not be
      // silently counted as average.
      portfolio: {
        scored: scored.length,
        unscoreable: healths.length - scored.length,
        mean_score: scored.length ? Math.round(scored.reduce((s, h) => s + h.score, 0) / scored.length) : null,
        by_band: healths.reduce((acc, h) => { const k = h.band || "unscoreable"; acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
        // Per currency, never blended: this portfolio has EUR, USD and PKR retainers.
        mrr: mrrByCurrency(healths),
        mrr_at_risk: mrrByCurrency(healths.filter((h) => ["at_risk", "critical"].includes(h.band))),
      },
    }, null, 2));
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
      // Retention layer (D3). term_months is coerced to a number so `term_months=6`
      // from the shell doesn't store the string "6" and fail validation.
      else if (["engagement_start", "renewal_date", "risk_note"].includes(k)) d[k] = val === "" ? null : val;
      else if (k === "term_months") d.term_months = val === "" ? null : (Number(val) || null);
      else if (k === "email") d.contact.email = val;
      else { console.error(`Unknown field "${k}". Known: retainer, currency, email, next_action, next_action_due, owner, source, expected_close, company_name, engagement_start, term_months, renewal_date, risk_note, link.<name>`); process.exit(1); }
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

  console.error("Usage: crm <add|list|show|stage|log|set|sync|next|health> ... (see header)");
  process.exit(1);
}

main().catch((e) => { console.error("[crm] FATAL:", e.message); process.exit(1); });
