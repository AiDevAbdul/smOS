# Build Prompt — Wellness & Care single-page website

> Paste everything between the rules into a fresh Claude Code session, from a directory where you
> want the Next.js project created. Copy `SPEC.md`, `DESIGN-SYSTEM.md`, `tokens.json`,
> `content.json`, and `globals.css` into that directory first (see "Before you paste" at the end).

---

Build the marketing website for **Wellness & Care** (`wellnessncare.com`) — a single-page Next.js
site. The complete specification is in the files already in this directory. **Read all five before
writing any code:**

- `SPEC.md` — page structure, section-by-section requirements, compliance rules, tech constraints
- `DESIGN-SYSTEM.md` — the visual system and its rationale
- `tokens.json` — machine-readable design tokens
- `content.json` — every string on the site, already written and voice-compliant
- `globals.css` — the complete Tailwind v4 theme + component layer, ready to drop in

## What the business is

Wellness & Care curates weight-loss and energy supplements and earns **affiliate commission**
(Maxweb, ClickBank) when visitors buy through outbound links. It is not a store: no cart, no
checkout, no payments, no accounts, no database. Every buy button is an external affiliate link.

Its positioning: *"For busy adults aged 25–70 seeking sustained energy and weight loss, Wellness &
Care is the curated marketplace of science-backed supplements that delivers transformative results
without the hype, because our selection is driven by efficacy research, not profit maximization."*

The page's whole job is **credibility → outbound click**. Traffic arrives from Meta ads, US +
Canada, ages 25–70, and is roughly **85% mobile** — design mobile-first.

## Stack

Next.js 15 App Router · React 19 · TypeScript (strict) · Tailwind CSS v4 (CSS-first `@theme`, no
`tailwind.config.js`) · `next/font/google` for Poppins + Inter · deployed on Vercel, Node.js
runtime (do **not** set `runtime = 'edge'`). Server Components by default; `'use client'` only
where state or effects genuinely exist. No UI kit, no animation library, no carousel library.

## The build

1. **Scaffold** a Next.js 15 + TS + Tailwind v4 app in this directory.
2. **Install** the design system: replace `app/globals.css` with the provided `globals.css`
   verbatim. Wire Poppins (600/700, `--font-poppins`) and Inter (400/500/600, `--font-inter`) via
   `next/font/google` onto `<html>`. Never write a raw hex value in a component — if a color is
   missing, add a token to `@theme`.
3. **Type the content**: `lib/content.ts` loads `content.json` through a zod schema so a bad copy
   edit fails the build. Every section component reads its strings from there — no hardcoded copy
   in JSX.
4. **Build the page** in the order and structure given in `SPEC.md` §3:
   Hero → Problem → How It Works → Science → Results → Picks → Guarantee → FAQ → Final CTA, plus a
   sticky header, a mobile-only sticky CTA bar, and the footer.
5. **Build the thin legal routes** `/privacy`, `/terms`, `/disclosure` using the same shell and
   `.container-narrow`. Use the client's supplied legal text where present; where it is absent,
   render a clearly-marked placeholder and list it in your handoff notes. **Do not write policy
   prose and present it as reviewed legal text.**
6. **Wire tracking** per `SPEC.md` §6: Meta Pixel `1720541425873368` via `next/script`
   (`afterInteractive`); `ViewContent` when the Picks section enters view; a custom
   `OutboundAffiliateClick` event on every affiliate link. `lib/affiliate.ts` builds every outbound
   URL — appending UTMs, passing inbound `utm_*` params through to the merchant, and enforcing
   `target="_blank" rel="sponsored nofollow noopener noreferrer"`. Add `@vercel/analytics` and
   `@vercel/speed-insights`. No Google Analytics.
7. **SEO**: App Router `metadata` export from `content.json → seo`; JSON-LD for Organization +
   WebSite in `layout.tsx` and FAQPage in the FAQ section; `sitemap.ts`, `robots.ts`, favicon set,
   and a 1200×630 OG image.

## Rules you must not break

**Compliance** — this is a health + affiliate page; these are what make it ad-eligible:
- The FTC affiliate disclosure must be **visible before the first affiliate link** (in the How It
  Works section), *and* in the footer. Not footer-only.
- The full FDA supplement disclaimer ("not evaluated by the FDA… not intended to diagnose, treat,
  cure, or prevent any disease") goes in the footer, with a short form near the product cards.
- Never state or imply the products treat, cure, or prevent any condition.
- Enforce `content.json → banned_words` and `banned_patterns`. Notably **miracle, guaranteed, cure,
  best ever, life-changing** — these come from the client's approved brand voice rules. Say
  "30-day money-back window," never "guaranteed results."
- **Never invent proof.** No fabricated testimonials, names, stats, study citations, or before/after
  imagery. Where `content.json` marks something `TBD`, build the component to render an empty state
  or hide the section entirely, and list it in your handoff notes. A section that hides cleanly is
  correct; a section full of plausible fake customers is a legal problem.
- No countdown timers, fake stock counters, exit-intent modals, or unlicensed "as seen on" logo
  walls. They'd fail both the brand's transparency promise and Meta ad review.

**Accessibility** — WCAG 2.1 AA, Lighthouse Accessibility 100:
- `#20B2AA` and `#34C759` **fail** AA on white. Use `--color-secondary-text` (`#0E7C75`) and
  `--color-accent-text` (`#1E8E3E`) for any teal/green that must be read. Raw brand values are for
  fills and gradients only.
- Visible `:focus-visible` ring everywhere; touch targets ≥ 48×48px; semantic landmarks; one `h1`;
  no skipped heading levels; FAQ via `<details>` or a properly `aria-expanded`-wired accordion;
  all motion inside `@media (prefers-reduced-motion: no-preference)`.

**Performance** — Lighthouse mobile Performance ≥ 90, LCP < 2.0s, CLS < 0.05, client JS < 90 KB
gzipped. Hero image `priority` with explicit `sizes`; everything below the fold lazy.

## Assets

Copy from `../brand/`:
- `logo_primary.png` → `public/logo.png` (**ask the client for an SVG** — flag this in handoff)
- `social/profile_picture.png` → favicon source

Product photography, hero imagery, real testimonials, and before/after photos are **not yet
supplied**. Build with graceful empty states and use tasteful placeholder blocks that are obviously
placeholders — never AI-generated people on a health credibility page.

## Definition of done

1. `pnpm build` clean — zero TS errors, zero lint errors
2. Lighthouse mobile: Performance ≥ 90, Accessibility 100, Best Practices ≥ 95, SEO ≥ 95
3. Keyboard-only pass reaches every CTA with a visible focus ring
4. 320px viewport: no horizontal scroll, nothing clipped
5. Zero hits when grepping the build output for `banned_words`
6. Every affiliate link has `rel="sponsored nofollow noopener noreferrer"` + UTMs
7. Affiliate disclosure readable without scrolling to the footer

## Finally

End with a **handoff note** listing: (a) everything still needed from the client (product list +
affiliate URLs, testimonials with consent, before/after releases, photography, legal text, SVG
logo, sourced stats), (b) every section currently hidden or empty-stated and what unhides it, and
(c) your Lighthouse numbers. Be accurate about what's stubbed — do not report the site as complete
when sections are placeholders.

---

## Before you paste

```bash
mkdir -p ~/dev/wellnessncare && cd ~/dev/wellnessncare
cp /Users/apple/abdul/smOS/clients/healthncare/web/{SPEC.md,DESIGN-SYSTEM.md,tokens.json,content.json,globals.css} .
mkdir -p brand && cp -r /Users/apple/abdul/smOS/clients/healthncare/brand/* brand/
claude
```

Then paste the prompt above.
