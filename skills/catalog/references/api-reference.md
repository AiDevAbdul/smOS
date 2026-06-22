# Catalog — API Reference

Self-contained reference for every Meta Graph / Marketing API call `catalog.js` makes.
All calls go through `scripts/lib/meta-graph.js` (`createGraph`), which pins the version,
runs the fail-closed guard chokepoint on writes, retries transient errors, and attaches
`appsecret_proof` when `META_APP_SECRET` is set.

**API version:** `v25.0` (base `https://graph.facebook.com/v25.0`). Confirmed current —
released 2026-02-18, no newer version. Pinned in `meta-graph.js` as `API_VERSION`.

## Endpoints used

| Mode | Method + Path | Key params | Returns |
|---|---|---|---|
| `list` | `GET /{business_id}/owned_product_catalogs` | `fields=id,name,vertical,product_count,feed_count`, `limit=200` | `{data:[...]}` |
| `create` | `POST /{business_id}/owned_product_catalogs` | `name`, `vertical:"commerce"` | `{id}` |
| `sync` (upload) | `POST /{catalog_id}/items_batch` | `requests` (JSON string, ≤5000), `item_type:"PRODUCT_ITEM"` | batch handle |
| `sync` (verify) | `GET /{catalog_id}` | `fields=product_count` | `{product_count}` |
| `feed` | `POST /{catalog_id}/product_feeds` then `POST /{feed_id}/uploads` | `name`, `file_format:"CSV"`, optional `schedule` (JSON `{interval}`); `url` | `{feed_id, upload}` |
| `items` | `GET /{catalog_id}/products` | `fields=id,retailer_id,name,availability,price,brand,link,image_url`, `limit=200` | `{data:[...]}` |
| `sets list` | `GET /{catalog_id}/product_sets` | `fields=id,name,product_count,filter`, `limit=100` | `{data:[...]}` |
| `sets create` | `POST /{catalog_id}/product_sets` | `name`, `filter` (JSON string) | `{id}` |

### items_batch request shape

```json
{
  "item_type": "PRODUCT_ITEM",
  "requests": "[{\"method\":\"CREATE\",\"retailer_id\":\"SKU-1\",\"data\":{...full product...}}]"
}
```
`requests` is a JSON-encoded string. Each entry: `method` (`CREATE`/`UPDATE`/`DELETE`),
`retailer_id`, `data` (the product object). The skill currently emits `CREATE`.

### Schedule object (feed)

```json
{ "interval": "DAILY" }
```
Interval is uppercased from `--schedule` (e.g. `daily` → `DAILY`).

## Rate limits & error handling

Handled centrally by `meta-graph.js` — callers do not implement retry.

- **Retryable** (exponential backoff + full jitter, honors `Retry-After`): Meta codes 1, 2,
  4 (app rate limit), 17 (user rate limit), 32 (page rate limit), 341, 613, 80000-series
  (per-product); HTTP 429/500/502/503/504; network ECONNRESET/ETIMEDOUT/etc. Max 4 retries.
- **Never retried:** token codes 190/102/463/467 → `TokenExpiredError` (`tokenExpired:true`)
  so the caller prompts re-auth instead of hammering a dead token.
- **Surfaced verbatim:** other Meta errors become `Meta API {code}: {message} (type=..., trace={fbtrace_id})`.

`items_batch` may return HTTP 200 while silently dropping items — this is why the read-back
`product_count` verification is mandatory, not optional.

## Cited official sources

| Resource | URL | Use For |
|---|---|---|
| Catalog reference (fields) | https://developers.facebook.com/docs/marketing-api/catalog/reference/ | Required feed fields |
| Catalog Fields (Commerce) | https://developers.facebook.com/docs/commerce-platform/catalog/fields/ | Field defs + enum values |
| Product Item node | https://developers.facebook.com/docs/marketing-api/reference/product-item/ | `availability`/`condition` enums, `product_count` |
| Catalog Batch API guide | https://developers.facebook.com/docs/marketing-api/catalog-batch | Bulk update model |
| items_batch reference | https://developers.facebook.com/docs/marketing-api/reference/product-catalog/items_batch/ | Batch schema; 5000 items/request |
| Graph API versions | https://developers.facebook.com/docs/graph-api/changelog/versions/ | Confirm v25.0 current |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes, `fbtrace_id` |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | App/user/BUC limits, headers |
| Marketing API Rate Limiting | https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/ | Ad-account limits + subcodes |

**Fetch guidance:** if Meta changes the `items_batch` limit, an enum value, or a field name,
fetch the cited page above, update `domain-standards.md` + this file, and bump the
"Last verified" date in `SKILL.md`. Do not change `meta-graph.js` from this skill.

**Last verified:** 2026-06-22
