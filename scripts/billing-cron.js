#!/usr/bin/env node
/**
 * billing-cron.js — the monthly auto-issue run (Group D1).
 *
 * Before this, a "recurring retainer" depended on a human remembering to run
 * `/billing <slug> invoice` twelve times a year. This iterates every client with an
 * active subscription record and issues the current period's invoice for the ones
 * smOS is responsible for collecting.
 *
 * Three deliberate safety properties, because this spends and bills on its own:
 *
 * 1. IDEMPOTENT per (client, period). `/billing invoice` already refuses to reissue a
 *    period that exists in the ledger; this runner checks first and reports `skipped`
 *    rather than passing --force. Firing the cron twice in a month is a no-op.
 * 2. It NEVER issues for a client whose subscription is collected by Stripe
 *    (`collection_mode=stripe_subscription`) — Stripe generates those invoices itself,
 *    so issuing locally too would double-bill. Those are reported as
 *    `stripe_managed` and reconciled by the webhook path instead.
 * 3. DRY RUN BY DEFAULT. Without `--commit` it prints exactly what it would do and
 *    writes nothing. This matches CLAUDE.md's default-PAUSED posture: an automated
 *    money-moving action has to be asked for explicitly.
 *
 * `--send` additionally pushes each issued invoice to Stripe. Left off, invoices are
 * generated locally (HTML+PDF) for manual collection.
 *
 * Usage:
 *   node scripts/billing-cron.js                      # dry run, current period
 *   node scripts/billing-cron.js --commit             # issue locally
 *   node scripts/billing-cron.js --commit --send      # issue + push to Stripe
 *   node scripts/billing-cron.js --period 2026-09 --commit
 */
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/load-env.js";
import { loadPipeline } from "./lib/crm-store.js";
import { getSubscription, listInvoices } from "./lib/billing-store.js";
import { subscription as subSchema } from "../schemas/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
loadEnv();

export function currentPeriod(now = new Date()) { return now.toISOString().slice(0, 7); }

/**
 * Decide what to do for one client, without doing it. Pure given its inputs, so the
 * whole decision matrix is unit-testable without a filesystem or Stripe.
 *
 * Returns { slug, action, reason, amount?, currency? } where action is one of:
 *   issue         — smOS should issue this period's invoice
 *   skipped       — already issued for this period
 *   stripe_managed— Stripe bills it; do not issue locally
 *   not_due       — the subscription doesn't bill this period
 *   inactive      — paused/canceled subscription
 *   no_subscription
 */
export function planClient({ slug, sub, invoices, period }) {
  if (!sub) return { slug, action: "no_subscription", reason: "No subscription record — run /billing <slug> subscribe." };
  if (sub.status === "canceled") return { slug, action: "inactive", reason: "Subscription canceled." };
  if (sub.status === "paused") return { slug, action: "inactive", reason: "Subscription paused." };
  if (sub.status === "past_due") {
    // Still bill: an unpaid prior period is a collections problem (D2 dunning), not a
    // reason to stop invoicing for work being delivered this period.
    // (falls through)
  }
  if (!subSchema.billsPeriod({ ...sub, status: "active" }, period)) {
    return { slug, action: "not_due", reason: `Subscription does not bill ${period} (starts ${sub.start_period}${sub.end_period ? `, ends ${sub.end_period}` : ""}, ${sub.interval}ly).` };
  }
  if (sub.collection_mode === "stripe_subscription") {
    return { slug, action: "stripe_managed", reason: `Stripe subscription ${sub.stripe?.subscription_id} issues this period; not issuing locally.` };
  }
  if ((invoices || []).some((i) => i.period === period)) {
    return { slug, action: "skipped", reason: `Invoice for ${period} already in the ledger.` };
  }
  return { slug, action: "issue", reason: `Due: ${sub.currency} ${sub.amount} for ${period}.`, amount: sub.amount, currency: sub.currency };
}

/** Build the full plan across the pipeline. Reads state; performs nothing. */
export function buildPlan(period) {
  return loadPipeline()
    .filter((d) => d.stage === "won")
    .map((d) => planClient({ slug: d.slug, sub: getSubscription(d.slug), invoices: listInvoices(d.slug), period }));
}

function issueInvoice(slug, period, { send }) {
  const args = [resolve(ROOT, "skills/billing/billing.js"), slug, "invoice", "--period", period];
  if (send) args.push("--send");
  try {
    const out = execFileSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, detail: JSON.parse(out) };
  } catch (e) {
    // Report the failure per-client and keep going — one client's bad data must not
    // stop the rest of the agency from being billed.
    return { ok: false, error: (e.stderr || e.message || "").trim().split("\n").slice(-1)[0] };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true) : undefined; };
  const period = String(flag("period") || currentPeriod());
  const commit = Boolean(flag("commit"));
  const send = Boolean(flag("send"));

  if (!/^\d{4}-\d{2}$/.test(period)) { console.error(`--period must be YYYY-MM, got "${period}".`); process.exit(1); }

  const plan = buildPlan(period);
  const toIssue = plan.filter((p) => p.action === "issue");

  const results = [];
  if (commit) {
    for (const p of toIssue) {
      const r = issueInvoice(p.slug, period, { send });
      results.push({ slug: p.slug, issued: r.ok, ...(r.ok ? { invoice: r.detail.invoice, total: r.detail.total, status: r.detail.status } : { error: r.error }) });
    }
  }

  const summary = plan.reduce((acc, p) => { acc[p.action] = (acc[p.action] || 0) + 1; return acc; }, {});
  const billed = results.filter((r) => r.issued);
  console.log(JSON.stringify({
    period,
    mode: commit ? (send ? "commit+stripe-send" : "commit (local invoices)") : "DRY RUN — nothing written; add --commit to issue",
    summary,
    due: toIssue.map((p) => ({ slug: p.slug, amount: `${p.currency} ${p.amount}` })),
    plan,
    ...(commit ? {
      issued: billed.length,
      failed: results.filter((r) => !r.issued),
      total_billed: billed.reduce((s, r) => s + (Number(String(r.total).replace(/[^\d.]/g, "")) || 0), 0),
      results,
    } : {}),
  }, null, 2));

  // A non-zero exit when a commit run had failures, so the scheduler surfaces it.
  if (commit && results.some((r) => !r.issued)) process.exit(3);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("[billing-cron] FATAL:", e.message); process.exit(1); });
}
