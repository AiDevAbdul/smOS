# /launch — I/O Contract

Full input/output contract for `skills/launch/launch.js`. Each schema is independently
readable. Canonical schema modules live in `schemas/` (`launch_plan.js`, `strategy_brief.js`,
`ad_copy.js`, `audience_map.js`, `client_profile.js`) — every input is `normalize()`d on read.

## CLI

```
node skills/launch/launch.js <slug> [--execute] [--phase A|B|C] [--create-audiences]
```

| Flag | Effect | Default |
|------|--------|---------|
| `<slug>` | Client dir under `clients/<slug>/` | required (exit 1 if missing) |
| `--execute` | Create entities on Meta; without it, DRY RUN only | off (dry run) |
| `--phase A\|B\|C` | Filter brief to one phase | first/live phase |
| `--create-audiences` | Create missing RT/LAL custom audiences (consequential write) | off (lookup only) |

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (dry run plan written, or execute completed) |
| 1 | No slug given, or fatal/uncaught error |
| 2 | Missing handoff input(s) — names the file + producing skill |
| 3 | `--execute` but brief `approval.status` ≠ `approved` |
| 4 | `--execute` but `accounts.ad_account_id` is TBD |
| 5 | `--execute` but naming violations exist |
| 6 | `--execute` but launch_plan not executable (null copy / `<TBD_>` audience) |

## Inputs (read from `clients/<slug>/`)

- `client_profile.json` — uses `accounts.{ad_account_id, pixel_id, facebook_page_id, instagram_business_id, website}`, `location.country`, `audience.{geo_targets, age_range}`, `business.conversion_events`.
- `strategy_brief.json` — `approval.status`, `objective_hierarchy[].{phase,objective}`, `audience_priority[].{id,source}`, `budget_allocation.adsets[].{audience_id, daily_budget}`, `creative_angles[].{name, format, image_*/video_*/asset}`.
- `audience_map.json` — `age_gender`, `geo`, `clusters[]`, `retargeting_layers[]`, `lookalikes[]`/`lookalike`, `resolved_audiences{}`.
- `ad_copy.json` — consumed via `adCopy.selectTopCopy(angle, adCopy)` → `{copy_used, reason}`.

Env (execute only): `META_ACCESS_TOKEN` (required), `META_APP_SECRET` (for appsecret_proof).

## Outputs

### `launch_plan.json` (always written)
```json
{
  "slug": "acme",
  "generated_at": "2026-06-22T10:00:00.000Z",
  "mode": "DRY_RUN",
  "live_phase": { "phase": "A", "objective": "OUTCOME_SALES" },
  "deferred_phases": [ { "phase": "B", "objective": "OUTCOME_TRAFFIC" } ],
  "naming_issues": [],
  "campaigns": [
    {
      "audience_id": "LAL1PCT",
      "phase": "A",
      "payload": { "name": "CONV_LAL1PCT_202606", "objective": "OUTCOME_SALES",
                   "status": "PAUSED", "daily_budget": "5000", "special_ad_categories": [] },
      "adsets": [
        {
          "payload": { "name": "FEED_2545_LAL1PCT", "status": "PAUSED",
                       "daily_budget": "5000", "billing_event": "IMPRESSIONS",
                       "optimization_goal": "OFFSITE_CONVERSIONS",
                       "targeting": { "age_min": 25, "age_max": 45,
                                      "custom_audiences": [{ "id": "120330..." }] },
                       "attribution_spec": [ { "event_type": "CLICK_THROUGH", "window_days": 7 },
                                             { "event_type": "VIEW_THROUGH", "window_days": 1 } ] },
          "ads": [
            { "name": "IMG_PAIN_v1", "angle": "PAIN", "format": "single_image",
              "asset": { "image_url": "https://cdn/acme/pain.jpg" },
              "copy_used": { "primary_text": "...", "headline": "...", "cta": "SHOP_NOW" },
              "warnings": [] }
          ]
        }
      ]
    }
  ]
}
```

### `campaign_log.json` (written on `--execute`)
```json
{
  "slug": "acme", "generated_at": "2026-06-22T10:05:00.000Z", "brief_phase": "A",
  "created": {
    "campaigns": [ { "id": "238...", "name": "CONV_LAL1PCT_202606" } ],
    "adsets":    [ { "id": "238...", "name": "FEED_2545_LAL1PCT", "campaign_id": "238..." } ],
    "ads":       [ { "id": "238...", "name": "IMG_PAIN_v1", "adset_id": "238...", "creative_id": "238..." } ],
    "errors":    [ ]
  },
  "next": "reply 'activate' in Discord to set PAUSED → ACTIVE"
}
```

### stdout summary (machine-readable)
```json
{ "slug": "acme", "mode": "EXECUTE", "phase": "A", "objective": "OUTCOME_SALES",
  "campaigns_planned": 1, "adsets_planned": 1, "ads_planned": 1, "naming_issues": 0,
  "created": { "campaigns": 1, "adsets": 1, "ads": 0, "errors": 1 },
  "next": "review campaign_log.json errors" }
```
stderr carries `[launch] …` progress, resolution counts, and gate messages.

## Validation gate (`schemas/launch_plan.js`)

`normalize()` flattens the nested `campaigns[].adsets[].ads[]` tree into top-level `adsets`
and `ads` arrays. `validate(plan, {requireExecutable:true})` returns `{ok, errors[]}` and
fails when: `ads` is empty; any ad has `copy_used` null/non-object or with no
`primary_text`/`headline`; any adset's `custom_audiences`/`excluded_custom_audiences`
contains an id matching `/<?TBD[_>]/i`.

## Edge cases

- **Audience without budget allocation** → that audience is skipped (no campaign built).
- **No asset on an angle** → link-only creative; Meta pulls the URL's OG image.
- **Asset upload fails** → `{stage:"asset"}` error recorded, ad proceeds link-only, siblings continue.
- **Campaign create fails** → its child adsets/ads are not attempted; logged under `errors`.
- **Audience resolution throws** → warned, continues; the executable gate catches leftover `<TBD_>`.
- **Dry-run with unresolved plan** → exit 0, but stderr states plan is NOT executable.
- **`resolved_audiences` already present** → resolution skipped; existing map reused.

**Last verified:** 2026-06-22
