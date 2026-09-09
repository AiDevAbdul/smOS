/**
 * HTTP reachability probe (E3 — "verify, don't assume").
 *
 * Why this exists: /setup-web used to record `accounts.website_url` from whatever
 * string the operator typed. Every downstream step then trusted it — /capi-setup
 * looks for a pixel on it, Meta domain verification is claimed against it, ad
 * creatives link to it — so one typo or a not-yet-propagated DNS record produced a
 * client profile that *asserted* a live site that never resolved. The fix is to GET
 * it once and refuse to record a URL that does not answer.
 *
 * Deliberate choices:
 *   - Redirects are followed MANUALLY so the chain is reportable and the recorded
 *     URL can be the final one (http→https and apex→www are the common cases).
 *   - Only a 2xx counts as reachable. A 401/403 is *not* treated as live: a landing
 *     page behind auth is not a landing page a customer can reach.
 *   - The body is read only far enough to report content type + size. We do NOT
 *     try to detect domain-parking pages — every heuristic for that produces false
 *     positives on real minimal landers, and a wrong block is worse than none.
 *   - Never throws for a network error; returns { ok:false, error }.
 */

// SMOS_PROBE_TIMEOUT_MS lets a caller (and the test suite) shorten the wait; a
// slow DNS/TLS handshake on a fresh domain is normal, so the default is generous.
export const DEFAULT_TIMEOUT_MS = Number(process.env.SMOS_PROBE_TIMEOUT_MS) > 0
  ? Number(process.env.SMOS_PROBE_TIMEOUT_MS)
  : 10_000;
export const MAX_REDIRECTS = 5;

/** Coerce user input into an absolute http(s) URL. Returns { ok, url, reason }. */
export function normalizeUrl(input) {
  if (typeof input !== "string" || !input.trim()) return { ok: false, reason: "empty URL" };
  let s = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return { ok: false, reason: `unparseable URL: ${input}` }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: `unsupported protocol ${u.protocol} (need http/https)` };
  }
  if (!u.hostname.includes(".")) return { ok: false, reason: `hostname "${u.hostname}" has no TLD` };
  return { ok: true, url: u.toString() };
}

/**
 * GET a URL and report whether it actually answers.
 *
 * @returns {Promise<{ok:boolean, url:string, final_url:string|null, status:number|null,
 *   https:boolean|null, redirects:Array<{from:string,status:number,to:string}>,
 *   content_type:string|null, bytes:number|null, error:string|null, checked_at:string}>}
 */
export async function probeUrl(input, opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = MAX_REDIRECTS,
  } = opts;
  const checked_at = new Date().toISOString();
  const norm = normalizeUrl(input);
  if (!norm.ok) {
    return {
      ok: false, url: String(input ?? ""), final_url: null, status: null, https: null,
      redirects: [], content_type: null, bytes: null, error: norm.reason, checked_at,
    };
  }
  if (typeof fetchImpl !== "function") {
    return {
      ok: false, url: norm.url, final_url: null, status: null, https: null, redirects: [],
      content_type: null, bytes: null, error: "no fetch implementation available", checked_at,
    };
  }

  const redirects = [];
  let current = norm.url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res;
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
    try {
      res = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: ac ? ac.signal : undefined,
        headers: { "user-agent": "smOS-setup-verify/1.0" },
      });
    } catch (e) {
      return {
        ok: false, url: norm.url, final_url: null, status: null,
        https: current.startsWith("https:"), redirects, content_type: null, bytes: null,
        error: e?.name === "AbortError" ? `timed out after ${timeoutMs}ms` : (e?.message || String(e)),
        checked_at,
      };
    } finally { if (timer) clearTimeout(timer); }

    const status = res.status;
    const location = typeof res.headers?.get === "function" ? res.headers.get("location") : null;
    if (status >= 300 && status < 400 && location) {
      let next;
      try { next = new URL(location, current).toString(); } catch {
        return {
          ok: false, url: norm.url, final_url: current, status, https: current.startsWith("https:"),
          redirects, content_type: null, bytes: null,
          error: `unparseable redirect target "${location}"`, checked_at,
        };
      }
      redirects.push({ from: current, status, to: next });
      current = next;
      continue;
    }

    let bytes = null;
    try {
      const body = typeof res.text === "function" ? await res.text() : "";
      bytes = typeof body === "string" ? body.length : null;
    } catch { bytes = null; }

    return {
      ok: status >= 200 && status < 300,
      url: norm.url,
      final_url: current,
      status,
      https: current.startsWith("https:"),
      redirects,
      content_type: typeof res.headers?.get === "function" ? res.headers.get("content-type") : null,
      bytes,
      error: status >= 200 && status < 300 ? null : `HTTP ${status}`,
      checked_at,
    };
  }

  return {
    ok: false, url: norm.url, final_url: current, status: null,
    https: current.startsWith("https:"), redirects, content_type: null, bytes: null,
    error: `too many redirects (> ${maxRedirects})`, checked_at,
  };
}

/** One-line human summary of a probe result, for CLI output and profile notes. */
export function describeProbe(p) {
  if (!p) return "not checked";
  if (p.ok) {
    const via = p.redirects.length ? ` (after ${p.redirects.length} redirect${p.redirects.length > 1 ? "s" : ""} → ${p.final_url})` : "";
    return `HTTP ${p.status}${via}`;
  }
  return `unreachable: ${p.error}`;
}
