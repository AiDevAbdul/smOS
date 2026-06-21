// scripts/lib/supabase.js — thin PostgREST writer for skill scripts (H4).
//
// Access pattern (see memory: supabase-access-pattern): row reads/writes go through
// PostgREST at SUPABASE_URL/rest/v1/<table> with the SERVICE key (bypasses RLS).
// DDL is NOT done here (that's the Management API + PAT).
//
// Every function is a NO-OP that returns { skipped:true } when env is unset, so
// scripts run fine locally/offline without Supabase — persistence is best-effort
// and never blocks the deliverable.

const URL = () => process.env.SUPABASE_URL;
const KEY = () => process.env.SUPABASE_SERVICE_KEY;

export function supabaseConfigured() {
  return !!(URL() && KEY());
}

function headers(extra = {}) {
  const key = KEY();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function rest(method, path, { body, query, prefer } = {}) {
  if (!supabaseConfigured()) return { skipped: true, reason: "SUPABASE_URL/SUPABASE_SERVICE_KEY not set" };
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  const res = await fetch(`${URL()}/rest/v1/${path}${qs}`, {
    method,
    headers: headers(prefer ? { Prefer: prefer } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** Insert one or many rows. Returns inserted rows (Prefer: return=representation). */
export async function insert(table, rows) {
  const arr = Array.isArray(rows) ? rows : [rows];
  if (!arr.length) return [];
  return rest("POST", table, { body: arr, prefer: "return=representation" });
}

/**
 * Upsert rows on a conflict target (comma-separated column list, must match a
 * unique constraint). Used for daily_metrics so re-runs don't duplicate a day.
 */
export async function upsert(table, rows, onConflict) {
  const arr = Array.isArray(rows) ? rows : [rows];
  if (!arr.length) return [];
  return rest("POST", table, {
    body: arr,
    query: onConflict ? { on_conflict: onConflict } : undefined,
    prefer: "return=representation,resolution=merge-duplicates",
  });
}

/** Select rows with optional PostgREST filters, e.g. select("clients", { slug: "eq.acme" }). */
export async function select(table, filters = {}, columns = "*") {
  return rest("GET", table, { query: { select: columns, ...filters } });
}

/** Resolve a client's UUID by slug (cached per-process). Returns null if absent. */
const _clientIdCache = new Map();
export async function clientIdBySlug(slug) {
  if (_clientIdCache.has(slug)) return _clientIdCache.get(slug);
  if (!supabaseConfigured()) return null;
  try {
    const rows = await select("clients", { slug: `eq.${slug}`, limit: "1" }, "id");
    const id = Array.isArray(rows) && rows[0] ? rows[0].id : null;
    _clientIdCache.set(slug, id);
    return id;
  } catch {
    return null;
  }
}
