# Contract — I/O Contract

Exact inputs, outputs, exit codes, and edge cases for `skills/contract/contract.js`.
Self-contained: consult this file to call the skill correctly without reading the source.

---

## CLI

```
node skills/contract/contract.js <slug> [--package <id>] [--send] [--mark-signed]
```

| Token | Required | Meaning |
|-------|----------|---------|
| `<slug>` | yes | Deal slug; must already exist in `crm/pipeline.json` |
| `--package <id>` | no | Force a catalog package (`starter` / `growth` / `scale`); else inferred from retainer |
| `--send` | no | After generating, attempt e-signature (Dropbox Sign, else manual) |
| `--mark-signed` | no | Record a received signature → move deal to `won`; does NOT regenerate the doc |

`--mark-signed` is mutually exclusive in effect with generation: if present, the skill records
the signature and returns early (no rendering, no `--send`).

---

## Inputs read

### `crm/pipeline.json` deal (via `getDeal(slug)` → `schemas/deal.js`)
Fields consumed:
```jsonc
{
  "slug": "acme",
  "company_name": "Acme Co",
  "stage": "proposed",                 // must be reachable → negotiating / won
  "contact": { "name": "Jane Roe", "email": "jane@acme.com" },
  "deal": { "monthly_retainer": 3000, "currency": "USD" },
  "links": { "proposal": "proposals/acme/proposal.pdf", "contract": null },
  "activities": []
}
```
Note: code reads `d.deal.monthly_retainer`, `d.company_name`, `d.contact.name`, `d.contact.email`.

### `config/services.json` (via `loadCatalog()`)
```jsonc
{
  "agency": { "name": "Ducker Creative", "email": "abdul@duckercreative.com", ... },
  "packages": [ { "id": "growth", "name": "Growth", "monthly_retainer": 3000,
                  "currency": "USD", "setup_fee": 750, "includes": [ "...", "..." ] } ],
  "terms": { "contract_length_months": 3, "ad_spend": "...", "payment": "...", "cancellation": "..." }
}
```

### Env
- `DROPBOX_SIGN_API_KEY` (optional) — enables a real e-sign send under `--send`.

---

## Outputs written

| Artifact | Path |
|----------|------|
| Agreement Markdown | `contracts/{slug}/agreement.md` |
| Agreement HTML | `contracts/{slug}/agreement.html` |
| Agreement PDF | `contracts/{slug}/agreement.pdf` (skipped if Playwright absent) |
| CRM mutation | `crm/pipeline.json` (+ best-effort Supabase `deals` mirror) |

### CRM mutation on generate
`stage` → `negotiating` (if transition legal, else unchanged); `links.contract` → PDF path
(or HTML if PDF skipped); one `activities` entry `{ type: "contract", note: "agreement generated (<pkg>)" }`.

### CRM mutation on `--mark-signed`
`stage` → `won`; `won_at` → ISO timestamp; one `activities` entry `{ type: "contract", note: "agreement signed" }`.

---

## stdout JSON

### Generate (default, optionally with `--send`)
```jsonc
{
  "slug": "acme",
  "company": "Acme Co",
  "package": "growth",
  "html": "/abs/contracts/acme/agreement.html",
  "pdf": "/abs/contracts/acme/agreement.pdf",   // or "(PDF skipped — install playwright)"
  "crm_stage": "negotiating",
  "contract_link": "contracts/acme/agreement.pdf",
  "esign": { "sent": false, "mode": "skipped" }, // or manual/dropbox_sign result
  "note": "Template — have an attorney review before signing.",
  "next": "Send it, then /contract acme --mark-signed on signature."
}
```

### `--mark-signed`
```jsonc
{ "slug": "acme", "stage": "won", "signed": true,
  "next": "Run /intake to onboard, then /billing to invoice." }
```

### `esign` result shapes (under `--send`)
```jsonc
{ "sent": true,  "mode": "dropbox_sign", "request_id": "abc123" }
{ "sent": false, "mode": "manual", "reason": "No DROPBOX_SIGN_API_KEY set — …" }
```

---

## Exit codes

| Code | Cause |
|------|-------|
| 0 | Success (generate, send, or mark-signed) |
| 1 | Missing `<slug>` (usage); or FATAL (unknown package, missing/empty catalog, unexpected throw) |
| 2 | No CRM deal for slug |
| 3 | `--mark-signed` with no `links.contract` yet |
| 4 | `--mark-signed` from a stage that cannot transition to `won` |
| 5 | `upsertDeal` validation failed marking won (e.g. missing `links.proposal`) |

---

## Edge cases

- **Bare slug, no proposal run:** generate still works (`upsertDeal` creates a deal if absent;
  package inferred from retainer 0 → `growth`), but `--mark-signed` will exit 5 until a
  proposal exists, because `won` requires `links.proposal`.
- **Illegal generate transition** (e.g. stage already `won` or `lost`): stage left unchanged,
  doc still rendered, `links.contract` still set.
- **Playwright missing:** `pdfOk=false` → `contract_link` and the e-sign attachment fall back to
  the HTML file; JSON `pdf` shows the skip note.
- **`--send` without key:** manual fallback, exit 0 — not a failure.
- **Per-deal retainer 0:** falls back to the package's catalog `monthly_retainer` in the Fees
  section.

**Last verified:** 2026-06-22
