---
name: setup-web
description: Use this skill when a zero-start client needs a domain, a basic website/landing page, and a link-in-bio destination (typically via `/setup-web {slug}`). Buys a domain, deploys a branded landing + link-in-bio page (Vercel), registers the domain to the Meta business, and drops the facebook-domain-verification TXT via DNS so conversion ads have a verified destination. Records website_url + domain back into client_profile.json.
---

# /setup-web — Domain + Landing + Domain Verification (Phase 0 · setup track)

Ads need a destination, and conversion campaigns need a **verified domain**. For a brand-new business this whole chain is automatable except the one-time payment method on file — fastest path given smOS already has Vercel tooling.

## Required Context

- `clients/{slug}/client_profile.json` — `accounts.business_id`, plus brand for the page content
- `clients/{slug}/brand_profile.json` (recommended) — logo, colors, type, bio, link-in-bio structure to style the page
- `META_ACCESS_TOKEN` for registering + reading the owned domain
- Vercel auth (CLI/MCP) for buy + deploy; a DNS provider with an API (Vercel/Cloudflare/Route53) for the TXT record

## Why DNS-controlled hosting (not Linktree)

Meta domain verification requires placing a `facebook-domain-verification` TXT record — which means you need DNS control. Third-party link-in-bio hosts don't give you that, so they can't satisfy verification. Owning the domain + deploying on Vercel does.

## Workflow

1. **Buy the domain** (Vercel Registrar / Cloudflare / Route53). One-time payment method is the only human step.
2. **Deploy a landing + link-in-bio page** on Vercel, styled from `brand_profile.json` (logo, colors, type, bio, link-in-bio links). Lead with the highest-value action.
3. **Register the domain to the Meta business** and read its verification status:
   ```
   node skills/setup-web/setup-web.js {slug} --register example.com
   ```
4. **Add the verification TXT** record via your DNS provider's API (the skill prints the exact `facebook-domain-verification=...` value to publish). Meta then crawls it.
5. **Poll verification + record the site:**
   ```
   node skills/setup-web/setup-web.js {slug} --verify-status example.com
   node skills/setup-web/setup-web.js {slug} --set-website https://example.com
   ```
   `--set-website` writes `accounts.website_url` + `accounts.domain` and stamps `setup.landing_deployed_at`.

## Output

- Updated `clients/{slug}/client_profile.json` (`accounts.website_url`, `accounts.domain`, `setup.domain_verified_at`, `setup.landing_deployed_at`)
- A live landing/link-in-bio page on the client's domain

## Handoffs

- `/capi-setup` installs/verifies the pixel on this site.
- `/launch` requires a `destination_url`; once `website_url` is set the campaign has a real, verified destination (and UTM enforcement applies via the guard).

## Safety

- Domain registration to the business goes through the guarded `createGraph()` chokepoint.
- The skill never claims verification succeeded — it reports Meta's actual `verification_status` (verified / pending / unverified).
