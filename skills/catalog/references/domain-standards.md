# Catalog — Domain Standards

Self-contained reference for product-feed quality, validation rules, batch limits, and
verification semantics. These are the CONSTANTS the skill enforces; the feed contents
themselves VARY per client.

## Why catalogs matter

Dynamic ads (Advantage+ Catalog Ads, formerly DPAs) automatically pull products from a
catalog and personalize them to each viewer (e.g. items they browsed). Without a clean,
populated catalog, retargeting falls back to static creative — leaving an estimated
30–60% of an e-comm client's retargeting revenue unrealized. Feed quality directly gates
delivery: items missing required fields are rejected (often silently) and never serve.

## Required product fields

Meta rejects items missing any required field — sometimes without a per-item error, which
is exactly why post-upload count verification exists.

| Field | Required | Rule enforced locally |
|---|---|---|
| `id` | Yes | Non-empty; unique within the input (stable retailer id across syncs) |
| `title` | Yes | Non-empty (Meta limit ≤150 chars — not enforced locally) |
| `description` | Yes | Non-empty (Meta limit ≤5000 chars — not enforced locally) |
| `availability` | Yes | Must be in the availability enum (case-insensitive) |
| `condition` | Yes | Must be in the condition enum (case-insensitive) |
| `price` | Yes | Must match `^\d+(\.\d{1,2})?\s+[A-Z]{3}$` (e.g. `19.99 USD`) |
| `link` | Yes | Non-empty; must start with `http://` or `https://` |
| `image_link` | Yes | Non-empty; must start with `http://` or `https://` |
| `brand` | Yes | Non-empty |
| `google_product_category` | Recommended | Improves delivery (not validated) |
| `sale_price` | Optional | Same format as `price` (not validated) |
| `gtin` / `mpn` | Optional | Helps with shopping ads (not validated) |

## Enums (exact, case-insensitive on input)

**`availability`:** `in stock` · `out of stock` · `preorder` · `available for order` · `discontinued`

**`condition`:** `new` · `refurbished` · `used`

> The validator lowercases the input value before comparing, so `In Stock` passes. The
> value uploaded to Meta is the original string from the feed — keep feeds lowercase to
> match Meta's canonical spec.

## Price format

Regex: `^\d+(\.\d{1,2})?\s+[A-Z]{3}$`

- Integer or up to 2 decimals, single space, uppercase ISO-4217 currency.
- Good: `19.99 USD`, `5 GBP`, `1200.50 EUR`
- Bad: `$19.99` (symbol), `19.999 USD` (3 decimals), `19.99usd` (lowercase), `19.99` (no currency)

## Batch limit

**5,000 items per `items_batch` request.** The skill chunks accepted rows into 5000-item
slices and POSTs each chunk sequentially. This is a hard Meta limit — do not raise it.

## Post-upload verification semantics

A `200` from `items_batch` is NOT proof items landed — Meta can drop items server-side
silently. After uploading, the skill GETs the catalog node's `product_count` and compares
to the number of accepted (uploaded) items:

| Status | Meaning | Reported as |
|---|---|---|
| `matched` | `live_product_count >= expected` | Success (catalog may already hold prior-sync items, so `>=` not `==`) |
| `discrepancy` | `live_product_count < expected` | WARNING with `missing = expected - live` — NOT success |
| `count_unverified` | count GET failed or `product_count` absent | Honest "could not confirm" with `reason` — NOT success |

Rule: never claim success on `discrepancy` or `count_unverified`.

## Good vs bad feed examples

Good CSV row (all required fields, valid enums/format):
```csv
id,title,description,availability,condition,price,link,image_link,brand
SKU-1,Trail Runner,Lightweight trail shoe,in stock,new,89.99 USD,https://shop.x/p/1,https://cdn.x/1.jpg,Acme
```

Bad rows (each excluded + logged):
```csv
SKU-2,,Missing title,in stock,new,89.99 USD,https://shop.x/p/2,https://cdn.x/2.jpg,Acme   # missing:title
SKU-3,Cap,Hat,limited,new,12 USD,https://shop.x/p/3,https://cdn.x/3.jpg,Acme              # bad_availability:limited
SKU-4,Sock,Wool sock,in stock,new,$5.00,https://shop.x/p/4,https://cdn.x/4.jpg,Acme        # bad_price_format:$5.00
SKU-1,Dup,Same id,in stock,new,9 USD,https://shop.x/p/5,https://cdn.x/5.jpg,Acme           # duplicate_id
```

## Product sets (retargeting)

Product sets segment a catalog for targeted DPAs (e.g. by brand or category). Created with
a `name` and a `filter` JSON string, e.g. `{"brand":{"eq":"Nike"}}`. The skill passes the
filter through verbatim — Meta's filter grammar (operators `eq`, `neq`, `gt`, `contains`,
`is_any`, etc.) is the source of truth; see `api-reference.md`.
