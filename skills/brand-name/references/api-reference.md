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

**Query set:** the exact name PLUS its sound-alike respellings — `spellingVariants(name,
{limit: 6})` from `scripts/lib/phonetics.js` (ph↔f, c↔k, s↔z, i↔y, ee↔ea, qu→kw, x→ks,
double-letter collapse, trailing-e churn). Exact spelling first, deduped, deterministic.
One request per variant, sequentially.

**Confusability:** every mark name in a response (`markText` / `mark_identification` /
`markIdentification` / `name`) is compared to the candidate with `isConfusable` — soundex
match OR consonant-skeleton match OR normalized edit similarity ≥ 0.8 — and reported in
`similar_marks[]` with its reasons. This is the case an exact-string search misses:
"Klaritee" vs a live "CLARITY".

**Result mapping** (`trademarkKnockout`):
- No key in env ⇒ `{ knockout_clear: null, queried, note: "no USPTO_ODP_API_KEY — knockout NOT run … search these respellings too: …" }`.
- ANY variant query non-2xx / unparseable ⇒ `{ knockout_clear: null, note: "knockout incomplete ({n}/{m} queries failed …)" }`. A partial neighbourhood is never a clean sheet.
- 0 hits across every variant ⇒ `{ knockout_clear: true, hits: 0, note: "no hits across {m} respellings (NOT clearance)" }`.
- Hits but none confusable ⇒ `{ knockout_clear: false, hits, note: "{n} hit(s) … none scoring as confusable — attorney review required" }`.
- Confusable marks found ⇒ `{ knockout_clear: false, similar_marks: [...], note: "{n} sound-alike/near mark(s) … attorney review required" }`.
- Every row also carries `phonetics: { soundex, consonant_skeleton }`.

> The legacy public TESS endpoint was retired; `tmsearch.uspto.gov` has no open JSON API.
> A knockout is advisory; `attorney_clearance_flagged` stays `true` in every case.

## 2. Domains — DNS (multi-TLD)

| Item | Value |
|------|-------|
| Method | `node:dns` `dns.resolveNs(domain)` then fallback `dns.resolve(domain)` |
| Domains built as | `handleize(name) + "." + tld` for each TLD; `handleize` = lowercase, strip non `[a-z0-9]` |
| Default TLDs | `com, co, io, net` (`DEFAULT_TLDS`); override with `--tlds com,co,pk` |
| Authoritative confirm | RDAP — https://www.icann.org/rdap (wire in for definitive answers) |

**Result mapping** (`checkDomains`): per TLD, a resolvable NS or A record ⇒ `false` (taken);
both throw ⇒ `null` (unknown — confirm at registrar/RDAP). Never `true`. Returns
`{ base, domains: {tld: false|null}, domain: "{base}.com", com_available, taken_tlds,
unknown_tlds }`. `.com` remains the gate field (`domain_com_available`); the other TLDs are
context — a name whose only options are fallbacks is a weaker name, and that should be
visible. A TLD that wasn't screened is `null`, not free.

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

**Consistency verdict** (`handleConsistency`): one brand should be @thesamething on every
platform, so the row also carries `{ handle, platforms_checked, definitely_free[], unknown[],
consistent, note }`. Because only a 404 proves anything, `consistent` is `true` only when
EVERY platform 404s, and `null` otherwise — never `false`.

## 4. Rate Limits & Etiquette

- USPTO ODP: respect per-key quota (see developer.uspto.gov terms); on 429/5xx the field
  degrades to `null` — do not auto-retry in a tight loop. The variant fan-out means up to 6
  requests per candidate, run sequentially; keep the shortlist small.
- Social GETs are best-effort and may be rate-limited or geo-blocked; `null` is the expected
  degraded result. Keep the shortlist small (~6) to limit fan-out.
- The three gates run with `Promise.all` per name (domains fan out across TLDs, handles
  across platforms, trademark sequentially across variants); one gate's failure never blocks
  the others.

## 5. Versions

- Node ≥ 18 (global `fetch`, stable `node:dns/promises`).
- USPTO ODP Trademark Search API v1 (`/api/v1/trademarks/search`).
- No Meta Graph API surface is used by this skill.

**Last verified:** 2026-06-22 (cross-checked against `skills/references-shared.md`).
