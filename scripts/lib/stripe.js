// scripts/lib/stripe.js — the one Stripe boundary (Group D1).
//
// Extracted from skills/billing/billing.js so the invoice sender, the recurring
// subscription creator, and the webhook reconciler (D2) all speak to Stripe the
// same way instead of three hand-rolled fetch loops.
//
// Two things this module exists to get right:
//
// 1. IDEMPOTENCY. Every POST carries an `Idempotency-Key`. Stripe replays the
//    original response for a repeated key (24h) instead of performing the action
//    again, so a retried invoice run — a cron firing twice, a crash between the
//    Stripe call and the ledger write, an operator re-running the command — cannot
//    create a second customer or charge the client twice. Keys are DETERMINISTIC
//    (derived from the invoice/subscription id + the operation), never random:
//    a random key would make every retry a fresh, chargeable request. The
//    /billing SKILL.md referenced this header long before any code sent it; D1 is
//    where that stopped being a documentation-only claim.
//
// 2. HONEST FAILURE. Nothing here throws into a success path or invents ids.
//    `stripeConfigured()` is false without a key, and callers fall back to a
//    local/manual invoice — matching CLAUDE.md's fail-closed posture. Amounts
//    arrive in MAJOR units and are converted to cents at this boundary only.

import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.stripe.com/v1";

// `.env` ships with `STRIPE_API_KEY=FILL_IN`-style placeholders, and a truthiness
// check treats those as configured — so `/billing reconcile` reported "checked 1"
// and fired a doomed 401 at Stripe instead of saying it wasn't set up. A real
// Stripe secret key is `sk_live_…` / `sk_test_…` (or a restricted `rk_…`);
// anything else is a placeholder, not a credential.
const PLACEHOLDER = /^(fill[_-]?in|todo|changeme|your[_-]|xxx+|<.*>|none|n\/a|placeholder)/i;

export function stripeKey() {
  const k = (process.env.STRIPE_API_KEY || "").trim();
  if (!k || PLACEHOLDER.test(k)) return null;
  return k;
}

export function stripeConfigured() {
  return stripeKey() !== null;
}

/** Major units → integer cents. Stripe rejects fractional cents. */
export function toCents(amount) {
  return Math.round((Number(amount) || 0) * 100);
}

/**
 * A deterministic Idempotency-Key. Same (scope, op) → same key forever, so a
 * replay is recognized by Stripe as the same logical request.
 *
 * `scope` should identify the thing being acted on (an invoice id, a slug+period,
 * a subscription id) and `op` the single operation (`customer`, `item-0`,
 * `invoice`, `finalize`, `price`, `subscription`).
 */
export function idempotencyKey(scope, op) {
  return `smos:${scope}:${op}`;
}

class StripeError extends Error {
  constructor(path, status, body) {
    super(`Stripe ${path} ${status}: ${String(body).slice(0, 200)}`);
    this.name = "StripeError";
    this.path = path;
    this.status = status;
  }
}

/**
 * POST a form-encoded request. `idempotency` is REQUIRED for any call that
 * creates or mutates — pass null only for a genuinely idempotent-by-nature call.
 * `fetchImpl` is injectable so tests exercise the real header/body construction
 * without touching the network.
 */
export async function stripePost(path, params, { idempotency, fetchImpl = globalThis.fetch } = {}) {
  const key = stripeKey();
  if (!key) throw new Error("STRIPE_API_KEY is not set (or is still a placeholder)");
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotency) headers["Idempotency-Key"] = idempotency;
  const res = await fetchImpl(`${API}/${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new StripeError(path, res.status, await res.text());
  return res.json();
}

export async function stripeGet(path, { fetchImpl = globalThis.fetch } = {}) {
  const key = stripeKey();
  if (!key) throw new Error("STRIPE_API_KEY is not set (or is still a placeholder)");
  const res = await fetchImpl(`${API}/${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new StripeError(path, res.status, await res.text());
  return res.json();
}

/**
 * Find-or-create the Stripe customer for a client. Keyed on the slug via
 * metadata so re-running never forks a second customer record for one client.
 */
export async function ensureCustomer({ slug, email, name }, opts = {}) {
  const found = await stripeGet(`customers/search?query=${encodeURIComponent(`metadata['smos_slug']:'${slug}'`)}`, opts)
    .catch(() => null);
  if (found?.data?.length) return found.data[0];
  return stripePost("customers", {
    email, name, "metadata[smos_slug]": slug,
  }, { ...opts, idempotency: idempotencyKey(slug, "customer") });
}

/**
 * Create a recurring subscription for a retainer: a monthly (or yearly) price on
 * the fly, then a subscription against it. `collection_method=send_invoice` keeps
 * this consistent with how one-off retainer invoices are already collected — the
 * client gets a payable invoice each period rather than a silent card charge.
 *
 * Returns { customer_id, price_id, subscription_id }.
 */
export async function createSubscription({ slug, email, company, amount, currency, interval, daysUntilDue = 7 }, opts = {}) {
  const cust = await ensureCustomer({ slug, email, name: company }, opts);
  const price = await stripePost("prices", {
    unit_amount: String(toCents(amount)),
    currency: String(currency).toLowerCase(),
    "recurring[interval]": interval,
    "product_data[name]": `${company} — management retainer`,
    "metadata[smos_slug]": slug,
  }, { ...opts, idempotency: idempotencyKey(`${slug}:${interval}:${toCents(amount)}:${currency}`, "price") });
  const sub = await stripePost("subscriptions", {
    customer: cust.id,
    "items[0][price]": price.id,
    collection_method: "send_invoice",
    days_until_due: String(daysUntilDue),
    "metadata[smos_slug]": slug,
  }, { ...opts, idempotency: idempotencyKey(slug, "subscription") });
  return { customer_id: cust.id, price_id: price.id, subscription_id: sub.id };
}

export async function cancelSubscription(subscriptionId, opts = {}) {
  return stripePost(`subscriptions/${subscriptionId}`, { cancel_at_period_end: "true" }, {
    ...opts, idempotency: idempotencyKey(subscriptionId, "cancel"),
  });
}

// ──────────────────── reconciliation (Group D2) ────────────────────
//
// Two ways to learn that an invoice was paid, both landing in the same applier:
//   POLL    — `/billing <slug> reconcile` fetches each invoice's current Stripe
//             status. Needs no public URL, so it works on a laptop today.
//   WEBHOOK — `scripts/stripe-webhook.js` verifies a signed event and applies it.
//             Lower latency, but only once an endpoint exists.
// Both replace the old manual `mark-paid`, which drifted from reality the moment a
// client paid without anyone telling smOS.

/** Fetch one Stripe invoice (for the polling reconciler). */
export async function fetchInvoice(stripeInvoiceId, opts = {}) {
  return stripeGet(`invoices/${stripeInvoiceId}`, opts);
}

/**
 * Map Stripe's invoice status onto ours. Stripe's vocabulary is wider than the
 * ledger's, so this is explicit rather than a cast: anything unrecognized returns
 * null and the caller leaves the ledger ALONE rather than guessing.
 *
 * Stripe: draft | open | paid | uncollectible | void
 */
export function mapInvoiceStatus(stripeStatus) {
  switch (String(stripeStatus)) {
    case "paid": return "paid";
    case "open": return "sent";
    case "draft": return "draft";
    case "void": return "void";
    // Written off as uncollectible is a real accounting outcome, not a payment.
    case "uncollectible": return "void";
    default: return null;
  }
}

// The Stripe events worth acting on. Anything else is acknowledged and ignored —
// a webhook endpoint that errors on unknown events makes Stripe retry forever.
export const HANDLED_EVENTS = [
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "invoice.voided",
  "invoice.marked_uncollectible",
  "customer.subscription.deleted",
];

/**
 * Verify a Stripe webhook signature (the `Stripe-Signature` header).
 *
 * Implemented directly rather than pulling the Stripe SDK for one function. Two
 * properties that matter and are easy to get wrong:
 *   - the signed payload is `${timestamp}.${rawBody}` — the RAW body, so a caller
 *     must not JSON.parse-and-restringify before verifying;
 *   - the comparison is timing-safe, and a timestamp older than `toleranceSec`
 *     is rejected so a captured request can't be replayed later.
 * Returns { ok, reason? }. Fail-closed: no secret configured means not verified.
 */
export function verifyWebhookSignature(rawBody, signatureHeader, { secret = process.env.STRIPE_WEBHOOK_SECRET, toleranceSec = 300, now = Date.now() } = {}) {
  if (!secret) return { ok: false, reason: "STRIPE_WEBHOOK_SECRET is not set" };
  if (!signatureHeader) return { ok: false, reason: "missing Stripe-Signature header" };
  const parts = String(signatureHeader).split(",").map((p) => p.trim().split("="));
  const timestamp = parts.find((p) => p[0] === "t")?.[1];
  const signatures = parts.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (!timestamp || !signatures.length) return { ok: false, reason: "malformed Stripe-Signature header" };

  const ageSec = Math.abs(Math.floor(now / 1000) - Number(timestamp));
  if (!Number.isFinite(ageSec)) return { ok: false, reason: "malformed signature timestamp" };
  if (ageSec > toleranceSec) return { ok: false, reason: `signature timestamp outside tolerance (${ageSec}s > ${toleranceSec}s)` };

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const match = signatures.some((sig) => {
    const sigBuf = Buffer.from(String(sig), "utf8");
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
  return match ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

export { StripeError };
