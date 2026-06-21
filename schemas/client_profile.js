// schemas/client_profile.js — canonical shape for clients/<slug>/profile.json.
// The `accounts` block is read by audit, audience-map, launch, before-after,
// publish, leads, audit-creative — and intake wrote DIFFERENT names than they read.
//
// SINGLE SOURCE OF TRUTH for IDs:
//   accounts.facebook_page_id       (intake wrote: page_id)
//   accounts.instagram_business_id  (intake wrote: ig_account_id)
//   accounts.ad_account_id, accounts.pixel_id
//
// normalize() backfills the canonical names from the legacy aliases AND keeps the
// aliases populated, so both old-name and new-name readers resolve during the
// transition. New writes go out in canonical form.

import { pick, isNonEmptyString, result } from "./_shared.js";

export function normalizeAccounts(a) {
  const acc = a || {};
  const fb = pick(acc, "facebook_page_id", "page_id");
  const ig = pick(acc, "instagram_business_id", "ig_account_id", "ig_business_id");
  return {
    ...acc,
    ad_account_id: pick(acc, "ad_account_id") ?? null,
    pixel_id: pick(acc, "pixel_id") ?? null,
    facebook_page_id: fb ?? null,
    instagram_business_id: ig ?? null,
    // keep legacy aliases mirrored so transitional readers still resolve
    page_id: fb ?? null,
    ig_account_id: ig ?? null,
    bm_id: pick(acc, "bm_id", "business_id") ?? null,
    business_id: pick(acc, "business_id", "bm_id") ?? null,
    system_user_id: pick(acc, "system_user_id") ?? null,
    currency: pick(acc, "currency") ?? null,
    timezone: pick(acc, "timezone") ?? null,
    // Phase 0 (zero-start) provenance + web — additive, default null so existing
    // established-client profiles are unaffected.
    pixel_installed: acc.pixel_installed === true,
    website_url: pick(acc, "website_url") ?? null,
    domain: pick(acc, "domain") ?? null,
  };
}

// Phase 0 setup-checklist state. /setup-accounts owns this: it records which
// manual gates the human has cleared and which API-creatable assets smOS made.
// A null step = not done yet; a string = ISO timestamp it was completed.
export function normalizeSetup(raw) {
  const s = raw || {};
  const step = (...keys) => pick(s, ...keys) ?? null;
  return {
    // manual gates (human-only — see docs/agency-foundation.md)
    business_verified_at: step("business_verified_at"),
    page_created_at: step("page_created_at"),
    instagram_created_at: step("instagram_created_at"),
    instagram_professional_at: step("instagram_professional_at"),
    ig_page_linked_at: step("ig_page_linked_at"),
    payment_method_added_at: step("payment_method_added_at"),
    asset_access_granted_at: step("asset_access_granted_at"),
    // API-creatable (smOS does these once the manual spine exists)
    ad_account_created_at: step("ad_account_created_at"),
    pixel_created_at: step("pixel_created_at"),
    system_user_token_at: step("system_user_token_at"),
    assets_assigned_at: step("assets_assigned_at"),
    domain_verified_at: step("domain_verified_at"),
    landing_deployed_at: step("landing_deployed_at"),
  };
}

export function normalize(raw) {
  const r = raw || {};
  return { ...r, accounts: normalizeAccounts(r.accounts), setup: normalizeSetup(r.setup) };
}

/** Validate the accounts needed for a LIVE launch. Pre-launch skills (intake) may
 *  legitimately have nulls, so this is opt-in via requireLive. */
export function validateAccounts(accounts, { requireLive = false } = {}) {
  const errors = [];
  const a = accounts || {};
  if (requireLive) {
    if (!isNonEmptyString(a.ad_account_id)) errors.push("accounts.ad_account_id is missing");
    if (!isNonEmptyString(a.facebook_page_id)) errors.push("accounts.facebook_page_id is missing");
  }
  // if any id is present it must be a string, not a <TBD_...> placeholder
  for (const k of ["ad_account_id", "facebook_page_id", "instagram_business_id", "pixel_id"]) {
    if (isNonEmptyString(a[k]) && /^<?TBD/i.test(a[k].trim())) {
      errors.push(`accounts.${k} is still a placeholder ('${a[k]}')`);
    }
  }
  return result(errors);
}

export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["profile is not an object"]);
  if (!isNonEmptyString(obj.slug) && !isNonEmptyString(obj.client_slug)) {
    errors.push("profile.slug is missing");
  }
  if (!obj.accounts) errors.push("profile.accounts is missing");
  return result([...errors, ...validateAccounts(obj.accounts).errors]);
}
