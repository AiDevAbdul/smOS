# setup-accounts — I/O Contract

The complete CLI contract, exit codes, stdout JSON schemas, and example payloads for `setup-accounts.js`. Self-contained: read this to predict exactly what the skill consumes and emits without running it.

---

## CLI surface

```
node skills/setup-accounts/setup-accounts.js <slug> [mode]
```

| Mode | Effect |
|------|--------|
| (none) / `--status` | Print the status report (default) |
| `--done <step> [--set k=v] [--from-intake] [--force]` | Stamp a manual gate `nowIso()`; optionally set `accounts.k = v`, or resolve the id from an intake handle. Read-verified steps refuse the stamp unless `--force` |
| `--verify` | Read-verify the Page + IG↔Page link (no writes) |
| `--bootstrap` | Create the API-creatable assets + assign them |

`<slug>` is required and positional (first arg). Modes are mutually exclusive in practice; `--done` is checked before `--verify`, then `--bootstrap`, then the `--status` default.

### Read-verified gates

`ig_page_linked_at` is the one manual gate Meta can confirm, and the one whose false
stamp breaks `/publish`, `/inbox` and IG placements later. Before stamping it the
companion GETs `/{page_id}?fields=instagram_business_account{id,username}` through the
guarded chokepoint (`verifyIgPageLink` in `scripts/lib/meta_verify.js`) and:

- no linked IG on the Page → **exit 6**, nothing written;
- a *different* IG id than `accounts.instagram_business_id` → **exit 6** (`mismatch: true`);
- linked and matching → stamps `setup.ig_page_link_verified_at` and back-fills the live
  `accounts.instagram_business_id`;
- `--force` → the gate is stamped, `ig_page_link_verified_at` stays `null`, and
  `setup.ig_page_link_check.forced` records that a human overrode the check.

---

## Inputs

| Input | Source | Required for |
|-------|--------|--------------|
| `slug` | argv[0] | all modes |
| `clients/{slug}/client_profile.json` | filesystem (created by `/intake`) | all modes |
| `accounts.business_id` (a.k.a `bm_id`) | profile | `--bootstrap` |
| `META_ACCESS_TOKEN` | env (via `load-env.js`) | `--bootstrap` |
| `META_APP_SECRET` | env (optional) | enables `appsecret_proof` |
| `<step>` after `--done` | argv | `--done` |
| `k=v` after `--set` | argv | optional with `--done` |

---

## Exit codes

| Code | Cause |
|------|-------|
| 0 | Success (any mode) |
| 1 | Missing `slug`; unknown `--done` step; uncaught fatal error |
| 2 | Profile not found (`run /intake first`) |
| 3 | `--bootstrap` without `accounts.business_id` |
| 6 | A read-verified gate failed: `--done ig_page_linked_at` with no/mismatched IG link, or `--verify` finding the Page or link bad |

A missing `META_ACCESS_TOKEN` throws "META_ACCESS_TOKEN is required" inside `createGraph()`, caught by the top-level handler → exit 1.

---

## Output schemas (stdout JSON)

### `--status`
```jsonc
{
  "slug": "acme",
  "manual_gates": [
    { "step": "business_verified_at", "done": true,  "at": "2026-06-20T10:00:00.000Z" },
    { "step": "page_created_at",       "done": false, "at": null }
    // ... all 7 MANUAL_STEPS, in MANUAL_STEPS order
  ],
  "api_assets": {
    "ad_account_id": "act_123", "pixel_id": "456",
    "system_user_id": "789",    "business_id": "555"
  },
  "ready": false,                       // checkZeroStartPrereqs ok
  "blocking": [                          // empty when ready:true
    { "asset": "pixel", "label": "Meta pixel/dataset", "fix": "run /setup-accounts ..." }
  ]
}
```

### `--done <step> [--set k=v]`
```jsonc
{
  "slug": "acme",
  "recorded": "page_created_at",
  "at": "2026-06-22T12:00:00.000Z",
  "resolved_from_intake": null,          // set when --from-intake resolved the id
  "verified": null,                      // true/false for a read-verified step, else null
  "warning": null,                       // "RECORDED UNVERIFIED (--force): …" when forced
  "accounts": { /* full normalized accounts block, incl. the --set id */ }
}
```

### `--verify`
```jsonc
{
  "slug": "acme",
  "page": { "ok": true, "page_id": "102938", "name": "Acme Co", "reason": null },
  "ig_page_link": {
    "ok": true, "page_id": "102938", "instagram_business_id": "204857",
    "username": "acmeco", "mismatch": false,
    "recorded_instagram_business_id": "204857", "reason": null
  }
}
```
Exits 6 if either check fails (the `reason` says what to fix).

### `--bootstrap`
```jsonc
{
  "slug": "acme",
  "created": {                           // only keys actually created this run
    "ad_account_id": "act_123",
    "pixel_id": "456",
    "system_user_id": "789"
  },
  "errors": [                            // per-step failures; [] on full success
    "ad_account: Meta API 200: ... (type=OAuthException, trace=Abc123)"
  ],
  "next": "Resolve errors (likely Advanced Access / verification — see docs/agency-foundation.md), then re-run --bootstrap"
}
```
On full success, `next` = "Run --status to confirm readiness, then /setup-web + /capi-setup".

---

## Persisted file: `client_profile.json` (the parts this skill writes)

```jsonc
{
  "slug": "acme",
  "name": "Acme Co",
  "accounts": {
    "business_id": "555",
    "facebook_page_id": "102938",        // from --done --set
    "instagram_business_id": "204857",   // from --done --set
    "ad_account_id": "act_123",          // from --bootstrap
    "pixel_id": "456",                   // from --bootstrap
    "system_user_id": "789",             // from --bootstrap
    "currency": "USD"
  },
  "setup": {
    "business_verified_at": "2026-06-20T10:00:00.000Z",
    "page_created_at": "2026-06-21T09:00:00.000Z",
    "instagram_created_at": null,
    "instagram_professional_at": null,
    "ig_page_linked_at": null,
    "payment_method_added_at": null,
    "asset_access_granted_at": null,
    "ad_account_created_at": "2026-06-22T12:00:00.000Z",
    "pixel_created_at": "2026-06-22T12:00:01.000Z",
    "system_user_token_at": "2026-06-22T12:00:02.000Z",
    "assets_assigned_at": "2026-06-22T12:00:03.000Z",
    "ig_page_link_verified_at": null,    // non-null = smOS read the link itself
    "ig_page_link_check": null           // last verification result (incl. `forced`)
  }
}
```
The file is always saved through `clientProfile.normalize(...)`, so legacy aliases (`page_id`, `ig_account_id`, `bm_id`) stay mirrored and every `setup` key is always present (null when not done).

---

## Edge cases

| Case | Behavior |
|------|----------|
| `--done` with no step arg | Falls through to `MANUAL_STEPS.includes(undefined)` → unknown step → exit 1 |
| `--set` with malformed value (no `=`) | Split yields no `v`; assignment skipped (gate still recorded) |
| `--set` an id whose key is a legacy alias | Stored as-given; `normalize()` mirrors canonical/alias on save |
| `--bootstrap` re-run after partial success | `isTbd` skips already-created ids; only missing assets are attempted |
| Asset-assignment target id unset | That assignment is skipped (page or ad account); not an error |
| System user create fails | `system_user_id` stays unset → assignment block is skipped entirely |
| Pixel already present, ad account missing | Only ad account is created this run |
| Token expired mid-bootstrap | `TokenExpiredError` propagates → fatal exit 1 (re-auth, then re-run) |
| `--done ig_page_linked_at` with no `facebook_page_id` on record | Verification halts before any API call: exit 6, "record the Page gate first" |
| `--done ig_page_linked_at` while the Graph call itself fails (token/permission) | Treated as unverified → exit 6 with the Graph error as the reason (never stamped on an error) |

---

**Last verified:** 2026-06-22 against `setup-accounts.js` and `schemas/client_profile.js`.
