# bundle — I/O Contract

`/bundle` reads already-rendered HTML and writes a hub page + manifest entry. It makes
**no external calls** and re-derives nothing.

## Invocation

```
node skills/bundle/bundle.js <slug> [--only-ready]
```

- `<slug>` — required; must have `clients/{slug}/client_profile.json`.
- `--only-ready` — omit muted "In progress" steps; number only resolved phases.

## Phase manifest (curated client journey)

Resolved in this order. **First match wins** per phase; the group phase takes all matches.

| # | Phase key | Source (newest filename wins within a dir) |
|---|-----------|---------------------------------------------|
| 1 | `pre-audit` | `prospects/{slug}/pre_audit.html` → else `public/reports/{slug}/*-pre-audit.html` |
| 2 | `audit` | `clients/{slug}/reports/*_audit.html` |
| 3 | `research` | `clients/{slug}/reports/competitor_report_*.html` |
| 4 | `strategy-brief` | `clients/{slug}/strategy_brief.html` |
| 5 | `audience-map` | `clients/{slug}/audience_map.html` |
| 6 | `ad-creative` | `clients/{slug}/ad_copy.html` |
| 7 | `content-plan` | `clients/{slug}/content_plan.html` |
| 8 | `reports` *(group)* | all `clients/{slug}/reports/*_(weekly\|monthly_review\|before_after).html` — one button each, newest-first |

Pure-data artifacts (`launch_plan.json`, `content_calendar.json`, etc.) are **excluded** —
the hub links only to client-facing HTML.

## Outputs

| Path | What |
|------|------|
| `public/reports/{slug}/index.html` | The hub (the shareable link `/reports/{slug}/`) |
| `public/reports/{slug}/{NN}-{phase}.html` | Copied single-phase report (e.g. `04-strategy-brief.html`) |
| `public/reports/{slug}/{NN}-{origname}.html` | Copied group report, dated basename preserved (e.g. `08-2026-06-19_weekly.html`) |
| `public/reports/index.json` | Appended/replaced `bundle` entry (de-duped by `slug`+`type`) |

Button `href`s are **relative filenames** (hub sits in the same dir) → work both on
`file://` locally and when hosted.

### Manifest entry shape

```json
{
  "slug": "blue-rose-auto",
  "type": "bundle",
  "client": "Blue Rose Auto Care & Repair Services",
  "date": "2026-06-29",
  "url": "/reports/blue-rose-auto/",
  "generated_at": "2026-06-29T12:00:00.000Z"
}
```

## stdout summary

```json
{
  "hub": "<abs path to index.html>",
  "public_path": "/reports/{slug}/",
  "share_url": "https://smos-reports.vercel.app/reports/{slug}/",
  "included_phases": ["pre-audit","audit", ...],
  "missing_phases": ["research"],
  "files_copied": 7,
  "deploy_hint": "vercel deploy --prod   (deploy is a separate, explicit step; then share share_url)"
}
```

`share_url` base defaults to the neutral `smos-reports` Vercel project; override with
the `SMOS_REPORTS_BASE_URL` env var (e.g. a custom domain).

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Hub written |
| 2 | Usage error (no slug) |
| 3 | HALT — `clients/{slug}/client_profile.json` not found |

## Deploy (separate, explicit step)

`public/` is served per the repo's `vercel.json` (`outputDirectory: public`, `/reports/*`
routed, HTML cache headers). The repo is linked (via `.vercel/`) to one neutral project,
**`smos-reports`** — every client hub deploys there as its own path, so a single
`vercel deploy --prod` ships all clients. After review, deploy and share the `share_url`
(`https://smos-reports.vercel.app/reports/{slug}/`). The skill never auto-deploys.
