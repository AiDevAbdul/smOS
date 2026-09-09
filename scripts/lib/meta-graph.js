/**
 * Canonical Meta Graph API client for the whole of smOS.
 *
 * There used to be two divergent clients — this one (skills) and
 * mcp/meta-server/meta-client.js (MCP tools). They disagreed on guards, retry,
 * and pagination, which meant the MCP path could mutate an account WITHOUT the
 * fail-closed guard chokepoint. This module is now the single source of truth;
 * meta-client.js is a thin wrapper around createGraph().
 *
 * Every account mutation runs the shared guard rule-set BEFORE the request
 * leaves the process. Transient failures (rate limits, 5xx, network blips) are
 * retried with exponential backoff + jitter. Expired/invalid tokens (code 190)
 * are surfaced as a clearly-flagged, non-retryable TokenExpiredError so callers
 * can prompt a re-auth instead of silently hammering a dead token.
 */

import axios from "axios";
import { createHmac, randomUUID } from "node:crypto";
import { guardGraphWrite } from "./guards.js";

export const API_VERSION = "v25.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

// Meta error codes that mean "back off and try again" — rate limits + transient
// platform errors. https://developers.facebook.com/docs/graph-api/guides/error-handling
const RETRYABLE_META_CODES = new Set([
  1,     // API unknown / transient
  2,     // service temporarily unavailable
  4,     // application-level rate limit
  17,    // user-level rate limit
  32,    // page-level rate limit
  341,   // application limit reached
  613,   // calls-per-hour limit (custom audiences etc.)
  80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, // per-product rate limits
]);
const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_NET = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "EAI_AGAIN", "ENOTFOUND"]);
// OAuth token problems — never retry, the token must be refreshed first.
const TOKEN_EXPIRED_CODES = new Set([190, 102, 463, 467]);

export class TokenExpiredError extends Error {
  constructor(metaError) {
    super(
      `Meta access token expired or invalid (code ${metaError?.code}` +
        `${metaError?.error_subcode ? `/${metaError.error_subcode}` : ""}): ${metaError?.message}`
    );
    this.name = "TokenExpiredError";
    this.metaError = metaError;
    this.tokenExpired = true;
  }
}

/**
 * appsecret_proof = HMAC-SHA256(access_token) keyed by the app secret. Meta
 * requires it on every call once an app enables "Require App Secret"; without it
 * those apps return error 100% of the time. Returns null when no secret is set.
 */
export function appsecretProof(token, appSecret = process.env.META_APP_SECRET) {
  if (!appSecret || !token) return null;
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

function isTokenExpired(err) {
  const meta = err.metaError || err.response?.data?.error;
  return !!meta && (meta.type === "OAuthException"
    ? TOKEN_EXPIRED_CODES.has(meta.code)
    : meta.code === 190);
}

function isRetryable(err) {
  if (err.tokenExpired) return false;
  const meta = err.metaError || err.response?.data?.error;
  if (meta && RETRYABLE_META_CODES.has(meta.code)) return true;
  if (err.response?.status && RETRYABLE_HTTP.has(err.response.status)) return true;
  if (err.code && RETRYABLE_NET.has(err.code)) return true;
  return false;
}

// Honor an explicit Retry-After header (seconds) when Meta sends one; otherwise
// exponential backoff with full jitter. attempt is 0-based.
function backoffMs(attempt, baseDelayMs, err) {
  const retryAfter = Number(err?.response?.headers?.["retry-after"]);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  const ceiling = baseDelayMs * 2 ** attempt;
  return Math.round(Math.random() * ceiling);
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createGraph(token = process.env.META_ACCESS_TOKEN, opts = {}) {
  if (!token) throw new Error("META_ACCESS_TOKEN is required");
  const {
    http = axios.create({ baseURL: BASE_URL, timeout: 30000 }),
    maxRetries = 4,
    baseDelayMs = 500,
    sleep = realSleep,
    appSecret,
    // Stamp every call of one logical operation with the same id (see logTerminalError).
    correlationId = null,
  } = opts;
  const proof = appsecretProof(token, appSecret);

  function normalizeError(err) {
    const meta = err.response?.data?.error;
    if (meta) {
      if (isTokenExpired({ metaError: meta })) return new TokenExpiredError(meta);
      const e = new Error(`Meta API ${meta.code}: ${meta.message} (type=${meta.type}, trace=${meta.fbtrace_id})`);
      e.metaError = meta;
      e.response = err.response;
      return e;
    }
    return err;
  }

  // Durable, non-blocking error capture. Lazy-imported so meta-graph stays light
  // and so a missing/unconfigured supabase module can never break a Graph call.
  //
  // Correlation IDs (E6): a single logical operation — an IG carousel publish, a
  // /launch fan-out — issues many Graph calls, and until now each failure landed
  // in error_log as an unrelated row. Every request carries a `correlation_id`
  // (caller-supplied for a multi-step flow, otherwise generated per request) and
  // an `attempt` count, so the whole operation can be reassembled from the log
  // and a retried-then-failed call is distinguishable from four separate ones.
  function logTerminalError(err, method, path, cid, attempt) {
    try {
      const meta = err?.metaError || {};
      import("./supabase.js")
        .then((m) => m.logError({
          source: "meta-graph",
          code: meta.code ?? null,
          type: meta.type ?? null,
          message: err?.message || String(err),
          fbtrace_id: meta.fbtrace_id ?? null,
          path: `${method} ${path}`,
          context: { correlation_id: cid, attempts: attempt + 1 },
        }))
        .catch(() => {});
    } catch { /* never throw from the logger */ }
  }

  async function request(method, path, params = {}, data = null, opts = {}) {
    const cid = opts.correlationId || correlationId || newCorrelationId();
    // Fail-closed guardrails: every account mutation runs the shared rule-set
    // BEFORE the HTTP request leaves the process. Throws GuardError on a block.
    // Runs once (not per retry) — a blocked request never goes out at all.
    // `resource` lets a caller declare the resource class of a DELETE so the
    // destructive guard can allow organic moderation without unlocking ad deletes.
    if (method === "POST" || method === "DELETE") {
      try {
        await guardGraphWrite({ method, path, data, token, resource: opts.resource });
      } catch (guardErr) {
        guardErr.correlationId = cid;
        throw guardErr;
      }
    }
    const config = {
      method, url: path,
      params: { access_token: token, ...(proof ? { appsecret_proof: proof } : {}), ...params },
    };
    if (data) config.data = data;

    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await http(config);
        return res.data;
      } catch (rawErr) {
        const err = normalizeError(rawErr);
        err.correlationId = cid;
        err.attempts = attempt + 1;
        lastErr = err;
        if (err.tokenExpired) { logTerminalError(err, method, path, cid, attempt); throw err; } // never retry a dead token
        if (attempt >= maxRetries || !isRetryable(err)) { logTerminalError(err, method, path, cid, attempt); throw err; }
        await sleep(backoffMs(attempt, baseDelayMs, err));
      }
    }
    throw lastErr;
  }

  const api = {
    get: (path, params, opts) => request("GET", path, params, null, opts),
    post: (path, data, params, opts) => request("POST", path, params, data, opts),
    /** opts.resource declares the DELETE's resource class for the destructive guard. */
    delete: (path, params, opts) => request("DELETE", path, params, null, opts),
    act: (id) => `act_${String(id).replace(/^act_/, "")}`,
    /** Correlation id of this client instance (or a fresh one per request when unset). */
    correlationId,
    /** A child client that stamps every call of a multi-step flow with one id. */
    withCorrelationId: (cid = newCorrelationId()) =>
      createGraph(token, { ...opts, correlationId: cid }),
    /**
     * Paged GET. Returns an Array (unchanged for every existing caller) but with
     * pagination facts attached as NON-ENUMERABLE properties: `truncated`,
     * `pageCount`, `limit`, `nextCursor`.
     *
     * Why (E6): this silently `slice(0, max)`d at 500 rows. A 700-ad account, a
     * busy comment thread, a long insights range all came back looking complete,
     * and a report or an optimizer decision was then computed on a partial
     * account with nothing anywhere saying so. Truncation is now visible: it
     * warns on stderr, exposes the cursor to continue from, and callers that
     * care can assert `rows.truncated === false`. Pass `{ onTruncate }` to fail
     * hard instead of warning.
     */
    paginate: async function paginate(path, params, max = 500, { onTruncate } = {}) {
      const results = [];
      const limit = params?.limit ?? 100;
      let next = { path, params: { ...params, limit } };
      let pageCount = 0;
      let nextCursor = null;
      while (next && results.length < max) {
        const page = await request("GET", next.path, next.params);
        pageCount++;
        results.push(...(page.data || []));
        if (page.paging?.next) {
          const u = new URL(page.paging.next);
          next = { path: u.pathname.replace(/^\/v\d+\.\d+/, ""), params: Object.fromEntries(u.searchParams) };
          delete next.params.access_token;
          delete next.params.appsecret_proof; // re-added fresh by request()
          nextCursor = page.paging?.cursors?.after ?? next.params.after ?? null;
        } else {
          next = null;
          nextCursor = null;
        }
      }
      // Truncated when Meta still had a next page, or when the last page
      // overshot `max` and we are about to drop rows we already fetched.
      const truncated = Boolean(next) || results.length > max;
      const out = results.slice(0, max);
      Object.defineProperties(out, {
        truncated: { value: truncated, enumerable: false },
        pageCount: { value: pageCount, enumerable: false },
        limit: { value: max, enumerable: false },
        nextCursor: { value: truncated ? nextCursor : null, enumerable: false },
      });
      if (truncated) {
        const msg =
          `[meta-graph] paginate(${path}) TRUNCATED at max=${max} after ${pageCount} page(s) — ` +
          `more rows exist upstream${nextCursor ? ` (continue after cursor ${nextCursor})` : ""}. ` +
          `Any total computed from this result is a floor, not the account's real total.`;
        if (typeof onTruncate === "function") onTruncate({ path, max, pageCount, nextCursor, message: msg });
        else console.error(msg);
      }
      return out;
    },
  };
  return api;
}

function newCorrelationId() {
  return randomUUID().slice(0, 8);
}

export function isTbd(value) {
  return value == null || value === "" || /^TBD/i.test(String(value));
}

// Exposed for unit tests + callers that want to classify without catching.
export const _internals = { isRetryable, isTokenExpired, backoffMs, RETRYABLE_META_CODES, TOKEN_EXPIRED_CODES };
