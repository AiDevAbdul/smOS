# /research — I/O Contract

Full input/output contract for `skills/research/research.js`. Read this when wiring
`/research` into a chain, validating output, or debugging the `competitor_intel.json`
shape. Self-contained.

## CLI Contract

```
node skills/research/research.js <slug> [--days N] [--country CC] [--skip-classify]
```

| Arg / flag | Required | Default | Meaning |
|------------|----------|---------|---------|
| `<slug>` | yes | — | Client slug; `clients/{slug}/client_profile.json` must exist |
| `--days N` | no | `90` | Ad Library lookback window |
| `--country CC` | no | first `geo_targets`, else profile country, else `US` | ISO-3166-1 alpha-2 |
| `--skip-classify` | no | off | Skip the LLM angle taxonomy pass (`classifier.py`) |

Exit non-zero on: missing profile, `competitors.length < 2`, zero resolved page IDs, or a
fatal failure in `client.py` / `analyzer.py` / `report.py`.

## Inputs

- `clients/{slug}/client_profile.json` — reads `competitors[]` (strings or `{name,page_id}`), `audience.geo_targets[]`, `location.country`, `business.usp`.
- `META_ACCESS_TOKEN` — loaded via `loadEnv()`; required by `createGraph()`.
- Prior `clients/{slug}/reports/analyzed_*.json` — auto-detected for the diff pass (newest non-current wins).

## Primary Output: `clients/{slug}/competitor_intel.json`

Produced by `competitorSchema.normalize(...)` in `schemas/competitor_intel.js`. The
**actual** top-level shape (there is NO `format_mix` and NO `top_angles` field):

```json
{
  "client_slug": "acme",
  "generated_at": "2026-06-22T14:03:00.000Z",
  "country": "US",
  "days_window": 90,
  "competitors": [
    {
      "name": "Rival Co",
      "page_id": "123456789012345",
      "status": "active",
      "angles": [ { "angle": "social_proof", "frequency": 12, "fit_for_client": null, "use_for": [], "notes": "" } ]
    }
  ],
  "angles": [
    { "angle": "social_proof", "frequency": null, "fit_for_client": null, "use_for": [], "notes": "" }
  ],
  "gaps": [
    { "type": "angle", "observation": "...", "recommended_angle": "..." }
  ],
  "artifacts": {
    "raw": "clients/acme/reports/raw_<ts>.json",
    "analyzed": "clients/acme/reports/analyzed_<ts>.json",
    "html": "clients/acme/reports/competitor_report_<ts>.html",
    "pdf": "clients/acme/reports/competitor_report_<ts>.pdf",
    "diff": "clients/acme/reports/snapshot_diff_<ts>.json"
  },
  "resolved_page_ids": [ { "name": "Rival Co", "page_id": "1234...", "ad_count_in_country": 14 } ]
}
```

### Field rules (from `normalize()`)
- **`angles`** (top-level) — array. Prefer an explicit `analyzed.angles`; otherwise **aggregate** the union of `competitors[].angles`, de-duplicated case-insensitively by `angle`. May be empty (degraded-but-valid).
- Each angle is normalized to `{ angle, frequency, fit_for_client, use_for[], notes }`. A bare string becomes `{ angle: <trimmed>, frequency: null, ... }`. Aliases `name`/`theme` map to `angle`; `fit` maps to `fit_for_client`.
- **`competitors`** — accepts `competitors` or `pages` from the analyzed file.
- **`client_slug`** — accepts `client_slug` or `slug`; else `null`.
- **`gaps`** — array, passed through.
- `generated_at`, `country`, `days_window`, `artifacts`, `resolved_page_ids` — passthrough (not reshaped).

### Validation (`validate()`)
- Object required; `angles` MUST be an array. An empty `angles` array is **valid** — strategy-brief handles the empty case with its defaults.

## Secondary Outputs

| Path | Producer | Always? |
|------|----------|---------|
| `reports/raw_<ts>.json` | `client.py` | yes |
| `reports/analyzed_<ts>.json` | `analyzer.py` | yes |
| `reports/competitor_report_<ts>.html` | `report.py` | yes |
| `reports/competitor_report_<ts>.pdf` | `render_pdf.py` | best-effort (logged if skipped) |
| `reports/snapshot_diff_<ts>.json` | `differ.py` | only when a prior `analyzed_*` exists |

## stdout Summary (machine-readable)

```json
{
  "slug": "acme",
  "competitors_resolved": 3,
  "competitors_skipped": 1,
  "days": 90,
  "country": "US",
  "intel_path": "clients/acme/competitor_intel.json",
  "html_report": "clients/acme/reports/competitor_report_<ts>.html",
  "pdf_report": "clients/acme/reports/competitor_report_<ts>.pdf",
  "diff": null,
  "gap_count": 4,
  "next": "review competitor_intel.json, then /strategy-brief"
}
```

## Edge Cases

| Case | Behavior |
|------|----------|
| Competitor name unresolved | Entry kept with `status: inactive_or_not_found`; excluded from fetch |
| All names unresolved | Fatal: "No active page IDs resolved" |
| First run (no prior snapshot) | `diff: null`, no diff file; not an error |
| `classifier.py` fails | Logged; output uses regex-derived angles |
| PDF helper missing | `pdf_report: null`; skip logged |
| Empty `angles` after normalize | Valid; downstream uses defaults |

## Downstream Consumers

- `/strategy-brief` reads `competitor_intel.angles` (NOT `top_angles`) to pick creative angles.
- `/audit-creative` may consume downloaded creatives — but those come from `creatives.py`, which this skill does not invoke.
- Supabase persistence (`reports` / `competitor_snapshots`) is a separate, optional `persist.py` step.
