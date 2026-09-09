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
 * Group D1 adds the recurring half. Before it, "recurring retainer" was a number on
 * the deal plus a human remembering to run `invoice` every month; now a client has an
 * explicit subscription record (schemas/subscription.js) that states what they pay,
 * from which period, and whether Stripe is collecting it — and `scripts/billing-cron.js`
 * issues each period automatically off that record.
 *
 * Usage:
 *   node skills/billing/billing.js <slug> invoice [--period 2026-06] [--ad-spend 500] [--no-setup] [--send] [--force]
 *   node skills/billing/billing.js <slug> list
 *   node skills/billing/billing.js <slug> mark-paid --period 2026-06
 *   node skills/billing/billing.js <slug> subscribe [--amount 3000] [--interval month|year]
 *                                                   [--start 2026-09] [--end 2027-08] [--stripe]
 *   node skills/billing/billing.js <slug> subscription
 *   node skills/billing/billing.js <slug> unsubscribe [--reason "..."]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { heroHeader } from "../../scripts/lib/design_system.js";
import { docShell, writeDocHtmlAndPdf, escHtml } from "../../scripts/lib/client_doc.js";
import { getDeal, upsertDeal } from "../../scripts/lib/crm-store.js";
import { listInvoices, getInvoice, saveInvoice, getSubscription, saveSubscription } from "../../scripts/lib/billing-store.js";
import { stripeConfigured, stripePost, ensureCustomer, createSubscription, cancelSubscription, idempotencyKey, toCents } from "../../scripts/lib/stripe.js";
import { subscription as subSchema } from "../../schemas/index.js";
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

/* ─────────────────────────── HTML (primary) ──────────────────────────── */

const STATUS_BADGE = { draft: "ds-badge--neutral", sent: "ds-badge--info", paid: "ds-badge--good", overdue: "ds-badge--bad" };

/** Invoice-specific components, all on --ds-* tokens (no raw hex). */
function invoiceCss() {
  return `
.inv-parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.inv-party__lbl{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ds-muted);margin-bottom:6px;}
.inv-party__name{font-size:15px;font-weight:700;}
.inv-party__meta{font-size:13px;color:var(--ds-muted);margin-top:2px;}
.inv-table td.amt,.inv-table th.amt{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
.inv-table tfoot td{border-top:2px solid var(--ds-line-strong);font-weight:800;font-size:15px;}
.inv-table tfoot td.amt{color:var(--ds-ink);}
.inv-pay{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  background:var(--ds-surface);border:1px solid var(--ds-line);border-radius:var(--ds-r);padding:18px 22px;box-shadow:var(--ds-shadow-sm);}
.inv-pay__terms{font-size:13px;color:var(--ds-muted);max-width:520px;}
@media (max-width:640px){.inv-parties{grid-template-columns:1fr;}}
`;
}

export function buildInvoiceHtml(inv, agency, { paymentTerms = "" } = {}) {
  const money = (n) => `${inv.currency} ${Number(n).toLocaleString()}`;
  const badgeClass = STATUS_BADGE[inv.status] || "ds-badge--neutral";

  const hero = heroHeader({
    title: `Invoice ${inv.id}`,
    eyebrow: `Invoice · ${agency.name}`,
    subtitleHtml: `Period <strong>${escHtml(inv.period)}</strong> &nbsp;·&nbsp; Issued ${escHtml(inv.issued_at.slice(0, 10))} &nbsp;·&nbsp; Due ${escHtml(inv.due_date.slice(0, 10))}`,
    pills: [`Total · ${money(inv.total)}`, `Status · ${inv.status}`],
  });

  const parties = `<div class="inv-parties">
<div class="ds-card"><div class="inv-party__lbl">From</div><div class="inv-party__name">${escHtml(agency.name)}</div><div class="inv-party__meta">${escHtml(agency.email)}</div></div>
<div class="ds-card"><div class="inv-party__lbl">Billed to</div><div class="inv-party__name">${escHtml(inv.company)}</div><div class="inv-party__meta">Billing period ${escHtml(inv.period)}</div></div>
</div>`;

  const rows = inv.line_items.map((l) => `<tr><td>${escHtml(l.description)}</td><td class="amt">${money(l.amount)}</td></tr>`).join("");
  const table = `<div class="ds-table-wrap"><table class="ds-table inv-table">
<thead><tr><th>Description</th><th class="amt">Amount</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td>Total due</td><td class="amt">${money(inv.total)}</td></tr></tfoot>
</table></div>`;

  const payBtn = inv.stripe?.hosted_url ? `<a class="ds-btn" href="${escHtml(inv.stripe.hosted_url)}">Pay online →</a>` : `<span class="ds-badge ${badgeClass}">${escHtml(inv.status)}</span>`;
  const pay = `<div class="inv-pay"><div class="inv-pay__terms">${escHtml(paymentTerms || "Payment due within 7 days of the issue date.")}</div>${payBtn}</div>`;

  const body = [
    hero,
    `<div class="ds-section">${parties}</div>`,
    `<div class="ds-section">${table}</div>`,
    `<div class="ds-section">${pay}</div>`,
  ].join("\n");

  return docShell({ title: `Invoice ${inv.id}`, extraCss: invoiceCss(), body, date: inv.issued_at.slice(0, 10) });
}

// Stripe send (best-effort, fail-closed). Every mutating call now carries a
// deterministic Idempotency-Key scoped to the invoice id (see scripts/lib/stripe.js),
// so a retried run — cron double-fire, crash between Stripe and the ledger write, an
// operator re-running `--send` — replays instead of billing the client twice. Any
// non-2xx / throw returns a manual result rather than a false success.
export async function stripeSend(inv, deal, opts = {}) {
  if (!stripeConfigured()) return { sent: false, mode: "manual", reason: "No STRIPE_API_KEY — invoice generated locally; send/collect manually." };
  if (!deal.contact.email) return { sent: false, mode: "manual", reason: "No client email on the deal — set it before a Stripe send." };
  try {
    const cust = await ensureCustomer({ slug: inv.slug, email: deal.contact.email, name: inv.company }, opts);
    // Line index is part of the key: two lines with the same description and amount
    // are legitimately two charges, so they must not collapse into one.
    for (const [i, l] of inv.line_items.entries()) {
      await stripePost("invoiceitems", {
        customer: cust.id, amount: String(toCents(l.amount)),
        currency: inv.currency.toLowerCase(), description: l.description,
      }, { ...opts, idempotency: idempotencyKey(inv.id, `item-${i}`) });
    }
    const si = await stripePost("invoices", {
      customer: cust.id, collection_method: "send_invoice", days_until_due: "7", auto_advance: "true",
      "metadata[smos_slug]": inv.slug, "metadata[smos_invoice_id]": inv.id, "metadata[smos_period]": inv.period,
    }, { ...opts, idempotency: idempotencyKey(inv.id, "invoice") });
    const final = await stripePost(`invoices/${si.id}/finalize`, {}, { ...opts, idempotency: idempotencyKey(inv.id, "finalize") });
    return { sent: true, mode: "stripe", customer_id: cust.id, invoice_id: si.id, hosted_url: final.hosted_invoice_url || null };
  } catch (e) {
    return { sent: false, mode: "manual", reason: `Stripe send failed (${e.message}) — invoice generated locally.` };
  }
}

async function main() {
  const [slug, cmd, ...rest] = process.argv.slice(2);
  if (!slug || !cmd) { console.error("Usage: billing.js <slug> <invoice|list|mark-paid|subscribe|subscription|unsubscribe> [flags]"); process.exit(1); }
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

  if (cmd === "subscription") {
    const sub = getSubscription(slug);
    if (!sub) { console.error(`No subscription for "${slug}". Create one with: /billing ${slug} subscribe`); process.exit(6); }
    console.log(JSON.stringify({ slug, subscription: sub, mrr: subSchema.mrr(sub), annual: subSchema.annualValue(sub) }, null, 2));
    return;
  }

  if (cmd === "subscribe") {
    if (deal.stage !== "won" && !flag("force")) {
      console.error(`Deal "${slug}" is "${deal.stage}", not won. Sign the contract first, or --force.`); process.exit(4);
    }
    const existing = getSubscription(slug);
    if (existing && existing.status !== "canceled" && !flag("force")) {
      console.error(`"${slug}" already has a ${existing.status} subscription (${existing.currency} ${existing.amount}/${existing.interval}). Use --force to replace it.`);
      process.exit(7);
    }
    const amount = Number(flag("amount")) || deal.deal.monthly_retainer;
    if (!(amount > 0)) {
      console.error(`No retainer amount: the deal has monthly_retainer=0 and no --amount was given. Halting rather than guessing.`);
      process.exit(8);
    }
    const interval = String(flag("interval") || "month");
    // Default the first billed period to now, not to the engagement start: back-dating
    // would make the cron issue invoices for months already settled by hand.
    const startPeriod = String(flag("start") || currentPeriod());
    const endPeriod = flag("end") ? String(flag("end")) : null;
    const at = nowIso();

    let stripeInfo = null;
    let collectionMode = "invoice_manual";
    let stripeNote = "Not attempted — add --stripe to have Stripe own the recurring charge.";
    if (flag("stripe")) {
      if (!stripeConfigured()) {
        stripeNote = "No STRIPE_API_KEY — recorded as invoice_manual; smOS will issue each period locally.";
      } else if (!deal.contact.email) {
        stripeNote = "No client email on the deal — recorded as invoice_manual; set the email and re-run with --stripe.";
      } else {
        try {
          stripeInfo = await createSubscription({
            slug, email: deal.contact.email, company: deal.company_name,
            amount, currency: deal.deal.currency || "USD", interval,
          });
          collectionMode = "stripe_subscription";
          stripeNote = `Stripe subscription ${stripeInfo.subscription_id} created.`;
        } catch (e) {
          // Fail closed to manual rather than recording a Stripe mode with no id —
          // the schema would reject that anyway.
          stripeNote = `Stripe subscription failed (${e.message}) — recorded as invoice_manual.`;
        }
      }
    }

    const sub = await saveSubscription(slug, {
      slug, company: deal.company_name, amount, currency: deal.deal.currency || "USD",
      interval, status: "active", collection_mode: collectionMode,
      start_period: startPeriod, end_period: endPeriod,
      created_at: existing?.created_at || at, updated_at: at, stripe: stripeInfo,
    });
    await upsertDeal(slug, { activities: [...(deal.activities || []), { at, type: "note", note: `subscription active — ${sub.currency} ${sub.amount}/${sub.interval} from ${sub.start_period} (${sub.collection_mode})` }] });

    console.log(JSON.stringify({
      slug, subscription: sub, mrr: subSchema.mrr(sub), annual: subSchema.annualValue(sub),
      stripe: stripeNote,
      next: collectionMode === "stripe_subscription"
        ? "Stripe issues each period; run `/billing <slug> reconcile` to pull payment status into the ledger."
        : `smOS issues each period — the monthly cron (scripts/billing-cron.js) will do it, or run: /billing ${slug} invoice`,
    }, null, 2));
    return;
  }

  if (cmd === "unsubscribe") {
    const sub = getSubscription(slug);
    if (!sub) { console.error(`No subscription for "${slug}".`); process.exit(6); }
    if (sub.status === "canceled") { console.log(JSON.stringify({ slug, status: "canceled", note: "Already canceled." }, null, 2)); return; }
    const at = nowIso();
    let stripeNote = "No Stripe subscription to cancel.";
    if (sub.stripe?.subscription_id && stripeConfigured()) {
      try {
        await cancelSubscription(sub.stripe.subscription_id);
        stripeNote = `Stripe subscription ${sub.stripe.subscription_id} set to cancel at period end.`;
      } catch (e) {
        // Say so loudly: a local cancel with a live Stripe subscription still bills.
        stripeNote = `WARNING — Stripe cancel FAILED (${e.message}). The Stripe subscription may still bill; cancel it in the Stripe dashboard.`;
      }
    } else if (sub.stripe?.subscription_id) {
      stripeNote = `WARNING — subscription ${sub.stripe.subscription_id} exists in Stripe but STRIPE_API_KEY is not set; it was NOT canceled there.`;
    }
    const saved = await saveSubscription(slug, { ...sub, status: "canceled", canceled_at: at, updated_at: at });
    const reason = flag("reason");
    await upsertDeal(slug, { activities: [...(deal.activities || []), { at, type: "note", note: `subscription canceled${reason && reason !== true ? ` — ${reason}` : ""}` }] });
    console.log(JSON.stringify({ slug, subscription: saved, stripe: stripeNote }, null, 2));
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
    // Primary deliverable: structured invoice HTML on the design system (+ PDF).
    const html = buildInvoiceHtml(saved, catalog.agency, { paymentTerms: catalog.terms?.payment });
    const htmlPath = resolve(outDir, `invoice-${period}.html`);
    const { pdfPath, pdfOk } = writeDocHtmlAndPdf(htmlPath, html);

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

  console.error(`Unknown command "${cmd}". Use invoice | list | mark-paid | subscribe | subscription | unsubscribe.`);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("[billing] FATAL:", e.message); process.exit(1); });
}
