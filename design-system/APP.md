# smOS Console — Application Layer Reference

**Extends Ledger for the operator UI (`ui/`).** Reports never load this file; the
Console does. Source: [`smos-app.css`](./smos-app.css), loaded after
[`smos-design-system.css`](./smos-design-system.css). Live review page:
[`preview/index.html`](./preview/index.html) — open it (or `npx serve design-system/preview`)
before writing any screen; it is the approval gate.

Do not fork a third stylesheet. Every new Console component is added here, using only
`--ds-*` tokens (core + the application tokens below) and reusing Ledger classes
(`ds-badge`, `ds-btn`, `ds-verdict`, `ds-kpi*`, `ds-step*`) wherever a report component
already does the job.

## "Aurora" — the Console's glass finish (added 2026-09-09)

Ledger (documents) → Console (application) → **Aurora** (the Console's finish).
Additive on the existing `--ds-shell*` family; no new hues, no forked stylesheet.
Three rules, and they are not stylistic preferences:

1. **Glass goes on chrome and overlays only** — rail, topbar, statusbar, ⌘K palette,
   dialogs, toasts, inspector, chart tooltips, the mobile rail drawer.
2. **Data stays opaque.** Cards, tables and chart plots sit on `--ds-surface`. A number
   never sits on a shifting background, so contrast is provable rather than hopeful.
3. **Blur needs something behind it.** `backdrop-filter` over a flat fill renders
   *nothing*. The `ds-aurora` wash (and `.ds-app`'s dark radial gradient behind the
   chrome) is therefore load-bearing, not decoration.

Mixin: `.ds-glass`, `--strong` (0.86 alpha, for overlays carrying text over page
content), `--shell` (the always-dark chrome). Wash: `.ds-aurora` + three
`.ds-aurora__blob` children, `position: fixed`, `pointer-events: none`, drifting on
~50s keyframes, frozen under `prefers-reduced-motion`.

**Contrast note:** `--ds-faint` (#8695a5) is ~2.9:1 on white — fine for a hairline or a
decorative glyph, below AA for text. Small captions in this layer use `--ds-muted`
(~5.6:1). Verified by a Lighthouse pass (accessibility 100 on `/`).

## Charts (added 2026-09-09)

Recharts 3.x, `ui/` only — reports keep Chart.js. `ui/components/charts/`:
`ChartCard` (the wrapper every chart goes through — it owns the loading, empty, error
and "Show table" states so none can be skipped, and reserves height so async data can't
shift layout), `TrendChart`, `RankBar`, `DonutStat`, `FunnelBar`, `Gauge`, `Sparkline`,
`HeatCalendar`, `GlassTooltip`.

- `--ds-chart-1…7` are **aliases** of the semantic tokens (blue, green, amber, red, teal,
  purple, steel), in the same order as `CHART_PALETTE` in
  `scripts/lib/design_system.py`. Because they alias, a theme flip repaints every plot
  for free and neither side can drift.
- Colours are resolved at draw time by `useChartTheme()` (`ui/lib/chart-theme.ts`) from
  `getComputedStyle`, re-resolved on `smos:theme-change` and on the OS colour-scheme
  media query — the rule `MASTER.md` sets for every chart in the system. Never bake hex
  into a chart component.
- Series are distinguished by stroke pattern as well as hue; deltas pair colour with an
  arrow glyph. Colour is never the only carrier of meaning.
- **Say where the numbers came from.** `ChartCard`'s `source` prop renders a
  `ds-source-chip`; `--live` for real daily rows, `--approx` for windowed snapshots.
- **Match the form to the data.** `performance_analysis.json` holds *cumulative* 7/14/30-day
  windows, not successive periods — 30d spend is ≥ 7d spend by construction. Plotting
  them as a line draws a confident downward slope that is simply false, so the windows
  fallback switches to bars. Sparklines are suppressed entirely on that data.
- Formatters live in `ui/lib/format.ts`, **not** `chart-theme.ts`: the latter is
  `"use client"`, which turns its exports into client references that a Server Component
  cannot call. `LOCALE` there is pinned, because `Intl(undefined, …)` resolves the Node
  locale on the server and the browser locale on the client — a real hydration mismatch
  ("$19,800" vs "US$19,800").

## New tokens (in `smos-design-system.css`, additive)
- **Spacing** (4pt grid): `--ds-space-1` … `--ds-space-10` (4→64px). No literal px margins/padding in new components.
- **Controls**: `--ds-control-sm/md/lg` (28/36/44), `--ds-input-pad`, `--ds-icon`, `--ds-icon-lg`.
- **Focus**: `--ds-focus` (light surfaces), `--ds-focus-shell` / `--ds-shell-focus` (dark shell surfaces).
- **Z-layers**: `--ds-z-rail/panel/overlay/toast/palette` — use these, never a magic z-index.
- **Run/session state**: `--ds-run-queued/running/done/failed/waiting` — mapped onto existing hues, no new colors.
- **Shell completions**: `--ds-shell-hover`, `--ds-shell-selected`, `--ds-shell-accent` (alongside the existing `--ds-shell/-2/-3/-ink/-mut/-line`).
- **Density**: `[data-density="compact"]` (default) vs `[data-density="comfortable"]` on `<html>`, widens control/space tokens.
- **Glass**: `--ds-glass-bg/-bg-strong/-line/-highlight`, `--ds-glass-blur` (18px), `--ds-glass-sat` (140%); `--ds-shell-glass/-glass-2/-glass-line/-glass-hi` for the always-dark chrome.
- **Ambient wash**: `--ds-aurora-1/-2/-3` (light + dark variants) and `--ds-shell-aurora-1/-2` behind the chrome.
- **Charts**: `--ds-chart-1…7`, `--ds-chart-grid`, `--ds-chart-axis` — aliases, see above.

## Component index
| Class | Purpose |
|---|---|
| `ds-app` | CSS-grid shell: rail + topbar + main + statusbar |
| `ds-rail`, `ds-nav-item`, `ds-nav-group` | Left navigation; `.is-active`, `[aria-disabled]`, `__badge` count |
| `ds-topbar`, `ds-statusbar` | Fixed chrome above/below main |
| `ds-tabs` / `ds-tab` | Section switcher inside a client workspace |
| `ds-breadcrumb`, `ds-client-switcher` | Wayfinding |
| `ds-palette`, `ds-palette__item` | ⌘K command palette, routes to `/skill slug flags` |
| `ds-split`, `ds-split__handle` | Resizable two-pane (run list \| run detail) |
| `ds-panel`, `ds-inspector` | Generic surfaces / right-hand detail drawer |
| `ds-grid` | Dense sortable table (distinct from Ledger's `ds-table-wrap`, which stays for reports) |
| `ds-kv`, `ds-json`, `ds-file-chip` | Key-value sheets, collapsible JSON viewer, file reference chip |
| `ds-dot`, `ds-skeleton`, `ds-empty` | Status pulse, loading placeholder, empty state |
| `ds-track` | Horizontal compact pipeline (client header); `ds-step.is-partial` extends Ledger's roadmap step |
| `ds-run-header`, `ds-run-list`, `ds-stream`, `ds-tool-call` | Live agent run: header meta, session list, streamed text (`role="log" aria-live="polite"`), collapsible tool-call cards (`--failed` variant) |
| `ds-approval-card`, `ds-permission-toast` | Approvals inbox card (`--destructive` variant), headless permission-prompt bridge toast |
| `ds-field`, `ds-input`, `ds-select`, `ds-textarea`, `ds-switch`, `ds-form-row` | Forms for skill-launcher args |
| `ds-toast-stack`, `ds-toast`, `ds-dialog`, `ds-confirm__type-target`, `ds-inline-error` | Feedback: toasts (`--good/--warn/--bad`), native `<dialog>`, typed-confirmation target, inline error |
| `ds-btn--danger/--icon/--sm/--lg/--on-shell`, `.is-loading` | Button variants beyond Ledger's default/`--ghost`. `--on-shell` re-tones ghost for the dark chrome, where the light-surface ghost reads as a solid white pill |
| `ds-glass`, `--strong`, `--shell` | The one blur mixin — chrome and overlays only |
| `ds-aurora`, `ds-aurora__blob` | Ambient drifting wash; what makes blur read as glass |
| `ds-page`, `ds-band`, `ds-duo` | Screen content wrapper (`.ds-main` is a bare scroll container), main+side band, two-up grid. `.ds-page > * { min-width: 0 }` is what lets `auto-fit` grids actually reflow on a phone |
| `ds-sec`, `__title`, `__sub`, `__actions` | Section header with a right-aligned controls slot |
| `ds-metric-grid`, `ds-metric-card` (+`__label/__value/__unit/__foot/__delta--up|down|flat/__note/__spark`) | Opaque KPI card; `--ds-metric-accent` sets the top hairline |
| `ds-chart-card` (+`__head/__title/__unit/__actions/__body/__foot/__table`) | Chart container; `--ds-chart-h` reserves height |
| `ds-source-chip` (`--live`/`--approx`) | Data provenance — a chart that can't say where its numbers came from isn't trustworthy |
| `ds-tooltip-glass` (+`__label/__row/__swatch/__val`) | Hover readout for Recharts |
| `ds-sparkline` | Inline axis-free trend glyph |
| `ds-segmented`, `__btn` | iOS-style range switcher; a real `role="tablist"` so arrow keys work |
| `ds-ring`, `ds-ring-wrap`, `__label` | Completion ring (server-renderable — CSS classes, not `useChartTheme`) |
| `ds-card-grid`, `ds-client-card` (+`__head/__avatar/__name/__slug/__metrics/__metric*/__spark/__next*`) | The Overview client grid |
| `ds-attn`, `__row` (`--bad/--warn/--info`), `__icon/__title/__meta` | "Needs you" feed; capped height with its own scroll |
| `ds-rail__brand`, `__brand-mark`, `__brand-name`, `__collapse`, `__scrim` | Rail header, collapse toggle, mobile drawer scrim |
| `ds-topbar__search`, `__kbd`, `__menu` | ⌘K opener styled as a search field; mobile rail trigger |
| `ds-palette__group/__empty/__hint` | Palette section headings, empty state, keyboard legend |
| `ds-stagger` | Entrance stagger for a card group; set `--ds-i` per child |
| `ds-sr-only` | Visually hidden but announced |

## Icons
`icons.svg` is a stroke-based sprite (`currentColor`, 24×24 viewBox). **`preview/index.html`
inlines a copy of the sprite** (cross-file `<use>` needs a server), so a symbol added to
`icons.svg` must be pasted into the preview too or the style guide shows empty boxes.
Reference via
`<svg><use href="icons.svg#i-name"/></svg>` (or inline the sprite once per page — see
`preview/index.html` — when serving over `file://`, since cross-file `<use>` needs a
server). Status is never icon-color-only: pair with a `ds-badge` or text label.

## Rules (enforced by `test/ui-no-raw-hex.test.js`)
1. No literal hex colors or `rgb()/rgba()` literals in `ui/**` or `design-system/smos-app.css` component rules — tokens only.
2. No hardcoded `font-family` outside the three `--ds-font*` tokens.
3. Every interactive control defines `:hover`, `:focus-visible`, and a disabled/loading state.
4. Streaming regions use `role="log"` + `aria-live="polite"`; long lists get keyboard focus rings via `:focus-visible`, never `:focus`.
5. Report HTML embedded via iframe is never restyled from the Console side — it renders its own Ledger CSS untouched.

## Pre-screen checklist (mirrors Ledger's pre-delivery checklist)
- [ ] Reviewed in `preview/index.html` in light, dark, and inside `ds-app` shell
- [ ] Checked at 375 / 1024 / 1440px
- [ ] Every control keyboard-reachable with a visible focus ring
- [ ] No raw hex / literal font-family
- [ ] Reduced-motion respected (spinners/pulses become static)
- [ ] Density works in both `compact` and `comfortable`
- [ ] Glass only on chrome/overlays; every number sits on an opaque surface
- [ ] Charts: legend, tooltip, axis units, empty state, "Show table" fallback, and a
      `source` chip that names the provenance
- [ ] Theme flipped with a chart on screen — the plot repainted (didn't keep stale hues)
- [ ] Small captions use `--ds-muted`, not `--ds-faint` (AA)
- [ ] Lighthouse accessibility pass on the changed screen
