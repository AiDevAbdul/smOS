# Wellness & Care — Web Design System

Brand-derived design system for `wellnessncare.com`.
Machine-readable: **`tokens.json`** · Drop-in CSS: **`globals.css`**

> This is the **client brand** system. It is deliberately *not* the smOS "Cupertino" system
> (`design-system/smos-design-system.css`), which styles agency deliverables — reports, audits,
> the bundle hub. Never mix the two. Nothing in this file should be copied back into a report
> renderer, and nothing from Cupertino belongs on this site.

---

## Foundations

### Color

| Token | Value | Where it goes |
|---|---|---|
| `--color-primary` | `#0066CC` | **60%.** CTAs, links, trust icons, key numerals |
| `--color-primary-hover` | `#0053A6` | Hover |
| `--color-primary-pressed` | `#00417F` | Active |
| `--color-primary-soft` | `#E6F0FB` | Tinted cards, pills, icon tiles |
| `--color-secondary` | `#20B2AA` | **30%.** Gradients, rules, large graphics |
| `--color-secondary-text` | `#0E7C75` | Teal **as text** (AA-safe) |
| `--color-secondary-soft` | `#E4F6F5` | Teal tint background |
| `--color-accent` | `#34C759` | **10%.** Success ticks, energy bolt, fills |
| `--color-accent-text` | `#1E8E3E` | Green **as text** (AA-safe) |
| `--color-accent-soft` | `#E7F8EC` | Green tint background |
| `--color-ink` | `#1D1D1F` | Body text |
| `--color-ink-muted` | `#636366` | Secondary text, captions |
| `--color-ink-subtle` | `#8E8E93` | Placeholders, disabled |
| `--color-line` | `#E5E5EA` | Borders, dividers |
| `--color-surface` | `#FFFFFF` | Cards, default surface |
| `--color-canvas` | `#F5F5F7` | Alternating section band |
| `--color-inverse` | `#0B1B2B` | Deep navy proof band |
| `--color-inverse-ink` | `#F5F7FA` | Text on navy |

**Ratio: 60 / 30 / 10** — primary / secondary / accent, measured across the whole page.

**The contrast trap.** `#20B2AA` sits at ~2.3:1 on white and `#34C759` at ~1.9:1. Both fail AA for
text by a wide margin. They are **fill colors**, not text colors. Any teal or green that a user has
to *read* uses `--color-secondary-text` / `--color-accent-text`. On the navy band, `#6FD8D1` and
`#6FE08F` are available for large display type and graphics only.

**Gradients**

| Token | Value | Use |
|---|---|---|
| `--grad-brand` | `135deg #0066CC → #20B2AA` | Hero wash, final CTA band, `.grad-text` |
| `--grad-brand-soft` | `135deg #E6F0FB → #E4F6F5` | Science section band |
| `--grad-energy` | `135deg #20B2AA → #34C759` | Energy accents. Sparingly |
| `--grad-inverse` | `160deg navy → deep blue → teal-black` | Results band |

White text on `--grad-brand` must be ≥20px — the teal end drops below 3:1 at small sizes.

### Typography

**Poppins** (600/700) for headings · **Inter** (400/500/600) for everything else. Both self-hosted
through `next/font/google`. No web-font CDN.

| Role | Size | Weight | Line | Tracking |
|---|---|---|---|---|
| Display (hero H1) | `clamp(2.5rem, 1.6rem + 3.6vw, 3.75rem)` | 700 | 1.06 | −0.02em |
| H1 (section) | `clamp(2rem, 1.4rem + 2.4vw, 2.75rem)` | 700 | 1.15 | −0.015em |
| H2 | `clamp(1.5rem, 1.25rem + 1vw, 1.875rem)` | 600 | 1.25 | −0.01em |
| H3 (card title) | `20px` | 600 | 1.35 | — |
| Body large | `18px` | 400 | 1.6 | — |
| Body | `16px` | 400 | 1.65 | — |
| Body small | `14px` | 400 | 1.55 | — |
| Caption / legal | `12px` | 500 | 1.45 | — |
| Eyebrow | `13px` | 600 | 1.2 | 0.08em, uppercase |

Rules: measure 60–72ch for body (hero subhead 46ch) · never set Poppins below 18px — below that
it's always Inter · stats and prices use `.tabular` · max two type sizes per card.

### Space & layout

4px base. Scale: `4 8 12 16 20 24 32 40 48 64 80 96 128`.

Container `1200px` max, `760px` narrow. Gutter `20px` mobile / `40px` desktop.
Section padding: `64px` mobile → `80px` tablet → `112px` desktop, vertical.
Grid: 12 columns, `16px` gap mobile / `24px` desktop.

### Radius, elevation, motion

Radius: `8 / 12 / 16 / 24 / pill`. Default **16px** for cards, **pill** for buttons.

Shadows are soft and low-contrast (`--shadow-xs` → `--shadow-lg`, plus `--shadow-brand` for the
primary CTA). Never combine a hard border and a heavy shadow on the same element.

Motion: `120ms` fast, `200ms` base, `360ms` slow, `520ms` reveal.
Easing `cubic-bezier(0.4,0,0.2,1)` standard, `cubic-bezier(0.16,1,0.3,1)` for reveals.
**Every animation lives inside `@media (prefers-reduced-motion: no-preference)`.**
Scroll reveal is the only page-level effect: opacity 0→1 + `translateY(16px)`→0, 60ms stagger,
fired once via `IntersectionObserver`. No parallax, no scroll-jacking, no autoplay carousels.

### Focus

`box-shadow: 0 0 0 3px rgba(0,102,204,0.35)` on `:focus-visible`, everywhere, always. Outlines are
never removed without a replacement.

---

## Components

All defined in `globals.css` under `@layer components`. Use these class names; do not fork parallel
styles in JSX.

| Class | What it is |
|---|---|
| `.container-wc` / `.container-narrow` | Page containers (1200 / 760) |
| `.section` + `.section-canvas` / `.section-soft` / `.section-inverse` | Section shell + band variants |
| `.eyebrow` | Uppercase teal label above a section H2 |
| `.lede` | 18px muted intro paragraph, 62ch |
| `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-lg` / `.btn-block` | Buttons. 48px min height (56px for `lg`), pill radius |
| `.card` + `.card-hover` / `.card-feature` | Surface cards |
| `.pill` / `.pill-accent` / `.pill-teal` | Badges and trust chips |
| `.stat-value` / `.stat-label` | Stat blocks, tabular numerals |
| `.icon-tile` / `.icon-tile-teal` / `.icon-tile-green` | 48px rounded icon container (Lucide, 2px stroke) |
| `.grad-brand` / `.grad-text` / `.rule-brand` | Gradient surfaces, gradient text, 56px accent rule |
| `.legal` / `.disclosure-box` | Fine print and the FTC/medical callouts |
| `.sticky-cta` | Mobile-only bottom CTA bar, blurred, safe-area aware |
| `.reveal` / `.is-visible` | Scroll-reveal pair |
| `.tabular` | `font-variant-numeric: tabular-nums` |

### Button hierarchy
**One primary CTA per viewport.** Primary = `.btn-primary` (solid blue, brand shadow). Secondary =
`.btn-secondary` (white, bordered). Tertiary = `.btn-ghost`. Two primaries side by side is a bug.

### Card anatomy
`.icon-tile` → H3 title → 14–16px muted body → optional `.pill`. Padding 24px. One border, one soft
shadow, 16px radius. Hover lifts 2px only on `.card-hover`.

---

## Voice in the interface

The brand voice — **Educational, Bold, Urgent, Transparent** — has UI consequences, not just copy
ones:

- **Educational** → the Science section shows what research *doesn't* support. Build the ✗ column.
- **Bold** → large display type, real contrast, no hedging microcopy.
- **Urgent** → urgency comes from the *cost of waiting* ("that tiredness follows you into every
  day"), never from a fake timer or stock counter.
- **Transparent** → the affiliate disclosure appears *before* the first buy button, not buried in
  the footer. This is a design decision, and it's the brand's actual differentiator.

**Banned in UI as well as copy:** countdown timers, fake stock counters, exit-intent modals, chat
bubbles, unlicensed "as seen on" logo walls, spinning discount badges. Full word list in
`content.json → banned_words` / `banned_patterns`.

---

## Checklist

- [ ] No raw hex anywhere in component code — tokens only
- [ ] Teal/green never used as small text on white
- [ ] Body ≥ 4.5:1, large text ≥ 3:1, verified
- [ ] `:focus-visible` ring on every interactive element
- [ ] Touch targets ≥ 48×48px
- [ ] All motion behind `prefers-reduced-motion`
- [ ] One `h1`; no heading level skipped
- [ ] 60/30/10 color ratio holds across the full page
- [ ] Poppins never below 18px
- [ ] Body measure inside 60–72ch
