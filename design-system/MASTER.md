# smOS Design System — "Cupertino"

**The single visual standard for every client-facing report and template.**
Apple / iOS design language. Source of truth: [`smos-design-system.css`](./smos-design-system.css).
Do **not** fork styles per report — edit the CSS once; every deliverable inherits it.

> Generated with the `ui-ux-pro-max` skill, then tuned to Apple's Human Interface
> Guidelines aesthetic (the look was the explicit brief: "I like the design system of
> the apple/iphone UI/UX").

---

## How it's wired (architecture)

```
design-system/smos-design-system.css   ← ONE source of truth (tokens + base + components)
        ▲ read at render time ▲
scripts/lib/design_system.js   (Node)   scripts/lib/design_system.py  (Python)
        │                                        │
        ├─ md_to_html.js  ── /report /analyze /before-after /monthly-review
        ├─ audit_report_html.js ── /audit /audit-creative
        ├─ pre_audit_report.py ── /pre-audit
        └─ report.py (competitor) ── /research
                                                 → scripts/render_pdf.py → PDF
```

Every renderer **inlines** the CSS string (self-contained HTML, no external host —
works offline and survives PDF conversion). The loaders expose:

- **JS** (`scripts/lib/design_system.js`): `designSystemCss()`, `reportHead({title, extraHead})`, `heroHeader({title, subtitle, subtitleHtml, eyebrow, headline, pills, aside})`, `heroAside({body, statLabel, statValue, statCaption})`, `reportFooter(date)`.
- **Python** (`scripts/lib/design_system.py`): `design_system_css()`, `report_head()`, `hero_header(title, subtitle, eyebrow, headline, pills, aside, subtitle_html)`, `hero_aside(body, stat_label, stat_value, stat_caption)`, `CHART_PALETTE`, `CHART_THEME` (Chart.js global theming).

New report? Import a loader and reuse the `ds-*` component classes. Never paste raw hex.

### The hero is MANDATORY and uniform

Every client-facing report renders **one** hero — the canonical `.ds-hero` — via
`heroHeader()` / `hero_header()`. **Never** hand-roll a `<header class="ds-hero">`,
fork a bespoke `.hero`, or override hero colors per report. The hero supports an
optional right-hand executive column (`aside`) for a score ring + single hero stat
(build it with `heroAside()` / `hero_aside()`); pass `eyebrow` for the badge pill,
`headline` for a one-line summary, `pills` for a snapshot row. The `hero-uniform`
test (`test/hero-uniform.test.js`) fails the build if a renderer hand-rolls a hero
instead of calling the loader. The two standalone `templates/*.html` mirror the
same aurora aesthetic (they are filled client-side and inline their own CSS).

---

## Foundations

### Color (iOS system palette)
| Token | Hex | Use |
|---|---|---|
| `--ds-bg` | `#f5f5f7` | Page canvas |
| `--ds-surface` | `#ffffff` | Cards, tables, sheets |
| `--ds-surface-2` | `#fbfbfd` | Zebra rows |
| `--ds-ink` | `#1d1d1f` | Primary text |
| `--ds-muted` | `#6e6e73` | Secondary text / captions |
| `--ds-faint` | `#8e8e93` | Footnotes |
| `--ds-line` | `#e2e2e7` | Dividers / borders |
| `--ds-blue` / `--ds-blue-strong` | `#0071e3` / `#0066cc` | Primary action, links |
| `--ds-green` | `#34c759` | Success / scale (systemGreen) |
| `--ds-amber` | `#ff9f0a` | At risk / warn (systemOrange) |
| `--ds-red` | `#ff3b30` | Critical / pause (systemRed) |
| `--ds-purple` `--ds-teal` `--ds-pink` `--ds-indigo` | … | Extra chart series |
| `*-tint` | soft | Callout / badge backgrounds |

Semantic, not decorative: status is always color **+** text/icon (WCAG `color-not-only`).

### Type
- One family: **SF Pro / system stack** (`--ds-font`) — Apple's native UI font, zero web-font load. Mono: `--ds-font-mono` (SF Mono).
- Scale: H1 32 / H2 24 / H3 19 / body 16 / caption 13. Negative tracking on headings.
- Tabular numerals on all data (`font-variant-numeric: tabular-nums`) so columns don't jitter.

### Shape & elevation
- Radii: `--ds-r-sm` 10 · `--ds-r` 14 · `--ds-r-lg` 20 · pill 980.
- Soft, low-contrast shadows (`--ds-shadow*`) — Apple "floating card", never heavy.
- Hero gradient `--ds-grad-blue`; table headers `--ds-grad-ink`.
- Motion: 220ms `cubic-bezier(.4,0,.2,1)`; respects `prefers-reduced-motion`.

---

## Components (class names)
`ds-wrap` (page container, `--wide` = 1200px) · `ds-hero` + `ds-eyebrow` · `ds-card` ·
`ds-kpi-grid` / `ds-kpi` (`__label` `__value` `__delta--up/down`) · `ds-badge` (`--good/warn/bad/info/neutral`) ·
`ds-callout` (`--good/warn/bad`) · `ds-table-wrap` + `table` · `ds-chart` + `ds-chart__title` · `ds-footer` ·
`ds-btn` (`--ghost`; `aria-disabled="true"` = inert) ·
`ds-roadmap` › `ds-step` (`.is-pending` = muted/dashed) › `ds-step-num` (circular numbered badge), `ds-step-body` (`ds-step-title` / `ds-step-desc` / `ds-step-actions`). Numbered client-journey hub used by `/bundle`.
**`/bundle` "operating-system console"** (dark shell framing bright report windows):
`ds-hub` (dark `--ds-shell` flex-column) › `ds-skip` (skip link) · `ds-hub__head` (`ds-hub__eyebrow` / `ds-hub__title` gradient-clip / `ds-hub__sub`) · `ds-progress` (`__label`/`__count`/`__track`/`__seg.is-done` — segmented meter, aurora on delivered) · `ds-hubnav` (`--bottom`; glass sticky, horizontal-scroll on mobile, hidden bottom nav <760px) › `ds-hubnav__btn` (`.n` numbered badge; `.is-active` = aurora; `.is-disabled`) · `ds-viewer-wrap` (elevated window) › `ds-viewer` (same-tab iframe) + `ds-viewer__loader` (`.is-on`) › `ds-spinner`. Entrance: `ds-anim` (`ds-rise`).

**Tokens (bolder evolution):** `--ds-grad-brand` (aurora blue→indigo→violet — the one bold accent, used on `ds-hero`, progress, spine, active chip) · `--ds-shell*` (dark console chrome) · `--ds-fs-display` (clamped display scale) · `--ds-ease-out` / `--ds-dur-fast` (motion).

Charts use `CHART_PALETTE` order + `CHART_THEME` (SF font, gray grid, point-style legend).

---

## Pre-delivery checklist
- [ ] No emoji as structural icons (SVG only); status uses color **+** text
- [ ] Text contrast ≥ 4.5:1; focus-visible rings intact
- [ ] Tabular numerals on data columns
- [ ] Reads correctly at 375px and in print/PDF (`break-inside: avoid` on cards)
- [ ] No raw hex in renderers — only `--ds-*` tokens / `ds-*` classes
- [ ] HTML is self-contained (CSS inlined, no external font/CSS host)

Per-page deviations go in `design-system/pages/<name>.md` and override this Master.
