# Proposal — I/O Contract

Full input/output schemas, example payloads, and edge-case handling for `/proposal`.
Self-contained — read this to know exactly what the script consumes and emits.

---

## Invocation

```
node skills/proposal/proposal.js <slug> [--package <id>] [--no-crm]
```

| Token | Required | Meaning |
|-------|:--------:|---------|
| `<slug>` | yes | Prospect/deal slug (positional, `argv[0]`). Missing → usage + exit 1. |
| `--package <id>` | no | Force a catalog package id. Unknown id → throws. |
| `--no-crm` | no | Render the document only; do not read/write the pipeline. |

---

## Inputs read

### `config/services.json` (catalog — required)

```json
{
  "agency":   { "name": "Ducker Creative", "tagline": "…", "email": "abdul@duckercreative.com",
                "website": "https://duckercreative.com", "logo_url": null },
  "packages": [
    { "id": "growth", "name": "Growth", "monthly_retainer": 3000, "currency": "USD",
      "setup_fee": 750, "best_for": "…", "includes": ["…", "…"] }
  ],
  "terms": { "contract_length_months": 3, "ad_spend": "…", "payment": "…", "cancellation": "…" }
}
```

Required: non-empty `packages[]`. Missing file or empty packages → throw (fail closed).

### `crm/pipeline.json` deal (via `getDeal(slug)` — optional, auto-created)

Relevant fields consumed: `company_name`, `deal.monthly_retainer`, `stage`,
`links`, `activities`. Full normalized deal shape (from `schemas/deal.js`):

```json
{
  "id": "acme", "slug": "acme", "company_name": "Acme Co",
  "contact": { "name": null, "email": null, "phone": null },
  "stage": "audited", "source": "pre-audit", "services": [],
  "deal": { "monthly_retainer": 2800, "setup_fee": 0, "currency": "USD" },
  "probability": 35, "expected_close": null, "owner": null,
  "activities": [],
  "links": { "pre_audit": "prospects/acme/pre_audit.pdf", "proposal": null,
             "contract": null, "client_profile": null },
  "created_at": "…", "updated_at": "…", "won_at": null, "lost_at": null, "lost_reason": null
}
```

### `prospects/{slug}/synthesis.json` or `page_audit.json` (findings — optional)

First file found wins. Loosely mapped:

```json
{ "wins": ["Consistent IG presence"], "gaps": ["No retargeting", "CTR 0.4%"] }
```

- wins ← `wins` || `strengths`; gaps ← `gaps` || `opportunities` || `weaknesses`.
- Items may be strings or `{ text|title }` objects. Unparsable JSON → ignored (non-fatal).

---

## Outputs written

| Path | Content |
|------|---------|
| `proposals/{slug}/proposal.md` | Filled Markdown template |
| `proposals/{slug}/proposal.html` | Rendered HTML (always) |
| `proposals/{slug}/proposal.pdf` | Rendered PDF (if Playwright available) |
| `crm/pipeline.json` | Updated deal (unless `--no-crm`) |
| Supabase `deals` | Best-effort mirror (if configured) |

### Deal patch applied (unless `--no-crm`)

```json
{
  "company_name": "<company>",
  "stage": "proposed",                       // only if isValidTransition(current,"proposed")
  "links": { "proposal": "proposals/<slug>/proposal.pdf" },  // .html if PDF skipped
  "deal": { "monthly_retainer": <retainer||pkg.monthly_retainer>, "currency": "<cur>" },
  "activities": [ ...prior,
    { "at": "<ISO>", "type": "proposal", "note": "proposed Growth (USD 3000/mo)" } ]
}
```

### stdout JSON summary

```json
{
  "slug": "acme",
  "company": "Acme Co",
  "package": "growth",
  "monthly": "USD 2800",
  "html": "/…/proposals/acme/proposal.html",
  "pdf": "/…/proposals/acme/proposal.pdf",   // or "(PDF skipped — install playwright)"
  "used_pre_audit": true,
  "crm": { "stage": "proposed", "proposal_link": "proposals/acme/proposal.pdf", "stage_changed": true },
  "next": "Send to the prospect. On signature: /contract, then /intake + /billing."
}
```

`crm` variants: `{ "skipped": true }` with `--no-crm`; `{ "error": "<msg>" }` if the
deal failed schema validation on save.

---

## Edge cases

| Case | Behavior |
|------|----------|
| No `<slug>` | Usage to stderr, `exit 1` |
| No deal exists for slug | `upsertDeal` creates `{ slug, company_name: slug }`; `company` defaults to slug |
| Deal retainer = 0 | Headline uses package list price; package defaults to `growth` |
| `--package` unknown | Throws with available-ids list; nothing written |
| No catalog | Throws before any output |
| No findings | Generic opportunity paragraph; `used_pre_audit: false` |
| Findings object items | Rendered via `text || title || JSON.stringify(x)` |
| PDF render fails | `pdfOk:false`; HTML linked; summary notes skip; **non-fatal** |
| Current stage past `proposed` | Stage unchanged; `links.proposal` still set; `stage_changed:false` |
| Deal invalid on save | `crm.error` set; document still written |
| Supabase down | Mirror swallowed; local pipeline authoritative |

---

**Last verified:** 2026-06-22
