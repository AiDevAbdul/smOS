#!/usr/bin/env node
/**
 * /portal companion — white-label client dashboard (Phase 2.5 → upgraded in Phase 5).
 *
 * Blends paid + organic performance with the Phase 5 commercial layer: the client's
 * plan, their invoice ledger (issued/paid/outstanding), and no-login approvals for
 * pending content (mailto-based, so it works from a static, self-contained file).
 * Offline-safe: every section degrades to a "no data yet" line.
 *
 * Usage: node skills/portal/portal.js <slug>
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { mdToHtml } from "../../scripts/lib/md_to_html.js";
import { getDeal } from "../../scripts/lib/crm-store.js";
import { listInvoices } from "../../scripts/lib/billing-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv({ silent: true });

const slug = process.argv[2];
if (!slug) { console.error("usage: portal.js <slug>"); process.exit(2); }
const dir = resolve(ROOT, "clients", slug);
const profilePath = resolve(dir, "client_profile.json");
if (!existsSync(profilePath)) { console.error(`HALT: ${profilePath} not found.`); process.exit(3); }
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const clientName = profile?.business?.name || profile?.name || slug;

function readJson(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
function readClientJson(name) { return readJson(resolve(dir, name)); }

const catalog = readJson(resolve(ROOT, "config", "services.json")) || { agency: {} };
let agencyEmail = catalog.agency?.email;
if (!agencyEmail) {
  agencyEmail = "hello@agency.co";
  console.error(
    "WARN: config/services.json agency.email is unset — falling back to the placeholder " +
    `"${agencyEmail}". Approval mailto links will point at the wrong inbox. ` +
    "Set agency.email before shipping this portal to a client."
  );
}
// Approval cap is a tunable business policy, not an invariant — config-driven.
const approvalCap = Number(catalog.portal?.approval_cap) > 0 ? Number(catalog.portal.approval_cap) : 8;

const perf = readClientJson("performance_analysis.json");
const inbox = readClientJson("inbox.json");
const content = readClientJson("content_plan.json");
const listening = readClientJson("listening_snapshot.json");
const deal = getDeal(slug);
const invoices = listInvoices(slug);

const fmt = (n) => Number(n || 0).toLocaleString();
const s = [`# ${clientName}`, `_Your account dashboard · updated ${new Date().toISOString().slice(0, 10)}_`, ""];

// ── Your Plan (commercial) ──
s.push("## Your Plan");
if (deal && deal.deal?.monthly_retainer) {
  s.push(`- **${deal.deal.currency} ${fmt(deal.deal.monthly_retainer)}/month** management retainer`);
  if (deal.links?.contract) s.push(`- Agreement: on file`);
} else s.push("_Plan details will appear once your agreement is active._");

// ── Billing (commercial) ──
s.push("", "## Billing");
if (invoices.length) {
  s.push(`| Invoice | Period | Amount | Status |`, `|---|---|--:|---|`);
  for (const i of invoices) {
    const status = i.stripe?.hosted_url && i.status !== "paid" ? `[Pay now](${i.stripe.hosted_url})` : i.status;
    s.push(`| ${i.id} | ${i.period} | ${i.currency} ${fmt(i.total)} | ${status} |`);
  }
  // Outstanding is summed PER CURRENCY — never add across currencies, which would
  // produce a meaningless figure. Almost always one currency; mixed ledgers degrade
  // to one balance line each rather than a wrong total.
  const byCurrency = {};
  for (const i of invoices) {
    const c = i.currency;
    byCurrency[c] = byCurrency[c] || { issued: 0, paid: 0 };
    byCurrency[c].issued += i.total;
    if (i.status === "paid") byCurrency[c].paid += i.total;
  }
  const lines = Object.entries(byCurrency)
    .map(([c, v]) => `${c} ${fmt(v.issued - v.paid)}`)
    .join(" · ");
  s.push("", `**Outstanding: ${lines}**`);
} else s.push("_No invoices issued yet._");

// ── Approvals (no-login, mailto) ──
s.push("", "## Awaiting Your Approval");
const pending = (content?.items || []).filter((i) => i.status === "pending").slice(0, approvalCap);
if (pending.length) {
  s.push("Review each planned post and approve or request changes — no login needed.", "");
  for (const it of pending) {
    const label = `${String(it.publish_at).slice(0, 10)} · ${it.platform}/${it.format}`;
    const subj = (verb) => encodeURIComponent(`[${verb}] ${clientName} post ${it.id}`);
    const body = encodeURIComponent(`Post: ${label}\nCaption: ${(it.message || "").slice(0, 140)}\n\nDecision: `);
    const approve = `mailto:${agencyEmail}?subject=${subj("APPROVE")}&body=${body}`;
    const changes = `mailto:${agencyEmail}?subject=${subj("CHANGES")}&body=${body}`;
    s.push(`- **${label}** — ${(it.message || "").slice(0, 80)}  ·  [Approve](${approve}) · [Request changes](${changes})`);
  }
} else s.push("_Nothing needs your approval right now._");

// ── Paid Performance ──
s.push("", "## Paid Performance");
if (perf?.summary) {
  const p = perf.summary;
  s.push(`| Spend | Conversions | CPA | ROAS | CTR |`, `|--:|--:|--:|--:|--:|`,
    `| $${fmt(p.spend)} | ${p.conversions ?? "—"} | ${p.cpa ?? "—"} | ${p.roas ?? "—"} | ${p.ctr ?? "—"}% |`);
} else s.push("_Performance data will appear once campaigns are live._");

// ── Organic ──
s.push("", "## Community");
if (inbox?.items?.length) {
  const breaches = inbox.items.filter((i) => i.first_reply_due_at && Date.parse(i.first_reply_due_at) < Date.now() && i.state !== "replied").length;
  s.push(`- **${inbox.items.length}** interactions handled`, `- **${breaches}** awaiting reply`);
} else s.push("_No community activity captured yet._");

s.push("", "## Content Calendar");
if (content?.items?.length) {
  s.push(`- **${content.pillars?.length || 0}** content pillars · **${content.items.length}** posts planned`);
} else s.push("_Your content calendar will appear here._");

s.push("", "## Market Listening");
if (listening?.competitors?.length || listening?.mentions?.length) {
  s.push(`- Tracking **${listening.competitors?.length || 0}** competitors · **${listening.mentions?.length || 0}** mentions`);
} else s.push("_Listening insights will appear here._");

const html = mdToHtml(s.join("\n"), { title: `${clientName} — Portal`, subtitle: "Client Dashboard" });
const out = resolve(dir, "portal.html");
writeFileSync(out, html);
console.log(JSON.stringify({
  portal: out, client: clientName,
  sections: { plan: !!deal, billing: invoices.length, approvals: pending.length, paid: !!perf, organic: !!inbox, content: !!content, listening: !!listening },
}, null, 2));
