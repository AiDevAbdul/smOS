# I/O Contract — setup-web companion

The exact input/output contract of `skills/setup-web/setup-web.js`, with per-mode
JSON schemas, example payloads, the profile writeback, and edge-case behavior.
Self-contained; mirrors the code exactly.

---

## Invocation

```
node skills/setup-web/setup-web.js <slug> --register      <domain>
node skills/setup-web/setup-web.js <slug> --verify-status  <domain>
node skills/setup-web/setup-web.js <slug> --set-website     <url>
```

- `<slug>` is positional and required (arg 0).
- Exactly one mode flag must be present. `--set-website` is checked first and
  short-circuits before any Meta call (no token needed).

---

## Exit codes

| Code | Cause |
|------|-------|
| `0` | Success (JSON printed to stdout) |
| `1` | No slug, no mode flag, or `--set-website` given without a URL; or fatal error |
| `2` | `client_profile.json` not found (`run /intake first`) |
| `3` | `accounts.business_id`/`bm_id` is null or TBD (`run /setup-accounts`) |
| `4` | `--verify-status` domain not registered to the business (`run --register first`) |

---

## Mode 1 — `--register <domain>`

Calls `POST /{business_id}/owned_domains` then reads the node back.

**Output schema (stdout):**
```json
{
  "slug": "acme",
  "registered": "example.com",
  "verification_status": "pending",
  "txt_record": "facebook-domain-verification=abc123...",
  "next": "Publish the TXT record via your DNS provider's API, then --verify-status"
}
```
- `verification_status` defaults to `"pending"` if Meta omits it.
- `txt_record` is `"(fetch from Business Settings → Brand Safety → Domains)"` when
  no `verification_code` is returned.
- No profile mutation in this mode.

---

## Mode 2 — `--verify-status <domain>`

Reads `GET /{business_id}/owned_domains`, finds the matching `domain_name`.

**Output schema (stdout):**
```json
{
  "slug": "acme",
  "domain": "example.com",
  "verification_status": "verified",
  "recorded": true
}
```
- `recorded` is `true` only when `verification_status === "verified"`, in which
  case `setup.domain_verified_at` is stamped (ISO) and the profile is saved.
- If the domain is not found in the business's owned_domains → exit 4 (not JSON).

---

## Mode 3 — `--set-website <url>`

Pure profile writeback; no Meta call, no token required.

**Output schema (stdout):**
```json
{
  "slug": "acme",
  "website_url": "https://example.com",
  "domain": "example.com",
  "next": "Run /capi-setup to install/verify the pixel on this site"
}
```

**Writeback to `clients/{slug}/client_profile.json`:**
- `accounts.website_url` = the URL as given.
- `accounts.domain` = `new URL(url).hostname` with leading `www.` stripped.
  If the URL is unparseable, `domain` is left unchanged (try/catch swallows).
- `setup.landing_deployed_at` = current ISO timestamp.

---

## Profile fields touched (canonical shape)

Per `schemas/client_profile.js`, after `normalize()`:

```jsonc
{
  "accounts": {
    "business_id": "1029384756",   // read (alias: bm_id) — required for Meta modes
    "website_url": "https://example.com",  // written by --set-website
    "domain": "example.com"                // written by --set-website
  },
  "setup": {
    "domain_verified_at": "2026-06-22T10:00:00.000Z", // written by --verify-status (only if verified)
    "landing_deployed_at": "2026-06-22T09:30:00.000Z" // written by --set-website
  }
}
```
- The profile is re-`normalize()`d on save, so legacy aliases stay mirrored.
- `null` on a `setup.*` step means "not done yet".

---

## Edge cases

| Case | Behavior |
|------|----------|
| Slug missing | Usage to stderr, exit 1 |
| Profile file absent | "Profile not found … run /intake first", exit 2 |
| `business_id` null/TBD (`isTbd`) | "Set accounts.business_id first (run /setup-accounts).", exit 3 |
| `--set-website` without URL | "--set-website needs a URL", exit 1 |
| Unparseable URL in `--set-website` | `website_url` still written; `domain` left unchanged |
| Register node read fails | `.catch(() => ({}))` → status falls back to `"pending"`, txt_record falls back to Business-Settings hint |
| Domain not registered on `--verify-status` | exit 4 |
| Verification still pending | `recorded: false`, no `domain_verified_at` stamp |
| Meta token expired (190/102/463/467) | `TokenExpiredError` from `meta-graph.js`; fatal, exit 1 — re-auth required |
| Transient Meta/HTTP/network error | Auto-retried (≤4×) with backoff before surfacing |
| No mode flag at all | "Provide one of --register, --verify-status, --set-website", exit 1 |

---

## Handoff chain

- Upstream: `/setup-accounts` (sets `accounts.business_id`).
- Downstream: `/capi-setup` (installs/verifies the pixel on the live site);
  `/launch` (uses `accounts.website_url` as a real, UTM-enforced destination).

**Last verified:** 2026-06-22
