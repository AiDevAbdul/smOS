// scripts/lib/billing-store.js — per-client invoice ledger (Phase 5).
//
// One ledger file per client: billing/<slug>/ledger.json (array of invoices,
// schemas/invoice.js shape). /billing writes it; /portal reads it for the client's
// invoice view. Best-effort Supabase `invoices` mirror, like crm-store.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { invoice as invoiceSchema, subscription as subSchema } from "../../schemas/index.js";
import { upsert, supabaseConfigured } from "./supabase.js";
import { billingLedger, billingSubscription } from "./paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

function ledgerPath(slug) { return billingLedger(slug); }

export function listInvoices(slug) {
  const p = ledgerPath(slug);
  if (!existsSync(p)) return [];
  try { return JSON.parse(readFileSync(p, "utf8")).map(invoiceSchema.normalize); } catch { return []; }
}

export function getInvoice(slug, period) {
  return listInvoices(slug).find((i) => i.period === period) || null;
}

async function mirror(slug, inv) {
  if (!supabaseConfigured()) return;
  try {
    await upsert("invoices", {
      id: inv.id, slug, company: inv.company, period: inv.period,
      currency: inv.currency, total: inv.total, status: inv.status,
      issued_at: inv.issued_at, due_date: inv.due_date,
      stripe_invoice_id: inv.stripe?.invoice_id || null,
    }, "id");
  } catch { /* best-effort */ }
}

/** Insert or update an invoice (by id) in the client's ledger, validated. */
export async function saveInvoice(slug, raw) {
  const inv = invoiceSchema.normalize({ ...raw, slug });
  const v = invoiceSchema.validate(inv);
  if (!v.ok) throw new Error(`invoice invalid:\n  - ${v.errors.join("\n  - ")}`);
  const all = listInvoices(slug);
  const idx = all.findIndex((i) => i.id === inv.id);
  if (idx >= 0) all[idx] = inv; else all.push(inv);
  const p = ledgerPath(slug);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(all.map(invoiceSchema.normalize), null, 2));
  await mirror(slug, inv);
  return inv;
}

// ─────────────────────── subscriptions (Group D1) ───────────────────────
// One file per client: billing/<slug>/subscription.json. The ledger above is the
// invoice history; this is the current recurring arrangement the cron reads.

export function getSubscription(slug) {
  const p = billingSubscription(slug);
  if (!existsSync(p)) return null;
  try { return subSchema.normalize(JSON.parse(readFileSync(p, "utf8"))); } catch { return null; }
}

async function mirrorSub(slug, sub) {
  if (!supabaseConfigured()) return;
  try {
    await upsert("subscriptions", {
      slug, company: sub.company, amount: sub.amount, currency: sub.currency,
      interval: sub.interval, status: sub.status, collection_mode: sub.collection_mode,
      start_period: sub.start_period, end_period: sub.end_period,
      stripe_subscription_id: sub.stripe?.subscription_id || null,
      updated_at: sub.updated_at,
    }, "slug");
  } catch { /* best-effort, like the invoice mirror */ }
}

/** Create or replace the client's subscription record, validated fail-closed. */
export async function saveSubscription(slug, raw) {
  const sub = subSchema.normalize({ ...raw, slug });
  const v = subSchema.validate(sub);
  if (!v.ok) throw new Error(`subscription invalid:\n  - ${v.errors.join("\n  - ")}`);
  const p = billingSubscription(slug);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(sub, null, 2));
  await mirrorSub(slug, sub);
  return sub;
}

export { ROOT };
