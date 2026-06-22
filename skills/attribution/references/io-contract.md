# Attribution — I/O Contract

Full input/output contract for `/attribution`. Authoritative shape lives in
`schemas/attribution_report.js` (`normalize`, `normalizeCell`, `validate`,
`METHODS`); this file documents it with example payloads and edge cases so it is
readable without opening the code.

## Invocation

```
node skills/attribution/attribution.js <slug> [--method=M] [--study-id=ID]
```

| Arg / flag | Required | Default | Notes |
|------------|----------|---------|-------|
| `<slug>` | yes | — | Client dir under `clients/{slug}/` |
| `--method=` | no | `meta_lift_study` | Must be in `METHODS` |
| `--study-id=` | no | `SMOS_LIFT_STUDY_ID` → `profile.attribution.lift_study_id` | Meta Conversion Lift study id |

Env: `SMOS_OFFLINE=1` (skip live pull), `SMOS_PERIOD_START`, `SMOS_PERIOD_END`,
token vars (`scripts/lib/tokens.js`), Supabase vars (`scripts/lib/supabase.js`).

## Inputs

### Required: `clients/{slug}/client_profile.json`
Reads `accounts.ad_account_id`, `accounts.access_token`, `attribution.lift_study_id`.
Missing file → HALT exit 3.

### Optional fallback: `clients/{slug}/lift_export.json`
Used when no live study row is produced. Shape:
```json
{
  "rows": [
    {
      "entity_id": "120200000000000001",
      "entity_name": "CONV_PROSPECT_202605",
      "last_click_conversions": 420,
      "incremental_conversions": 180,
      "spend": 7398,
      "incremental_cpa": 41.1,
      "incrementality_factor": 0.43,
      "confidence": "p<0.05"
    }
  ]
}
```
A row MUST carry `incremental_conversions` OR `incrementality_factor`, else it is
rejected by `validate`. Field aliases accepted by `normalizeCell`: `campaign_id`/
`adset_id`→`entity_id`, `name`→`entity_name`, `conversions`→`last_click_conversions`,
`lift`→`incrementality_factor`.

## Outputs

### `clients/{slug}/attribution_report.json`
```json
{
  "client_slug": "acme",
  "method": "meta_lift_study",
  "period_start": "2026-05-01",
  "period_end": "2026-05-28",
  "rows": [
    {
      "entity_id": "120200000000000001",
      "entity_name": "CONV_PROSPECT_202605",
      "last_click_conversions": 420,
      "incremental_conversions": 180,
      "spend": 7398,
      "incremental_cpa": 41.1,
      "incrementality_factor": 0.43,
      "confidence": "p<0.05"
    }
  ]
}
```

| Field | Type | Notes |
|-------|------|-------|
| `client_slug` | string | From slug arg |
| `method` | enum string | Required; one of `METHODS` |
| `period_start` / `period_end` | string\|null | Study times or env override |
| `rows[].entity_id` | string | Required per row |
| `rows[].entity_name` | string\|null | Campaign name |
| `rows[].last_click_conversions` | number | Default 0 |
| `rows[].incremental_conversions` | number\|null | Required unless factor present |
| `rows[].spend` | number | Default 0 |
| `rows[].incremental_cpa` | number\|null | `spend / incremental_conversions` |
| `rows[].incrementality_factor` | number\|null | Required unless incr. conv. present |
| `rows[].confidence` | number\|string\|null | e.g. `0.9` or `"p<0.05"` |

### Other outputs
- `attribution_report.md` / `.html` / `.pdf` — rendered table (`scripts/lib/md_to_html.js` → `scripts/render_pdf.py`).
- `lift_study_raw.json` — raw study response, written only when a live study was pulled.
- Supabase `lift_studies` — best-effort `{ client_id, slug, method, report }`.

## Validation rules (`schema.validate`)

Returns `{ ok, errors[] }`. Fails (and the skill exits 5) when:
- `method` missing or not in `METHODS`.
- `rows` empty.
- Any row missing `entity_id`.
- Any row with **both** `incremental_conversions` and `incrementality_factor` null
  → "would degrade to last-click".

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 2 | No slug arg |
| 3 | `client_profile.json` missing |
| 4 | No measured incremental data (HALT — refuse last-click-as-lift) |
| 5 | Schema invalid |

## Edge cases

- **Study still running / unsupported shape:** mapper returns 0 measurable rows → falls through to export → if none, HALT exit 4. A `note:` is logged.
- **Study id set, no token:** logs note, falls back to export.
- **`SMOS_OFFLINE=1`:** skips the live pull entirely; relies on `lift_export.json`.
- **Mixed measured/unmeasured cells:** unmeasured cells are silently dropped by the mapper (never zero-filled); only measured cells become rows.
- **Supabase not configured:** persist skipped with a log line; report files still written, exit 0.
- **`confidence` absent:** allowed (null); treat the lift as directional in the writeup.
