// scripts/lib/tokens.js — per-client access-token resolution (Phase 2 prerequisite).
//
// The expert review flagged a "single global page token" defect: organic tools
// (publishing.js / leads.js / inbox) all read one process-wide META_PAGE_TOKEN,
// so a multi-client agency would publish/reply to the WRONG page. This centralizes
// resolution so every organic surface resolves the right token for the right client.
//
// Resolution order (most specific wins), per token kind:
//   1. explicit override passed by the caller
//   2. env  META_<KIND>_TOKEN_<SLUG_UPPER>     (per-client; preferred)
//   3. profile.accounts.<kind>_token            (per-client; stored in profile)
//   4. env  META_<KIND>_TOKEN                    (global fallback; DISCOURAGED)
//
// Fail-closed: resolveToken(..., { require:true }) THROWS when nothing resolves,
// so a live publish/reply can never silently fall through to the wrong account.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const KINDS = {
  page: { env: "PAGE_TOKEN", profile: "page_token" },
  ig: { env: "IG_TOKEN", profile: "ig_token" },
  threads: { env: "THREADS_TOKEN", profile: "threads_token" },
  // Account/system-user token for ad-account-level reads (insights, lift studies).
  // Global fallback is META_ACCESS_TOKEN — the standard system token.
  user: { env: "ACCESS_TOKEN", profile: "access_token" },
};

function envSlugKey(base, slug) {
  return `META_${base}_${String(slug).toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

export function loadProfile(slug) {
  if (!slug) return null;
  const p = resolve(ROOT, "clients", slug, "client_profile.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

/**
 * Resolve a token of `kind` ('page' | 'ig' | 'threads') for a client slug.
 * Returns { token, source } or { token:null, source:'none', tried:[...] }.
 * With { require:true } it throws instead of returning a null token.
 */
export function resolveToken(kind, slug, { override = null, profile = null, require = false } = {}) {
  const def = KINDS[kind];
  if (!def) throw new Error(`resolveToken: unknown kind "${kind}"`);
  const tried = [];

  if (override) return { token: override, source: "override" };

  const perClientEnv = envSlugKey(def.env, slug || "");
  if (slug && process.env[perClientEnv]) return { token: process.env[perClientEnv], source: perClientEnv };
  tried.push(perClientEnv);

  const prof = profile || loadProfile(slug);
  const fromProfile = prof?.accounts?.[def.profile];
  if (fromProfile) return { token: fromProfile, source: `profile.accounts.${def.profile}` };
  tried.push(`profile.accounts.${def.profile}`);

  const globalKey = `META_${def.env}`;
  if (process.env[globalKey]) {
    // Global fallback is a multi-client foot-gun — surface it, don't hide it.
    return { token: process.env[globalKey], source: globalKey, global_fallback: true };
  }
  tried.push(globalKey);

  if (require) {
    throw new Error(
      `No ${kind} token for client "${slug || "?"}". Set ${perClientEnv} (preferred), ` +
      `accounts.${def.profile} in the profile, or ${globalKey} (global). Tried: ${tried.join(", ")}.`
    );
  }
  return { token: null, source: "none", tried };
}

export function pageTokenFor(slug, opts) { return resolveToken("page", slug, opts).token; }
export function igTokenFor(slug, opts) { return resolveToken("ig", slug, opts).token; }
export function threadsTokenFor(slug, opts) { return resolveToken("threads", slug, opts).token; }
