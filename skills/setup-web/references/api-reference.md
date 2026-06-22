# API Reference — Meta owned_domains (setup-web)

Exact endpoints, fields, version, and rate limits the `/setup-web` companion uses.
All Meta calls go through `scripts/lib/meta-graph.js` `createGraph()` (guarded,
retried, appsecret_proof-aware). Self-contained — cite from here, do not re-derive.

---

## Version

- **Graph API version:** `v25.0` (pinned in `scripts/lib/meta-graph.js` `API_VERSION`).
  Base URL: `https://graph.facebook.com/v25.0`.
- Current latest, released **2026-02-18**; no newer version exists as of 2026-06-22.
- Source: https://developers.facebook.com/docs/graph-api/changelog/versions/

---

## Endpoints used

### 1. Register a domain to the business

```
POST /{business_id}/owned_domains
  body: { domain_name: "example.com" }
  → { id: "<owned_domain_id>" }
```

Then read the node back to get the verification code + status:

```
GET /{owned_domain_id}
  fields: id,domain_name,verification_status,verification_code
  → { id, domain_name, verification_status, verification_code }
```

`verification_code` is the bare token; publish it as a DNS TXT record valued
`facebook-domain-verification=<verification_code>`.

### 2. Poll verification status

```
GET /{business_id}/owned_domains
  fields: id,domain_name,verification_status,verification_code
  → { data: [ { id, domain_name, verification_status, verification_code }, ... ] }
```

The companion finds the entry whose `domain_name` matches and reads
`verification_status` (one of `unverified` / `pending` / `verified`).

> If `verification_code` is absent on the register response, fetch it from
> Business Settings → Brand Safety → Domains (the companion prints this fallback).

---

## Fields

| Field | Meaning |
|-------|---------|
| `domain_name` | The apex domain registered (e.g. `example.com`) |
| `verification_status` | `unverified` \| `pending` \| `verified` — report literally |
| `verification_code` | Token to publish in the `facebook-domain-verification` TXT |
| `id` | The owned-domain node id (used to read the node back) |

---

## Authentication

- `META_ACCESS_TOKEN` — business/system-user token with Business Manager domain
  permissions. Required for `--register` and `--verify-status`. Not needed for
  `--set-website` (pure profile writeback).
- `META_APP_SECRET` (optional) — when set, every call includes
  `appsecret_proof = HMAC-SHA256(token)` keyed by the app secret (added by
  `meta-graph.js` `appsecretProof`). Required if the app enables "Require App Secret".
- Resolved via `scripts/lib/load-env.js`; never hardcoded or logged.

---

## Rate limits & error handling

`meta-graph.js` enforces these automatically:

- **Retryable** (exponential backoff + jitter, honors `Retry-After`): rate-limit
  codes 1, 2, 4 (app), 17 (user), 32 (page), 341, 613, 80000–80008; HTTP 429/500/502/503/504;
  network ECONNRESET/ETIMEDOUT/ECONNABORTED/EAI_AGAIN/ENOTFOUND. Max 4 retries.
- **Non-retryable token errors** (surface for re-auth): codes 190, 102, 463, 467 →
  `TokenExpiredError`.
- **All other Meta errors** surface as `Meta API <code>: <message> (type=…, trace=<fbtrace_id>)`.
- Rate-limit signal headers: `X-App-Usage`, `X-Business-Use-Case-Usage`.

| Resource | URL |
|----------|-----|
| Domain Verification overview | https://developers.facebook.com/docs/sharing/domain-verification/ |
| Verifying Your Domain (TXT/meta/file) | https://developers.facebook.com/docs/sharing/domain-verification/verifying-your-domain/ |
| Domain Verification FAQ (propagation/conflicts) | https://developers.facebook.com/docs/sharing/domain-verification/faq/ |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ |
| Versions list | https://developers.facebook.com/docs/graph-api/changelog/versions/ |

---

## External (non-Meta) providers

Domain purchase + DNS TXT publishing + Vercel deploy are driven by the agent in
the skill body using each provider's own auth/CLI/MCP (Vercel Registrar, Cloudflare,
AWS Route 53). They are intentionally **not** wrapped by the companion — only the
Meta side and the profile writeback are deterministic. Consult the provider's own
docs for those calls; they are out of scope for this Meta-focused reference.

**Last verified:** 2026-06-22
