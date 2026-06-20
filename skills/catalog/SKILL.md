---
name: catalog
description: Use this skill when the user asks to set up, sync, or audit a client's product catalog for dynamic ads (typically via `/catalog {slug}`). Reads `clients/{slug}/products.csv` (or json), creates the catalog if needed, uploads the product feed, and optionally creates product sets for retargeting campaigns.
---

# /catalog — Product Catalog & Dynamic Ads Setup

## Why this exists

Dynamic ads (Advantage+ Catalog Ads, DPAs) need a populated product catalog. Without one, every e-comm client is leaving 30–60% of retargeting revenue on the table. This skill takes a simple product CSV and gets Meta to a state where dynamic ads work.

## Required Context

- `clients/{slug}/client_profile.json` — for `accounts.business_id`, `accounts.catalog_id` (optional — created if missing)
- One of:
  - `clients/{slug}/products.csv` — product feed in Meta-compatible CSV
  - `clients/{slug}/products.json` — JSON array (same fields)
- Or `--feed-url <url>` if the client has a hosted feed

## Required product fields

Per Meta's spec — missing fields cause items to be rejected silently:

| Field | Required | Notes |
|---|---|---|
| `id` | Yes | Unique retailer ID. Keep stable across syncs. |
| `title` | Yes | ≤ 150 chars |
| `description` | Yes | ≤ 5000 chars |
| `availability` | Yes | `in stock`, `out of stock`, `preorder`, `available for order`, `discontinued` |
| `condition` | Yes | `new`, `refurbished`, `used` |
| `price` | Yes | Format: `19.99 USD` (with ISO currency) |
| `link` | Yes | Product page URL |
| `image_link` | Yes | Public image URL |
| `brand` | Yes | Brand name |
| `google_product_category` | Recommended | Improves delivery |
| `sale_price` | Optional | Same format as price |
| `gtin` / `mpn` | Optional | Helps with shopping ads |

## Modes

`node skills/catalog/catalog.js <slug> <mode> [args]`

- `list` — Show catalogs under the client's BM
- `create [--name NAME]` — Create a catalog and store the ID in `client_profile.accounts.catalog_id`
- `sync` — Upload `products.csv` or `products.json` to the catalog
- `feed [--url URL --schedule daily]` — Set up a scheduled feed (Meta pulls automatically)
- `items` — List current items in the catalog
- `sets list|create` — Manage product sets

## Workflow (`sync` mode)

1. Read `products.csv` or `products.json`. Halt if neither exists or schema is invalid.
2. Validate each row against required fields; collect rejected rows with reasons.
3. POST batched upload to `/{catalog_id}/items_batch` with `requests: [{method: 'CREATE'|'UPDATE', retailer_id, data}, ...]`
4. Wait briefly, then GET item count and compare to expected.
5. Write `clients/{slug}/catalog_sync_log.json` with: total_input, accepted, rejected (with reasons), upload_handle.
6. Print one-line summary.

## Validation

Local validation before sending to Meta — saves quota:
- All required fields present (non-empty)
- `availability` in allowed enum
- `condition` in allowed enum
- `price` matches `\d+(\.\d{2})? [A-Z]{3}` format
- `link` and `image_link` start with `http`
- `id` unique within the input

Rows that fail validation are excluded from upload and logged.

## Output

- `clients/{slug}/catalog_sync_log.json`

## Error Handling

- Catalog doesn't exist → `create` mode required first
- Feed file missing → halt with which path to populate
- Meta partial-failure response → log per-item errors, don't abort the whole batch
- BM access denied → tell the user which permission to grant

## Token Efficiency

- Local validation before API call
- Batch upload (single call for ≤ 5000 items) instead of per-item
- No LLM in the body
