# Meta Lead Ads API — Reference (v25.0)

Self-contained reference for the Graph API surface `skills/leads/leads.js` touches.
All calls go through `scripts/lib/meta-graph.js` (`createGraph`), which pins
**`v25.0`**, runs the fail-closed guard on writes, retries transient failures with
backoff+jitter, and raises a non-retryable `TokenExpiredError` on dead tokens.

API version: **v25.0** — latest, released 2026-02-18, no newer version exists.

---

## 1. List lead forms on a Page

```
GET /{page_id}/leadgen_forms
  ?fields=id,name,locale,status,leads_count,created_time
  &limit=200
  &access_token={PAGE_TOKEN}
```

- Requires a **Page** access token (not the global ad-account token).
- `status` values include `ACTIVE`, `ARCHIVED`, `DELETED`, `DRAFT`, `PAUSED`. `sync`
  keeps only `ACTIVE`.
- Returns `{ data: [...], paging: {...} }`.

URL: https://developers.facebook.com/docs/graph-api/reference/page/leadgen_forms/

---

## 2. Retrieve leads for a form

```
GET /{leadgen_form_id}/leads
  ?fields=id,created_time,ad_id,adset_id,campaign_id,form_id,field_data,is_organic,platform
  &since={ISO_8601 or unix}      # omitted on a full pull
  &limit=500
  &access_token={PAGE_TOKEN}
```

- Paginated via `graph.paginate(..., 5000)` — follows `paging.next`, capped at 5,000
  leads per invocation, strips and re-signs `access_token`/`appsecret_proof` per page.
- `field_data` is `[{ name, values: [...] }]` (see `domain-standards.md` §3).
- `is_organic: true` means the lead came directly through the form, not a paid click.
- **Retention: 90 days.** Leads older than 90 days are no longer retrievable — this is
  why the skill exists.
- A single `GET /{lead_id}` also works for one lead; the skill always pulls by form.

URL: https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/
Guide: https://developers.facebook.com/docs/marketing-api/guides/lead-ads/

---

## 3. Webhooks (preferred at scale — not implemented here)

Real-time `leadgen` webhook delivery beats polling: no 90-day expiry race, far lower
rate-limit pressure. The skill only *suggests* this when polling looks lossy; setting
it up is one-time integration work outside this skill.

URL: https://developers.facebook.com/docs/marketing-api/guides/lead-ads/quickstart/webhooks-integration

---

## 4. Permissions

A Page token used for lead retrieval needs `leads_retrieval`, `pages_show_list`,
`pages_read_engagement`, plus `pages_manage_metadata` for webhook subscription. The
Page admin must also have completed the Lead Ads terms acceptance for the Page.

---

## 5. Errors & rate limits (handled by `meta-graph.js`)

| Code(s) | Meaning | Client behavior |
|---|---|---|
| 190, 102, 463, 467 | Token expired/invalid (OAuthException) | `TokenExpiredError`, **never retried** — re-auth needed |
| 4 | App-level rate limit | retry w/ backoff |
| 17 | User-level rate limit (`API_EC_USER_TOO_MANY_CALLS`) | retry w/ backoff |
| 32 | Page-level rate limit | retry w/ backoff |
| 613 | Calls-per-hour custom limit | retry w/ backoff |
| 1, 2, 341, 80000–80008 | Transient / per-product limits | retry w/ backoff |
| HTTP 429/500/502/503/504 | Transient platform | retry w/ backoff (honors `Retry-After`) |
| 100 (form/lead-level) | Bad form id, expired lead, etc. | surfaced per-form in `results[]`; other forms continue |

Every Meta error is logged with `code`, `type`, and `fbtrace_id`. No automatic retry on
non-transient errors.

Error handling: https://developers.facebook.com/docs/graph-api/guides/error-handling/
Rate limiting: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/

---

**Last verified:** 2026-06-22 (against `skills/references-shared.md` §7 and §11).
