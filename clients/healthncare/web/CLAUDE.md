# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this directory is

`clients/healthncare/web/` is a **build package, not an application**. It contains no source code,
no `package.json`, and nothing to run. It is the complete, self-contained specification for
**wellnessncare.com** — a single-page Next.js marketing site for the smOS client *Wellness & Care*
(`healthncare`) — derived from that client's approved `../brand_profile.json` (strategy + verbal +
visual layers, all three human gates stamped).

Two distinct kinds of work happen against it:

1. **Editing the spec** (most work done *here*). The seven files are the deliverable. Keep them
   mutually consistent — see "Cross-file invariants" below.
2. **Building the site** (done in a *separate* Next.js project elsewhere). `BUILD-PROMPT.md` is the
   prompt for that; the commands below scaffold it.

## Files and their roles

| File | Role |
|---|---|
| `BUILD-PROMPT.md` | The paste-into-a-fresh-session prompt that drives the actual build. Entry point. |
| `SPEC.md` | Authority on page structure (§3), compliance rules (§2), file layout + tech rules (§5), tracking (§6), asset inventory (§7). |
| `DESIGN-SYSTEM.md` | Human-readable rationale for the visual system. |
| `tokens.json` | Machine-readable tokens (color / typography / space / radius / shadow / motion / focus / breakpoints / z). |
| `globals.css` | Ships **verbatim** as `app/globals.css`. Tailwind v4 `@theme` + `@layer base` + `@layer components`. |
| `content.json` | Every string on the site, plus `banned_words` / `banned_patterns` and `TBD` markers. |
| `README.md` | Orientation + the client-blocker list. |

## Commands

Nothing builds here. To start the site build:

```bash
mkdir -p ~/dev/wellnessncare && cd ~/dev/wellnessncare
cp /Users/apple/abdul/smOS/clients/healthncare/web/{SPEC.md,DESIGN-SYSTEM.md,tokens.json,content.json,globals.css} .
mkdir -p brand && cp -r /Users/apple/abdul/smOS/clients/healthncare/brand/* brand/
claude   # then paste the prompt from BUILD-PROMPT.md
```

Verification gates for the built site (run in that project, not here) — `SPEC.md` §5 "Quality gates":

```bash
pnpm build                      # must be zero TS errors, zero ESLint errors
npx lighthouse <url> --preset=desktop --form-factor=mobile   # Perf ≥90, A11y 100, BP ≥95, SEO ≥95
grep -rEi "miracle|guaranteed|\bcure" .next/server            # must return zero hits
grep -rL 'rel="sponsored nofollow noopener noreferrer"'       # every affiliate link must carry it
```

## Architecture of the specified site

Next.js 15 App Router · React 19 · TS strict · Tailwind v4 (CSS-first `@theme`, **no
`tailwind.config.js`**) · Vercel, **Node.js runtime — never `runtime = 'edge'`**. No UI kit, no
animation library, no carousel library.

The load-bearing structural decisions, each of which spans several files:

- **Affiliate model, not commerce.** No cart, checkout, payments, accounts, database, API routes, or
  server actions. Every buy button is an outbound Maxweb/ClickBank link. The real `Purchase` fires
  on the merchant's side and is unobservable here — on-site tracking terminates at the outbound
  click, which is why Meta campaigns optimize toward that event.
- **Content is data, not JSX.** `lib/content.ts` parses `content.json` through a zod schema so a bad
  copy edit fails the build. No hardcoded strings in components.
- **Server Components by default.** `'use client'` only where state/effects genuinely exist: Header
  (mobile menu + scroll condense), StickyCta, Reveal, the FAQ accordion, and Picks *if* category
  filtering is interactive.
- **All outbound URLs go through `lib/affiliate.ts`** — appends the smOS UTM standard, passes
  inbound `utm_*` through to the merchant so attribution survives the hop, and enforces
  `target="_blank" rel="sponsored nofollow noopener noreferrer"`.
- **Page order is fixed and maps to ad angles:** Hero → Problem (PAIN) → How It Works → Science
  (PROOF) → Results (ASPIRATION) → Picks → Guarantee → FAQ → Final CTA. Anchor IDs are deep-link
  targets from ad UTMs — don't rename them. Plus three thin legal routes `/privacy` `/terms`
  `/disclosure`.

## Rules that are not stylistic — breaking them breaks the business

- **Compliance is structural.** FTC affiliate disclosure visible *before the first affiliate link*
  (in How It Works), not footer-only; full FDA supplement disclaimer in the footer plus a short form
  near product cards; never state or imply the products treat, cure, or prevent a condition. These
  are what make the page eligible for Meta ad review.
- **Never invent proof.** No fabricated testimonials, names, stats, study citations, or before/after
  imagery. Where `content.json` marks something `TBD`, render an empty state or hide the section and
  list it in the handoff. A cleanly hidden section is correct; plausible fake customers are a legal
  problem. Same for legal prose — do not write policy text and present it as reviewed.
- **`banned_words` / `banned_patterns` in `content.json` are enforced**, not advisory. They derive
  from the client's approved brand-voice `dont` list. Say "30-day money-back window," never
  "guaranteed results."
- **Banned in UI, not just copy:** countdown timers, fake stock counters, exit-intent modals, chat
  bubbles, spinning badges, unlicensed "as seen on" logo walls.
- **`#20B2AA` and `#34C759` fail AA on white** (~2.3:1 and ~1.9:1). They are fill colors. Any teal or
  green a user must *read* uses `--color-secondary-text` (`#0E7C75`) / `--color-accent-text`
  (`#1E8E3E`). On the navy band, `#6FD8D1` / `#6FE08F` are large-display only.
- **No raw hex in component code.** If a color is missing, add a token to `@theme` in `globals.css`
  and mirror it in `tokens.json`.

## Design-system boundary

This is the **client brand** system (Poppins/Inter, `#0066CC`/`#20B2AA`/`#34C759`). It is *not* the
smOS "Cupertino" system in `design-system/smos-design-system.css`, which styles agency deliverables
(reports, audits, the bundle hub). Never mix them in either direction — nothing here belongs in a
report renderer, and nothing from Cupertino belongs on this site.

## Cross-file invariants

When editing anything in this directory, keep these in sync or the package silently contradicts
itself:

- A token changed in `tokens.json` must change in `globals.css` `@theme` (and vice versa), and any
  value quoted in `DESIGN-SYSTEM.md`'s tables.
- Component class names in `globals.css` `@layer components` are the ones `DESIGN-SYSTEM.md`
  documents and `SPEC.md` §3 references (`.disclosure-box`, `.section-inverse`, `.container-narrow`,
  `.icon-tile`, …). Don't add a class to one without the others.
- Section keys in `content.json` map 1:1 to the `SPEC.md` §3 section list and to the component names
  in §5's file layout.
- Adding a banned word means the site's grep gate changes — check nothing in `content.json` copy now
  violates it.

## Known open items (do not silently resolve)

- **Copy conflict:** the approved brand `promise` says *"We **guarantee** measurable energy and
  weight-loss results"*, which collides with the approved voice rule *"never say 'guaranteed'"* and
  would be an unsupportable efficacy claim. `content.json` resolves it by keeping the 30-day
  money-back window and dropping the results guarantee. Reverting that is a client decision that
  should go past a lawyer.
- **Client still owes:** product list + affiliate URLs, testimonials with consent, before/after
  releases, licensed hero/section photography (no AI-generated people on a health credibility page),
  legal text for the three routes, an SVG logo (only `../brand/logo_primary.png` exists), and sources
  for any stat in the Results band.
- **Pixel `1720541425873368` is not yet installed** (`pixel_installed: false`) — installing it is
  part of the build.
- Ad creatives in `../generated/` are **AI-generated**: reference only, never hero photography, and
  any AI imagery used anywhere must be disclosed per the smOS `ai-disclosure` guard and Meta policy.
