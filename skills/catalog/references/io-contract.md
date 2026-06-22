# Catalog — I/O Contract

Full input/output schemas, example payloads, and edge-case handling for `catalog.js`.
Read this when wiring inputs or consuming `catalog_sync_log.json` downstream.

## CLI invocation

```
node skills/catalog/catalog.js <slug> <mode> [args]
```

| Mode | Args | Precondition |
|---|---|---|
| `list` | — | `business_id` not TBD |
| `create` | `[--name NAME]` | `business_id` not TBD; writes back `catalog_id` |
| `sync` | — | `catalog_id` not TBD; `products.csv`/`products.json` present |
| `feed` | `--url URL [--schedule daily] [--name NAME]` | `catalog_id` not TBD; `--url` required |
| `items` | — | `catalog_id` not TBD |
| `sets list` | — | `catalog_id` not TBD |
| `sets create` | `--name NAME --filter '<json>'` | `catalog_id` not TBD; both flags required |

Exit codes: `0` success · `1` runtime/usage/validation error · `2` profile not found.
Result JSON prints to **stdout**; diagnostics + log paths print to **stderr**.

## Inputs

### client_profile.json (read; `create` mutates it)
```json
{ "name": "Acme", "accounts": { "business_id": "123", "catalog_id": "456" } }
```
`isTbd()` treats `null`, `""`, and any value starting with `TBD` (case-insensitive) as unset.

### products.json (sync)
Array of product objects. Required keys per item: `id, title, description, availability,
condition, price, link, image_link, brand` (see `domain-standards.md`).
```json
[
  { "id":"SKU-1","title":"Trail Runner","description":"Lightweight",
    "availability":"in stock","condition":"new","price":"89.99 USD",
    "link":"https://shop.x/p/1","image_link":"https://cdn.x/1.jpg","brand":"Acme" }
]
```

### products.csv (sync)
First row = headers; parsed by an inline RFC-4180-style parser handling quoted fields,
embedded commas, and `""` escapes. Blank/all-empty rows are skipped. Header order is free.

## Outputs

### stdout (all modes)
```json
{ "slug": "acme", "mode": "create", "result": { "id": "456" } }
```

### catalog_sync_log.json (sync only)
```json
{
  "slug": "acme",
  "generated_at": "2026-06-22T10:00:00.000Z",
  "accepted": 120,
  "rejected": 3,
  "rejected_list": [
    { "id": "SKU-2", "errors": ["missing:title"], "sample": { "title": "", "brand": "Acme" } },
    { "id": null,    "errors": ["missing:id","bad_price_format:$5"], "sample": {...} }
  ],
  "uploads": [ { /* per-chunk items_batch response */ } ],
  "verification": { "status": "matched", "expected": 120, "live_product_count": 120 },
  "input_total": 123
}
```

`verification` is one of:
```json
{ "status": "matched",          "expected": 120, "live_product_count": 130 }
{ "status": "discrepancy",      "expected": 120, "live_product_count": 90, "missing": 30 }
{ "status": "count_unverified", "expected": 120, "reason": "product_count not returned by Meta" }
```

When zero rows pass validation, `syncProducts` short-circuits:
```json
{ "accepted": 0, "rejected": 5, "rejected_list": [...], "upload": null }
```
(no upload attempted, no `verification` key).

### Validation error codes (in `rejected_list[].errors`)
`missing:<field>` · `bad_availability:<value>` · `bad_condition:<value>` ·
`bad_price_format:<value>` · `bad_link` · `bad_image_link` · `duplicate_id`

## Edge cases

| Case | Behavior |
|---|---|
| Both `products.csv` and `products.json` present | CSV wins (checked first) |
| `products.json` not an array | Throws `products.json must be an array of product objects` |
| Empty CSV (headers only) | `accepted:0` short-circuit, no upload |
| >5000 accepted items | Split into sequential 5000-item `items_batch` POSTs; one entry per chunk in `uploads` |
| Catalog already held items from a prior sync | `matched` uses `live >= expected`, so prior items don't trigger a false discrepancy |
| Verification GET fails (network/token/missing field) | `count_unverified` with `reason`; log still written; success NOT claimed |
| `feed` missing `--url` | Throws `feed mode requires --url` |
| `sets create` missing `--name` or `--filter` | Throws usage error |
| `sets` sub-mode not `list`/`create` | Throws `sets sub-mode must be list or create` |
| Unknown mode | Throws `Unknown mode: <mode>` |
| Missing profile | Exit code 2, prints expected path |
