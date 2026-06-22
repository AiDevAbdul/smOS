# Domain & Web Setup Standards (setup-web)

Self-contained domain-verification, DNS, and landing-page expertise for the
Phase 0 `/setup-web` skill. Read this when you need the *why* and the *how* behind
the deterministic companion. Nothing here requires runtime discovery.

---

## 1. Why DNS-controlled hosting (not Linktree / Beacons / Stan)

Meta domain verification proves you control a domain by requiring one of three
artifacts placed at the domain — and the most robust is a **DNS TXT record**.
Third-party link-in-bio hosts (Linktree, Beacons, Stan, Carrd free tier) do not
give you DNS control or `<head>` access, so they **cannot** satisfy verification.

A verified domain unlocks:
- Aggregated Event Measurement (AEM) event configuration for iOS conversions.
- Editing/owning link previews when the domain is shared on FB/IG.
- Preventing another business from claiming your domain.

**Rule:** own the domain + host on a provider with a DNS API (Vercel Registrar,
Cloudflare, AWS Route 53). This is the constant the skill enforces.

---

## 2. The three Meta verification methods

| Method | Where the artifact goes | Best for |
|--------|------------------------|----------|
| **DNS TXT record** | A `TXT` record `@` (root) with value `facebook-domain-verification=<code>` | **Preferred** — survives redeploys, host-agnostic |
| **Meta tag** | `<meta name="facebook-domain-verification" content="<code>" />` in `<head>` of the root HTML | When you control the page HTML but not DNS |
| **HTML file upload** | Upload `<code>.html` to the web root, served at `https://domain/<code>.html` | Static hosts without `<head>` control |

`/setup-web` uses the **DNS TXT** path because it owns DNS. The companion prints
the literal `facebook-domain-verification=<code>` string to publish.

### Good vs bad TXT publishing

- GOOD: `TXT  @  "facebook-domain-verification=abc123def456"` (root, exact value, no quotes inside the value).
- BAD: placing it on a subdomain (`www`) when verifying the apex — Meta crawls the registered domain.
- BAD: wrapping the value in extra quotes or adding `https://` — the value is a bare token.
- BAD: deleting the TXT after verification — keep it; Meta re-checks periodically.

### Propagation expectations

- DNS propagation is typically minutes but can take up to 72h depending on TTL.
- Set a low TTL (300s) on the verification record so re-checks are fast.
- `verification_status` transitions: `unverified` / `pending` → `verified`.
  Never assume `verified`; poll with `--verify-status`.

---

## 3. Landing + link-in-bio page best practices

The page is the destination for both organic bio links and paid conversion ads.
Style it from `brand_profile.json` (logo, palette, type, bio, link list).

### Structure (lead with the highest-value action)

1. Logo + one-line value proposition (the brand's positioning statement).
2. Primary CTA above the fold (book / buy / lead form) — single, unambiguous.
3. Secondary link-in-bio stack (latest offer, IG, catalog, contact).
4. Trust strip (social proof / logos) if available.
5. Footer: business name, contact, privacy link.

### Conversion + verification hygiene

- The destination URL used in ads must carry UTM params (`utm_source`,
  `utm_medium`, `utm_campaign`) — the `utm-enforcer` guard blocks ad creatives
  whose destination lacks them. Build the landing page so UTM'd URLs resolve.
- Keep the pixel/CAPI install out of scope here — `/capi-setup` owns it — but
  leave a clean `<head>` so the pixel snippet can be injected later.
- Accessibility: body text must meet WCAG 2.x AA contrast (4.5:1 normal text,
  3:1 large ≥18pt or ≥14pt bold). Do not round these thresholds.

### Good vs bad landing pages

- GOOD: one primary CTA, brand palette, fast static deploy, mobile-first.
- BAD: five competing CTAs, off-brand stock colors, no value prop, slow heavy JS.
- BAD: redirecting the apex to a third-party host you don't control (breaks
  verification and pixel injection later).

---

## 4. Naming / writeback conventions (constant)

- `accounts.domain` is the apex host with `www.` stripped (e.g. `https://www.example.com` → `example.com`).
- `accounts.website_url` is the full URL the client points ads/bio at.
- `setup.landing_deployed_at` / `setup.domain_verified_at` are ISO-8601 timestamps;
  `null` means "not done yet" (see `schemas/client_profile.js` `normalizeSetup`).

---

## 5. Keeping current

- Meta pins **Graph API v25.0** (released 2026-02-18, current as of 2026-06-22).
  Re-verify the version + verification-method list against the docs in
  `references/api-reference.md` if a newer version ships.
- If Meta changes the verification artifact format, update Section 2 here and the
  TXT-value handling note in `references/api-reference.md` — do not hardcode a new
  format silently.

**Last verified:** 2026-06-22
