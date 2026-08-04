# HOPE'87 — Website Redesign Scope

**Client:** HOPE'87 (hope87.at)
**Prepared:** 2026-07-31
**Prepared by:** smOS / Ducker Creative
**Current site:** WordPress, 148KB homepage, 67 external scripts, no Meta Pixel / GTM / GA4, responsive (viewport meta present)

---

## 0. Decisions locked for this scope

These are settled — not open questions:

1. **Stack:** Astro. Chosen over Next.js because the site is content-and-donation-marketing led with minimal interactivity outside the donation flow itself. Astro ships close to zero JS by default, which fixes the current site's core problem (148KB HTML + 67 external scripts dragging load time) without paying for a React runtime the content doesn't need.
2. **Languages:** English + German only. The Austria/Germany diaspora audience is fluent in the host-country language; Urdu is reserved for ad creative, not the site itself.
3. **Donation landing page:** in scope, cause-specific to skills-development / livelihood programs (HOPE'87's strongest, most concrete proof point).
4. **Tracking:** Meta Pixel + Conversions API (CAPI) wired into the donation flow at launch — this is a clean install, since the current domain has zero tracking infrastructure.

---

## 1. Information Architecture

Full sitemap for the new Astro site. EN/DE parity is required everywhere the diaspora donor journey touches; a small number of secondary pages can ship EN-only at launch and get German added in a fast-follow pass.

```
/                              Home
/about/                        About / Mission (history since 1987, 9-country presence)
/programs/                     Programs overview
/programs/skills-development/  Skills Development & Livelihood (featured program — donation CTA anchor)
/programs/[other-program]/     Additional program pages (as content exists)
/impact/                       Impact & Transparency (financials, results, accountability)
/donate/                       Donate — general entry point
/donate/skills-development/    Donation landing page (cause-specific — see Section 3)
/news/                         News / Stories (index)
/news/[slug]/                  Individual story/post
/contact/                      Contact
```

**Parity requirement (build EN + DE together at launch):**
- Home
- Programs overview
- Skills Development & Livelihood (featured program)
- Impact & Transparency
- Donate (general) + the skills-development donation landing page
- Contact

These are the pages a donor or a Meta ad click will land on — they carry the trust and conversion weight and cannot be EN-only.

**EN-only acceptable at launch, DE fast-follow within 4–6 weeks post-launch:**
- News/Stories index and individual posts (long-tail content, lower conversion weight per page; German versions can roll out as new stories are published rather than retrofitting the archive)
- Any additional/secondary program pages beyond skills-development

Rationale: this front-loads translation effort onto the exact pages that carry paid traffic and donation intent, and defers it on content that accrues value over time anyway.

---

## 2. Dual-Language Implementation

**Routing pattern:** path-based i18n, not domain-based. `/en/...` and `/de/...` under a single `hope87.at` domain, using Astro's built-in i18n routing (`i18n.locales`, `i18n.defaultLocale`, `i18n.routing.prefixDefaultLocale`).

- Set `defaultLocale: "de"` with `prefixDefaultLocale: true` — i.e. both languages get an explicit prefix (`/de/`, `/en/`), no bare unprefixed default. This avoids ambiguity for SEO and for the redirect logic below, and treats German as the primary audience language (Austria/Germany) with English as the deliberate second option, not an afterthought.
- Root `/` issues a one-time locale redirect based on `Accept-Language`, falling back to `/de/` — implemented as a tiny Astro middleware/edge redirect, not client-side JS.
- Domain-based (`de.hope87.at` / `en.hope87.at`) is rejected: it splits SEO authority across two hostnames for no benefit at this content volume, and complicates the single-domain Meta domain-verification step already planned in `/setup-web`.

**Content model:** Astro Content Collections, one collection per content type (`programs`, `stories`, `pages`), with a locale field baked into the frontmatter and a shared `slug` key used to pair EN/DE variants of the same document. Example:

```
src/content/programs/skills-development.de.md
src/content/programs/skills-development.en.md
```

A shared `translationKey` (or matching filename stem) lets a `<LanguageSwitcher>` component link directly to the counterpart page rather than bouncing to the home page in the other language — a common and avoidable dual-language bug.

**Translation workflow:**
1. All net-new copy is authored in German first (primary donor-facing language for the AT/DE diaspora audience), by HOPE'87 staff or smOS working from HOPE'87 source material.
2. English is a **human-reviewed translation**, not raw machine output: first-pass via DeepL (best quality/cost for DE↔EN of the options available), then one editorial review pass by a fluent English speaker on the HOPE'87 or smOS side to catch tone drift — the brand voice is "warm, trustworthy, community-rooted, humble-but-credible, storytelling over statistics," which literal MT reliably flattens.
3. Parity pages (Section 1) do not go live in either language until both language versions have cleared review — no shipping an EN placeholder on a donation-path page.
4. Ongoing content (news/stories) can ship DE-first and follow with EN within the same review step, since these are not gated as launch-blocking parity pages.

---

## 3. Donation Landing Page Spec — `/donate/skills-development/`

This is the single highest-leverage page in the rebuild: it is where paid traffic (Meta ads) and organic/diaspora-network traffic both convert.

**Hero framing (cause-specific, not generic "donate to HOPE'87"):**
- Headline anchors on the concrete outcome: skills training and livelihood income for a named program participant profile (e.g. youth/women in vocational training) — not an abstract "help us" ask, consistent with the "storytelling over statistics" voice.
- Subhead states the mechanism in one line: what a donation directly funds (training slot, tools/materials, stipend) — donors respond to tangible unit-of-impact framing.
- Primary CTA button, soft-CTA style per brand voice rules (e.g. "Support a Trainee" rather than a hard "Donate Now" demand) — visually dominant, above the fold, repeated after each major section.

**Trust signals (in order of appearance on the page):**
1. **9-country credibility** — "Represented in 9 Countries Worldwide" badge/strip near the hero, pulled directly from the existing IG bio positioning that already tested well organically.
2. **Est. 1987 / decades-of-operation** marker — longevity is a core trust asset for a diaspora donor base deciding whether a nonprofit is legitimate.
3. **Transparency proof points** — link/summary from the Impact & Transparency page: financial accountability statement, program results to date. If audited financials or an annual report exist, surface a direct link/download here, not buried on `/impact/` only.
4. **Past impact stats** — the current WordPress site and social profiles should be mined during migration (Section 4) for any concrete numbers already in circulation (trainees placed, employment outcomes, countries active, years of operation). If no hard stats exist yet beyond "9 countries" and "since 1987," do **not** fabricate metrics — ship with the qualitative trust signals above and flag stats collection as a fast-follow with HOPE'87 program staff.
5. **Community/testimonial element** — a short quote or story snippet from a program participant or a recognizable community figure, if available, placed just above the final CTA.

**Donation flow — PayPal recommendation:** keep PayPal as the payment processor, but move it from an off-site `paypal.me` link (the current setup, per the IG bio) to an **embedded PayPal Donate/Checkout integration on-site**. Reasoning: PayPal already has the diaspora donor base's trust and habitual use (it's the only mechanism the org has ever used), Pakistani-diaspora donors in AT/DE skew toward PayPal familiarity over card-first alternatives, and switching processors entirely would add unnecessary migration risk with zero evidence PayPal is a conversion blocker. The fix needed is not "replace PayPal," it's "stop sending donors off-site to complete the gift," which is what breaks pixel/CAPI tracking today. Evaluate Stripe only as a secondary card-direct option in a later phase if HOPE'87 wants to reduce PayPal fees or add recurring-giving features PayPal makes clumsy — not part of this scope.

**Meta Pixel / CAPI event map (fires on this page and its flow):**

| Event | Fires when | Method |
|---|---|---|
| `PageView` | On page load of `/donate/skills-development/` (and every page, site-wide) | Pixel (browser) |
| `ViewContent` | On page load, with `content_name: "skills-development-donation"` | Pixel (browser) |
| `InitiateCheckout` | User clicks the primary donate CTA button, before the PayPal widget completes | Pixel (browser), fired from the CTA's own click handler — not dependent on PayPal's redirect completing |
| `Donate` (custom conversion event, standard Meta event where available) | PayPal confirms a completed transaction — via PayPal's IPN/webhook or the on-site success/thank-you page render | **Server-side CAPI**, deduplicated against a matching browser Pixel `Donate`/`Purchase` event fired on the thank-you page load, using a shared `event_id` |

CAPI is required specifically because a donation is a genuine off-Meta-domain financial transaction handled by a third-party processor (PayPal) — the transaction confirmation is more reliably captured server-side (PayPal webhook → CAPI) than by relying solely on a client-side redirect back to a thank-you page, which browser ad-blockers and PayPal's own redirect flow can interrupt. Both events fire with the same `event_id` for Meta's deduplication.

This is wired at launch per the global constitution's requirement that any donation/conversion flow have CAPI in place before paid traffic is sent to it.

---

## 4. Migration Notes

**Carries over (rebuild, don't recreate from scratch):**
- Organizational history / "since 1987" narrative and the 9-country footprint description — this is core credibility content already established with the audience.
- Any existing program descriptions, especially skills-development/livelihood content — becomes the seed for the featured program page.
- Any impact numbers, participant stories, or testimonials currently published anywhere on hope87.at, in newsletters, or in annual reports — audit these explicitly during content inventory, since the page audit shows the current site as thin on structured content (no evidence of a stats/impact block in the crawled homepage).
- Existing blog/news posts worth preserving for SEO equity (see below) — migrate the ones with any external backlinks or search visibility, archive/redirect the rest.

**Gets rewritten, not carried over verbatim:**
- Any copy currently only in a single language — everything gets rebuilt bilingually per Section 2, so this is a rewrite pass by definition, not a copy-paste.
- Donation calls-to-action — currently just an off-site PayPal link in the IG bio and presumably similar treatment on-site; rewritten as the cause-specific, soft-CTA framing in Section 3.
- Any copy laden with the current site's likely SEO-plugin cruft contributing to the 67 external scripts and 148KB homepage weight (typical WordPress bloat: font icon kits, multiple slider/carousel libraries, tracking snippets that were never wired to anything since no pixel/GTM/GA4 was ever actually installed). None of that carries over — Astro's output should ship with a small fraction of that script count.

**Avoiding SEO/inbound-link breakage during the domain-verification handoff:**
Because the audit confirms hope87.at currently has **zero tracking infrastructure** (no pixel, no GTM, no GA4), there is no analytics history to preserve — this is a genuinely clean install from a tracking standpoint. The SEO risk is entirely about URL structure and inbound links, handled as follows:

1. **Inventory current URLs before takedown.** Crawl hope87.at (sitemap.xml if present, else a full crawl) to list every indexed/live URL before the WordPress site is retired.
2. **Map old → new URLs** and ship a 301 redirect table (old WordPress permalink → new Astro path, including the new `/de/` or `/en/` prefix) as part of the deploy — not an afterthought. This is a flat redirects config in Astro's `astro.config` or at the hosting/edge layer (see Section 5).
3. **Preserve the root domain.** hope87.at stays the domain of record; only the underlying site changes. No new domain, so no need to re-establish backlinks elsewhere.
4. **Re-submit the new sitemap** to Google Search Console (or set it up if it doesn't exist) immediately at launch, and keep the old WordPress XML sitemap's URLs redirecting rather than 404ing.
5. **Meta domain verification** (already planned under `/setup-web`) is unaffected by the redesign since it verifies domain ownership via DNS/meta-tag, not URL structure — sequence it any time after DNS is stable, independent of the redirect rollout.
6. Because there's no existing Meta Pixel/GTM/GA4 to migrate, there's no event-mapping legacy debt — the Section 3 event map is the entire tracking spec, built fresh.

---

## 5. Technical Scope Summary (for pricing/estimation)

**Page count at launch (bilingual pages counted once as a build unit, per Section 1):**

| Page | EN/DE at launch |
|---|---|
| Home | Yes |
| About/Mission | Yes |
| Programs overview | Yes |
| Skills Development & Livelihood (featured) | Yes |
| Impact & Transparency | Yes |
| Donate (general) | Yes |
| Donate — Skills Development landing page | Yes |
| Contact | Yes |
| News/Stories index | EN at launch, DE fast-follow |
| News/Stories — individual posts (assume 3–5 migrated + net-new) | EN at launch, DE fast-follow |

**~9 distinct page templates, 8 shipping bilingual at launch** (16 rendered pages) plus a news archive that grows over time. This is a small, tightly-scoped site — consistent with an Astro build being the right call over a heavier framework.

**CMS recommendation:** pair Astro with a **headless CMS**, not bare Content Collections, specifically because HOPE'87 needs to self-edit content post-launch (news/stories especially, and periodically the impact stats) without a developer in the loop. Recommend **Astro + a Git-based or API headless CMS with a straightforward editor UI** — concretely, **Sanity** (generous free tier, clean editor experience for non-technical nonprofit staff, structured content model that maps directly onto the bilingual content model in Section 2 via a `locale` field per document) over Contentful (pricier at this scale) or a pure Git-based CMS like Decap (fine for developers, but asks non-technical staff to work uncomfortably close to Git/Markdown). Astro's official Sanity integration keeps the build pipeline simple: content edits in Sanity trigger a rebuild via webhook.

**Hosting recommendation: Vercel.** Astro deploys to Vercel with zero configuration friction, its edge network handles the EN/DE locale redirect and the 301 redirect table cleanly at the routing layer (no origin server round-trip), preview deployments make the translation-review workflow in Section 2 easy to sign off on before merging, and it's already the hosting pattern used elsewhere in this agency's stack — no new ops surface to maintain for a low-traffic nonprofit site. Netlify is a reasonable second choice with equivalent capability; no reason to pick it over Vercel here.

**Out of scope for this document (separate line items):** Meta ad creative/copy production, the `/setup-web` domain-verification execution itself, ongoing content production after the fast-follow window, and any recurring-donation/membership functionality beyond the one-time PayPal donation flow specified in Section 3.
