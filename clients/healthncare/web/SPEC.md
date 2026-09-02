# Wellness & Care — Single-Page Website Specification

**Client:** Wellness & Care (`healthncare`) · **Domain:** `wellnessncare.com`
**Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS v4 · deployed on Vercel
**Type:** One page, anchor-navigated, plus three thin legal routes
**Source of truth:** `brand_profile.json` (strategy + verbal + visual, all three human gates approved)
**Written:** 2026-08-18

---

## 1 · What this site is

Wellness & Care is an **affiliate business**, not a merchant. It does not hold inventory, take
payments, or ship. It curates weight-loss and energy supplements and sends traffic to Maxweb /
ClickBank offers.

That single fact determines the whole build:

- **No cart, no checkout, no Stripe, no accounts, no database.** Every buy button is an outbound
  affiliate link.
- The page's job is **credibility → click**. The conversion event is `purchase_affiliate_link`,
  fired off-site; on-site we measure the outbound click.
- **Legal surface is load-bearing.** FTC affiliate disclosure and FDA supplement disclaimers are
  not footer decoration — they are the reason this page is allowed to run Meta ads.

### Traffic context (drives layout)
Paid Meta traffic from `act_1837020087281652`, targeting US + Canada, ages 25–70, $1,000/mo,
target CPA $25. Ad angles already built: **PAIN** (problem-agitate-solve), **ASPIRATION**
(before/after transformation), **PROOF** (clinical research). The page must give each of those
three angles a landing beat it can hand off to — which is exactly what sections 2, 5, and 4 do.

**Mobile is the primary design target.** Meta feed traffic in this audience is ~85% mobile.
Design mobile-first, then widen.

---

## 2 · Non-negotiable constraints

### Compliance (fail the build if any is missing)

| Rule | Requirement |
|---|---|
| FTC affiliate disclosure | Visible **above the fold or adjacent to the first affiliate link** — not only in the footer. A `.disclosure-box` in the "How we choose" section plus the footer block satisfies this. |
| FDA supplement disclaimer | Full "not evaluated by the FDA / not intended to diagnose, treat, cure or prevent any disease" text in the footer, and a short form near any product card. |
| No disease claims | The page must never state or imply the products treat, cure, or prevent a condition. |
| No fabricated proof | Testimonials, before/afters, stats, and study citations must be real and client-supplied. If the client hasn't supplied them, **hide the section** — do not ship Lorem or invented names. |
| Banned words | Enforce `content.json → banned_words` and `banned_patterns`. Notably: *miracle, guaranteed, cure, best ever, life-changing*. These come from the client's approved voice `dont` list. |
| Medical caution | "Consult your physician…" line present in the Science section and the footer. |
| Privacy | A real Privacy Policy, Terms, and Affiliate Disclosure route. Cookie/consent banner required if any analytics beyond first-party is loaded for EU visitors — audience is US/CA, so a lightweight banner is optional but the Privacy Policy is not. |

> **Copy conflict, flagged:** the approved brand `promise` reads *"We **guarantee** measurable
> energy and weight-loss results, or your money back within 30 days"* — which collides with the
> approved voice rule *"never say 'guaranteed'"* and would be an unsupportable efficacy claim on a
> supplement page. **Resolution used in `content.json`: keep the 30-day money-back window, drop the
> results guarantee.** All site copy says "30-day money-back window," never "guaranteed results."
> If the client wants the original wording, that's their call to make explicitly — and it should go
> past a lawyer first.

### Accessibility
- WCAG 2.1 AA. Body text ≥ 4.5:1, large text ≥ 3:1.
- **`#20B2AA` and `#34C759` fail AA on white.** Use `--color-secondary-text` (`#0E7C75`) and
  `--color-accent-text` (`#1E8E3E`) whenever teal/green must be *read*. The raw brand values are
  for fills, gradients, and large graphics only.
- Every interactive element has a visible `:focus-visible` ring. Touch targets ≥ 48×48px.
- Semantic landmarks (`header`/`nav`/`main`/`section`/`footer`), one `h1`, no heading level skips.
- FAQ built with real `<details>`/`<summary>` or a properly-wired accordion with `aria-expanded`.
- All animation gated behind `@media (prefers-reduced-motion: no-preference)`.
- Images have meaningful `alt`; decorative ones get `alt=""`.

### Performance budget
- Lighthouse mobile: **Performance ≥ 90, Accessibility 100, Best Practices ≥ 95, SEO ≥ 95.**
- LCP < 2.0s on 4G, CLS < 0.05, INP < 200ms.
- JS shipped to the client: **< 90 KB gzipped.** This page needs almost no client JS — everything
  except the mobile menu, the FAQ accordion, the scroll-reveal observer, and outbound-click
  tracking is a Server Component.
- Fonts via `next/font/google` (self-hosted, `display: swap`, preloaded). **No external font CDN.**
- Hero image: `next/image` with `priority`, explicit `sizes`, AVIF/WebP. Everything below the fold
  lazy-loads.
- No animation library. No carousel library. No UI kit. Tailwind + a handful of hand-written
  components only.

---

## 3 · Page structure

Single scrolling page. Section IDs are the anchor targets used by the nav and by ad UTM deep-links.

```
┌ Header (sticky, translucent, condenses on scroll)
│
├ 1  HERO                #top          Full-height-ish. Gradient wash + real photo. H1 + subhead
│                                      + primary CTA + trust strip (4 items).
├ 2  PROBLEM             #problem      Dark-on-canvas band. 3 pain cards. Lands the PAIN ad angle.
├ 3  HOW IT WORKS        #how-it-works White. 3 numbered filter steps + affiliate disclosure box.
├ 4  SCIENCE             #science      Soft gradient band. Supported vs not-supported claim list
│                                      (✓/✗), + physician callout. Lands the PROOF ad angle.
├ 5  RESULTS             #results      Inverse navy band. Stat row + testimonial cards.
│                                      Lands the ASPIRATION angle. HIDDEN until real proof exists.
├ 6  PICKS               #picks        Canvas. Category tabs (Weight / Energy) + product card grid.
│                                      The money section. Every CTA is an outbound affiliate link.
├ 7  GUARANTEE           #guarantee    Narrow, centered. 30-day money-back window + fine print.
├ 8  FAQ                 #faq          Narrow. 8 accordion items. Emits FAQPage schema.
├ 9  FINAL CTA           #start        Gradient band. Repeat of the primary CTA + reassurance line.
│
└ FOOTER                               Boilerplate, nav columns, socials, affiliate disclosure,
                                       FDA disclaimer, copyright.

+ Sticky mobile CTA bar (< 768px only), appears after the hero scrolls out.
```

All copy for every section is in **`content.json`** — build components that read from it rather
than hardcoding strings, so the client can revise copy without touching JSX.

### Section-by-section notes

**1 · Hero.** Left column copy, right column image on ≥1024px; stacked on mobile with the image
below the CTA (not above — the headline must be the first thing in the viewport). Background:
white with a soft `--grad-brand` radial bleed top-right at ~8% opacity. Trust strip is four
`.pill` items, wrapping. One primary CTA and one ghost secondary — never two competing primaries.

**2 · Problem.** `.section-canvas`. Three `.card`s, no icons — this section is text and empathy.
Keep it short; the reader is here to move past the pain, not sit in it.

**3 · How it works.** Three `.card`s with `.icon-tile` (flask / shield / tag, Lucide stroke icons,
2px). Large ghosted `01 02 03` numerals behind each card title. **The `.disclosure-box` with the
FTC affiliate line closes this section** — this is the first place a reader learns how the site
makes money, which is exactly the transparency the brand claims.

**4 · Science.** `.section-soft`. Two-column claim list: green `✓` items (what research supports)
and neutral `✗` items (what it doesn't). The ✗ column is the differentiator — most affiliate pages
never write one. Physician callout as a `.disclosure-box` beneath.

**5 · Results.** `.section-inverse`. Stat row (3 stats, tabular numerals) + 3 testimonial cards.
**Render nothing if `content.json → proof` has no real entries.** Every testimonial carries an
"Individual results vary." line. Before/after images require a signed release on file.

**6 · Picks.** The commercial core. Two category filters (client-side state, or plain anchor
sections if you'd rather keep it zero-JS). Product cards render from an array. Each card: name,
category pill, price band, "why it made the list" (1–2 sentences), key ingredients, and a
`View Product` button. **Every button:**
- `target="_blank" rel="sponsored nofollow noopener noreferrer"` — `sponsored` is the FTC/Google-
  correct rel for a paid affiliate link.
- carries UTM params (see §6).
- fires the outbound-click event before navigating.
Short affiliate reminder line above the grid.

**7 · Guarantee.** `.container-narrow`. One statement, one fine-print paragraph. No badge clipart.

**8 · FAQ.** Eight items from `content.json`. First one open by default. Emits `FAQPage` JSON-LD.

**9 · Final CTA.** Gradient band, single centered CTA, reassurance line beneath. This is the last
chance to convert someone who scrolled the whole page.

### Extra routes (thin, static, same shell)
`/privacy` · `/terms` · `/disclosure` — plain prose pages using `.container-narrow`. Required for
Meta ad review and for affiliate-network compliance. Client supplies the legal text; do not
generate policy text and present it as reviewed.

---

## 4 · Design direction

The look sits between **medical credibility** and **human warmth** — clinical enough to be
believed, warm enough not to feel like a pharmacy portal. Concretely:

- **Generous whitespace.** Sections breathe (112px desktop / 64px mobile vertical padding). This is
  the single biggest signal separating a trustworthy health page from a spammy one.
- **Structured, not decorated.** Cards with 1px `--color-line` borders and soft low shadows. No
  glassmorphism, no neon, no heavy gradients outside the designated bands.
- **Alternating bands** carry rhythm: white → canvas → white → soft-gradient → **inverse navy** →
  canvas → white → white → gradient. The single navy band is the page's visual anchor — use it once,
  for proof, where you most want the reader to stop.
- **Photography over illustration.** Real people, 25–70, diverse, warm lighting, no stock clichés
  (no lab coats holding beakers, no measuring tape around a waist, no white-teeth-and-salad).
- **Iconography:** Lucide, 2px stroke, rounded. Bolt = energy (green), leaf = wellness (teal),
  shield/check = trust (blue). Icons live in `.icon-tile`, never floating bare.
- **Restraint on motion.** Fade-and-rise reveals on section entry, 60ms stagger, once. Nothing else.

**Do not** use: countdown timers, stock-counter urgency, spinning badges, "as seen on" logo walls
without permission, chat-bubble popups, exit-intent modals. Every one of them undercuts the exact
trust the brand is selling — and several would fail Meta ad review.

---

## 5 · Technical implementation

### File layout
```
app/
  layout.tsx            Fonts, metadata, JSON-LD, <html lang="en">
  page.tsx              Server Component. Imports content.json, composes sections.
  globals.css           ← ship the provided globals.css verbatim
  privacy/page.tsx
  terms/page.tsx
  disclosure/page.tsx
components/
  layout/Header.tsx           'use client' (mobile menu + scroll condense)
  layout/Footer.tsx           server
  layout/StickyCta.tsx        'use client'
  sections/Hero.tsx           server
  sections/Problem.tsx        server
  sections/HowItWorks.tsx     server
  sections/Science.tsx        server
  sections/Results.tsx        server
  sections/Picks.tsx          'use client' only if category filtering is interactive
  sections/Guarantee.tsx      server
  sections/Faq.tsx            'use client' (accordion) or <details> server-only
  sections/FinalCta.tsx       server
  ui/Button.tsx  Card.tsx  Pill.tsx  IconTile.tsx  SectionHeader.tsx  Reveal.tsx
lib/
  content.ts            typed loader + zod schema for content.json
  affiliate.ts          buildAffiliateUrl() — appends UTMs, enforces rel attrs
  analytics.ts          trackOutboundClick()
content/
  content.json          ← ship the provided content.json
public/
  images/  logo.svg  hero.jpg  og.jpg
  favicon.ico  apple-touch-icon.png  site.webmanifest
```

### Rules
- **Server Components by default.** `'use client'` only on Header, StickyCta, Reveal, the FAQ
  accordion, and Picks-if-filtered. If a component has no state or effect, it does not get the
  directive.
- **Tailwind v4, CSS-first.** All tokens live in `@theme` inside `globals.css`. There is no
  `tailwind.config.js`. Never write a raw hex in a component — if a color is missing, add a token.
- **Typed content.** `lib/content.ts` parses `content.json` through a zod schema at build time so a
  copy edit that breaks a shape fails the build, not the page.
- **Fonts:**
  ```ts
  import { Poppins, Inter } from 'next/font/google'
  const poppins = Poppins({ subsets: ['latin'], weight: ['600','700'], variable: '--font-poppins', display: 'swap' })
  const inter    = Inter({ subsets: ['latin'], weight: ['400','500','600'], variable: '--font-inter', display: 'swap' })
  // <html className={`${poppins.variable} ${inter.variable}`}>
  ```
- **Metadata** via the App Router `metadata` export — title, description, openGraph, twitter,
  canonical, robots. Values in `content.json → seo`.
- **JSON-LD** in `layout.tsx` (Organization + WebSite) and in the FAQ section (FAQPage), injected
  with `<script type="application/ld+json">`.
- **No database, no API routes, no auth, no server actions** — unless the newsletter is enabled,
  in which case one route handler posting to the client's ESP. It is disabled by default.
- **Deploy:** Vercel, Node.js runtime (the default — do **not** set `runtime = 'edge'`), static by
  default since the whole page is a static render.

### Quality gates before "done"
1. `pnpm build` clean — zero TS errors, zero ESLint errors.
2. Lighthouse mobile hits the §2 budget.
3. Keyboard-only pass: reach every CTA, open/close menu and FAQ, visible focus throughout.
4. 320px viewport: no horizontal scroll, nothing clipped.
5. Grep the built output for `content.json → banned_words` — zero hits.
6. Every affiliate link carries `rel="sponsored nofollow noopener noreferrer"` and UTMs.
7. Affiliate disclosure visible without opening the footer.

---

## 6 · Tracking

### Meta Pixel
Pixel `1720541425873368`. **Currently `pixel_installed: false` — installing it is part of this
build.** Load via `next/script` with `strategy="afterInteractive"`.

Events:
| Event | Trigger |
|---|---|
| `PageView` | Page load (automatic) |
| `ViewContent` | Picks section enters viewport |
| `Lead` *(custom: `OutboundAffiliateClick`)* | Any affiliate link click. Params: `product_name`, `category`, `merchant`, `value` (price band midpoint), `currency: 'USD'` |

The real `Purchase` fires on the merchant's side and is **not observable from this site** — that
gap is why CAPI matters here. Flag to the operator: with an affiliate model, on-site conversion
tracking terminates at the outbound click, so optimize Meta campaigns toward the outbound-click
event unless/until merchant postback is wired up.

### UTMs on every outbound link
`lib/affiliate.ts` appends, per the smOS UTM standard:
```
?utm_source=meta&utm_medium=paid_social&utm_campaign={campaign_name}&utm_content={ad_name}
```
Read `utm_*` off the inbound URL (`searchParams`) and **pass them through** to the affiliate URL so
the merchant-side attribution chain survives the hop. Fall back to `utm_source=website` for organic
visits.

### Analytics
Vercel Analytics + Speed Insights (`@vercel/analytics`, `@vercel/speed-insights`). No Google
Analytics unless the client asks — fewer third-party scripts, less consent surface.

---

## 7 · Assets available now

| Asset | Path | Note |
|---|---|---|
| Primary logo | `clients/healthncare/brand/logo_primary.png` | Copy to `public/logo.png`. **Request an SVG from the client** — a PNG logo in a header is a quality tell. |
| Profile picture | `clients/healthncare/brand/social/profile_picture.png` | Logo on brand gradient — usable as a favicon source. |
| FB cover | `clients/healthncare/brand/social/cover_photo.png` | Reference for the gradient treatment. |
| Highlight covers | `clients/healthncare/brand/social/highlight_*.png` | Icon language reference (About/Products/Results/Science/FAQ). |
| Ad creatives | `clients/healthncare/generated/{PAIN,ASPIRATION,PROOF}-ad.png` | **AI-generated.** Reference only — do not reuse as hero photography. |

**Still needed from the client** (blockers for a fully-populated page):
1. Product list + affiliate URLs (Maxweb / ClickBank).
2. Real testimonials with consent, and before/after photos with signed releases.
3. Hero + section photography (or a licensed stock budget). No AI-generated people on a health
   credibility page — and if any AI imagery is used anywhere, it must be disclosed per the smOS
   `ai-disclosure` guard and Meta's policy.
4. Legal text for `/privacy`, `/terms`, `/disclosure`.
5. Logo in SVG.
6. Any stat used in the Results band, with a source.

Build the page fully functional with these sections gracefully hidden or empty-stated so it can go
live before all six land.
