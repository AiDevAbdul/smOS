#!/usr/bin/env node
/**
 * /leads companion script — pull Meta lead-gen leads, score, export.
 *
 * Lead delivery is WEBHOOK-FIRST (B4): real-time `leadgen` notifications are the
 * primary path; `sync` is the backfill/reconciliation poller. Both write to the
 * same per-form JSONL store and dedupe on lead id.
 *
 * Usage:
 *   node skills/leads/leads.js <slug> webhook --payload <file>   # PRIMARY (real-time)
 *   cat payload.json | node skills/leads/leads.js <slug> webhook
 *   node skills/leads/leads.js <slug> sync                       # backfill poller
 *   node skills/leads/leads.js <slug> list
 *   node skills/leads/leads.js <slug> pull <form_id> [--since ISO_DATE]
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";
import * as P from "../../scripts/lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "throwaway.email",
  "yopmail.com", "trashmail.com", "sharklasers.com", "getairmail.com", "fakeinbox.com",
]);

const QUALIFIED_FLOOR = 70;
const REVIEW_FLOOR = 40;

function pageTokenFor(slug) {
  const envKey = `META_PAGE_TOKEN_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return process.env[envKey] || process.env.META_PAGE_TOKEN;
}

function normalizeFieldData(field_data) {
  // Meta returns [{name:"email", values:["x@y.com"]}, ...] — flatten
  const out = {};
  for (const f of field_data || []) {
    const key = f.name?.toLowerCase().replace(/\s+/g, "_");
    if (!key) continue;
    out[key] = Array.isArray(f.values) ? (f.values.length === 1 ? f.values[0] : f.values) : f.values;
  }
  return out;
}

function scoreLead(lead) {
  const reasons = [];
  let score = 70;

  const fd = lead.normalized || {};
  const email = (fd.email || fd.email_address || "").toLowerCase().trim();
  const phone = (fd.phone_number || fd.phone || "").replace(/[^\d]/g, "");
  const fullName = (fd.full_name || `${fd.first_name || ""} ${fd.last_name || ""}`).trim();

  // Email checks
  if (email) {
    const m = email.match(/^[^@\s]+@([^@\s]+\.[^@\s]+)$/);
    if (!m) {
      score -= 60;
      reasons.push("malformed_email");
    } else if (DISPOSABLE_DOMAINS.has(m[1])) {
      score -= 50;
      reasons.push("disposable_email");
    }
  } else {
    score -= 30;
    reasons.push("no_email");
  }

  // Phone checks
  if (phone) {
    if (phone.length < 7 || phone.length > 15) {
      score -= 30;
      reasons.push("phone_length_invalid");
    }
    if (/^(\d)\1+$/.test(phone) || phone === "1234567890") {
      score -= 40;
      reasons.push("phone_obvious_repeat");
    }
  }

  // Name checks
  if (fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    const shortParts = parts.filter((p) => p.length < 2);
    if (shortParts.length) {
      score -= 30;
      reasons.push("name_too_short");
    }
    if (fullName === fullName.toLowerCase() && /^[a-z]+(\s[a-z]+)+$/.test(fullName)) {
      // all-lowercase with only ASCII letters → likely junk
      score -= 30;
      reasons.push("name_lowercase_junk");
    }
    // All-caps name
    if (fullName === fullName.toUpperCase() && /[A-Z]/.test(fullName)) {
      score -= 10;
      reasons.push("name_all_caps");
    }
  }

  // Organic vs paid
  if (lead.is_organic) {
    score += 10;
    reasons.push("organic_submission");
  }

  score = Math.max(0, Math.min(100, score));
  const tier = score >= QUALIFIED_FLOOR ? "qualified" : score >= REVIEW_FLOOR ? "review" : "junk";

  return { score, tier, reasons };
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeLeadsCsv(allLeads, outPath) {
  // Union of all field keys across all leads
  const baseCols = ["lead_id", "created_time", "form_id", "ad_id", "campaign_id", "platform", "is_organic", "score", "tier"];
  const fieldKeys = new Set();
  for (const l of allLeads) for (const k of Object.keys(l.normalized || {})) fieldKeys.add(k);
  const cols = [...baseCols, ...fieldKeys];

  const lines = [cols.map(csvEscape).join(",")];
  for (const l of allLeads) {
    const row = [
      l.id,
      l.created_time,
      l.form_id,
      l.ad_id,
      l.campaign_id,
      l.platform,
      l.is_organic ?? false,
      l.score,
      l.tier,
      ...[...fieldKeys].map((k) => l.normalized?.[k] ?? ""),
    ];
    lines.push(row.map(csvEscape).join(","));
  }
  writeFileSync(outPath, lines.join("\n"));
}

async function listForms(graph, pageId, token) {
  return graph.get(`/${pageId}/leadgen_forms`, {
    fields: "id,name,locale,status,leads_count,created_time",
    access_token: token,
    limit: 200,
  });
}

async function fetchLeads(graph, formId, token, since) {
  const params = {
    fields: "id,created_time,ad_id,adset_id,campaign_id,form_id,field_data,is_organic,platform",
    access_token: token,
    limit: 500,
  };
  if (since) params.since = since;
  return graph.paginate(`/${formId}/leads`, params, 5000);
}

function loadState(slug) {
  const p = P.clientFile(slug, "leads_state.json");
  if (!existsSync(p)) return { forms: {} };
  return JSON.parse(readFileSync(p, "utf8"));
}

function saveState(slug, state) {
  const p = P.clientFile(slug, "leads_state.json", { forWrite: true });
  writeFileSync(p, JSON.stringify(state, null, 2));
}

function appendLeadsJsonl(slug, formId, leads) {
  const dir = resolve(P.clientRoot(slug), "leads");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = resolve(dir, `${formId}.jsonl`);
  const seen = new Set();
  if (existsSync(p)) {
    for (const line of readFileSync(p, "utf8").split("\n").filter(Boolean)) {
      try { seen.add(JSON.parse(line).id); } catch {}
    }
  }
  const fresh = leads.filter((l) => !seen.has(l.id));
  for (const l of fresh) appendFileSync(p, JSON.stringify(l) + "\n");
  return fresh.length;
}

function readAllLeadsForCsv(slug) {
  const dir = resolve(P.clientRoot(slug), "leads");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    const lines = readFileSync(resolve(dir, file), "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try { out.push(JSON.parse(line)); } catch {}
    }
  }
  return out;
}

// ── Webhook-first ingestion (B4) ─────────────────────────────────────────────
// Real-time is the PRIMARY path: Meta POSTs a `leadgen` change the instant a lead
// is submitted; we fetch the full lead by id, score it, and append to the SAME
// per-form JSONL store the poller writes — so webhook + backfill converge and
// dedupe on lead id. `sync` is now the reconciliation/backfill path that catches
// anything a missed/duplicated webhook left behind.

/** Pure: pull every leadgen id out of a Meta page webhook payload. Testable. */
export function extractLeadgenIds(payload) {
  const out = [];
  if (!payload || !Array.isArray(payload.entry)) return out;
  for (const entry of payload.entry) {
    for (const change of entry.changes || []) {
      if (change.field !== "leadgen") continue;
      const v = change.value || {};
      const leadId = v.leadgen_id || v.lead_id;
      if (leadId) {
        out.push({
          lead_id: String(leadId),
          form_id: v.form_id != null ? String(v.form_id) : null,
          page_id: v.page_id != null ? String(v.page_id) : null,
          ad_id: v.ad_id != null ? String(v.ad_id) : null,
          created_time: v.created_time || null,
        });
      }
    }
  }
  return out;
}

async function fetchLeadById(graph, leadId, token) {
  return graph.get(`/${leadId}`, {
    fields: "id,created_time,ad_id,adset_id,campaign_id,form_id,field_data,is_organic,platform",
    access_token: token,
  });
}

/** Enrich a raw Meta lead the same way the poller does, so scores match exactly. */
export function enrichLead(raw) {
  const normalized = normalizeFieldData(raw.field_data);
  const { score, tier, reasons } = scoreLead({ ...raw, normalized });
  return { ...raw, normalized, score, tier, score_reasons: reasons };
}

async function ingestWebhook(graph, slug, payload, token) {
  const refs = extractLeadgenIds(payload);
  const state = loadState(slug);
  const byForm = {};
  const errors = [];
  for (const ref of refs) {
    try {
      const raw = await fetchLeadById(graph, ref.lead_id, token);
      const enriched = enrichLead(raw);
      const formId = enriched.form_id || ref.form_id || "unknown_form";
      (byForm[formId] ||= []).push(enriched);
    } catch (e) {
      errors.push({ lead_id: ref.lead_id, error: e.message });
    }
  }
  let newCount = 0;
  for (const [formId, leads] of Object.entries(byForm)) {
    const fresh = appendLeadsJsonl(slug, formId, leads); // dedupes on lead id
    newCount += fresh;
    state.forms[formId] = {
      last_webhook: new Date().toISOString(),
      total_pulled: (state.forms[formId]?.total_pulled || 0) + fresh,
    };
  }
  saveState(slug, state);
  return { received: refs.length, new: newCount, forms: Object.keys(byForm), errors };
}

async function syncForm(graph, slug, form, token, sinceOverride) {
  const state = loadState(slug);
  const since = sinceOverride || state.forms[form.id]?.last_synced || new Date(Date.now() - 7 * 86400_000).toISOString();
  console.error(`[leads] ${form.id} (${form.name}) — fetching since ${since}…`);

  const raw = await fetchLeads(graph, form.id, token, since);
  const enriched = raw.map((l) => {
    const normalized = normalizeFieldData(l.field_data);
    const { score, tier, reasons } = scoreLead({ ...l, normalized });
    return { ...l, normalized, score, tier, score_reasons: reasons };
  });

  const newCount = appendLeadsJsonl(slug, form.id, enriched);
  state.forms[form.id] = { last_synced: new Date().toISOString(), total_pulled: (state.forms[form.id]?.total_pulled || 0) + newCount };
  saveState(slug, state);

  return { form_id: form.id, form_name: form.name, fetched: raw.length, new: newCount, enriched };
}

async function main() {
  const [slug, mode, ...rest] = process.argv.slice(2);
  if (!slug || !mode) {
    console.error("Usage: node skills/leads/leads.js <slug> <webhook|sync|list|pull> [args]");
    process.exit(1);
  }

  const profilePath = P.clientFile(slug, "client_profile.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const pageId = profile.accounts?.facebook_page_id;
  if (isTbd(pageId)) {
    console.error("accounts.facebook_page_id is TBD");
    process.exit(3);
  }

  const token = pageTokenFor(slug);
  if (!token) {
    console.error(`No page access token — set META_PAGE_TOKEN_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")} or META_PAGE_TOKEN`);
    process.exit(4);
  }

  const graph = createGraph();

  if (mode === "list") {
    const res = await listForms(graph, pageId, token);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  // Webhook-first (B4): ingest a Meta leadgen webhook payload (the PRIMARY path).
  //   node skills/leads/leads.js <slug> webhook --payload <file>
  //   cat payload.json | node skills/leads/leads.js <slug> webhook
  if (mode === "webhook") {
    const pIdx = rest.indexOf("--payload");
    let payloadStr;
    if (pIdx >= 0 && rest[pIdx + 1]) {
      payloadStr = readFileSync(rest[pIdx + 1], "utf8");
    } else {
      payloadStr = readFileSync(0, "utf8"); // stdin
    }
    let payload;
    try { payload = JSON.parse(payloadStr); }
    catch { console.error("[leads] webhook payload is not valid JSON"); process.exit(5); }

    const res = await ingestWebhook(graph, slug, payload, token);
    // Keep the flat CSV in sync, exactly like the poller does.
    const allLeads = readAllLeadsForCsv(slug);
    const csvPath = P.clientFile(slug, "leads_export.csv", { forWrite: true });
    writeLeadsCsv(allLeads, csvPath);
    console.error(`[leads] webhook ingested ${res.new} new lead(s); ${allLeads.length} total`);
    console.log(JSON.stringify({ slug, mode, ...res, total_stored: allLeads.length, csv: csvPath }, null, 2));
    return;
  }

  if (mode === "sync" || mode === "pull") {
    const forms = mode === "pull"
      ? [{ id: rest[0], name: `forced:${rest[0]}` }]
      : (await listForms(graph, pageId, token)).data?.filter((f) => f.status === "ACTIVE") || [];

    if (!forms.length) {
      console.log(JSON.stringify({ slug, mode, note: "no active forms" }));
      return;
    }

    const sinceIdx = rest.indexOf("--since");
    const sinceOverride = sinceIdx >= 0 ? rest[sinceIdx + 1] : null;

    const results = [];
    for (const f of forms) {
      try {
        results.push(await syncForm(graph, slug, f, token, sinceOverride));
      } catch (e) {
        results.push({ form_id: f.id, error: e.message });
      }
    }

    // Rebuild flat CSV from all stored leads
    const allLeads = readAllLeadsForCsv(slug);
    const csvPath = P.clientFile(slug, "leads_export.csv", { forWrite: true });
    writeLeadsCsv(allLeads, csvPath);

    const tiers = allLeads.reduce((m, l) => ({ ...m, [l.tier]: (m[l.tier] || 0) + 1 }), {});
    console.error(`[leads] wrote ${csvPath} (${allLeads.length} total leads)`);
    console.log(JSON.stringify({
      slug,
      mode,
      forms_processed: results.length,
      new_leads: results.reduce((s, r) => s + (r.new || 0), 0),
      total_stored: allLeads.length,
      tier_counts: tiers,
      csv: csvPath,
      results: results.map((r) => ({ form_id: r.form_id, form_name: r.form_name, fetched: r.fetched, new: r.new, error: r.error })),
    }, null, 2));
    return;
  }

  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}

// Only run as a CLI — guard so importing the pure helpers doesn't trigger main().
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("[leads] FATAL:", e.message);
    process.exit(1);
  });
}
