#!/usr/bin/env node
/**
 * stripe-webhook.js — apply a signed Stripe webhook event to the ledger (Group D2).
 *
 * The lower-latency half of reconciliation. `/billing <slug> reconcile` polls and
 * needs no public URL; this reacts the moment a client pays, but only works once
 * an endpoint exists to receive it. Both funnel through `applyStatus`, so there is
 * one implementation of "what happens when Stripe says paid".
 *
 * Deliberately NOT a server. It reads one raw event body on stdin and applies it,
 * so it can sit behind whatever is actually exposed — a Next.js route in `ui/`, an
 * `ssh` tunnel, `stripe listen --forward-to`, or a hand-run replay — without smOS
 * shipping a public HTTP listener nobody asked for.
 *
 * Signature verification is mandatory and fail-closed: without a valid
 * `Stripe-Signature` (env STRIPE_WEBHOOK_SECRET) it refuses to touch the ledger.
 * An unsigned "invoice.paid" is exactly how someone would mark their own invoice
 * settled.
 *
 * Usage:
 *   stripe listen --forward-to ... # (or any receiver) then, per event:
 *   cat event.json | node scripts/stripe-webhook.js --signature "$STRIPE_SIGNATURE"
 *   cat event.json | node scripts/stripe-webhook.js --insecure-skip-verify   # local replay only
 *
 * Exit codes: 0 applied/ignored · 1 usage · 2 signature rejected · 3 apply conflict
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/load-env.js";
import { verifyWebhookSignature, HANDLED_EVENTS } from "./lib/stripe.js";
import { applyStatus } from "./lib/reconcile.js";

loadEnv();

function readStdin() {
  return new Promise((res, rej) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => { buf += d; });
    process.stdin.on("end", () => res(buf));
    process.stdin.on("error", rej);
  });
}

/**
 * Decide what one event means for the ledger. Pure, so the whole event→action map
 * is testable without stdin, Stripe, or a filesystem.
 *
 * Returns null for anything not worth acting on — an unhandled event type must be
 * ACKNOWLEDGED, not errored, or Stripe retries it forever.
 */
export function planEvent(event) {
  const type = event?.type;
  if (!type || !HANDLED_EVENTS.includes(type)) {
    return { action: "ignored", type: type || "(none)", reason: "Event type is not one smOS acts on; acknowledged." };
  }
  const obj = event?.data?.object || {};

  if (type === "customer.subscription.deleted") {
    return {
      action: "subscription_canceled", type,
      slug: obj.metadata?.smos_slug || null,
      subscription_id: obj.id || null,
      // Reported, not auto-applied: Stripe cancelling a subscription and the agency
      // considering a client churned are different facts, and /crm owns churn (D3).
      reason: "Stripe subscription ended — review the client's status in /crm.",
    };
  }

  // Every remaining handled type is an invoice event.
  const slug = obj.metadata?.smos_slug || null;
  const invoiceId = obj.metadata?.smos_invoice_id || null;
  if (!slug) {
    return { action: "unroutable", type, reason: "Stripe object carries no metadata.smos_slug — cannot tell which client's ledger to touch." };
  }
  if (type === "invoice.payment_failed") {
    return {
      action: "payment_failed", type, slug, invoice_id: invoiceId, stripe_invoice_id: obj.id || null,
      // Not a status change: the invoice is still open and still owed. It is a
      // dunning signal, which `/billing dunning` derives from the due date anyway.
      reason: "Payment attempt failed; invoice remains outstanding. Chase via /billing dunning.",
    };
  }
  return {
    action: "apply_status", type, slug,
    invoice_id: invoiceId,
    stripe_invoice_id: obj.id || null,
    stripe_status: obj.status || (type === "invoice.voided" ? "void" : null),
    amount_paid: Number.isFinite(obj.amount_paid) ? obj.amount_paid / 100 : null,
    hosted_url: obj.hosted_invoice_url || null,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true) : undefined; };

  const raw = await readStdin();
  if (!raw.trim()) { console.error("No event body on stdin."); process.exit(1); }

  const skip = Boolean(flag("insecure-skip-verify"));
  if (skip) {
    // Loud, because this is the one path that trusts an unsigned payload.
    console.error("[stripe-webhook] WARNING: signature verification SKIPPED (--insecure-skip-verify). Never use this on a public endpoint.");
  } else {
    const sig = flag("signature") || process.env.STRIPE_SIGNATURE;
    const v = verifyWebhookSignature(raw, sig && sig !== true ? sig : null);
    if (!v.ok) {
      console.error(`[stripe-webhook] REJECTED: ${v.reason}. Ledger untouched.`);
      process.exit(2);
    }
  }

  let event;
  try { event = JSON.parse(raw); } catch (e) { console.error(`Event body is not JSON: ${e.message}`); process.exit(1); }

  const plan = planEvent(event);
  if (plan.action !== "apply_status") {
    console.log(JSON.stringify({ event_id: event.id || null, ...plan }, null, 2));
    return;
  }

  const r = await applyStatus(plan.slug, plan.invoice_id, {
    stripeStatus: plan.stripe_status,
    via: "stripe_webhook",
    amountPaid: plan.amount_paid,
    stripeInvoiceId: plan.stripe_invoice_id,
    hostedUrl: plan.hosted_url,
  });
  console.log(JSON.stringify({ event_id: event.id || null, type: plan.type, slug: plan.slug, ...r }, null, 2));
  if (r.outcome === "conflict") process.exit(3);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("[stripe-webhook] FATAL:", e.message); process.exit(1); });
}
