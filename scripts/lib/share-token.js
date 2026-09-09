// scripts/lib/share-token.js — signed, expiring share links (Group D5).
//
// The problem this replaces: client-facing artifacts were published to guessable
// public paths (`public/reports/<slug>/index.html`). Anyone who can guess a client
// slug — or read one off a URL you sent someone else — could read that client's
// performance and invoices. For an agency ops dashboard carrying MRR, margin and
// AR across the whole book, that is worse still.
//
// A token here is `<payload-b64url>.<hmac-b64url>`:
//   - the payload names exactly what may be read (resource + optional slug) and
//     when it stops being readable (`exp`), so a leaked link dies on its own;
//   - the HMAC is over the payload with SMOS_SHARE_SECRET, compared timing-safely,
//     so a token cannot be forged or edited (e.g. bumping `exp`, or swapping the
//     slug to read another client);
//   - verification is FAIL-CLOSED: no secret configured means no valid tokens,
//     rather than a fallback that accepts anything.
//
// This module only mints and verifies. It does not itself gate a web route — the
// serving layer must call `verifyShareToken` and refuse on `ok: false`. A token in
// front of a file that is also still world-readable protects nothing.

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const fromB64url = (s) => Buffer.from(String(s), "base64url");

// Prefix-matched, not fully anchored: the .env.example value is
// `your_share_secret_here`, which a `$`-anchored pattern would happily accept as a
// real credential. A randomly generated base64url secret starting with one of these
// exact words is not a practical concern.
const PLACEHOLDER = /^(fill[_-]?in|todo|changeme|your[_-]|xxx+|<|none$|n\/a$|placeholder|secret$|example)/i;

export function shareSecret() {
  const s = (process.env.SMOS_SHARE_SECRET || "").trim();
  // Same lesson as STRIPE_API_KEY: a placeholder in .env is not a credential, and
  // a 6-character "secret" is not one either.
  if (!s || PLACEHOLDER.test(s) || s.length < 16) return null;
  return s;
}

export function shareConfigured() {
  return shareSecret() !== null;
}

/** Generate a secret suitable for SMOS_SHARE_SECRET. */
export function generateSecret() {
  return randomBytes(32).toString("base64url");
}

function sign(payloadB64, secret) {
  return b64url(createHmac("sha256", secret).update(payloadB64).digest());
}

/**
 * Mint a token.
 *
 * @param {object} opts
 *   resource — what may be read, e.g. "agency-ops" or "portal"
 *   slug     — optional client scope; a portal token must carry one
 *   ttlDays  — how long it stays valid (default 14)
 * @returns {{token, expires_at, payload}}
 * @throws when no usable secret is configured — never mints an unsigned token.
 */
export function mintShareToken({ resource, slug = null, ttlDays = 14, now = Date.now() } = {}) {
  const secret = shareSecret();
  if (!secret) {
    throw new Error("SMOS_SHARE_SECRET is not set (or is a placeholder / shorter than 16 chars). Generate one with `node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64url'))\"` and put it in .env — refusing to mint an unsigned share token.");
  }
  if (!resource) throw new Error("mintShareToken requires a resource");
  if (!(ttlDays > 0)) throw new Error("ttlDays must be > 0");
  const payload = {
    r: String(resource),
    s: slug ? String(slug) : null,
    exp: Math.floor(now / 1000) + Math.round(ttlDays * 86400),
    // Makes two tokens for the same resource+ttl distinct, so one can be
    // distributed and later distinguished in logs.
    n: randomBytes(6).toString("base64url"),
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  return {
    token: `${payloadB64}.${sign(payloadB64, secret)}`,
    expires_at: new Date(payload.exp * 1000).toISOString(),
    payload,
  };
}

/**
 * Verify a token against an expected resource (and slug, when scoped).
 *
 * @returns {{ok: true, payload}} | {{ok: false, reason}}
 */
export function verifyShareToken(token, { resource = null, slug = null, now = Date.now() } = {}) {
  const secret = shareSecret();
  if (!secret) return { ok: false, reason: "SMOS_SHARE_SECRET is not set — no share token can be validated" };
  if (!token || typeof token !== "string" || !token.includes(".")) return { ok: false, reason: "malformed token" };

  const idx = token.lastIndexOf(".");
  const payloadB64 = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!payloadB64 || !sig) return { ok: false, reason: "malformed token" };

  const expected = sign(payloadB64, secret);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };

  let payload;
  try { payload = JSON.parse(fromB64url(payloadB64).toString("utf8")); }
  catch { return { ok: false, reason: "payload is not JSON" }; }

  if (!Number.isFinite(Number(payload?.exp))) return { ok: false, reason: "payload has no expiry" };
  if (Number(payload.exp) * 1000 <= now) {
    return { ok: false, reason: `token expired at ${new Date(Number(payload.exp) * 1000).toISOString()}` };
  }
  // Scope checks come AFTER the signature so an attacker learns nothing by probing.
  if (resource && payload.r !== resource) return { ok: false, reason: `token is for resource "${payload.r}", not "${resource}"` };
  if (slug && payload.s !== slug) return { ok: false, reason: `token is scoped to "${payload.s}", not "${slug}"` };
  return { ok: true, payload };
}
