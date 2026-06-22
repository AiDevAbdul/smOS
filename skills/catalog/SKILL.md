---
name: catalog
description: Use this skill when the user asks to set up, sync, or audit a client's product catalog for dynamic ads / Advantage+ Catalog Ads (DPAs), typically via `/catalog {slug} <mode>`. It lists or creates the Meta product catalog, validates a product feed locally, batch-uploads items (≤5000/request) with read-back count verification, sets up scheduled feeds, lists items, and manages product sets for retargeting.
---

# /catalog — Product Catalog & Dynamic Ads Setup (Phase: Paid Pipeline)

Dynamic ads (Advantage+ Catalog Ads / DPAs) require a populated Meta product catalog. This skill takes a simple product CSV or JSON feed, validates it locally to save API quota, batch-uploads it to a Meta catalog, then reads back the live `product_count` to prove items actually landed — surfacing any discrepancy rather than claiming a false success.

## What This Skill Does

- List catalogs under the client's Business Manager (`list`).
- Create a `commerce`-vertical catalog and persist its id to `client_profile.accounts.catalog_id` (`create`).
- Validate products locally then batch-upload to `/{catalog_id}/items_batch` in ≤5000-item chunks, then verify by reading back `product_count` (`sync`).
- Register a scheduled hosted feed Meta pulls automatically (`feed --url`).
- List current catalog items (`items`).
- List or create product sets with a filter for retargeting segments (`sets list|create`).

## What This Skill Does NOT Do

- Build or launch the catalog/DPA campaign structure — `/launch` owns campaign → adset → ad creation.
- Set up the pixel/Conversions API that powers catalog event matching — `/capi-setup` owns it.
- Write ad creative or copy for catalog ads — `/creative` owns it.
- Create the Business Manager, ad account, or initial accounts — `/setup-accounts` owns it.
- Generate the product feed content itself — the client supplies `products.csv`/`products.json`.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, `API_VERSION`), `scripts/lib/load-env.js`, the sibling `skills/catalog/catalog.js` |
| **Conversation** | Which `{slug}`, which mode, whether a hosted feed URL exists, product-set filters requested |
| **Skill References** | `references/` — required fields, enum taxonomies, batch limits, I/O schemas (table below) |
| **Client Profile** | `clients/{slug}/client_profile.json` → `accounts.business_id`, `accounts.catalog_id`; per-client `CLAUDE.md` overrides |

## Clarifications

> Before asking: check the conversation, the client profile, and `clients/{slug}/products.*`.
> Only ask for what cannot be determined. Field specs, enums, and batch limits live in
> `references/` — never ask the user for them.

**Required (must resolve before running):**
1. The client `{slug}`.
2. The mode (`list` | `create` | `sync` | `feed` | `items` | `sets`).

**Optional (ask only if relevant):**
3. Catalog `--name` (defaults to `"{profile.name} Catalog"`).
4. For `feed`: the hosted feed `--url` (required for that mode) and `--schedule` (e.g. `daily`).
5. For `sets create`: the set `--name` and `--filter` JSON.

## Workflow

1. Confirm `clients/{slug}/client_profile.json` exists; read `accounts.business_id` / `accounts.catalog_id`.
2. Run `node skills/catalog/catalog.js {slug} {mode} [args]`.
3. For `create`/`list`: halt if `business_id` is TBD. For `sync`/`feed`/`items`/`sets`: halt if `catalog_id` is TBD (run `create` first).
4. For `sync`: load + validate the feed locally, exclude rejected rows with reasons, batch-upload accepted rows, then verify count.
5. Read `catalog_sync_log.json` and report `matched` / `discrepancy` / `count_unverified` honestly. Never report success on a discrepancy.

## Input / Output Specification

**Inputs:** `<slug> <mode>` args; `clients/{slug}/client_profile.json`; for `sync`: `clients/{slug}/products.csv` OR `products.json`; flags `--name`, `--url`, `--schedule`, `--filter`. Env: `META_ACCESS_TOKEN`, optional `META_APP_SECRET`.
**Outputs:** JSON result on stdout (`{slug, mode, result}`); `sync` writes `clients/{slug}/catalog_sync_log.json`; `create` mutates `client_profile.accounts.catalog_id`.
(Full schemas and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Slug, business_id, catalog_id, product feed contents, catalog/feed/set names, set filters, schedule interval | Required-field list, `availability`/`condition` enums, price regex, 5000-item batch limit, `vertical:"commerce"`, `item_type:"PRODUCT_ITEM"`, verification logic, Graph API v25.0 |

## Domain Standards

### Must Follow
- [ ] Validate every row locally before any API call (required fields non-empty, enums valid, price `^\d+(\.\d{1,2})?\s+[A-Z]{3}$`, http(s) links, unique ids).
- [ ] Chunk uploads at ≤5000 items per `items_batch` request.
- [ ] Read back live `product_count` after upload and compare to accepted count.
- [ ] Persist `catalog_id` to the profile on `create` so downstream skills resolve it.

### Must Avoid
- Claiming success on a `discrepancy` or `count_unverified` result — a 200 from `items_batch` is NOT proof items landed.
- Sending rejected rows to Meta — they are excluded and logged, not uploaded.
- Hardcoding tokens or the Business Manager id.

### Output Checklist (verify before delivery)
- [ ] `catalog_sync_log.json` written with `input_total`, `accepted`, `rejected`, `rejected_list`, `verification`.
- [ ] Verification status reported verbatim (matched / discrepancy / count_unverified).
- [ ] On `create`, `client_profile.accounts.catalog_id` updated.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `client_profile.json` | Exit code 2, print profile path — do not guess |
| `business_id` TBD (list/create) | Throw `accounts.business_id is TBD` — run `/setup-accounts` |
| `catalog_id` TBD (sync/feed/items/sets) | Throw — run `create` mode first |
| No `products.csv`/`products.json` (sync) | Throw with the path to populate |
| `products.json` not an array | Throw schema error |
| Rows fail local validation | Exclude + record in `rejected_list` with reasons; never abort whole batch |
| `product_count` GET fails / absent | Record `verification.status:"count_unverified"` with reason — never assert success |
| Live count < accepted | Record `verification.status:"discrepancy"` + `missing`; print WARNING |
| Meta API error | `meta-graph.js` surfaces code/type/fbtrace_id; transient codes retried w/ backoff; token code 190 → non-retryable `TokenExpiredError` |
| `feed` without `--url` / `sets create` without `--name`+`--filter` | Throw usage error |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, guarded chokepoint, retry/backoff, `appsecret_proof`), `scripts/lib/load-env.js`. No schema file — validation is inline in `catalog.js`.
- **External APIs:** Meta Graph / Marketing API **v25.0** — `owned_product_catalogs`, `items_batch` (5000/request), `product_feeds`, `products`, `product_sets`. Rate limits + error codes in `references/api-reference.md`.
- **Secrets:** `META_ACCESS_TOKEN` (and optional `META_APP_SECRET` → `appsecret_proof`) resolved from env via `load-env.js` — never hardcoded or logged.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Catalog reference (fields) | https://developers.facebook.com/docs/marketing-api/catalog/reference/ | Required feed fields |
| Catalog Fields (Commerce) | https://developers.facebook.com/docs/commerce-platform/catalog/fields/ | Field defs + accepted enum values |
| Product Item node | https://developers.facebook.com/docs/marketing-api/reference/product-item/ | `availability` / `condition` enums |
| Catalog Batch API guide | https://developers.facebook.com/docs/marketing-api/catalog-batch | Bulk update model |
| items_batch reference | https://developers.facebook.com/docs/marketing-api/reference/product-catalog/items_batch/ | Batch schema; 5000 items/request |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes + `fbtrace_id` |
| Marketing API Rate Limiting | https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/ | Ad-account rate limits |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Required/optional fields, `availability`/`condition` enums, price/link rules, batch limit, verification semantics, good/bad feed examples |
| `references/api-reference.md` | Exact endpoints, params, v25.0 version, rate limits + error codes, cited URLs |
| `references/io-contract.md` | Full JSON schemas for inputs, `catalog_sync_log.json`, mode outputs, edge cases |
