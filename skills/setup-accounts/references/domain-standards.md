# setup-accounts — Domain Standards

Embedded expertise for standing up a brand-new client's Meta stack. Self-contained: read this to understand *why* the skill splits the work the way it does, the exact step taxonomy, readiness rules, and asset caps. No runtime discovery required.

---

## 1. The governing law: identity is manual, structure is API

Verified against Graph API v25.0. Meta deliberately gates identity/trust behind human UI flows and only exposes structure/management to the API. Conflating the two is the #1 cause of zero-start failures.

| Half | What | Why it's here |
|------|------|---------------|
| **Manual (human-only)** | Facebook Page creation; Instagram account creation + convert to Professional; link IG ↔ Page; **business verification** (Security Center); payment method on ad account; client accepts asset-access request | No API exists (Page-create API removed years ago), or the flow is PCI/trust-gated. The skill **records** these via `--done`; it never fakes them. |
| **API-creatable** | Ad account; pixel/dataset; system user (+ token); assign assets to system user | Pure structure. The skill executes these through `createGraph()` once the manual spine + verification exist. |

**Master unlock:** business verification. Without it, `POST /{business_id}/adaccount` fails with a permissions error (100/200). Business verification + App Review for Advanced Access is a **one-time agency prerequisite** (done once across all clients), documented in `docs/agency-foundation.md`.

---

## 2. The 11 step keys (single source of truth: `schemas/client_profile.js → normalizeSetup`)

Each key is `null` (not done) or an ISO-8601 timestamp string (done). Do not invent new keys.

### Manual gates (recorded only via `--done`)
| Key | Cleared when the human has… | Typical id it produces (`--set`) |
|-----|------------------------------|----------------------------------|
| `business_verified_at` | Completed business verification in Security Center | — |
| `page_created_at` | Created the Facebook Page | `facebook_page_id` |
| `instagram_created_at` | Created the Instagram account | — |
| `instagram_professional_at` | Converted IG to a Professional account | `instagram_business_id` |
| `ig_page_linked_at` | Linked IG ↔ Page (Business Suite / IG app) | — |
| `payment_method_added_at` | Added a payment method to the ad account | — |
| `asset_access_granted_at` | Client accepted the agency's asset-access request | — |

> Only these 7 are accepted by `--done` (`MANUAL_STEPS` in `setup-accounts.js`). Passing any other key exits 1 with the valid list.

### API-creatable (stamped automatically by `--bootstrap`)
| Key | Stamped after | Id written to `accounts` |
|-----|---------------|--------------------------|
| `ad_account_created_at` | `POST /{business_id}/adaccount` succeeds | `ad_account_id` |
| `pixel_created_at` | `POST /{business_id}/adspixels` succeeds | `pixel_id` |
| `system_user_token_at` | `POST /{business_id}/system_users` succeeds | `system_user_id` |
| `assets_assigned_at` | Asset assignment loop runs | — |

> `domain_verified_at` and `landing_deployed_at` also live in the schema but are owned by `/setup-web`, not this skill.

---

## 3. Readiness rule

A profile is "ready" when `checkZeroStartPrereqs(profile, { need: ["page","ig","ad_account","pixel"] })` returns `ok: true`. That requires all four `accounts` ids to be set and non-placeholder:

- `facebook_page_id` (from `page_created_at`)
- `instagram_business_id` (from `instagram_professional_at`)
- `ad_account_id` (from `--bootstrap`)
- `pixel_id` (from `--bootstrap`)

An id counts as "set" only if it is non-null, non-empty, and does NOT match `/^<?TBD/i`. A `<TBD_...>` placeholder is treated as unset.

---

## 4. Asset caps and limits (do not exceed via API)

| Cap | Value | Beyond it |
|-----|-------|-----------|
| Ad accounts per business (API) | **5** | Create remaining accounts in Business Manager UI |
| Pixels/datasets per business | 100 | Reuse an existing dataset |
| System user assignment tasks (page) | `MANAGE, CREATE_CONTENT, MODERATE, ADVERTISE, ANALYZE` | — |
| System user assignment tasks (ad account) | `MANAGE, ADVERTISE, ANALYZE` | — |

---

## 5. Correct order (each gate unlocks the next)

```
business_verified_at  ──┐
page_created_at         │
instagram_created_at    ├─ manual spine (operator clears via --done)
instagram_professional_at
ig_page_linked_at       │
asset_access_granted_at │
payment_method_added_at ┘
        │
        ▼
   --bootstrap  → ad_account + pixel + system_user + assign assets (API)
        │
        ▼
   --status  → ready: true  → hand off to /setup-web → /capi-setup
```

---

## 6. Good vs bad operator flows

**GOOD — record the gate AND its id together**
```
$ node skills/setup-accounts/setup-accounts.js acme --done page_created_at --set facebook_page_id=102938
# setup.page_created_at stamped; accounts.facebook_page_id=102938
```

**BAD — claiming a gate the human hasn't done**
```
$ node ... acme --done business_verified_at   # but verification is still pending
# Fabricates trust state → --bootstrap will then fail with a confusing 100/200
```
Only run `--done` after the operator confirms the human step is truly complete.

**GOOD — bootstrap is idempotent**
```
$ node ... acme --bootstrap   # ad account fails (verification pending), pixel skipped
# fix verification, then:
$ node ... acme --bootstrap   # re-runs only the still-missing assets (isTbd skip)
```

**BAD — bootstrapping before business_id is set**
```
$ node ... acme --bootstrap   # accounts.business_id is null
# Halts with exit 3: "Set accounts.business_id ... first." — never guesses an id.
```
