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
import { createHmac } from "node:crypto";
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
  } = opts;
  const proof = appsecretProof(token);

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

  async function request(method, path, params = {}, data = null) {
    // Fail-closed guardrails: every account mutation runs the shared rule-set
    // BEFORE the HTTP request leaves the process. Throws GuardError on a block.
    // Runs once (not per retry) — a blocked request never goes out at all.
    if (method === "POST" || method === "DELETE") {
      await guardGraphWrite({ method, path, data, token });
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
        lastErr = err;
        if (err.tokenExpired) throw err;          // never retry a dead token
        if (attempt >= maxRetries || !isRetryable(err)) throw err;
        await sleep(backoffMs(attempt, baseDelayMs, err));
      }
    }
    throw lastErr;
  }

  return {
    get: (path, params) => request("GET", path, params),
    post: (path, data, params) => request("POST", path, params, data),
    delete: (path, params) => request("DELETE", path, params),
    act: (id) => `act_${String(id).replace(/^act_/, "")}`,
    paginate: async function paginate(path, params, max = 500) {
      const results = [];
      let next = { path, params: { ...params, limit: params?.limit ?? 100 } };
      while (next && results.length < max) {
        const page = await request("GET", next.path, next.params);
        results.push(...(page.data || []));
        if (page.paging?.next) {
          const u = new URL(page.paging.next);
          next = { path: u.pathname.replace(/^\/v\d+\.\d+/, ""), params: Object.fromEntries(u.searchParams) };
          delete next.params.access_token;
          delete next.params.appsecret_proof; // re-added fresh by request()
        } else {
          next = null;
        }
      }
      return results.slice(0, max);
    },
  };
}

export function isTbd(value) {
  return value == null || value === "" || /^TBD/i.test(String(value));
}

// Exposed for unit tests + callers that want to classify without catching.
export const _internals = { isRetryable, isTokenExpired, backoffMs, RETRYABLE_META_CODES, TOKEN_EXPIRED_CODES };
