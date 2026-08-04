# HOPE'87 — Engagement Deliverables

**Client:** HOPE'87 (hope87.at / hope87.org) · **Slug:** `hope87`
**Engagement start:** 2026-07-31 · **CRM stage:** won
**Contact:** shoaib@hope87.org

## Context

HOPE'87 is an Austria-based humanitarian/development NGO (est. 1987, active in 9 countries)
running youth training, employment, and livelihood/skills-development programs. Its donor
base is the Pakistani diaspora in Austria and Germany.

The `/pre-audit` scored them **26/100**. The three load-bearing findings that shape every
document here:

1. **No tracking at all** — no Meta Pixel, GTM, or GA4 anywhere on hope87.at. Every
   donation click through the PayPal link is unmeasured.
2. **Zero paid presence** — 0 ads have ever run in AT/DE, while Islamic Relief Worldwide
   placed 104 ads in AT+DE over 90 days (~35/month, 76 of them carousel).
3. **Organic cadence collapsed** — 0.75 posts/week against a ≥3x/week benchmark, with an
   11.6-day gap at time of audit.

## Scope

Beyond the standard Meta ads retainer, the engagement covers a WordPress → **Astro**
website rebuild (dual-language **EN/DE**) with a dedicated **donation landing page**, a
full FB/IG visual rebrand, graphics + video production, and a diaspora influencer program.
Donation cause focus: **skills development and livelihood programs**.

## Documents

| Deliverable | What it covers |
|---|---|
| [Strategy & Campaign Plan](strategy-plan/strategy-and-campaign-plan.md) | Donation cause framing, 90-day paid + organic campaign structure, awareness/trust-building, diaspora targeting, gap-by-gap fixes, competitor-informed creative direction |
| [90-Day Roadmap & Weekly Plan](3-month-roadmap/roadmap-and-weekly-plan.md) | Three monthly phases plus a Week 1–13 task list with Agency/Client ownership per workstream, and the critical-path dependencies |
| [Website Redesign Scope](website-redesign-scope/website-redesign-scope.md) | Astro IA/sitemap, EN/DE i18n routing + translation workflow, donation landing page spec with the full Pixel/CAPI event map, WordPress migration + SEO plan, CMS/hosting recommendation |
| [Content & Creative Production Plan](content-production-plan/content-and-creative-plan.md) | Social rebrand direction + template system, ~37-asset graphics package, ~8-asset video package with shot list, 3 ad creative angles, bilingual production rules, ongoing cadence |
| [Influencer Marketing Plan](influencer-marketing-plan/influencer-marketing-plan.md) | Diaspora influencer archetypes ranked by trust vs. reach, partnership models, collab formats, sourcing approach, measurement, phased rollout |

## Commercials

Priced in **EUR** and split into a **recurring** monthly management retainer and
**one-time** delivery fees (website build, donation landing page, initial video
production, initial graphics/social rebrand). Ad spend is billed separately and paid
directly to Meta — it is never included in the retainer.

**Figures are not restated here.** The proposal and the service agreement are the single
source of truth, and this overview is published to the client deliverables hub:

- `proposals/hope87/proposal.pdf` — scope + pricing, recurring vs. one-time
- `contracts/hope87/agreement.pdf` — the service agreement and fee schedule

Send those to the client directly rather than via the hub link.

## Known blockers

These gate the paid workstream and are tracked in `clients/hope87/profile.json`:

- **`accounts.ad_account_id` is `TBD_no_ad_account_yet`** — no Meta ad account exists yet.
- **`accounts.pixel_id` is null** — the pixel gets created and installed on the *new*
  donation landing page (Week 6 in the roadmap), deliberately not on the WordPress site
  that's being replaced.
- **`accounts.instagram_business_id` is null** — needs resolving once partner access to
  the Page/IG is granted (see `prospects/hope87/deliverables/access-request/`).
- **No brand kit** — `assets.brand_colors` and `brand_guidelines_url` are empty, so
  `/image-gen` cannot run for this client until a brand kit is seeded. The rebrand
  direction in the content plan is the input for that.

## Next steps

1. Client grants Business Manager partner access + website/CMS access (access-request doc
   already prepared under `prospects/hope87/deliverables/access-request/`).
2. Run `/audit hope87` to capture the immutable baseline before any changes.
3. Send proposal + contract; on signature run `/contract hope87 --mark-signed`, then
   `/billing hope87 invoice`.
4. Begin Week 1 of the roadmap.
