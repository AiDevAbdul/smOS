# /leads — I/O Contract

Full input/output schemas, exit codes, and edge-case handling for
`skills/leads/leads.js`. Read independently of `SKILL.md`.

---

## 1. Invocation

```
node skills/leads/leads.js <slug> <mode> [form_id] [--since ISO_DATE]
```

| Mode | Args | Behavior |
|---|---|---|
| `list` | — | Print all `leadgen_forms` JSON to stdout; no files written |
| `sync` | `[--since ISO]` | List ACTIVE forms, pull each since its `last_synced`, append + rebuild CSV |
| `pull` | `<form_id> [--since ISO]` | Force-pull one form (any status) since `--since` or its state |

> Implementation note: the script supports exactly `list`, `sync`, `pull`. There is **no
> standalone `score` mode** — scoring runs inline during `sync`/`pull`. Any other mode
> exits 1 with usage.

---

## 2. Inputs

**`clients/{slug}/client_profile.json`** (read):
```json
{ "accounts": { "facebook_page_id": "1234567890" } }
```
`facebook_page_id` must be present and not TBD (`isTbd` rejects null/empty/`/^TBD/i`).

**Page token** (env, resolved in order):
1. `META_PAGE_TOKEN_<SLUG_UPPER>` — slug uppercased, non-alphanumerics → `_`.
2. `META_PAGE_TOKEN` (global fallback).

**`clients/{slug}/leads_state.json`** (optional, read+written):
```json
{
  "forms": {
    "form_111": { "last_synced": "2026-06-21T08:00:00.000Z", "total_pulled": 142 }
  }
}
```

---

## 3. Outputs

### 3a. `clients/{slug}/leads/<form_id>.jsonl` — append-only store
One scored lead per line:
```json
{
  "id": "lead_999",
  "created_time": "2026-06-22T09:14:00+0000",
  "ad_id": "120000000",
  "adset_id": "120000001",
  "campaign_id": "120000002",
  "form_id": "form_111",
  "is_organic": false,
  "platform": "fb",
  "field_data": [
    { "name": "email", "values": ["jane.doe@gmail.com"] },
    { "name": "full name", "values": ["Jane Doe"] }
  ],
  "normalized": { "email": "jane.doe@gmail.com", "full_name": "Jane Doe" },
  "score": 70,
  "tier": "qualified",
  "score_reasons": []
}
```
Dedupe is by `id`: existing ids are read first, only unseen leads are appended.

### 3b. `clients/{slug}/leads_export.csv` — flat CRM export (overwritten each run)
Rebuilt from **all** stored leads across every `*.jsonl`. Columns:
```
lead_id, created_time, form_id, ad_id, campaign_id, platform, is_organic, score, tier, <union of all normalized field keys…>
```
Values are CSV-escaped (quotes doubled, fields containing `" , \n` quoted). Missing
fields render as empty strings.

### 3c. `clients/{slug}/leads_state.json` — updated per processed form
`last_synced` set to the run timestamp; `total_pulled` incremented by new count.

### 3d. stdout summary (sync/pull)
```json
{
  "slug": "acme",
  "mode": "sync",
  "forms_processed": 2,
  "new_leads": 17,
  "total_stored": 159,
  "tier_counts": { "qualified": 120, "review": 28, "junk": 11 },
  "csv": "/abs/path/clients/acme/leads_export.csv",
  "results": [
    { "form_id": "form_111", "form_name": "Demo Request", "fetched": 17, "new": 17 },
    { "form_id": "form_222", "error": "Meta API 100: ..." }
  ]
}
```
Human-readable progress (`[leads] …`) goes to **stderr**; machine JSON to **stdout**.

---

## 4. Exit codes

| Code | Meaning |
|---|---|
| 0 | Success (including "no active forms") |
| 1 | Missing args / unknown mode / fatal uncaught error |
| 2 | `client_profile.json` not found |
| 3 | `accounts.facebook_page_id` is TBD/empty |
| 4 | No Page token in env (message names the exact var) |

---

## 5. Edge cases

| Case | Handling |
|---|---|
| First run, no state | Default `since` = now − 7 days, per form |
| Form errors mid-sync | Captured as `{ form_id, error }` in `results[]`; loop continues |
| No active forms (sync) | `{ note: "no active forms" }`, exit 0 |
| Duplicate lead across runs | Skipped — dedupe by `id` in the JSONL |
| Multi-value field (e.g. multi-select) | Kept as an array in `normalized`; CSV stringifies it |
| Corrupt JSONL line | Skipped via try/catch when reading; never aborts the run |
| Token expired | `TokenExpiredError` thrown, non-retryable → FATAL exit 1; re-auth and rerun |
| `pull` on archived form | Allowed — `pull` does not filter by status |
| `--since` given | Overrides per-form state for that run only (state still updated to now) |
