# /pre-audit — HTML Template & Output Design Review
**Date:** 2026-07-15 · **Method:** template code review (`pre_audit_report.py`, 1,131 lines) + design-system CSS + page-by-page inspection of two real shipped PDFs (3 Star Kitchen, Jun 30 · BA Works, Jul 15 — current template)

---

## Verdict

The visual *system* is genuinely good — coherent Cupertino tokens, disciplined single template, a defensible signature (dark aurora hero + dark closing CTA bracketing a light body). The shipped *deliverable* is not. **The PDF — the artifact prospects actually receive — currently ships with its headline element broken: the 0–100 score is invisible in every PDF on disk**, plus empty score bars, an illegible footnote, operator jargon leaking to the client, and ~40% wasted page area. The HTML is a B+; the PDF is a C−. Since the PDF is the sales weapon, this is worth fixing before the next pitch.

---

## 1. What's working (keep)

- **One coherent design language.** `--ds-*` tokens, SF Pro system type, tabular-numeral mono for data, 14px radii, soft elevation — every section feels like one product. The never-fork rule is holding: BA Works and 3 Star render from byte-identical CSS.
- **The dark bracket.** Aurora-gradient hero opening + always-dark CTA closing is the one aesthetic risk, and it lands — the red "Book a Free Strategy Call" button on the dark field is the highest-contrast moment on the page, exactly where it should be.
- **Emotional arc is designed, not accidental.** Analysis → Pitch rail grouping, "every gap reframed as an opportunity", wins/gaps side-by-side with tier labels, 3-rec cap, 30/60/90 close. This is correct sales-report information architecture.
- **Honest-data craft.** The FB-fallback for blocked IG ("qualitative signal, never a fabricated count"), the low-confidence banner, sourced benchmark citations — rare discipline.
- **BA Works copy quality** (rec cards with problem → evidence → action → outcome fully populated) shows the template at its best.

## 2. Critical output defects (P0 — visible in shipped PDFs)

**2.1 The score never appears in the PDF.** Both PDFs show a blank white rectangle (with a broken-glyph artifact) where the gauge should be. The number "30" or "24" appears *nowhere* in 6–10 pages — only the band word "CRITICAL". Three stacked causes:
- `render_pdf.py` captures at `networkidle` with no settle wait; the gauge draws over 45 rAF frames (~750ms) that never complete in print.
- `ctx.font = 'bold 52px var(--ds-font-mono)'` (line ~1057) is an **invalid canvas font string** — `var()` is not legal in canvas font shorthand, so the assignment is ignored and the score digits render at default 10px *even in the live HTML*.
- No non-JS fallback: the score exists only as canvas paint.
**Fix:** render the number as real HTML text inside the gauge (`<div class="gauge-num">24<span>/100</span></div>`) with the canvas as decoration behind it; use a literal font string in canvas; add `page.wait_for_timeout(1200)` (or a `data-render-done` flag awaited by render_pdf.py).

**2.2 Score Breakdown bars are empty in the PDF.** Bars ship at `width:0%` and animate via IntersectionObserver, which never fires during print. BA Works page 2 shows five empty gray tracks. **Fix:** render `width:{val}%` server-side; let JS animate *from* 0 only on screen (`@media print` ignores the transition anyway), or add a print stylesheet rule `​.bar-fill{width:attr(data-pct %)}` equivalent via inline width.

**2.3 Invisible white-on-white text.** `.cta-footnote` (color `rgba(247,246,242,.35)` — designed for the dark CTA) is reused inside the white benchmarks card (line 948). In the BA Works PDF page 7 the "Benchmarks as of…" line is illegible. **Fix:** use a `.muted small` class there; reserve `.cta-*` classes for the dark section.

**2.4 Pagination waste.** BA Works: 10 pages, ~4 of them half-empty (pp. 5, 6, 7, 8, 9 all end in large voids; final page has a dead tail). Cards carry `break-inside:avoid` but sections have no break strategy, so big cards eject to the next page leaving craters. A premium sales PDF should be 5–6 tight pages. **Fix:** add `@page` margins + `break-before:page` only at Wins&Gaps and CTA; relax `break-inside:avoid` on tall cards (allow the benchmarks/sizing tables to split); add page numbers + running footer via `@page` margin boxes.

## 3. Audience leaks (P1 — wrong reader)

The template ships operator/debug prose to the prospect:
- **IG data status card** (BA Works p.3): 12 lines of "Instagram Business Discovery is blocked at the app level (needs instagram_basic App Review) AND the public web_profile_info endpoint returns HTTP 404…" — plus the closing sentence duplicated twice. A prospect reads jargon + a paragraph-long excuse.
- **Method card** (p.5): "OAuthException code 33", "ads_archive", "search_page_ids", "v25.0".
- **Sizing placeholders**: "Provide a revenue goal at **/intake** to work backward via target ROAS" — an internal slash-command in a client PDF; 3 Star showed raw "Provide monthly budget to generate."
**Fix:** two-register rendering — client-facing one-liner ("Instagram metrics couldn't be verified publicly; they populate at onboarding") + full diagnostics into an operator-only appendix or the JSON. Empty sizing → collapse the card to a single invitation line ("Bring your monthly budget to the strategy call and we'll size this live"), never an instruction to the operator.

## 4. Empty-state & semantic craft (P1)

- **"@unknown" / "Category unknown"** render as broken-feeling literals in the Profile cards — while the Gaps column simultaneously says "No Instagram account." The report contradicts itself. Empty profile card should collapse to a styled statement ("No Instagram presence found — see Gap #3").
- **Zero-data prospects get skeleton noise.** 3 Star renders a full Organic section of em-dash cards, an empty format table with a black header, and a full 6-column competitor table containing one line: "No competitor data captured." — directly under a hero claiming "First mover advantage — zero competitors running paid ads." Missing data and *meaningful zero* are different facts; a greenfield market deserves a designed "greenfield" panel (it's the pitch!), not an empty-table apology.
- **✗ glyph misuse.** Ad Library Findings marks every item — including neutral method notes and competitor descriptions — with a red ✗. The ✗/✓ vocabulary means fail/pass elsewhere; here it's decoration that reads as five failures.
- **Hero contradiction (3 Star):** band "CRITICAL" beside headline "First mover advantage" with prime hero real estate spent on "COMPETITOR OUTSPEND — N/A / data unavailable." Never lead with an N/A: swap the slot for the strongest available stat.

## 5. Typography & narrative (P2)

- **Unconstrained hero headline.** BA Works' synthesis headline is a 60-word paragraph set at display size — 12 wrapped lines consuming the entire first page and demoting the actual verdict. Enforce ≤120 chars in `build.py`; overflow goes to a `subhead` slot at body size.
- **Green mono paragraphs.** `.rec-outcome` sets multi-line prose in 11px green letterspaced mono (BA Works p.9) — mono is for data, not sentences. Same for right-aligned mono paragraph cells in the sizing table ("Illustrative only — assumes a test budget…" squeezed into a value cell).
- **Benchmark/currency whiplash.** The benchmarks table asserts CPL **$27.66** three pages before the sizing card estimates **PKR 300–500 (~$1.30)** for the same prospect. Both are defensible; adjacent and unreconciled they undermine each other. Localize or annotate ("US cross-vertical averages; PK category costs run far lower — see sizing").
- **"Meta 2025" branding in a July 2026 report** — even with citations, the label invites "this is stale." Lead with the refresh date, not the source year.
- **Inconsistent identity:** "Prepared by Ducker Creative" (Jun) vs "Prepared by Abdul" (Jul) — the env-var default is a first name. Default should be the agency name; a person's name belongs in the signature block.
- **Doc drift:** CLAUDE.md still describes `--ds-grad-brand` as "blue→indigo→violet aurora"; the CSS now ships green (#06251c→#16a973). Update the constitution so future skills don't re-introduce blue.

## 6. Accessibility & robustness floor (P2)

- Canvas gauge has no `role="img"`/`aria-label` and no text alternative (ties into 2.1 — HTML-text score fixes both).
- Heading order jumps h1 → h2 with section labels done as styled divs; fine, but the rail nav lacks `aria-current`.
- `scroll-behavior:smooth` with no `prefers-reduced-motion` guard; bar/gauge animations likewise.
- Mobile (≤720px) collapses sensibly (rail hidden, single column), but the 6-column competitor table gets no `overflow-x` wrapper — it will crush on phones, where many prospects will open the link.

## 7. Priority fix list

| P | Fix | Effort |
|---|-----|--------|
| P0 | HTML-text score in gauge + valid canvas font + PDF settle wait | S |
| P0 | Server-side bar widths (JS animates on screen only) | S |
| P0 | `.cta-footnote` off white cards | XS |
| P0 | Print pagination: section break rules, allow tall-card splits, page numbers | M |
| P1 | Two-register copy: client-facing status lines, operator diagnostics to appendix; kill `/intake` + "Provide X to generate" leaks | M |
| P1 | Designed empty states: collapse dash-cards, "greenfield" panel instead of empty competitor table, drop `@unknown`/`Category unknown` | M |
| P1 | Neutral bullet glyph for findings; headline length cap in build.py | S |
| P2 | Currency-localized benchmarks note; agency-name default; reduced-motion + table overflow + aria on gauge; update CLAUDE.md gradient doc | S–M |

**Bottom line:** don't redesign — the system is right. Harden the render path (score, bars, footnote, pagination), split operator voice from client voice, and design the empty states. Those three moves take the shipped PDF from "impressive template, broken details" to matching the quality the HTML already promises.
