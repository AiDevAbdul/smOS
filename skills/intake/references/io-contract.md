# Intake — I/O Contract

Full input/output contract for `skills/intake/intake.js`: the CLI surface, exit codes,
the `intake_answers.json` and `client_profile.json` schemas, the stdout status object, and
edge cases. Consult this when scripting intake, debugging a validation failure, or wiring a
downstream consumer to the profile.

---

## 1. CLI surface

```
node skills/intake/intake.js init  <slug>                  # scaffold clients/<slug>/intake_answers.json
node skills/intake/intake.js build <slug>                  # build from clients/<slug>/intake_answers.json
node skills/intake/intake.js build <slug> --answers <PATH> # build from a non-default answers file
```

`<slug>` is re-slugified internally (lowercase, hyphen-collapsed), so a name passes through cleanly.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | success (JSON status printed to stdout) |
| `1` | usage error (no mode) or fatal exception (`[intake] FATAL: <msg>`) |
| `2` | `init` aborted — answers file already exists (do not overwrite) |
| `3` | `build` validation failed — stderr lists `missing:<field>` lines |

`build` throws (exit 1) when the answers file is absent (`Answers file not found: <path>`).

---

## 2. `intake_answers.json` (input) schema

Scaffolded blank by `init`, filled during the Q&A. Shape:

```json
{
  "slug": "uppal-pharma",
  "name": "Uppal Pharma",
  "business": {
    "product_description": "B2B compounding-pharmacy SaaS",
    "price_low": 300, "price_high": 1200,
    "business_model": "B2B", "usp": "Only HIPAA-native compounding workflow",
    "conversion_event": "lead"
  },
  "audience": {
    "age_low": 30, "age_high": 55, "gender": "all",
    "geo_targets": ["US"], "pain_points": ["manual batch records", "audit risk"]
  },
  "voice": { "tone": "professional", "restricted_words": ["cheap"], "cta_style": "Learn more" },
  "accounts": {
    "ad_account_id": "act_123456789", "pixel_id": "987654321",
    "facebook_page_id": "111", "instagram_business_id": "222",
    "page_id": "111", "ig_account_id": "222", "bm_id": "333",
    "currency": null, "timezone": null
  },
  "kpis": { "target_cpa": 80, "target_roas": null, "monthly_budget_low": 5000, "monthly_budget_high": 12000 },
  "history": { "previous_spend": 40000, "what_worked": "lead-gen carousels", "what_failed": "broad awareness" },
  "competitors": ["compounder-a.com", "compounder-b.com"],
  "assets": { "formats_available": ["product photos", "video"], "brand_guidelines_url": null, "brand_colors": ["#0A3D62"] },
  "approvals": { "channel": "discord", "daily_cap": 500, "extra_rules": ["auto-pause underperformers"] }
}
```

### Validation (`validateAnswers`)

Required top-level: `name`, `business`, `audience`, `voice`, `accounts`, `kpis`, `approvals`.
Required `business.*`: `product_description`, `business_model`, `usp`.
Required `accounts.*`: `ad_account_id` — **only for established clients** (skipped when `isZeroStart`).
A failed required field emits `missing:<path>` to stderr and exits `3`. Unset optional fields stay `null`/`[]`.

---

## 3. `client_profile.json` (output) schema

`build` writes `answers` plus derived fields, then runs it through
`schemas/client_profile.js → normalize()` (backfills canonical IDs + mirrors legacy aliases).

Added by `buildProfile`:

```jsonc
{
  // ...all answers fields, with accounts normalized...
  "status": "active",            // "planning" for zero-start
  "onboarded_at": "2026-06-22",
  "blockers_before_live": [],    // zero-start only: e.g. ["ad_account_id","pixel_id"]
  "accounts": {
    "ad_account_id": "act_123456789", "pixel_id": "987654321",
    "facebook_page_id": "111", "instagram_business_id": "222",
    "page_id": "111", "ig_account_id": "222",      // mirrored aliases
    "bm_id": "333", "business_id": "333",
    "currency": "USD", "timezone": "America/New_York",  // detected from Meta when real
    "ad_account_status": 1, "ad_account_name": "Uppal Pharma Ads",
    "pixel_installed": false, "website_url": null, "domain": null
  }
}
```

Canonical ID source of truth: `facebook_page_id`, `instagram_business_id`, `ad_account_id`,
`pixel_id`. Downstream consumers (audit, audience-map, launch, before-after, publish, leads)
read the canonical names; the mirrored aliases exist only for transitional readers.

---

## 4. stdout status object (output)

`build` prints (for the orchestrating skill to read):

```json
{
  "mode": "build",
  "slug": "uppal-pharma",
  "status": "active",
  "zero_start": false,
  "blockers_before_live": [],
  "profile_path": "/.../clients/uppal-pharma/client_profile.json",
  "claude_md_path": "/.../clients/uppal-pharma/CLAUDE.md",
  "prospect_archived": "/.../clients/uppal-pharma/baseline/pre_audit.html",
  "prospect_hydrated_fields": ["name", "accounts.facebook_page_id"],
  "account_meta_detected": { "currency": "USD", "timezone": "America/New_York" },
  "skipped_fields": ["assets.brand_guidelines_url", "kpis.target_roas"],
  "next": "run /audit to pull baseline state of accounts"
}
```

`init` prints `{ mode, slug, answers_file, hydrated, hydrated_fields }`.

---

## 5. Edge cases

| Case | Behavior |
|---|---|
| Re-run `build` | Existing `client_profile.json` backed up to `client_profile.backup.<epoch>.json`, then overwritten. Hydration is idempotent. |
| `ad_account_id` = `TBD_...` | Treated as not-real by `isTbd`; no Meta call; counts toward zero-start detection. |
| Bare numeric ad account | Normalized to `act_<id>` before the Graph call. |
| Meta detection throws | WARN logged; currency/timezone fall back to provided → `USD`/`UTC`. |
| All answers blank except required | Builds; `skipped_fields` lists everything null/empty; surface the list to the user. |
| Template var unfilled | `client-claude.md` renders `_<field>_TBD_` so gaps are visible, not silent. |
| Zero-start | `status: planning`, `blockers_before_live` populated, `next` routes to Phase 0. |

---

## 6. Keeping current

Owner: the `/intake` skill. This contract describes `intake.js` and `schemas/client_profile.js`
directly, so refresh it on any code change:

- CLI surface / exit codes — re-check `main()` in `intake.js`.
- `intake_answers.json` shape — re-check `blankAnswers()`.
- Profile additions — re-check `buildProfile()` and `normalizeAccounts()`.
- stdout status object — re-check the `console.log` payloads in `init` and `build`.

**Last verified:** 2026-06-22
