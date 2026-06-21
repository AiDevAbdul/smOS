---
name: setup-accounts
description: Use this skill when a zero-start client has no Meta presence yet and needs Page / Instagram / ad account / pixel stood up (typically via `/setup-accounts {slug}`). Drives the manual gates with an interactive checklist (Page creation, IG creation, verification, payment, access grants) and auto-creates the API-creatable assets (ad account, pixel, system-user token, asset assignment), writing every id back into client_profile.json. This is what unblocks /audit, /audience-map, /launch, /publish for a brand-new business.
---

# /setup-accounts — Meta Account Bootstrap (Phase 0 · setup track)

The hard truth (verified against Graph API v25.0): **identity/trust is manual; structure/management is API.** This skill does both halves — it *guides* the human through the manual gates and *executes* the API-creatable parts, recording state in `client_profile.json → setup` and the resulting ids in `accounts`.

## The split

**Manual gates (human-only — the skill instructs + records, never fakes):**
1. Facebook **Page** creation (the create-Page API was removed years ago)
2. Instagram account creation + **convert to Professional**
3. **Link IG ↔ Page** (Business Suite / IG app)
4. **Business verification** (Security Center) — the master unlock for API ad-account creation
5. **Payment method** on the ad account (no API — PCI-gated)
6. Client **accepts your asset-access request** in their Business Manager

**API-creatable (smOS does these once the manual spine + verification exist):**
7. Create **ad account** — `POST /{business_id}/adaccount`
8. Create **pixel/dataset** — `POST /{business_id}/adspixels`
9. Create **system user** + non-expiring **token** — `POST /{business_id}/system_users` → `/access_tokens`
10. **Assign assets** (page, IG, ad account, pixel) to the system user

> Agency one-time prerequisite: business verification + App Review for Advanced Access on `ads_management`/`business_management`/`pages_*`/`instagram_*`. See `docs/agency-foundation.md`. Without it, step 7 fails.

## Required Context

- `clients/{slug}/client_profile.json` — needs `accounts.business_id` (the client's Business Portfolio id); the manual gates produce `facebook_page_id` + `instagram_business_id`
- `META_ACCESS_TOKEN` (agency system token with Advanced Access) for the API half

## Workflow

1. **Show status** — what's done, what's blocking:
   ```
   node skills/setup-accounts/setup-accounts.js {slug} --status
   ```
2. **Walk the manual gates** one at a time. After the human completes each, record it (and the id it produced):
   ```
   node skills/setup-accounts/setup-accounts.js {slug} --done page_created_at --set facebook_page_id=1234567890
   node skills/setup-accounts/setup-accounts.js {slug} --done business_verified_at
   ```
   Use the exact step keys from `schemas/client_profile.js → normalizeSetup` (page_created_at, instagram_created_at, instagram_professional_at, ig_page_linked_at, payment_method_added_at, asset_access_granted_at, business_verified_at).
3. **Bootstrap the API half** once `business_id` + verification are in place:
   ```
   node skills/setup-accounts/setup-accounts.js {slug} --bootstrap
   ```
   Creates ad account + pixel (+ optionally system user/token), assigns assets, and writes `ad_account_id`, `pixel_id`, `system_user_id` back to the profile with timestamps.
4. **Re-run `--status`** to confirm the profile now passes `checkZeroStartPrereqs`.

## Output

- Updated `clients/{slug}/client_profile.json` (`accounts` ids + `setup` timestamps)

## Safety

- The API half is **fail-closed via the existing guard chokepoint** — every write goes through `scripts/lib/meta-graph.js`. A missing token surfaces as `TokenExpiredError`, not a silent skip.
- Manual gates are recorded only on an explicit `--done` from the operator — the skill never assumes a human step happened.
- New ad account / pixel are created but **nothing is activated** — consistent with the constitution's PAUSED-by-default rule.

## Error Handling

- `--bootstrap` without `accounts.business_id` → halt: "Set accounts.business_id (the client's Business Portfolio id) first."
- Ad-account creation error 100/200 (permissions) → almost always missing Advanced Access or business verification; surface the fbtrace_id and point to `docs/agency-foundation.md`.
- Hard API cap: 5 ad accounts per business via API — beyond that is manual UI; the skill surfaces this.
