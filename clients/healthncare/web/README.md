# `clients/healthncare/web/` — Website build package

Everything needed to build **wellnessncare.com** as a single-page Next.js site, derived from the
approved `brand_profile.json` (strategy + verbal + visual layers, all three human gates stamped).

| File | What it is |
|---|---|
| **`BUILD-PROMPT.md`** | ← **Start here.** The prompt to paste into a fresh Claude Code session, plus the setup commands. |
| `SPEC.md` | Full specification — page structure, section-by-section requirements, compliance rules, tech constraints, tracking, asset inventory. |
| `DESIGN-SYSTEM.md` | The visual system and the reasoning behind it. Human-readable reference. |
| `tokens.json` | Machine-readable design tokens (color, type, space, radius, shadow, motion). |
| `globals.css` | Drop-in Tailwind v4 theme + component layer. Ship verbatim as `app/globals.css`. |
| `content.json` | Every string on the site — already written in the client's approved voice, screened against the banned-word list. `TBD` markers flag what the client still owes. |

## Quick start

```bash
mkdir -p ~/dev/wellnessncare && cd ~/dev/wellnessncare
cp /Users/apple/abdul/smOS/clients/healthncare/web/{SPEC.md,DESIGN-SYSTEM.md,tokens.json,content.json,globals.css} .
mkdir -p brand && cp -r /Users/apple/abdul/smOS/clients/healthncare/brand/* brand/
claude
# then paste the prompt from BUILD-PROMPT.md
```

## Two things to know before building

**1 · This is an affiliate site, not a store.** No cart, no checkout, no database. Every buy button
is an outbound link to Maxweb / ClickBank. Conversion tracking terminates at the outbound click —
the actual `Purchase` fires on the merchant's side and isn't observable here.

**2 · Compliance is structural, not decorative.** FTC affiliate disclosure above the first buy
button, FDA supplement disclaimer in the footer, no disease claims, and zero fabricated proof. A
health affiliate page without these fails Meta ad review.

## Design system boundary

This is the **client brand** system (Poppins/Inter, `#0066CC`/`#20B2AA`/`#34C759`). It is not the
smOS "Cupertino" system in `design-system/smos-design-system.css`, which styles agency deliverables.
Never mix them.

## Blocked on the client

The site is buildable now with graceful empty states, but these gate a fully-populated launch:

1. Product list + affiliate URLs (Maxweb / ClickBank)
2. Real testimonials with consent on file
3. Before/after photos with signed releases
4. Hero + section photography (licensed — no AI-generated people on a health credibility page)
5. Legal text for `/privacy`, `/terms`, `/disclosure`
6. Logo in SVG (only a PNG exists today)
7. Sources for any stat shown in the Results band

## Open item flagged in the spec

The approved brand `promise` says *"We **guarantee** measurable energy and weight-loss results"* —
which contradicts the approved voice rule *"never say 'guaranteed'"* and would be an unsupportable
efficacy claim on a supplement page. `content.json` resolves this by keeping the 30-day money-back
window and dropping the results guarantee. If the client wants the original wording, that decision
should go past a lawyer.
