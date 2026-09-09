// scripts/lib/web_search.js — key-gated web search for untagged brand-mention
// discovery (E5). Node twin of scripts/meta-ad-library/tavily.py, which the
// /pre-audit pipeline already uses; same design rules:
//
//   * Key-gated: no TAVILY_API_KEY ⇒ available() is false, the caller records
//     the source as `unavailable` with `mentions: null`, and the run stays
//     honestly partial. Never fabricated.
//   * Fail-soft: any network/HTTP/parse failure returns { ok:false, results:[] }
//     and never throws into the skill.
//   * Honest about what it is: an INDEX of public pages, not a per-platform
//     census. It can surface a Reddit thread or a news article that mentions the
//     brand without @-tagging it; it cannot enumerate TikTok or X.
//
// `fetchImpl` is injectable so the suite exercises the parser with no network.

const BASE = "https://api.tavily.com";
const TIMEOUT_MS = Number(process.env.SMOS_WEB_SEARCH_TIMEOUT_MS || 20000);

export function available(env = process.env) {
  return Boolean(env.TAVILY_API_KEY);
}

export function unavailableReason(env = process.env) {
  return available(env)
    ? null
    : "no TAVILY_API_KEY — web mention discovery not run (set the key to enable indexed public-page search)";
}

/**
 * Search the web for one query. Returns
 * `{ ok, results:[{title,url,content,published_date}], error }`.
 * `ok:false` always comes with `results: []` — the caller must treat that as
 * unknown coverage, not as zero mentions.
 */
export async function searchWeb(query, {
  maxResults = 10,
  days = 7,
  fetchImpl = globalThis.fetch,
  env = process.env,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  if (!available(env)) return { ok: false, results: [], error: unavailableReason(env) };
  if (!query || !String(query).trim()) return { ok: false, results: [], error: "empty query" };

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${BASE}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TAVILY_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: String(query), max_results: maxResults, days, include_answer: false, topic: "general" }),
      signal: controller?.signal,
    });
    if (!res?.ok) return { ok: false, results: [], error: `web search HTTP ${res?.status ?? "?"}` };
    const body = await res.json();
    return { ok: true, results: parseResults(body), error: null };
  } catch (e) {
    return { ok: false, results: [], error: `web search failed: ${e?.message || String(e)}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Pure parser over a Tavily search payload — unit-tested without network. */
export function parseResults(body) {
  const rows = Array.isArray(body?.results) ? body.results : [];
  return rows
    .map((r) => ({
      title: r?.title ?? null,
      url: r?.url ?? null,
      content: r?.content ?? "",
      published_date: r?.published_date ?? null,
    }))
    .filter((r) => r.url);
}
