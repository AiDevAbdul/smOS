---
name: setup-web
description: Use this skill to give a zero-start client a domain, a branded landing + link-in-bio page, and a Meta-verified destination for conversion ads. This skill should be used when a brand-new business needs a website chain built (typically via `/setup-web {slug}`) — it drives domain purchase + Vercel deploy in the skill body, then runs the Node companion to register the domain to the Meta business, surface the facebook-domain-verification TXT, report Meta's real verification status, and record website_url + domain into client_profile.json. Runs after /setup-accounts and before /capi-setup.
---

# /setup-web — Domain + Landing + Domain Verification (Phase 0 · setup track)

Ads need a destination, and conversion campaigns need a **verified domain**. For a brand-new business this whole chain is automatable except the one-time payment method on a domain registrar. This skill owns DNS-controlled hosting (so Meta domain verification is possible), deploys a branded landing/link-in-bio page, registers the domain to the Meta business, and writes the live URL back into the client profile.

## What This Skill Does

- Buys a domain (Vercel Registrar / Cloudflare / Route53) and deploys a branded landing + link-in-bio page on Vercel, styled from `brand_profile.json`.
- Registers the domain to the Meta business (`POST /{business_id}/owned_domains`) through the guarded chokepoint.
- Surfaces the exact `facebook-domain-verification=...` TXT value to publish via DNS.
- Reports Meta's **actual** `verification_status` (never fakes success); stamps `setup.domain_verified_at` only when Meta returns `verified`.
- Records `accounts.website_url`, `accounts.domain`, and `setup.landing_deployed_at` into `client_profile.json`.

## What This Skill Does NOT Do

- Create the Page/IG/ad account/pixel — that is `/setup-accounts` (run it first; this skill needs `accounts.business_id`).
- Install or verify the pixel/Conversions API on the site — that is `/capi-setup`.
- Build the brand identity (logo/colors/bio) the page is styled from — that is `/brand-visual` + `/brand-social`.
- Launch campaigns to the destination — that is `/launch`.
- Publish the DNS TXT record itself — the human/agent does this via the DNS provider's API; this skill only prints the value.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`), `schemas/client_profile.js` (`normalize`), `scripts/lib/load-env.js` |
| **Conversation** | Desired domain name; whether a domain is already owned; registrar/DNS provider preference |
| **Skill References** | DNS/verification standards + I/O contract from `references/` (see table below) |
| **Client Profile** | `clients/{slug}/client_profile.json` (`accounts.business_id`/`bm_id`) + `clients/{slug}/brand_profile.json` (logo, colors, type, bio, link-in-bio links) |

## Clarifications

> Before asking: check the conversation, the client profile, and prior handoff files.
> Only ask for what cannot be determined. Domain/DNS standards are embedded in `references/` —
> never ask the user for them.

**Required (must resolve before running):**
1. Which client `{slug}`?
2. What domain to register (e.g. `example.com`) — a business decision, not discoverable.

**Optional (ask only if relevant):**
3. Preferred registrar/DNS provider if not Vercel Registrar.
4. Link-in-bio destinations/order if not derivable from `brand_profile.json`.

## Workflow

1. **Buy the domain** via Vercel Registrar / Cloudflare / Route53. The one-time payment method is the only human step.
2. **Deploy a landing + link-in-bio page** on Vercel, styled from `brand_profile.json`. Lead with the highest-value action.
3. **Register the domain to the Meta business:**
   `node skills/setup-web/setup-web.js {slug} --register example.com`
   Prints `verification_status` and the `facebook-domain-verification=...` TXT value.
4. **Publish the TXT record** via the DNS provider's API. Meta then crawls it.
5. **Poll verification, then record the site:**
   `node skills/setup-web/setup-web.js {slug} --verify-status example.com`
   `node skills/setup-web/setup-web.js {slug} --set-website https://example.com`

## Input / Output Specification

**Inputs:** `{slug}` (positional) + exactly one mode flag: `--register <domain>`, `--verify-status <domain>`, or `--set-website <url>`. Env: `META_ACCESS_TOKEN` (register/verify modes), `META_APP_SECRET` (optional, for appsecret_proof). Files: `clients/{slug}/client_profile.json`.
**Outputs:** JSON on stdout per mode; mutates `clients/{slug}/client_profile.json` — sets `accounts.website_url`, `accounts.domain`, `setup.landing_deployed_at` (`--set-website`) and `setup.domain_verified_at` (`--verify-status` only when Meta returns `verified`). A live page on the client's domain.
(Full schemas + per-mode example payloads + edge cases: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Domain name, registrar/DNS provider | The 3-mode CLI contract (register / verify-status / set-website) |
| Brand styling of the landing page | DNS-controlled hosting requirement for verification |
| `business_id`, returned verification code | Graph API v25.0; `owned_domains` register-then-read flow |
| Whether verification is pending/verified | Never stamp `domain_verified_at` unless Meta says `verified` |

## Domain Standards

### Must Follow
- [ ] Use DNS-controlled hosting (own domain + Vercel/Cloudflare/Route53) — third-party link-in-bio hosts cannot place the verification TXT.
- [ ] Register the domain via the guarded `createGraph()` chokepoint (never a raw fetch).
- [ ] Report Meta's literal `verification_status`; only stamp `domain_verified_at` when it equals `verified`.
- [ ] Normalize `domain` from the URL host with `www.` stripped (the companion does this).

### Must Avoid
- Claiming verification succeeded before Meta returns `verified`.
- Running this before `/setup-accounts` has set `accounts.business_id` (the companion halts if TBD).
- Hardcoding the verification TXT value — read it from the register call / Business Settings.

### Output Checklist (verify before delivery)
- [ ] Landing/link-in-bio page is live on the client's domain.
- [ ] `client_profile.json` has non-TBD `accounts.website_url` + `accounts.domain`.
- [ ] `setup.landing_deployed_at` set; `setup.domain_verified_at` set iff Meta returned `verified`.
- [ ] Handoff stated: `/capi-setup` next to install/verify the pixel.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `client_profile.json` | Companion exits code 2 ("run /intake first") — halt, do not guess |
| No mode flag given | Companion exits code 1 with usage — supply one of `--register`/`--verify-status`/`--set-website` |
| `business_id` is null/TBD | Companion exits code 3 ("run /setup-accounts") — halt |
| Domain not registered when polling | Companion exits code 4 ("run --register first") |
| Meta API error | `meta-graph.js` surfaces code/type/fbtrace_id; transient codes retried with backoff, token errors (190/102/463/467) non-retryable |
| Verification still `pending` | Report status truthfully; re-poll later — never stamp `domain_verified_at` |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`), `schemas/client_profile.js` (`normalize`), `scripts/lib/load-env.js`. Domain registration passes through `guards.js` `guardGraphWrite()`.
- **External APIs:** Meta Graph API **v25.0** (`owned_domains` register + read); Vercel/Cloudflare/Route53 for domain purchase + DNS (driven by the agent in the skill body). Rate limits + endpoints in `references/api-reference.md`.
- **Secrets:** `META_ACCESS_TOKEN` / `META_APP_SECRET` resolved via env (`load-env.js`) — never hardcoded or logged. Registrar/DNS creds live in their own provider auth.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Domain Verification overview | https://developers.facebook.com/docs/sharing/domain-verification/ | `owned_domains` concept + Business Manager flow |
| Verifying Your Domain | https://developers.facebook.com/docs/sharing/domain-verification/verifying-your-domain/ | DNS TXT / meta-tag / HTML-file methods |
| Domain Verification FAQ | https://developers.facebook.com/docs/sharing/domain-verification/faq/ | DNS propagation, multi-business conflicts |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | `X-App-Usage`; codes 4 / 17 / 613 |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error-code table + `fbtrace_id` |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | DNS verification methods, link-in-bio/landing best practices, why DNS-controlled hosting, good/bad examples |
| `references/api-reference.md` | Exact Meta `owned_domains` endpoints/fields, v25.0, rate limits + cited URLs |
| `references/io-contract.md` | Full CLI contract, per-mode JSON output schemas, profile writeback fields, edge cases |
