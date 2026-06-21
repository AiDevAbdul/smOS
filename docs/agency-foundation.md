# Agency Foundation — one-time setup (do once, not per client)

`/setup-accounts` can create a client's ad account, pixel, system user, and assign assets
**via the Meta API** — but only if the agency itself has cleared a one-time trust setup.
Without it, `POST /{business_id}/adaccount` and friends fail with permission errors
(code 100/200). This is the master unlock; complete it before onboarding the first
zero-start client.

All facts below verified against Graph/Marketing API **v25.0**.

## Steps (all manual — these are the trust boundary)

1. **Create the agency Business Portfolio** at business.facebook.com. (~2 portfolios per
   person — an account limit, not an API one.)
2. **Business Verification** — Security Center → upload legal-entity documents. This is the
   master gate; it blocks Advanced Access and programmatic ad-account creation until a Meta
   reviewer approves (human review, can take days).
3. **Create a Meta App** and submit **App Review** for Advanced Access on:
   `ads_management`, `business_management`, `pages_show_list`, `pages_read_engagement`,
   `pages_manage_posts`, `instagram_basic`, `instagram_manage_comments`,
   `instagram_manage_insights`. Advanced Access is required to act on assets you don't own
   (i.e. clients'). Each permission is reviewed individually.
4. **Create a system user + long-lived token** under the agency business:
   `POST /{business_id}/system_users` → `POST /{system_user_id}/access_tokens` (non-expiring).
   Store it as `META_ACCESS_TOKEN`. This token backs the whole API half of smOS and the
   per-client token resolution in `scripts/lib/tokens.js`.
5. **Enable "Require App Secret"** (recommended) and set `META_APP_SECRET` — `meta-graph.js`
   auto-attaches the `appsecret_proof` on every call.

## Hard manual gates that recur per client (model as `/setup-accounts --done` steps)

These can never be automated; `/setup-accounts` records them but a human must do them:

- **Facebook Page creation** — the create-Page API was removed years ago; UI-only.
- **Instagram account creation + convert to Professional** — UI-only; a personal IG account
  cannot authenticate the Graph API at all until it's Professional.
- **IG ↔ Page link** — Business Suite / IG app; the API can only *read* the link
  (`GET /{page-id}?fields=instagram_business_account,connected_instagram_account`).
- **Payment method** on the ad account — PCI-gated; no API. The API can only *read*
  `funding_source`.
- **Client accepts your asset-access request** in their Business Manager (their consent).
- **TOS acceptances** — Custom Audience TOS (per ad account) and Lead Ads TOS (per page)
  must be clicked in the UI.
- **2FA / accepting invitations** — the authentication boundary; a token can't clear these.

## API caps worth knowing

- **5 ad accounts per business via API** — beyond that is manual UI only.
- **100 pixels/datasets per business.**
- Pixel = Dataset now (same object/id). The old Offline Conversions API was discontinued
  May 2025 — don't build against it; use the Conversions API (`POST /{dataset_id}/events`).

## Fastest "site + link-in-bio now" path

Given smOS already has Vercel tooling: buy the domain via Vercel Registrar → deploy a
landing + link-in-bio page via `vercel deploy` → register the domain to the business
(`POST /{business_id}/owned_domains`) → publish the `facebook-domain-verification` TXT via
your DNS provider's API → Meta crawls and verifies. Single token, end-to-end automatable
except the one-time card on file. Third-party link-in-bio hosts (Linktree) can't satisfy
Meta domain verification because they give you no DNS control. `/setup-web` drives this.
