// scripts/lib/billing-store.js — per-client invoice ledger (Phase 5).
//
// One ledger file per client: billing/<slug>/ledger.json (array of invoices,
// schemas/invoice.js shape). /billing writes it; /portal reads it for the client's
// invoice view. Best-effort Supabase `invoices` mirror, like crm-store.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { invoice as invoiceSchema } from "../../schemas/index.js";
import { upsert, supabaseConfigured } from "./supabase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

function ledgerPath(slug) { return resolve(ROOT, "billing", slug, "ledger.json"); }

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

export { ROOT };
