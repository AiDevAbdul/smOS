# /audit — I/O Contract

Exact inputs, outputs, schemas, example payloads, and edge-case handling for `skills/audit/audit.js`. Read this when wiring a downstream consumer (`/audit-creative`, `/before-after`, `/analyze`) or debugging a malformed audit artifact.

## CLI

```
node skills/audit/audit.js <slug> [--no-paid] [--no-ig]
```

- `<slug>` (required) — client directory under `clients/`. Missing → exit **1** (usage). Profile missing → exit **2**.
- `--no-paid` — skip Pass 3 (ad account). Use for organic-only or first-time advertisers.
- `--no-ig` — skip Pass 2 (Instagram).

**Reads:** `clients/<slug>/client_profile.json` (`name`, `accounts.{facebook_page_id,instagram_business_id,ad_account_id,pixel_id,currency,timezone}`).
**Env:** `META_ACCESS_TOKEN` (required), `META_APP_SECRET` (optional) — via `scripts/lib/load-env.js`.

## Outputs

1. `clients/<slug>/audit_raw.json` — full structured result (schema below).
2. `clients/<slug>/audit_report.md` — `templates/audit-report.md` filled via `{{VAR}}` substitution; qualitative `_(Claude to fill)_` placeholders left for Claude.
3. `clients/<slug>/baseline_snapshot.json` — written ONLY if absent; normalized via `schemas/baseline_snapshot.js`.
4. **stdout** — single JSON summary object.
5. **stderr** — progress logs (`[audit] …`), not part of the contract.

### stdout summary

```json
{
  "slug": "acme",
  "health_score": 72,
  "fb_followers": 18432,
  "ig_followers": 9210,
  "total_spend": 14820.55,
  "pixel_health": "partial",
  "raw_path": "/abs/clients/acme/audit_raw.json",
  "report_path": "/abs/clients/acme/audit_report.md",
  "errors": []
}
```
`errors` collects any pass-level `.error` strings (empty array = clean run).

## `audit_raw.json` schema

```json
{
  "slug": "acme",
  "generated_at": "2026-06-22T10:00:00.000Z",
  "health_score": 72,
  "organic": {
    "facebook": {
      "page_id": "…", "page_name": "Acme",
      "followers": 18432, "followers_delta_90d": 312,
      "page_completeness": 89, "page_completeness_table": "| Field | Set |…",
      "post_count": 14, "posts_per_week": 1.6,
      "format_mix_pct": { "video": 21.4, "image": 50.0, "carousel": 14.3, "link": 7.1, "status": 7.1 },
      "avg_engagement_rate": 2.8,
      "best_post": { "id":"…","er":0.041, "reactions":120, "comments":8, "shares":3, "impressions":3100 },
      "worst_post": { "…": "…" },
      "insights_error": null
    },
    "instagram": {
      "ig_id":"…","username":"acme","followers":9210,"media_count_total":340,
      "post_count_60d":18,"posts_per_week":2.1,
      "format_mix_pct": { "reels":44.4,"image":33.3,"carousel":16.7,"video":5.6 },
      "avg_engagement_rate":3.4,"reach_28d":52000,"profile_views_28d":1820,
      "insights_error": null
    }
  },
  "paid": {
    "account_id":"act_…","account_name":"…","account_status":1,"account_age_days":540,
    "currency":"USD","timezone":"America/New_York",
    "total_spend_lifetime":14820.55,"amount_spent_to_date":14820.55,"balance":0,
    "campaign_count_total":22,"campaign_count_active":3,"campaign_count_archived":15,
    "best_cpa":18.42,"best_roas":3.1,"zombie_count":1,"naming_compliance_pct":63.6,
    "custom_audience_count":12,"custom_audience_healthy":9,"custom_audience_broken":3,
    "audience_issues":["LAL 2% Purchasers (too small)"],
    "pixel_health":"partial","pixel_stats": { "data":[{"event":"PageView","count":4120}] }
  },
  "creative": null
}
```

## `baseline_snapshot.json` schema (after `normalize`)

```json
{
  "client_slug": "acme",
  "captured_at": "2026-06-22T10:00:00.000Z",
  "immutable_locked_at": "2026-06-22T10:00:05.000Z",
  "facebook": { "...auditFacebookPage output...",
                "engagement_rate_30d": 2.8, "posts_per_week_30d": 1.6 },
  "instagram": { "...auditInstagram output...",
                 "engagement_rate_30d": 3.4, "posts_per_week_30d": 2.1 },
  "creative_quality": { "score_out_of_10": null },
  "paid": { "pixel_events_per_month": null }
}
```

- `normalize` aliases `avg_engagement_rate`→`engagement_rate_30d` and `posts_per_week`→`posts_per_week_30d` so `/before-after` reads stable field names.
- `creative_quality.score_out_of_10` and `paid.pixel_events_per_month` start `null`; `/audit-creative` and later passes fill them.
- **Lock rule:** `immutable_locked_at` is set iff `facebook` has no `error` and `avg_engagement_rate` is finite. Unlocked → `/before-after` (validate `requireLock:true`) refuses to run.

## Skipped-pass shape

Any skipped pass returns `{ "skipped": true, "reason": "<why>" }` (e.g. `"page_id is TBD"`, `"ig_business_id is TBD"`). The report and health score degrade gracefully; never emit metrics for a skipped pass.

## Template variables

`buildVars()` maps the raw data to `{{VAR}}` tokens in `templates/audit-report.md`. Numeric formatting: `fmt(n,d)` (locale, fixed decimals); `money(n)` prefixes `currency`. Unset values render `—`. Qualitative tokens (`WIN_1..3`, `ISSUE_1..3`, `NEXT_STEP_1..3`, `CREATIVE_AUDIT_SECTION`) ship as `_(Claude to fill)_` placeholders for the agent to complete from `audit_raw.json`.

## Edge cases

| Case | Behavior |
|------|----------|
| First-time advertiser (zero spend) | Paid metrics = 0; `best_cpa`/`best_roas` `null`; flag "first-time advertiser". |
| Page insights permission error | `insights_error` carries the message; follower delta = 0; surface `fbtrace_id`. |
| No custom audiences | `custom_audience_count` 0 → audience health component scores 0. |
| Pixel TBD/skipped | `pixel_stats.skipped`; `pixel_health="none"`; pixel component scores 0. |
| Existing baseline | Not overwritten; stderr notes immutability; downstream uses the existing file. |
| FB error but IG/paid OK | Audit still completes; baseline stays UNLOCKED (re-run with FB access to lock). |
