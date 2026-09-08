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

## New tokens (in `smos-design-system.css`, additive)
- **Spacing** (4pt grid): `--ds-space-1` … `--ds-space-10` (4→64px). No literal px margins/padding in new components.
- **Controls**: `--ds-control-sm/md/lg` (28/36/44), `--ds-input-pad`, `--ds-icon`, `--ds-icon-lg`.
- **Focus**: `--ds-focus` (light surfaces), `--ds-focus-shell` / `--ds-shell-focus` (dark shell surfaces).
- **Z-layers**: `--ds-z-rail/panel/overlay/toast/palette` — use these, never a magic z-index.
- **Run/session state**: `--ds-run-queued/running/done/failed/waiting` — mapped onto existing hues, no new colors.
- **Shell completions**: `--ds-shell-hover`, `--ds-shell-selected`, `--ds-shell-accent` (alongside the existing `--ds-shell/-2/-3/-ink/-mut/-line`).
- **Density**: `[data-density="compact"]` (default) vs `[data-density="comfortable"]` on `<html>`, widens control/space tokens.

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
| `ds-btn--danger/--icon/--sm/--lg/--on-shell`, `.is-loading` | Button variants beyond Ledger's default/`--ghost` |

## Icons
`icons.svg` is a stroke-based sprite (`currentColor`, 24×24 viewBox). Reference via
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
