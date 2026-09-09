# smOS Design System — "Ledger"

**The single visual standard for every client-facing report and template.**
The language of a precision work order: an inspection sheet the client already knows
how to read. Source of truth: [`smos-design-system.css`](./smos-design-system.css).
Do **not** fork styles per report — edit the CSS once; every deliverable inherits it.

> Evolved 2026-09-02 from the "Cupertino" (Apple/iOS) system, after the owner approved
> the Blue Rose "August Inspection" prototype as the new account-wide format. Every
> `--ds-*` token name and `ds-*` class was kept contract-stable, so all wired renderers
> inherited the new language with no renderer changes.

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

Every renderer **inlines** the CSS string. Fonts are the one external resource:
`reportHead()`/`report_head()` link the Google Fonts trio (see Type below);
`render_pdf.py` waits for `networkidle` so the real faces land in PDFs, and every
face declares a system fallback stack so offline HTML stays legible. The loaders expose:

- **JS** (`scripts/lib/design_system.js`): `designSystemCss()`, `fontsLink()`, `reportHead({title, extraHead})`, `heroHeader({title, subtitle, subtitleHtml, eyebrow, headline, pills, aside, themeToggle})`, `heroAside({body, statLabel, statValue, statCaption})`, `reportFooter(date)`, `agencyName()`.
- **Python** (`scripts/lib/design_system.py`): `design_system_css()`, `FONTS_LINK`, `report_head()`, `hero_header(title, subtitle, eyebrow, headline, pills, aside, subtitle_html, theme_toggle)`, `hero_aside(body, stat_label, stat_value, stat_caption)`, `CHART_PALETTE`, `CHART_THEME` (Chart.js global theming).

New report? Import a loader and reuse the `ds-*` component classes. Never paste raw hex.

### Attribution: "Prepared by smOS"

Every report footer and prepared-by line reads **"Prepared by smOS"** — never the
agency name (owner decision, 2026-09-02). `reportFooter()` and the audit / pre-audit
footers already do this. The agency name (`config/services.json → agency.name`,
via `agencyName()`) remains correct for contractual/legal copy (e.g. `/contract`)
and contact email lines — identity of a party, not report attribution.

### The hero is MANDATORY and uniform — it is now a MASTHEAD

Every client-facing report renders **one** hero — the canonical `.ds-hero` — via
`heroHeader()` / `hero_header()`. In the Ledger language it renders as a bordered
work-order **masthead** on the light surface (accent spine on the left edge, mono
stamp for the eyebrow) — not a gradient banner. **Never** hand-roll a
`<header class="ds-hero">`, fork a bespoke `.hero`, or override hero colors per
report. It supports an optional right-hand executive column (`aside`) for a score
ring + single hero stat (build with `heroAside()` / `hero_aside()`); pass `eyebrow`
for the stamp, `headline` for a one-line summary, `pills` for a mono snapshot row.
The `hero-uniform` test (`test/hero-uniform.test.js`) fails the build if a renderer
hand-rolls a hero instead of calling the loader.

---

## Foundations

### Color (steel-blue ledger palette)
| Token | Light | Use |
|---|---|---|
| `--ds-bg` | `#f3f5f7` | Page canvas (cool steel-white) |
| `--ds-surface` | `#ffffff` | Cards, tables, sheets |
| `--ds-surface-2` | `#f8fafc` | Zebra rows |
| `--ds-ink` | `#17222e` | Primary text (deep blue-black) |
| `--ds-muted` | `#5a6b7c` | Secondary text / captions |
| `--ds-faint` | `#8695a5` | Footnotes |
| `--ds-line` / `--ds-line-strong` | `#dde4ea` / `#c9d3dc` | Hairline rules — the ledger's skeleton |
| `--ds-blue` / `--ds-blue-strong` | `#1d5dbf` / `#174a99` | Brand accent, links, stamps |
| `--ds-green` | `#1d8a4e` | Pass / scale |
| `--ds-amber` | `#b57a0a` | Caution / warn |
| `--ds-red` | `#c0392f` | Action needed / pause |
| `--ds-teal` `--ds-purple` `--ds-pink` `--ds-indigo` | … | Extra chart series |
| `*-tint` | soft | Callout / chip backgrounds |

Semantic status (pass/caution/action) is separate from the brand accent and is
always color **+** text (WCAG `color-not-only`) — the inspection-sheet chip pattern.

### Type — the engineered trio
- **Display** (`--ds-font-display`): **Barlow Semi Condensed** 600/700 — headings,
  big numbers, verdicts. Fallback: Arial Narrow.
- **Body** (`--ds-font`): **Barlow** 400/500/600. Fallback: system sans.
- **Data** (`--ds-font-mono`): **IBM Plex Mono** 400/500/600 — eyebrows, labels,
  table headers, metas, footers, chips, ledger figures. Fallback: SF Mono/Menlo.
- Scale: H1 32 / H2 23 / H3 18 / body 16 / caption 13. Mono labels are 10.5–12px,
  uppercase, letter-spaced (.08–.12em).
- Tabular numerals on all data (`font-variant-numeric: tabular-nums`).

### Shape & elevation
- Radii (crisper than Cupertino): `--ds-r-sm` 6 · `--ds-r` 10 · `--ds-r-lg` 14 · pill 980.
- Cool-tinted restrained shadows (`--ds-shadow*`); 1px hairline borders do the framing.
- `--ds-grad-brand` (deep steel → brand blue) is the ONE bold accent: masthead spine,
  progress segments, active chips, roadmap step badges.
- Motion: 220ms `cubic-bezier(.4,0,.2,1)`; respects `prefers-reduced-motion`.

---

## Components (class names)
`ds-wrap` (page container, `--wide` = 1200px) · `ds-hero` masthead + `ds-eyebrow` · `ds-card` ·
`ds-kpi-grid` / `ds-kpi` (counters: mono `__label`, display `__value`, `__delta--up/down`) ·
`ds-badge` (inspection chips: `--good/warn/bad/info/neutral` — mono uppercase) ·
`ds-callout` (fine print: `--good/warn/bad`) · `ds-table-wrap` + `table` (the ledger: mono
uppercase headers, hairlines, zebra) · `ds-chart` + `ds-chart__title` · `ds-footer` (mono,
"Prepared by smOS") · `ds-btn` (`--ghost`; `aria-disabled="true"` = inert) ·
**`ds-sheet`** › `ds-sheet__row` (`__metric` / `__read` + a `ds-badge` chip) — the
multi-point inspection sheet (metric / reading / status per row) ·
**`ds-wo`** › `ds-wo__row` (`__num` / `__title` / `__desc` / `__impact` with `b` and
`b.is-neutral`) + `ds-wo__net` (`__net-label` / `__net-value`) — the numbered work order
with right-aligned $ impact ·
**`ds-verdict`** — the display-face one-paragraph lede (em = accent) ·
`ds-roadmap` › `ds-step` (`.is-pending`) › `ds-step-num`, `ds-step-body` (`ds-step-title` /
`ds-step-desc` / `ds-step-actions`) — numbered client-journey hub used by `/bundle`.
**`/bundle` "operating-system console"** (dark shell framing bright report windows):
`ds-hub` › `ds-skip` · `ds-hub__head` (`ds-hub__eyebrow` / `ds-hub__title` / `ds-hub__sub`) ·
`ds-progress` (`__label`/`__count`/`__track`/`__seg.is-done`) · `ds-hubnav` › `ds-hubnav__btn`
(`.n`; `.is-active`; `.is-disabled`) · `ds-viewer-wrap` › `ds-viewer` + `ds-viewer__loader`
(`.is-on`) › `ds-spinner`. Entrance: `ds-anim` (`ds-rise`).

**Tokens:** `--ds-grad-brand` (steel→blue spine — the one bold accent) · `--ds-shell*`
(dark console chrome) · `--ds-fs-display` (clamped display scale) · `--ds-font-display`
(display face) · `--ds-ease-out` / `--ds-dur-fast` (motion).

Charts use `CHART_PALETTE` order + `CHART_THEME` (Barlow font, steel grid, point-style
legend). Hand-rolled SVG charts: area fill at .08 opacity, dashed amber target lines,
mono axis labels, emphasized endpoint dots.

### Report anatomy (the canonical monthly shape)

The Blue Rose "August Inspection" prototype defines the reference structure for a
periodic performance report — answer the client's three questions in the first screen:

1. **Masthead** (`ds-hero`) — report name, period, "Prepared by smOS", stamp.
2. **Verdict** (`ds-verdict`) — the month in one sentence.
3. **Counters** (`ds-kpi-grid`) — spend, results, cost/result, vs-target.
4. **Inspection sheet** (`ds-sheet`) — each KPI vs its contract target, chip-status.
5. **Evidence sections** — allocation vs plan, one honest chart, worked/didn't.
6. **Ledger table** (`ds-table-wrap`) — curated line items, spend-sorted, verdict chips.
7. **Work order** (`ds-wo`) — numbered next-month actions, each with $ impact.
8. **Fine print** (`ds-callout--warn`) — attribution caveats and audit methodology.

Numbers a client will quote must be **audited numbers** (CRM-reconciled where
possible), with platform-reported figures labeled as such — never present a
platform's self-attributed count as ground truth.

---

## Pre-delivery checklist
- [ ] No emoji as structural icons (SVG only); status uses color **+** text
- [ ] Text contrast ≥ 4.5:1; focus-visible rings intact
- [ ] Tabular numerals on data columns
- [ ] Reads correctly at 375px and in print/PDF (`break-inside: avoid` on cards)
- [ ] No raw hex in renderers — only `--ds-*` tokens / `ds-*` classes
- [ ] CSS inlined (self-contained); fonts are the one external link, with system fallbacks
- [ ] Footer says "Prepared by smOS"

Per-page deviations go in `design-system/pages/<name>.md` and override this Master.

---

## Application layer (Console)

The smOS operator UI (`ui/`, Next.js, local-only, see
`docs/ui-plan-design-system.md`) is a second surface built **on top of** Ledger,
not a fork of it. Reports stay editorial documents; the Console is a dense
operator app — persistent nav, live agent-run streaming, approvals, forms — and
needs primitives Ledger never defined (spacing scale, control heights, focus
rings, toasts, dialogs). Full reference: **[`APP.md`](./APP.md)**. Component
CSS: **[`smos-app.css`](./smos-app.css)**, loaded after the core stylesheet.
Living style guide / review gate: **[`preview/index.html`](./preview/index.html)**.

- Same palette, same type trio, same `--ds-shell*` dark-console chrome family
  `/bundle` already established — extended, never duplicated.
- Additive tokens only, in `smos-design-system.css`: 4pt spacing scale
  (`--ds-space-1…10`), control heights (`--ds-control-sm/md/lg`), focus rings
  (`--ds-focus`, `--ds-focus-shell`), z-layers, run-state colors
  (`--ds-run-queued/running/done/failed/waiting`), a completed shell family
  (`--ds-shell-hover/-selected/-accent`), and `[data-density]` (compact default,
  comfortable alternate).
- Enforced by `test/ui-no-raw-hex.test.js` (mirrors `hero-uniform.test.js`):
  no literal hex besides `#fff`, no font-family outside `--ds-font*`.
- Icon sprite: `icons.svg` (stroke, `currentColor`, 24×24) — status is always
  color **+** text via `ds-badge`, never icon color alone. `preview/index.html`
  inlines a copy of the sprite, so a new symbol must be pasted there too.
- **"Aurora" (2026-09-09)** — the Console's glass finish, additive on the same
  `--ds-shell*` family. Frosted chrome (rail, topbar, statusbar, ⌘K palette,
  dialogs, toasts, inspector, tooltips) over a drifting ambient wash; **data
  surfaces stay opaque** so a number never sits on a shifting background. Glass
  tokens (`--ds-glass-*`, `--ds-shell-glass-*`, `--ds-aurora-*`) and the chart
  palette (`--ds-chart-1…7`, aliases of the semantic hues, ordered to match
  `CHART_PALETTE` in `design_system.py`) live in the core stylesheet; reports
  never reference them. Details and the pre-screen checklist: `APP.md`.
- Console charts are **Recharts** (`ui/` only — reports keep Chart.js), all
  routed through `ChartCard`, which owns the loading/empty/error/"Show table"
  states so none can ship without them.

## Light / dark mode

Every HTML report supports auto (OS `prefers-color-scheme`) **and** a manual
override, via `[data-theme="light"|"dark"]` on `<html>`. Both directions win over
the media query. Wired automatically — no per-renderer work needed:

- `reportHead()`/`report_head()` inject a pre-paint bootstrap `<script>` that reads
  a saved preference from `localStorage` (`smos-theme`) before first paint (no
  flash-of-wrong-theme).
- `heroHeader()`/`hero_header()` render the `.ds-theme-toggle` sun/moon button by
  default (top-right of the masthead) and its click-wiring script. Pass
  `themeToggle: false` / `theme_toggle=False` to suppress it (used by the
  permanently-dark `/bundle` shell chrome, not its light report windows).
- All `--ds-*` tokens (surfaces, ink, lines, semantic colors, tints) have dark
  variants in `smos-design-system.css`; renderers must reference tokens, never
  literal hex, or they silently opt out of theming.
- **Print/PDF is always light** — `@media print` force-overrides every token back
  to the light values with `!important`, since `scripts/render_pdf.py` (headless
  Chromium) has no "OS setting" to honor and printed deliverables stay light.
- Chart.js theming (`CHART_THEME`) and any canvas-drawn elements must resolve
  colors via `getComputedStyle(document.documentElement).getPropertyValue('--ds-*')`
  at draw time — never bake in a literal hex — and re-draw on `.ds-theme-toggle` click.
