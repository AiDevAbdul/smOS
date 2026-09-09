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

const API = "https://api.stripe.com/v1";

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_API_KEY);
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
  const key = process.env.STRIPE_API_KEY;
  if (!key) throw new Error("STRIPE_API_KEY is not set");
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
  const key = process.env.STRIPE_API_KEY;
  if (!key) throw new Error("STRIPE_API_KEY is not set");
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

export { StripeError };
