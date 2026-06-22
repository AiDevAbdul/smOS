# before-after — I/O Contract

Full input/output contract for `skills/before-after/before-after.js`. Readable standalone.

## Invocation

```bash
node skills/before-after/before-after.js <client_slug>
```

One positional arg. No flags. `<client_slug>` maps to `clients/<slug>/`.

## Inputs

### `clients/{slug}/client_profile.json` (via `schemas/client_profile.js`)
Used fields:
```jsonc
{
  "name": "Acme Co",
  "accounts": {
    "facebook_page_id": "1234567890",
    "instagram_business_id": "1789...",
    "ad_account_id": "act_111",   // "act_" prefix normalized by graph.act()
    "pixel_id": "999..."          // optional; "—" if TBD
  }
}
```
Any account ID that is TBD/placeholder (`isTbd`) → that surface is skipped, rows render "—".

### `clients/{slug}/baseline_snapshot.json` (via `schemas/baseline_snapshot.js`)
Normalized, then `validate(obj, {requireLock:true})`. Required to pass:
- `immutable_locked_at` — non-empty string (the freeze).
- `facebook.engagement_rate_30d` — finite number.
- `facebook.posts_per_week_30d` — finite number.

Field map (normalize resolves audit's older names):
```jsonc
{
  "snapshot_date": "2026-01-15",
  "immutable_locked_at": "2026-01-15T09:00:00Z",
  "facebook": {
    "followers": 4200,
    "engagement_rate_30d": 1.8,      // ← avg_engagement_rate aliased
    "posts_per_week_30d": 2.0,        // ← posts_per_week aliased
    "page_completeness_pct": 78
  },
  "instagram": { "followers": 0 },
  "creative_quality": { "score_out_of_10": 6 },  // ← score / creative_quality_score aliased
  "paid": {
    "monthly_ad_spend": 0,
    "cost_per_lead": null,
    "roas": null,
    "pixel_events_per_month": 0       // ← pixel_events_per_month aliased
  }
}
```

### Environment (via `scripts/lib/load-env.js`)
`META_ACCESS_TOKEN` (required for live pull), `META_APP_SECRET` (optional → `appsecret_proof`).

## Outputs

Written to `clients/{slug}/reports/`:

| File | Contents |
|------|----------|
| `{YYYY-MM-DD}_before_after.md` | Filled `templates/before-after.md` |
| `{YYYY-MM-DD}_before_after.html` | HTML render (via `writeHtmlAndPdf`) |
| `{YYYY-MM-DD}_before_after.pdf` | PDF (best-effort; skipped if Playwright absent) |
| `{YYYY-MM-DD}_before_after_raw.json` | Machine-readable deltas (below) |

### `_raw.json` schema
```jsonc
{
  "slug": "acme",
  "baseline_date": "2026-01-15",
  "current_date": "2026-06-22",
  "baseline": { "fb_followers": 4200, "engagement_rate": 1.8, "cpl": null, "...": "..." },
  "current":  { "fb_followers": 5100, "engagement_rate": 2.6, "cpl": 28.0, "...": "..." },
  "deltas": {
    "fb_followers": { "change": 900, "pct": 21.4, "direction": "up", "arrow": "↑", "color": "green" },
    "cpl":          { "change": -14, "pct": -33.3, "direction": "down", "arrow": "↓", "color": "green" }
  },
  "headline": "In 158 days since the 2026-01-15 baseline, Acme Co grew Facebook followers by +21.4%..."
}
```

### stdout JSON (for the orchestrator)
```jsonc
{
  "slug": "acme",
  "baseline_date": "2026-01-15",
  "current_date": "2026-06-22",
  "days_since_baseline": 158,
  "md_path": "clients/acme/reports/2026-06-22_before_after.md",
  "raw_path": "clients/acme/reports/2026-06-22_before_after_raw.json",
  "headline": "...",
  "deltas_summary": { "fb_followers": "21.4%", "cpl": "-33.3%", "content_score": "new" }
}
```
Progress logs (`[before-after] ...`) go to **stderr**; stdout is the JSON only.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (report written) |
| 1 | No `<slug>` arg → usage; or FATAL uncaught error |
| 2 | `client_profile.json` not found |
| 3 | `baseline_snapshot.json` not found → run `/audit` first |
| 4 | Baseline invalid/unlocked → re-`/audit`, re-lock |

## Edge cases

- **Baseline 0 / null** → metric `direction:"new"`, `pct:null`; never divide by zero.
- **Surface skipped** (`isTbd`) → `{skipped:true}`; rows "—".
- **API failure on one surface** → `.catch` returns `{error}`/`[]`; report continues, that surface "—".
- **Content score** → always "—"/`_(run /audit-creative)_` (current value is `null` by design).
- **PDF render fails** → `pdfOk=false`, HTML kept, log "(PDF skipped)", exit 0.
- **Narrative slots** (`organic/paid/creative/optimization_summary`) → ship as `_(Claude to fill)_`; the agent fills them post-run from real data.

**Last verified:** 2026-06-22
