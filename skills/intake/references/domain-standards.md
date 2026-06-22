# Intake — Domain Standards

Self-contained reference for the embedded onboarding expertise: slug rules, the
9-group Q&A taxonomy and how each answer maps into the profile, KPI defaults,
established-vs-zero-start routing, and good/bad examples. Read this when running
the Q&A or deciding how to classify a client.

---

## 1. Slug rule (CONSTANT)

The slug is the primary key for `clients/{slug}/` and the Supabase `clients` row.
Derive it deterministically from the business name (`slugify` in `intake.js`):

- Lowercase everything.
- Replace any run of non-`[a-z0-9]` characters with a single hyphen.
- Trim leading/trailing hyphens.

| Business name | Slug |
|---|---|
| `Uppal Pharma` | `uppal-pharma` |
| `J&J Fitness Co.` | `j-j-fitness-co` |
| `  ACME   2024 ` | `acme-2024` |

Confirm the derived slug with the user before writing files — it is hard to change later
because every downstream artifact path embeds it.

---

## 2. The 9-group Q&A taxonomy (CONSTANT)

Ask one question at a time, group by group, from `templates/intake-questions.md`. Never
batch all groups — batching produces shallow answers. On an ambiguous answer, ask exactly
one clarifying follow-up, then move on. Map answers to these `intake_answers.json` slots:

| # | Group | Profile slots filled |
|---|---|---|
| 1 | Business Basics | `name`, `business.product_description`, `business.price_low/high`, `business.business_model`, `business.usp` |
| 2 | Target Audience | `audience.age_low/high`, `audience.gender`, `audience.geo_targets[]`, `audience.pain_points[]` |
| 3 | Brand Voice | `voice.tone`, `voice.restricted_words[]`, `voice.cta_style` |
| 4 | Accounts & Access | `accounts.ad_account_id`, `pixel_id`, `facebook_page_id`, `instagram_business_id`, `bm_id` |
| 5 | KPI Targets | `kpis.target_cpa`, `target_roas`, `monthly_budget_low/high`, `business.conversion_event` |
| 6 | History | `history.previous_spend`, `what_worked`, `what_failed` |
| 7 | Competitive Context | `competitors[]` (top 3) |
| 8 | Assets | `assets.formats_available[]`, `brand_guidelines_url`, `brand_colors[]` |
| 9 | Approval Preferences | `approvals.channel`, `approvals.daily_cap`, `approvals.extra_rules[]` |

**Field-format notes**
- `business_model`: one of DTC, B2B, lead-gen, e-commerce, service-based, subscription.
- `gender`: `all` / `male` / `female`.
- `ad_account_id`: Meta format `act_<digits>`. Accept a bare numeric and prepend `act_`.
- `conversion_event`: purchase, lead, call, signup, add_to_cart, etc.
- `restricted_words`: words that must NEVER appear in ad copy (enforced later by the
  brand-compliance guard) — e.g. `cheap`, `guaranteed`, competitor names.
- `daily_cap`: default `500` (the global no-auto-action ceiling) unless the user overrides.
- `approvals.channel`: default `discord`.

---

## 3. KPI defaults (CONSTANT — inherited when the user gives none)

When the user does not specify a threshold, the generated `CLAUDE.md` inherits the global
defaults from the root constitution (`CLAUDE.md` → *Global KPI Thresholds*). Do NOT bake
these numbers into `client_profile.json`; let the template carry them:

| Metric | Pause threshold | Scale threshold |
|---|---|---|
| CPA | `> 3× target` after `$50` spend | N/A |
| ROAS | `< 1.0` after `$100` spend | `> 3.0` for 3 consecutive days |
| CTR | `< 0.5%` after `$30` spend | N/A |
| Frequency | `> 4.0` in a 7-day window | N/A |
| New-campaign auto-launch cap | `$200/day` (above → approval) | N/A |

`intake.js → buildTemplateVars()` derives `PAUSE_CPA = target_cpa × 3` when a target exists,
else writes the literal string `"3× target"`.

---

## 4. Established vs zero-start routing (CONSTANT)

`isZeroStart(answers)` returns true when **none** of `ad_account_id`, `facebook_page_id`,
`pixel_id` is a real value (all null or `TBD*`, per `isTbd`).

| Class | Detection | `status` | Extra fields | Next step |
|---|---|---|---|---|
| **Established** | has a real `ad_account_id` (+ usually page/pixel) | `active` | — | `/audit` to pull the baseline |
| **Zero-start** | no real ad acct **and** no real page **and** no real pixel | `planning` | `blockers_before_live[]` listing the missing IDs | Phase 0: `/brand-strategy` → `/brand-name` → `/brand-visual` → `/brand-book` → `/brand-social` → `/setup-accounts` → `/setup-web`, then `/audit` |

Zero-start clients must NOT be blocked on missing account IDs — Phase 0 creates them.
`checkZeroStartPrereqs(profile, {need:[...]})` is called to describe what is still missing
and how to fix each item, but it does not halt the build.

---

## 5. Pre-audit hydration (reduce re-asking)

If `/pre-audit` ran for this prospect, `prospects/{slug}/page_audit.json` exists.
`hydrateFromProspect()` pre-fills (only when the slot is still empty): `name`,
`business.product_description` (from `about`), `accounts.facebook_page_id`,
`accounts.instagram_business_id`, `competitors[]` (first 3), `audience.geo_targets`
(from `country`). Confirm these in one batch instead of re-asking. On `build`, the prospect's
`pre_audit.html` is copied to `clients/{slug}/baseline/pre_audit.html` for the before/after trail.

---

## 6. Good vs bad intake examples

**Good — one question, parsed, then next**
> Q (Group 1): "What's the business name, and what does it sell?"
> A: "Uppal Pharma — we sell a B2B compounding-pharmacy SaaS, $300–$1,200/mo."
> → `name: "Uppal Pharma"`, `business.product_description: "...compounding-pharmacy SaaS"`,
>   `price_low: 300`, `price_high: 1200`, `business_model: "B2B"` (subscription). Confirm model, then Group 2.

**Bad — batching + guessing**
> "Give me your name, audience, voice, accounts, KPIs, history, competitors, assets, and approvals."
> (Dumps 9 groups; answers are shallow.) Then inventing `target_cpa: 25` the user never stated.
> Correct behavior: ask group-by-group; leave unstated KPIs `null` and inherit global defaults.

**Bad — blocking a zero-start client**
> Refusing to finish intake because `ad_account_id` is empty for a brand-new business.
> Correct: classify as zero-start, `status: planning`, list blockers, route to Phase 0.

---

## 7. Keeping current

Owner: the `/intake` skill. These standards mirror code, not external policy, so refresh them
whenever the source changes:

- Slug rule — re-check `slugify()` in `intake.js` if the regex changes.
- Q&A taxonomy — re-sync the group table against `templates/intake-questions.md`.
- KPI defaults — re-sync against root `CLAUDE.md` → *Global KPI Thresholds* and
  `buildTemplateVars()` in `intake.js`.
- Zero-start logic — re-check `isZeroStart()` and `checkZeroStartPrereqs()`.

**Last verified:** 2026-06-22
