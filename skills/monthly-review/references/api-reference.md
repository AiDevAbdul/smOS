# Monthly Review — Meta Marketing API Reference

The only external API this skill touches is the Meta Marketing API **Insights** edge,
via `createGraph()` in `scripts/lib/meta-graph.js`. API version is pinned to **v25.0**
(`API_VERSION` constant). All calls are reads (GET); no mutations.

---

## Endpoint

```
GET /v25.0/act_<AD_ACCOUNT_ID>/insights
```

`adAccountId` is normalized to the `act_` prefix if missing. Four calls run in parallel
(`Promise.all`) per run.

### Call 1 — daily account series (trend analysis)
| Param | Value |
|-------|-------|
| `fields` | `spend,impressions,clicks,ctr,cpm,frequency,actions,action_values,reach` |
| `time_range` | `{"since": <days ago>, "until": <yesterday>}` |
| `time_increment` | `1` (one row per day) |
| `level` | `account` |
| `limit` | `500` |

### Call 2 — adset aggregate (fatigue + ranking)
`fields=adset_id,adset_name,spend,impressions,clicks,ctr,cpm,frequency,actions,action_values`,
`level=adset`, same `time_range`, `limit=500`. No `time_increment` (window aggregate).

### Call 3 — ad daily (creative lifecycle)
`fields=ad_id,ad_name,spend,impressions,clicks,ctr,frequency`, `level=ad`,
`time_increment=1`, same `time_range`, `limit=500`.

### Call 4 — placement breakdown (efficiency) — best-effort
`fields=spend,impressions,clicks,ctr,cpm,actions`, `level=account`,
`breakdowns=publisher_platform,platform_position`, `limit=100`. Wrapped in try/catch;
on any error returns `[]` and the review renders without the placement section.

---

## Field semantics (verified)

- `ctr`, `cpm`, `frequency` — Meta returns these precomputed; `ctr` is already a **percentage**.
- `actions` / `action_values` — arrays of `{action_type, value}`; the script string-matches
  `action_type` (see `domain-standards.md` §1) rather than assuming fixed positions.
- `date_start` — present on every daily row; used to sort series and group ad days.
- `publisher_platform` ∈ {`facebook`, `instagram`, `audience_network`, `messenger`};
  `platform_position` ∈ {`feed`, `story`, `reels`, ...} — combined into the placement label.

---

## Versioning & rate limits

| Resource | URL | Use For |
|----------|-----|---------|
| Marketing API root | https://developers.facebook.com/docs/marketing-api/ | Insights edge entry point |
| Versions list | https://developers.facebook.com/docs/graph-api/changelog/versions/ | v25.0 is latest (released 2026-02-18); 2-year lifecycle |
| Versioning guide | https://developers.facebook.com/docs/graph-api/guides/versioning/ | How the `v25.0` pin is applied in URLs |
| Handle Errors | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error-code table; `fbtrace_id` to log on failure |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | `X-App-Usage` / `X-Business-Use-Case-Usage` headers; codes **4** (app), **17** (user), **613** (custom) |
| Marketing API Rate Limiting | https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/ | Ad-account-specific insights limits + ads-management subcodes |

**Rate-limit handling:** `createGraph()` retries transient/retryable codes with exponential
backoff (`RETRYABLE_META_CODES`). Token-expiry codes throw `TokenExpiredError` (no retry).
Insights is read-only and low-volume here (4 calls/run), so it sits well under ad-account
BUC limits; if `X-Business-Use-Case-Usage` approaches 100%, widen the cron interval rather
than parallelizing more.

**Do not** hardcode a different version — the `v25.0` pin lives in `meta-graph.js`
(`API_VERSION`) so every smOS skill moves in lockstep. To bump, change it there, not here.

**Last verified:** 2026-06-22 (cross-checked against `skills/references-shared.md`).
