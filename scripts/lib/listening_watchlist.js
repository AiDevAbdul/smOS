// scripts/lib/listening_watchlist.js — the per-client listening watchlist
// (E5): the configurable set of things /listening actually watches — brand
// terms, keywords, hashtags and competitor handles — plus the append-only time
// series that makes trend/velocity (and therefore crisis detection) computable.
//
// Why a file and not just the profile: the profile is identity, edited by
// /intake and the human. A watchlist is operational and churns — terms get
// added the day a campaign launches and retired the week after. It lives in
// clients/<slug>/data/listening_watchlist.json (via paths.js, never hardcoded)
// and SEEDS itself from the profile the first time so nothing is lost.
//
// The time series is deliberately separate and append-only. A single snapshot
// can never tell you whether 40 mentions is a crisis or a Tuesday; only the
// stack of prior points can, which is why detectCrisis() refuses to fire
// without a minimum baseline.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import * as P from "./paths.js";

export const watchlistPath = (slug, forWrite = false) =>
  forWrite ? P.ensureParent(P.clientData(slug, "listening_watchlist.json")) : P.clientData(slug, "listening_watchlist.json");

export const timeseriesPath = (slug, forWrite = false) =>
  forWrite ? P.ensureParent(P.clientData(slug, "listening_timeseries.json")) : P.clientData(slug, "listening_timeseries.json");

/** Canonical term form: lowercased, trimmed, no leading #/@. */
export function canonTerm(raw) {
  return String(raw ?? "").trim().replace(/^[#@]+/, "").replace(/\s+/g, " ").toLowerCase();
}

function uniq(list) {
  return [...new Set((list || []).map(canonTerm).filter(Boolean))];
}

/**
 * Normalize any watchlist-shaped input into the canonical record.
 *
 * `brand_terms` are the client's own names/handles — they are what separates a
 * mention of US from a mention of a COMPETITOR, so share-of-voice is undefined
 * without at least one. Competitors keep their display name alongside the
 * handle because a competitor is frequently named in prose without its @handle.
 */
export function normalizeWatchlist(raw) {
  const r = raw || {};
  return {
    client_slug: r.client_slug ?? r.slug ?? null,
    updated_at: r.updated_at ?? null,
    brand_terms: uniq(r.brand_terms ?? r.brand ?? []),
    keywords: uniq(r.keywords ?? r.tracked_keywords ?? []),
    hashtags: uniq(r.hashtags ?? []),
    competitors: (Array.isArray(r.competitors) ? r.competitors : [])
      .map((c) => (typeof c === "string" ? { handle: c, name: c } : c || {}))
      .map((c) => ({
        handle: canonTerm(c.handle ?? c.username ?? c.name) || null,
        name: String(c.name ?? c.handle ?? "").trim() || null,
        terms: uniq([c.handle ?? c.username, c.name, ...(c.terms || [])]),
      }))
      .filter((c) => c.handle),
  };
}

/**
 * Seed a watchlist from the client profile. Only used when no watchlist file
 * exists yet — after that the file is authoritative, so an operator's removal
 * is not silently undone by a stale profile field on the next run.
 */
export function seedFromProfile(slug, profile) {
  const p = profile || {};
  const brand = [p.business_name, p.name, p.brand_name, p?.accounts?.instagram_username, p?.accounts?.facebook_page_name]
    .filter(Boolean);
  const competitors = Array.isArray(p.competitors)
    ? p.competitors.map((c) => (typeof c === "string" ? { handle: c, name: c } : { handle: c?.handle || c?.name, name: c?.name || c?.handle }))
    : (p.competitor_handles || []).map((h) => ({ handle: h, name: h }));
  return normalizeWatchlist({
    client_slug: slug,
    brand_terms: brand,
    keywords: p.tracked_keywords ?? p.seo_keywords ?? [],
    hashtags: p.tracked_hashtags ?? p?.content_preferences?.hashtags ?? [],
    competitors,
  });
}

export function loadWatchlist(slug, profile) {
  const path = watchlistPath(slug);
  if (existsSync(path)) {
    try {
      return normalizeWatchlist(JSON.parse(readFileSync(path, "utf8")));
    } catch (e) {
      // A corrupt watchlist must not silently become an EMPTY watchlist — that
      // would read as "nothing to watch" and quietly stop all monitoring.
      const err = new Error(`listening_watchlist.json unreadable (${e.message}) — fix or delete it; refusing to run on an empty watchlist`);
      err.code = "WATCHLIST_CORRUPT";
      throw err;
    }
  }
  return seedFromProfile(slug, profile);
}

export function saveWatchlist(slug, wl, { now = new Date() } = {}) {
  const out = normalizeWatchlist({ ...wl, client_slug: wl.client_slug ?? slug, updated_at: now.toISOString() });
  writeFileSync(watchlistPath(slug, true), JSON.stringify(out, null, 2));
  return out;
}

/** Add terms to a watchlist (immutably). Duplicates collapse via canonTerm. */
export function addToWatchlist(wl, { keywords = [], hashtags = [], competitors = [], brand_terms = [] } = {}) {
  const base = normalizeWatchlist(wl);
  const merged = {
    ...base,
    brand_terms: uniq([...base.brand_terms, ...brand_terms]),
    keywords: uniq([...base.keywords, ...keywords]),
    hashtags: uniq([...base.hashtags, ...hashtags]),
    competitors: [...base.competitors],
  };
  for (const c of competitors) {
    const handle = canonTerm(typeof c === "string" ? c : c?.handle ?? c?.name);
    if (!handle) continue;
    if (merged.competitors.some((x) => x.handle === handle)) continue;
    merged.competitors.push({ handle, name: (typeof c === "string" ? c : c?.name) || handle, terms: uniq([handle, typeof c === "string" ? c : c?.name]) });
  }
  return normalizeWatchlist(merged);
}

/** Remove a term from every list it appears in. Returns {watchlist, removed}. */
export function removeFromWatchlist(wl, term) {
  const t = canonTerm(term);
  const base = normalizeWatchlist(wl);
  const removed = [];
  const drop = (list, label) => list.filter((x) => {
    if (x === t) { removed.push(label); return false; }
    return true;
  });
  const out = {
    ...base,
    brand_terms: drop(base.brand_terms, "brand_terms"),
    keywords: drop(base.keywords, "keywords"),
    hashtags: drop(base.hashtags, "hashtags"),
    competitors: base.competitors.filter((c) => {
      if (c.handle === t) { removed.push("competitors"); return false; }
      return true;
    }),
  };
  return { watchlist: normalizeWatchlist(out), removed };
}

/** Flat list of every term the watchlist watches (for matching). */
export function allTerms(wl) {
  const w = normalizeWatchlist(wl);
  return uniq([...w.brand_terms, ...w.keywords, ...w.hashtags, ...w.competitors.flatMap((c) => c.terms)]);
}

export function isWatchlistEmpty(wl) {
  return allTerms(wl).length === 0;
}

// ─────────────────────────── time series ───────────────────────────

export function loadTimeseries(slug) {
  const path = timeseriesPath(slug);
  if (!existsSync(path)) return { client_slug: slug, points: [] };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return { client_slug: raw.client_slug ?? slug, points: Array.isArray(raw.points) ? raw.points : [] };
  } catch {
    // A corrupt series is treated as NO baseline (not as a zero baseline), so
    // crisis detection reports insufficient_data instead of firing off garbage.
    return { client_slug: slug, points: [], corrupt: true };
  }
}

/**
 * Append one point, append-only and idempotent per captured_at: re-running
 * /listening twice in a run must not double-count the same capture into the
 * baseline (which would fabricate a volume spike out of a retry).
 */
export function appendTimeseries(series, point) {
  const points = [...(series?.points || [])];
  const i = points.findIndex((p) => p.captured_at === point.captured_at);
  if (i >= 0) points[i] = point;
  else points.push(point);
  points.sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
  return { client_slug: series?.client_slug ?? point.client_slug ?? null, points };
}

export function saveTimeseries(slug, series) {
  const out = { client_slug: series?.client_slug ?? slug, points: series?.points || [] };
  writeFileSync(timeseriesPath(slug, true), JSON.stringify(out, null, 2));
  return out;
}
