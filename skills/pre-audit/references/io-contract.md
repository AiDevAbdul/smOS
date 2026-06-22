# pre-audit — Input/Output Contract

Full schemas, example payloads, exit codes, and edge cases. Self-contained. The agent
produces the three input JSONs; `skills/pre-audit/pre-audit.js` consumes them and renders.

## Directory layout

```
prospects/{slug}/
  page_audit.json            # Pass 1 + Pass 5 merged (FB/IG + website tracking)
  competitor_summary.json    # Pass 2 + Pass 3 (self ads + competitor outspend)
  synthesis.json             # Pass 6 (score, wins, gaps, opportunities, outspend_ratio)
  reports/
    raw_self_<ts>.json
    raw_competitors_<ts>.json
    competitors_<ts>.html
    market_<ts>.html         # only if a niche file exists
  pre_audit.html             # rendered sales artifact (interactive)
  pre_audit.pdf              # rendered sales artifact (shareable)
```

All under `prospects/`, never `clients/` — the prospect has not signed.

## Wrapper CLI

```
node skills/pre-audit/pre-audit.js <slug> --business "Name" [--niche-html <path>] [--no-crm]
```

| Arg / flag | Required | Default | Effect |
|---|---|---|---|
| `<slug>` (positional) | yes | — | prospect dir + CRM deal key |
| `--business "Name"` | no | `<slug>` | report title + CRM `company_name` |
| `--niche-html <path>` | no | — | embeds the niche playbook section |
| `--no-crm` | no | off | skip the CRM deal write |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success — JSON summary printed to stdout |
| `1` | No slug given, or fatal error |
| `2` | One or more of the three required input files missing (names listed) |
| `3` | `pre_audit_report.py` render failed (first 500 chars of stderr printed) |

PDF failure is **not** fatal — the wrapper logs the Playwright-missing reason and continues.

## `page_audit.json`

```json
{
  "fetched_at": "2026-06-22T14:00:00Z",
  "facebook": {
    "fetch_status": "ok",
    "url": "https://www.facebook.com/acmehvac/",
    "page_id": "100064xxxxxxxxx",
    "likes": 1766, "talking_about": 2, "were_here": 247,
    "has_profile_pic": true, "verified": false,
    "latest_content_type": "video.other", "rating": null
  },
  "instagram": {
    "fetch_status": "ok", "handle": "acmehvac",
    "is_business_account": true, "is_verified": false,
    "category_name": "HVAC contractor",
    "followers": 842, "following": 310, "posts_total": 96,
    "external_url": "https://acmehvac.com",
    "posts_per_week": 2.1, "recency_days": 4
  },
  "website": {
    "fetch_status": "ok", "url": "https://acmehvac.com",
    "pixel": false, "pixel_id": null,
    "gtm": true, "gtm_id": "GT-XXXXXX", "google_tag_loader": true,
    "ga4": true, "ga4_id": "G-XXXXXXX",
    "conversion_event": false, "responsive": true,
    "response_bytes": 184320, "external_scripts": 14
  }
}
```

Edge case: any sub-tree may carry `"fetch_status": "blocked_400"` / `"blocked_429"` /
`"timeout"`; the scorer treats those fields as `unverified` and surfaces a gap.

## `competitor_summary.json`

```json
{
  "country": "US", "window_days": 90,
  "self": { "running_ads": false, "active_ad_count": 0, "bucket": "greenfield",
            "format_mix": {}, "has_conversion_objective": false },
  "competitors": [
    { "name": "BestAir Co", "page_id": "1000xxxx", "active_ad_count": 42,
      "est_monthly_spend": 12000, "top_formats": ["VID","CAR"],
      "top_objectives": ["OUTCOME_SALES","OUTCOME_LEADS"] }
  ],
  "max_competitor_monthly_spend": 12000,
  "outspend_ratio": 12000.0
}
```

`bucket` ∈ `greenfield | running_losing | running_competent` (see `domain-standards.md`).

## `synthesis.json`

```json
{
  "score": 38,
  "dimensions": {
    "page_completeness": 0.7, "posting_consistency": 0.7, "ad_maturity": 0.1,
    "outspend_gap": 0.08, "pixel_tracking": 0.4, "niche_alignment": null
  },
  "wins": ["Verified IG business account", "Posting 2×/week consistently", "GA4 installed"],
  "gaps": ["No Meta Pixel — ad spend unmeasured", "0 active ads vs 42 competitor ads",
           "No conversion event on site"],
  "opportunities": [
    { "title": "Install Meta Pixel + CAPI", "impact": "high", "effort": "low" },
    { "title": "Launch $50/day conversion test", "impact": "high", "effort": "medium" },
    { "title": "Match competitor video format", "impact": "medium", "effort": "medium" }
  ],
  "outspend_ratio": 12000.0
}
```

`dimensions.*` ∈ `[0,1]` or `null` (unverified). `score` is the rounded weighted sum.
`wins`/`gaps` have exactly 3 strings; `opportunities` exactly 3 objects.

## Wrapper stdout (success)

```json
{
  "slug": "acmehvac",
  "business": "Acme HVAC",
  "html": "/…/prospects/acmehvac/pre_audit.html",
  "pdf": "/…/prospects/acmehvac/pre_audit.pdf",
  "crm": { "stage": "audited", "pre_audit_link": "prospects/acmehvac/pre_audit.html" },
  "persisted": { "ok": true },
  "next": "Send the report. To pursue: /proposal acmehvac (deal is now 'audited')."
}
```

`pdf` is `"(PDF skipped — install playwright)"` when render failed. `crm` is
`{ "skipped": true }` with `--no-crm`, or `{ "error": "<msg>" }` on a write failure (still
exit 0). `persisted` is `{ "skipped": true }` when Supabase is unconfigured.

## CRM transition

The wrapper reads the existing deal via `getDeal(slug)`; if absent it starts at `lead`. It
advances to `audited` only when `dealSchema.isValidTransition(current, "audited")` is true
(valid from `lead`/`contacted`) or the deal is already `audited`; otherwise it leaves the
stage unchanged. It appends a `note` activity ("pre-audit completed") and sets
`links.pre_audit`. Mirrored to the Supabase `deals` table best-effort by `crm-store.js`.

## `prospect_audits` row (best-effort)

Inserted only when `supabaseConfigured()`: `{ slug, business_name, generated_at, converted: false }`.
On conversion, `/intake` flips `converted = true` and stamps `converted_at`.
