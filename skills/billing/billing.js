#!/usr/bin/env node
/**
 * /billing companion (Phase 5) — issues retainer invoices for a won/active client.
 *
 * Deterministic, testable parts: invoice modeling (retainer + first-month setup +
 * optional ad-spend pass-through), per-period idempotency, the ledger, and the CRM
 * activity log. The live Stripe send is best-effort and fail-closed: with STRIPE_API_KEY
 * it creates a customer + invoice items + invoice and finalizes; without it (or on any
 * error) it produces the local invoice and marks it manual — never charges silently,
 * never claims a send it didn't make.
 *
 * Usage:
 *   node skills/billing/billing.js <slug> invoice [--period 2026-06] [--ad-spend 500] [--no-setup] [--send] [--force]
 *   node skills/billing/billing.js <slug> list
 *   node skills/billing/billing.js <slug> mark-paid --period 2026-06
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { writeHtmlAndPdf } from "../../scripts/lib/md_to_html.js";
import { getDeal, upsertDeal } from "../../scripts/lib/crm-store.js";
import { listInvoices, getInvoice, saveInvoice } from "../../scripts/lib/billing-store.js";
import { loadCatalog, pickPackage } from "../proposal/proposal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const nowIso = () => new Date().toISOString();
function currentPeriod() { return nowIso().slice(0, 7); } // YYYY-MM
function addDays(iso, days) { const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString(); }

/**
 * Build a retainer invoice for a period. Pure — no I/O — so it's fully testable.
 * First invoice (no prior invoices) includes the one-time setup fee unless skipped.
 */
export function buildInvoice({ slug, deal, pkg, period, includeSetup, adSpend = 0, issuedAt }) {
  const currency = deal.deal.currency || pkg.currency || "USD";
  const retainer = deal.deal.monthly_retainer > 0 ? deal.deal.monthly_retainer : pkg.monthly_retainer;
  const lines = [{ description: `${pkg.name} management retainer — ${period}`, amount: retainer }];
  if (includeSetup && pkg.setup_fee > 0) lines.push({ description: "One-time setup fee", amount: pkg.setup_fee });
  if (adSpend > 0) lines.push({ description: `Ad spend pass-through — ${period}`, amount: adSpend });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return {
    id: `INV-${slug}-${period}`,
    slug, company: deal.company_name, period, currency,
    line_items: lines, subtotal: total, total,
    status: "draft", issued_at: issuedAt, due_date: addDays(issuedAt, 7),
    stripe: null,
  };
}

function invoiceMarkdown(inv, agency) {
  let md = `# Invoice ${inv.id}\n\n`;
  md += `**${agency.name}** · ${agency.email}\n\n`;
  md += `Billed to: **${inv.company}** · Period ${inv.period}\n\n`;
  md += `Issued ${inv.issued_at.slice(0, 10)} · Due ${inv.due_date.slice(0, 10)}\n\n---\n\n`;
  md += `| Description | Amount |\n|---|---:|\n`;
  for (const l of inv.line_items) md += `| ${l.description} | ${inv.currency} ${l.amount.toLocaleString()} |\n`;
  md += `| **Total** | **${inv.currency} ${inv.total.toLocaleString()}** |\n\n`;
  if (inv.stripe?.hosted_url) md += `[Pay online](${inv.stripe.hosted_url})\n`;
  return md;
}

// Stripe (best-effort). form-encoded; cents at the boundary. Unverified against live —
// any non-2xx / throw returns a manual result rather than a false success.
async function stripeSend(inv, deal) {
  const key = process.env.STRIPE_API_KEY;
  if (!key) return { sent: false, mode: "manual", reason: "No STRIPE_API_KEY — invoice generated locally; send/collect manually." };
  if (!deal.contact.email) return { sent: false, mode: "manual", reason: "No client email on the deal — set it before a Stripe send." };
  const auth = { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" };
  const post = async (path, params) => {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, { method: "POST", headers: auth, body: new URLSearchParams(params) });
    if (!res.ok) throw new Error(`Stripe ${path} ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return res.json();
  };
  try {
    const cust = await post("customers", { email: deal.contact.email, name: inv.company });
    for (const l of inv.line_items) {
      await post("invoiceitems", { customer: cust.id, amount: String(Math.round(l.amount * 100)), currency: inv.currency.toLowerCase(), description: l.description });
    }
    const si = await post("invoices", { customer: cust.id, collection_method: "send_invoice", days_until_due: "7", auto_advance: "true" });
    const final = await post(`invoices/${si.id}/finalize`, {});
    return { sent: true, mode: "stripe", customer_id: cust.id, invoice_id: si.id, hosted_url: final.hosted_invoice_url || null };
  } catch (e) {
    return { sent: false, mode: "manual", reason: `Stripe send failed (${e.message}) — invoice generated locally.` };
  }
}

async function main() {
  const [slug, cmd, ...rest] = process.argv.slice(2);
  if (!slug || !cmd) { console.error("Usage: billing.js <slug> <invoice|list|mark-paid> [flags]"); process.exit(1); }
  const flag = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? (rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[i + 1] : true) : undefined; };

  const deal = getDeal(slug);
  if (!deal) { console.error(`No CRM deal for "${slug}". A client must be won before billing.`); process.exit(2); }

  if (cmd === "list") {
    const invs = listInvoices(slug);
    const issued = invs.reduce((s, i) => s + i.total, 0);
    const paid = invs.filter((i) => i.status === "paid").reduce((s, i) => s + i.total, 0);
    console.log(JSON.stringify({ slug, count: invs.length, issued, paid, outstanding: issued - paid, invoices: invs.map((i) => ({ id: i.id, period: i.period, total: i.total, status: i.status })) }, null, 2));
    return;
  }

  if (cmd === "mark-paid") {
    const period = flag("period") || currentPeriod();
    const inv = getInvoice(slug, period);
    if (!inv) { console.error(`No invoice for ${slug} ${period}.`); process.exit(3); }
    inv.status = "paid";
    await saveInvoice(slug, inv);
    console.log(JSON.stringify({ slug, period, status: "paid", total: inv.total }, null, 2));
    return;
  }

  if (cmd === "invoice") {
    if (deal.stage !== "won" && !flag("force")) {
      console.error(`Deal "${slug}" is "${deal.stage}", not won. Sign the contract first, or --force.`); process.exit(4);
    }
    const period = flag("period") || currentPeriod();
    const prior = listInvoices(slug);
    if (prior.some((i) => i.period === period) && !flag("force")) {
      console.error(`Invoice for ${slug} ${period} already exists (${`INV-${slug}-${period}`}). Use --force to reissue.`); process.exit(5);
    }
    const catalog = loadCatalog();
    const pkg = pickPackage(catalog, { retainer: deal.deal.monthly_retainer });
    const includeSetup = flag("no-setup") ? false : prior.length === 0;
    const adSpend = Number(flag("ad-spend")) || 0;
    const issuedAt = nowIso();

    let inv = buildInvoice({ slug, deal, pkg, period, includeSetup, adSpend, issuedAt });

    let esign;
    if (flag("send")) {
      const r = await stripeSend(inv, deal);
      if (r.sent) { inv.status = "sent"; inv.stripe = { customer_id: r.customer_id, invoice_id: r.invoice_id, hosted_url: r.hosted_url }; }
      esign = r;
    }

    const saved = await saveInvoice(slug, inv);

    const outDir = resolve(ROOT, "billing", slug);
    mkdirSync(outDir, { recursive: true });
    const mdPath = resolve(outDir, `invoice-${period}.md`);
    const md = invoiceMarkdown(saved, catalog.agency);
    writeFileSync(mdPath, md);
    const { htmlPath, pdfPath, pdfOk } = writeHtmlAndPdf(mdPath, md, { title: `Invoice ${saved.id}` });

    await upsertDeal(slug, { activities: [...(deal.activities || []), { at: issuedAt, type: "note", note: `invoice ${saved.id} issued (${saved.currency} ${saved.total})` }] });

    console.log(JSON.stringify({
      slug, invoice: saved.id, period, total: `${saved.currency} ${saved.total}`,
      setup_included: includeSetup, status: saved.status,
      html: htmlPath, pdf: pdfOk ? pdfPath : "(PDF skipped — install playwright)",
      stripe: flag("send") ? esign : "(not sent — add --send)",
      next: saved.status === "sent" ? `On payment: /billing ${slug} mark-paid --period ${period}` : "Send manually or re-run with --send",
    }, null, 2));
    return;
  }

  console.error(`Unknown command "${cmd}". Use invoice | list | mark-paid.`);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("[billing] FATAL:", e.message); process.exit(1); });
}
