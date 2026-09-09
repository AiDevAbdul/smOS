# pre-audit — Input/Output Contract

Full schemas, example payloads, exit codes, and edge cases. Self-contained.

**The pipeline is four deterministic stages, all driven by the Node wrapper.** The three
render-contract JSONs are *derived* from the long-format `signals.csv` — the source of
truth — not hand-written:

```
collect.py   → data/raw/*.json          (4 public passes: FB, IG, website, Ad Library)
normalize.py → data/signals.csv         (one row per signal — human-editable ledger)
build.py     → data/{page_audit,competitor_summary,synthesis}.json   (+ deterministic 0–100 score)
pre_audit_report.py + render_pdf.py → deliverables/pre-audit/pre-audit.{html,pdf}
```

Re-running `build.py` on an unchanged `signals.csv` yields byte-identical JSON. A human can
correct a scraped value directly in `signals.csv`, then `--rebuild` to re-derive everything.

## Directory layout

```
prospects/{slug}/
  data/
    raw/
      facebook.json  instagram.json  website.json     # organic + tracking passes
      ads_self.json  ads_competitors.json             # Ad Library envelopes {status,data:[…]}
      manifest.json                                    # slug, fetched_at, country, window_days
    signals.csv              # ← SOURCE OF TRUTH (long format, see below)
    narrative.json           # OPTIONAL human/model prose overrides (merged last by build.py)
    page_audit.json          # derived: FB/IG + website tracking
    competitor_summary.json  # derived: self ads + competitors (dict keyed by name)
    synthesis.json           # derived: score, dimensions, wins/gaps, recs, outspend_ratio
  deliverables/pre-audit/
    pre-audit.html           # rendered sales artifact (interactive)
    pre-audit.pdf            # rendered sales artifact (shareable)
```

All under `prospects/`, never `clients/` — the prospect has not signed.

## `signals.csv` — the source of truth

One row per observed signal. Nested report fields are dotted `metric` paths that `build.py`
re-inflates; missing/blocked surfaces are recorded with their `status` (row `metric=_status`)
rather than dropped, so the ledger never implies absence it did not observe.

| Column | Meaning |
|---|---|
| `slug` | prospect slug |
| `pass` | `facebook` \| `instagram` \| `website` \| `ads` |
| `entity` | `self` or `competitor:<PageName>` |
| `metric` | dotted path, e.g. `likes`, `meta_pixel.installed`, `format_mix.VID`, `active_ads_last_90d` |
| `value` | string form of the value (`build.py` coerces by `unit`) |
| `unit` | `count` \| `bool` \| `rate` \| `text` \| `id` |
| `status` | `ok` \| `not_found` \| `blocked_<code>` \| `timeout` \| `no_token` |
| `source` | fetch URL |
| `fetched_at` | ISO timestamp (also drives derived timestamps — keeps builds reproducible) |

## Wrapper CLI

```
# render from an existing signals.csv / JSONs (default)
node skills/pre-audit/pre-audit.js <slug> --business "Name" [--niche-html <path>] [--no-crm]
# re-derive JSONs from an edited signals.csv, then render
node skills/pre-audit/pre-audit.js <slug> --rebuild --business "Name"
# full run: scrape → csv → json → render
node skills/pre-audit/pre-audit.js <slug> --collect --fb <url> [--ig <h>] [--site <url>] \
     [--competitor <url> …] [--country US] [--days 90] --business "Name"
```

| Arg / flag | Required | Default | Effect |
|---|---|---|---|
| `<slug>` (positional) | yes | — | prospect dir + CRM deal key |
| `--collect` | no | off | run stage 1 (scrape) then normalize + build |
| `--rebuild` | no | off | run normalize + build from existing `data/raw/`, then render |
| `--fb / --ig / --site` | with `--collect` | — | page URL / IG handle / website URL to scrape |
| `--competitor <url>` | no | — | competitor FB URL (repeatable) |
| `--country / --days` | no | `US` / `90` | Ad Library window |
| `--business "Name"` | no | `<slug>` | report title + CRM `company_name` |
| `--niche-html <path>` | no | — | embeds the niche playbook section |
| `--vertical <key>` | no | — | benchmark row (`hvac`, `apparel`, `b2b_saas`, …; aliases in `benchmarks.json`). Applies on `--collect`/`--rebuild`. Omitted ⇒ every figure labeled cross-vertical |
| `--geo <ISO2>` | no | `--country` | cost-indexes the benchmark CPM (`GB`, `AE`, `DE`, …). An uncovered market (e.g. `PK`) gets no index and no substitute |
| `--no-crm` | no | off | skip the CRM deal write |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success — JSON summary printed to stdout |
| `1` | No slug given, or fatal error |
| `2` | One or more of the three derived input files missing (run `--collect`/`--rebuild`) |
| `3` | `pre_audit_report.py` render failed (first 500 chars of stderr printed) |
| `4` | `collect.py` failed |
| `5` | `normalize.py` failed |
| `6` | `build.py` failed |

PDF failure is **not** fatal — the wrapper logs the Playwright-missing reason and continues.

The three schemas below are the **render contract** (what `pre_audit_report.py` reads).
`build.py` produces them from `signals.csv`; do not hand-edit them — edit `signals.csv`
(quantitative) or `narrative.json` (prose) and `--rebuild`.

## `page_audit.json`

```json
{
  "fetched_at": "2026-07-15T00:00:00Z",
  "facebook": {
    "likes": 1766, "talking_about": 2, "were_here": 247,
    "has_profile_pic": true, "verified": false,
    "latest_content_type": "video.other", "about": "HVAC in Austin", "page_id": "100064…"
  },
  "instagram": {
    "handle": "acmehvac", "bio": "We fix ACs", "external_url": "https://acmehvac.com",
    "category_name": "HVAC contractor", "is_business_account": true, "is_verified": false,
    "followers": 842, "following": 310, "posts_total": 96,
    "posts_per_week": 2.1, "recency_days": 4
  },
  "website": {
    "meta_pixel": { "installed": false, "id": null },
    "gtm": { "installed": true, "id": "GT-XXXXXX" },
    "ga4": { "installed": true, "id": "G-XXXXXXX" },
    "conversion_events": false, "viewport_meta": true,
    "response_bytes": 184320, "external_scripts": 14
  }
}
```

Edge case: a blocked/absent surface produces `"fetch_status": "blocked_400"` /
`"timeout"` / `"not_found"` on that sub-tree (from the CSV `_status` row); the scorer
treats it as `unverified` and surfaces a gap. Note the nested `meta_pixel/gtm/ga4`
objects (`{installed,id}`) — this is the shape the renderer reads.

## `competitor_summary.json`

`competitors` is a **dict keyed by page name** (not a list) — that is the render contract.

```json
{
  "self": {
    "active_ads_last_90d": 0, "new_ads_last_14d": 0,
    "avg_creative_age_days": null, "survival_past_60d_pct": null, "format_mix": {}
  },
  "competitors": {
    "BestAir Co": {
      "active_ads_last_90d": 42, "new_ads_last_14d": 6,
      "avg_creative_age_days": 55, "survival_past_60d_pct": 30.0,
      "format_mix": { "VID": 30, "CAR": 12 },
      "creative_matrix": { "hook_strength": 8, "visual_strategy": 7, "cta_match": 9,
                           "psychological_trigger": 7, "run_duration_score": 8 }
    }
  },
  "fetched_at": "2026-07-15T00:00:00Z"
}
```

`creative_matrix` (0–10 qualitative scores) is optional — add its rows to `signals.csv`
(`metric=creative_matrix.hook_strength`) when the classifier or a human scores creatives.

## `synthesis.json`

```json
{
  "score": 43,
  "headline": "Competitors are running 21× your ad volume — you're ceding the paid lane",
  "outspend_ratio": 21,
  "outspend_ratio_source": "top competitor active-ad volume vs. yours",
  "dimensions": {
    "page_completeness": 100, "posting_consistency": 79, "ad_maturity": 0,
    "outspend_gap_inverse": 0, "pixel_tracking": 35
  },
  "wins": ["Established Facebook presence — 1,766 likes to build on", "…", "…"],
  "gaps": ["No Meta Pixel — every ad click is unmeasured and un-retargetable", "…", "…"],
  "recommendations": [
    { "problem": "Ad spend is flying blind without a pixel",
      "action": "Install Meta Pixel + Conversions API before any paid spend",
      "impact": "high", "effort": "low" }
  ],
  "next_steps": { "day_30": "…", "day_60": "…", "day_90": "…" },
  "scored_at": "2026-07-15T00:00:00Z",
  "data_quality": {
    "core_passes": 4,
    "blocked_passes": ["facebook", "instagram"],
    "low_confidence": true
  }
}
```

`dimensions.*` ∈ `[0,100]` (integers). `score` = rounded mean of the five equal-weight
dimensions. `wins`/`gaps` ≤ 3 strings; `recommendations` ≤ 3 objects. All fields except
`score`/`dimensions`/`data_quality` may be overridden by `narrative.json`.

`data_quality` is the minimum-data-quality gate: `blocked_passes` lists the core public
passes (facebook, instagram, website, ads) whose `_status` was non-`ok`; `low_confidence`
is `true` when ≥2 are blocked. The renderer draws a **LOW CONFIDENCE** banner when set, so
a report built from mostly-empty passes never looks confident. `scored_at` drives the
report timestamp (data-derived, not wall-clock). Industry benchmarks that anchor opportunity
sizing + 2 score dimensions live in `scripts/meta-ad-library/benchmarks.json` (sourced,
dated, refreshed quarterly) — never hardcoded.

`synthesis.json` also carries a **`benchmarks`** block, resolved once by `build.py` (from
`--vertical` + `--geo`/manifest country) so the renderer reads it instead of re-deriving:

```json
{
  "benchmarks": {
    "vertical": { "key": "home_services", "input": "hvac", "match": "alias", "label": "Home Services" },
    "geo": { "key": "GB", "match": "exact", "label": "United Kingdom", "cpm_index": 0.7345, "band": "very_high" },
    "metrics": {
      "cpm": { "label": "CPM", "value": 9.84, "display": "$9.84", "basis": "geo_derived",
               "geo_adjusted": true, "note": "… Derived estimate, not a measured GB Home Services figure." },
      "cpc": { "…": "basis: vertical_observed, geo_adjusted: false" }
    },
    "global": { "meta_cpl": { "…": "the cross-vertical floor, always present" } },
    "sources": [ { "source": "…", "source_date": "…", "sample_note": "…" } ],
    "caveats": ["…"],
    "confidence_tier": "third_party_aggregate",
    "is_tailored": true,
    "is_geo_adjusted": true
  }
}
```

`vertical.match` ∈ `exact | alias | unmapped | unknown`; `geo.match` ∈
`exact | proxy | gap | unknown` (a `gap` carries a `reason` and forces `cpm_index: null`).
`is_tailored: false` means the report MUST NOT claim vertical specificity — the renderer's
scope line then reads "Cross-vertical — not tailored to this vertical". A `synthesis.json`
written before this block existed still renders: the renderer falls back to
`resolve(None, None)`. See `references/domain-standards.md` for the basis semantics.

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
