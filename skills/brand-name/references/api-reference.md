# brand-name — API & Network Reference

Exact endpoints, fields, versions, rate limits, and fail-open semantics for the three
screening gates in `brand-name.js`. Read this when interpreting a screen failure or wiring
in credentials.

## 1. Trademark — USPTO Open Data Portal

| Item | Value |
|------|-------|
| Endpoint | `GET https://api.uspto.gov/api/v1/trademarks/search?query={term}` |
| Auth | header `X-API-KEY: {USPTO_ODP_API_KEY}`, `accept: application/json` |
| Key source | https://developer.uspto.gov (Open Data Portal → Trademark APIs) |
| Manual fallback | https://tmsearch.uspto.gov (human knockout + clearance) |
| Hit count parsed from | `json.count` ?? `json.results.length` ?? `json.total` |

**Result mapping** (`trademarkKnockout`):
- No key in env ⇒ `{ knockout_clear: null, note: "no USPTO_ODP_API_KEY — verify manually …" }`.
- Non-2xx ⇒ `{ knockout_clear: null, note: "USPTO returned {status} …" }`.
- Unparseable hits ⇒ `{ knockout_clear: null, note: "USPTO response unparseable …" }`.
- `hits === 0` ⇒ `{ knockout_clear: true, hits: 0, note: "no identical live marks (NOT clearance)" }`.
- `hits > 0` ⇒ `{ knockout_clear: false, hits, note: "{n} potentially conflicting live mark(s) — attorney review required" }`.

> The legacy public TESS endpoint was retired; `tmsearch.uspto.gov` has no open JSON API.
> A knockout is advisory; `attorney_clearance_flagged` stays `true` in every case.

## 2. Domain — DNS (`.com`)

| Item | Value |
|------|-------|
| Method | `node:dns` `dns.resolveNs(domain)` then fallback `dns.resolve(domain)` |
| Domain built as | `handleize(name) + ".com"` where `handleize` = lowercase, strip non `[a-z0-9]` |
| Authoritative confirm | RDAP — https://www.icann.org/rdap (wire in for definitive answers) |

**Result mapping** (`checkDotCom`): resolvable NS or A record ⇒ `available: false` (taken);
both throw (no record) ⇒ `available: null` (unknown — confirm at registrar/RDAP). Never `true`.

## 3. Social Handles (unauthenticated)

| Platform | URL pattern |
|----------|-------------|
| Instagram | `https://www.instagram.com/{h}/` |
| Facebook | `https://www.facebook.com/{h}` |
| X | `https://x.com/{h}` |
| TikTok | `https://www.tiktok.com/@{h}` |
| LinkedIn | `https://www.linkedin.com/company/{h}` |

`h = handleize(name)`. Request: `fetch(url, { method: "GET", redirect: "manual" })`.

**Result mapping** (`checkHandle`): HTTP **404 ⇒ `true`** (definitively free);
**any other status / redirect / error ⇒ `null`** (unknown). A 200 is the platform's app
shell, NOT proof the handle is taken — so `false` is never returned unauthenticated.

## 4. Rate Limits & Etiquette

- USPTO ODP: respect per-key quota (see developer.uspto.gov terms); on 429/5xx the field
  degrades to `null` — do not auto-retry in a tight loop.
- Social GETs are best-effort and may be rate-limited or geo-blocked; `null` is the expected
  degraded result. Keep the shortlist small (~6) to limit fan-out.
- All screens run with `Promise.all` per name; one gate's failure never blocks the others.

## 5. Versions

- Node ≥ 18 (global `fetch`, stable `node:dns/promises`).
- USPTO ODP Trademark Search API v1 (`/api/v1/trademarks/search`).
- No Meta Graph API surface is used by this skill.

**Last verified:** 2026-06-22 (cross-checked against `skills/references-shared.md`).
