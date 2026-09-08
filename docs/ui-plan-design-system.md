# smOS Operator UI — Research, Reasoning & Plan (Step 1: Design System)

**Status:** Phases A–E all shipped 2026-09-08. Remaining: real-world verification of the
`--permission-prompt-tool` schema assumption in `mcp/ui-permission-bridge/`, and wiring
`skills/manifest.json` into the command palette (still hand-authored `ui/lib/skill-routes.ts`).
**Date:** 2026-09-08 · **Owner:** Abdul

## Phase C/D/E — shipped 2026-09-08 (built in parallel, three isolated worktree agents)
- **Phase C (screens):** every client now has real tabs —
  `ui/app/clients/[slug]/layout.tsx` + `ClientTabs.tsx` route Pipeline / Runs /
  Reports / Data / Approvals / Profile as nested App Router pages;
  `/clients/[slug]` redirects to `./pipeline`. Reports tab lists dated +
  public-hub renders and opens them via `ReportViewer.tsx` (iframe over the
  existing `/api/reports` route). Data tab is a collapsible `ds-json`
  inspector (`JsonViewer.tsx`) over every `paths.js` `DATA_FILES` entry that
  exists on disk for that client. Profile tab reads `profile.json` into a
  `ds-kv` sheet. Client-scoped Approvals tab is read-only, linking to the
  global inbox for decisions.
- **Phase C (palette + health):** `CommandPalette.tsx` — a `ds-palette`
  overlay opened via ⌘K/Ctrl+K or the topbar button, backed by
  `ui/lib/skill-routes.ts` (a hand-authored mirror of CLAUDE.md's Workflow
  Routing table, ~39 local routes + the two external/not-bundled tables
  marked unavailable so the palette never pretends an uninstalled skill
  ran). Selecting a route hands off to `/runs?slug=&prompt=`, so
  `RunConsole`/`runs/page.tsx` gained an `initialPrompt` prop. `Settings`
  (new nav entry) + `ui/lib/health.ts` surface `claude --version`
  (best-effort), a read-only `hooks/hooks.json` summary, env var **names**
  present under an allowlist (never values), and MCP servers found on disk.
- **Phase D (approvals + permissions bridge):** approvals are now decidable
  from the UI — `ui/app/api/approvals/[id]/decide` wraps
  `scripts/lib/approvals.js`'s fail-closed `decide()`, and
  `ApprovalDecision.tsx` adds Approve/Deny (role, decided-by, note) to every
  pending row in `/approvals`. A headless permission-prompt bridge
  (`mcp/ui-permission-bridge/`, one MCP tool `approve`) lets a run route its
  tool-use permission checks to a human in the UI instead of the CLI's
  default headless behavior — opt-in per run via a checkbox in the Run
  console (`usePermissionBridge`, default off, existing callers unaffected).
  Registering the bridge with Claude Code (`claude mcp add` or a
  `.mcp.json` entry) is documented in the server's header comment, not
  automated. **The exact `--permission-prompt-tool` call/response schema is
  a best-effort implementation, flagged as needing real-world verification
  against the installed CLI version** — see the comment block at the top of
  `mcp/ui-permission-bridge/index.js`.
- **Phase E (skill manifest):** `skills/manifest.json` — a 42-entry
  machine-readable catalog of every bundled skill's companion CLI (slug,
  `/command`, description, positional args incl. sub-action enums like
  billing's `invoice|list|mark-paid`, flags), built by inspecting each
  companion's `process.argv` handling and cross-referencing CLAUDE.md.
  `skills/MANIFEST.md` documents how it was generated and that it needs
  hand-updating when a skill's flags change (no automated sync). **Not yet
  wired into the command palette** — the palette still uses the simpler,
  independently-authored `ui/lib/skill-routes.ts`; a follow-up should make
  the palette read `manifest.json` instead so launcher forms can render real
  positional/flag inputs per skill rather than a raw text line.
- **How this landed:** four subagents ran in parallel, each in an isolated
  git worktree with a disjoint file-ownership scope to avoid collisions.
  Three of the four had branched before this session's Phase B commit
  existed on `feat/phase5-crm`, so each independently reconstructed the
  `ui/` baseline to build against rather than merging it — integrating their
  work back was done by hand-applying each agent's actual diff against the
  real, single Phase B baseline (not a raw multi-branch `git merge`),
  resolving the one genuine overlap (`RunConsole.tsx`: Phase D's
  permission-bridge checkbox/banner and Phase C's `initialPrompt` prop, on
  disjoint lines — both kept). Verified after integration: `npm run build
  --workspace ui` clean, `npm test` 370/370, and a live dev-server smoke
  test of every route (all client tabs, settings, approvals, runs) confirming
  real data renders rather than empty error boundaries.

## Phase B — shipped 2026-09-08
- `ui/` — Next.js App Router workspace (`npm run ui` from repo root), Node
  runtime only, TypeScript, plain CSS from `design-system/*` (no Tailwind).
  Root `package.json` gained `"workspaces": ["ui"]`.
- `ui/lib/registry.ts` — in-process run registry: spawns
  `claude -p <prompt> --output-format stream-json --verbose [--resume <id>]`
  in the repo root, owns the child process + NDJSON event buffer (survives
  `next dev` HMR via `globalThis`), independent of any one HTTP request.
- `ui/app/api/runs` (POST start / GET list), `ui/app/api/runs/[runId]/stream`
  (SSE tail with `since`-offset replay), `ui/app/api/runs/[runId]/cancel`
  (SIGTERM) — verified end-to-end against the real `claude` binary (spawn →
  NDJSON parse → SSE replay → session-id capture → exit status all confirmed
  working; the one live-run failure seen while testing was this sandboxed
  session's own `ANTHROPIC_API_KEY` shadowing OAuth login in the child
  process, not a scaffold defect — see `ui/README.md` § Auth).
- `ui/lib/status.ts`, `ui/lib/approvals.ts` — server-side data loaders.
  `status.ts` shells out to the existing `skills/smos-status/status.js` CLI
  (its `main()` runs unconditionally at import time, so it's invoked as a
  child process exactly like the CLI does, not imported as a library).
  `approvals.ts` reads `data/approvals/*.json` read-only.
- `ui/app/api/reports/[...path]` — serves report HTML/PDF for an iframe
  viewer from `clients/<slug>/reports/<date>/` or `public/reports/<slug>/`,
  path-traversal guarded.
- Minimal screens proving the loop end-to-end (full screen set is Phase C):
  Clients board (`/`), client workspace (`/clients/[slug]`), Approvals inbox
  (`/approvals`, read-only), Run console (`/runs`) with live SSE stream view
  and session resume.
- `ui/app/layout.tsx` imports `smos-design-system.css` + `smos-app.css`
  directly; `ui/public/icons.svg` symlinks to `design-system/icons.svg` — one
  source of truth, no forked styles.
- `ui/next.config.ts`: `outputFileTracingRoot` at repo root,
  `serverExternalPackages` for `sharp`/`@resvg/resvg-js`/`@supabase/supabase-js`/`satori`.
- `ui/instrumentation.ts` loads the repo's `.env` via `scripts/lib/load-env.js`
  on server start, same as every other script.
- `npm run build --workspace ui` passes clean (TypeScript + Turbopack, no
  raw-hex/tracing warnings after fixes). Root `npm run ui` starts the dev
  server.
- Open decisions from § 6 resolved with the doc's own recommendations (owner
  did not override before Phase B started): compact density default, chat/
  free-text mode included in the Run console alongside skill-routed prompts,
  `ui/` as an npm workspace.
- Not done yet (Phase C/D/E per § 4): full tab set per client, dense data
  grid over `DATA_FILES`, ⌘K command palette, Settings/Health screen,
  `--permission-prompt-tool` bridge, approvals decide-from-UI, skill launcher
  forms (needs `skills/manifest.json`).

## Phase A — shipped 2026-09-08
- `design-system/smos-design-system.css` — additive application tokens (spacing, control, focus, z-layer, run-state, shell completions, density), non-breaking to existing reports.
- `design-system/smos-app.css` — new Console component layer (shell, nav, palette, grid, run/stream/tool-call, approvals, forms, toasts, dialogs).
- `design-system/icons.svg` — stroke icon sprite.
- `design-system/preview/index.html` — living style guide / review gate (light+dark+shell, all components).
- `design-system/APP.md` — component reference; `design-system/MASTER.md` gained an "Application layer (Console)" section.
- `test/ui-no-raw-hex.test.js` — guardrail (no raw hex beyond `#fff`, no non-token font-family), scans `design-system/smos-app.css` and (once it exists) `ui/**/*.css`. Full suite: 370/370 passing.
- Open before Phase B: open `design-system/preview/index.html` in a browser and confirm it visually — automated tests only check token discipline, not the eye.
**Goal:** a local web UI for the whole smOS setup that runs on the Claude subscription
(no Anthropic API key), starting with an *application* design system layered on Ledger.

---

## 1. Research findings

### 1.1 Running Claude on subscription, no API key (verified 2026-09-08)

| Path | Works on Pro/Max login? | Notes |
|---|---|---|
| `claude -p … --output-format stream-json` (local CLI 2.1.263) | **Yes** | Same OAuth login as interactive CLI. NDJSON events: `system/init`, `assistant`, `tool_use`, `tool_result`, `permission_denied`, `result` (has `session_id`, `total_cost_usd`, `num_turns`). `--input-format stream-json` gives a bidirectional session. `--resume <id>` / `--session-id <uuid>` for continuity. Slash skills are invoked by putting `/analyze slug` in the prompt text. |
| Claude Agent SDK (TS/Python) | **No (not permitted)** | Docs: "Anthropic does not allow third party developers to offer claude.ai login … for their products, including agents built on the Claude Agent SDK. Use API key authentication." Off the table for this project. |
| Claude Code desktop app / Remote Control / claude.ai/code | Yes, but generic | A chat UI for Claude Code, no smOS domain layer (pipeline, approvals, reports, client data). Our UI adds the domain layer; it does not need to replace the chat. |

**Permission prompts in headless mode:** `--permission-prompt-tool <mcp_tool>` routes every
permission request to an MCP tool we write (stdio server that POSTs to our local UI server
and blocks until the operator clicks Approve/Deny). Project `hooks/hooks.json` (naming,
budget, brand, destructive guards) still executes under `-p`, so guardrails are preserved.
Hooks can also `curl` the local server to emit lifecycle events.

**Implication:** the UI is a *thin local server that shells out to the installed `claude`
binary in the repo cwd*, plus a browser front end. Everything deterministic (status,
approvals, file reads, report viewing) never touches Claude and costs zero subscription quota.

### 1.2 What the repo already gives us (integration seams)

| Need | Existing seam |
|---|---|
| Pipeline state per client (done / partial / missing) | `skills/smos-status/status.js` → JSON `{sections[{key,label,steps[{id,label,status,detail}]}], next_action}`; read-only, no API |
| Filesystem layout | `scripts/lib/paths.js` (`clientRoot`, `clientData`, `clientReport`, `publicHub`, legacy `resolveExisting()`) |
| Approvals | `scripts/lib/approvals.js` — fail-closed state machine, local JSON store `data/approvals/*.json` + `audit.jsonl`, RBAC roles, `requestApproval` / `decide` / `isApproved`. Natural home for an Approvals inbox (replaces `portal.js`'s `mailto:` hack). |
| Skill execution contract | `node skills/{slug}/{slug}.js {slug} [flags]` → one JSON object on stdout, exit 0 ok / 2 usage / 3 halt / 4–7 skill gates. **No shared arg parser** (each companion hand-rolls flags). |
| Reports | Self-contained HTML in `clients/{slug}/reports/{date}/` and `public/reports/{slug}/` — embed via iframe exactly as `/bundle` does |
| Visual language | `design-system/smos-design-system.css` (966 lines, ~35 KB) + `MASTER.md`; loaders `scripts/lib/design_system.js` / `.py`; dark console chrome already exists as the `--ds-shell*` token family used by `skills/bundle/bundle.js` |
| Prior UI thinking | Only client-facing BI (Metabase/Grafana in `docs/smOS_Strategic_Roadmap.md`, portal upgrade in `docs/agency-os-roadmap.md`). No operator UI, no Electron/Tauri. Greenfield. |

Repo is pure ESM, Node ≥18 (24.15 installed), no web framework, no build tooling.

---

## 2. Reasoning: why a *design system first*, and what kind

### 2.1 Ledger is a document system; the UI needs an application system

Ledger was designed for client deliverables: one-column reading, print/PDF, hero masthead,
sheets, work orders. An operator console has different jobs:

| Dimension | Ledger (reports) | Operator UI (needed) |
|---|---|---|
| Density | Editorial, generous | Dense, scannable, many clients on one screen |
| Chrome | None (page = document) | Persistent nav rail, top bar, status bar, side panels |
| State | Static | Live: streaming agent output, running/queued/failed, pending approvals, TTL countdowns |
| Inputs | None | Forms (skill args), toggles, command palette, dialogs, confirmations |
| Feedback | None | Toasts, inline errors, skeletons, progress, empty states |
| Spacing | Literal px in component rules | Needs a real scale (4-pt grid) and control heights |
| Motion | Entrance only | Streaming text, list reorder, focus management, reduced-motion |
| Accessibility | Contrast, print | Keyboard nav, focus rings, ARIA live regions for streams, roving tabindex |

Building screens without these primitives means every screen hand-rolls them, which is
exactly the "fork per report" failure Ledger was created to stop.

### 2.2 Extend, don't fork — the metaphor already exists

`/bundle` established the operator metaphor: a **dark operating-system console framing
bright work sheets**. The operator UI is that console at full size. Same type trio
(Barlow Semi Condensed / Barlow / IBM Plex Mono), same steel-blue accent, same semantic
pass/caution/action chips, same hairline rules. Every `--ds-*` token and `ds-*` class stays
contract-stable so reports rendered *inside* the UI look native without a second theme.

Naming: **"Ledger / Console"** — Ledger is the sheet, Console is the shell around it.

### 2.3 Architecture in one picture

```
ui/  — one Next.js (App Router) app, run locally with `next dev` / `next start`
├─ app/**/page.tsx   Server Components: import status.js / approvals.js / paths.js directly,
│                    read clients/** and public/reports/** on the server (no REST needed)
├─ app/api/runs/*    Route Handlers (Node runtime): spawn `claude -p --output-format stream-json
│                    --input-format stream-json --verbose --permission-prompt-tool
│                    mcp__smos-ui__approve` (cwd = repo root) → stream as SSE (ReadableStream)
├─ app/api/permissions/*  receives POSTs from the permission-bridge MCP tool; resolves when
│                    the operator clicks Approve/Deny in the UI
├─ app/api/reports/[...path]  serves report HTML for the iframe viewer
└─ Server Actions   approvals.decide(), mark/resume sessions, small writes
Client Components: run stream, approval cards, command palette, forms (plain CSS from
design-system/*.css imported in app/layout.tsx — no Tailwind, no UI kit)
Claude Code CLI (subscription login) → skills/, hooks/, CLAUDE.md load exactly as today
```

No API key anywhere. Only the runner consumes subscription quota; the UI shows
`num_turns` / `duration_ms` per run so quota use is visible.

**Next.js specifics that matter here**
- **Node runtime only** for every route handler and server component that spawns or reads
  files; never `runtime = 'edge'`. Streaming SSE works on the Node runtime.
- Long-lived runs: a Claude run can exceed a request lifetime. Keep a **process registry in
  a module-level singleton** (Map of `runId → child process + event buffer`) so a client can
  disconnect/reconnect and replay; the SSE handler tails the buffer rather than owning the
  process. `next dev` HMR resets module state, so persist the registry via
  `globalThis` (dev) and treat runs as resumable via `--resume <session_id>`.
- **Repo imports**: `ui/` has its own `package.json`; it imports `../scripts/lib/*.js` and
  `../skills/smos-status/status.js` relatively (ESM). Mark native/heavy deps as
  `serverExternalPackages` (`sharp`, `@resvg/resvg-js`, `@supabase/supabase-js`) and set
  `outputFileTracingRoot` to the repo root.
- **Env**: load the repo's `.env` via `scripts/lib/load-env.js` inside `instrumentation.ts`
  (server startup) so the same `META_*` / `SUPABASE_*` values apply. Never expose them with
  `NEXT_PUBLIC_`.
- **Local only**: no Vercel deploy target for `ui/`; add `ui/` to the root Vercel ignore so the
  existing `public/` static deploy is unaffected. Bind to `localhost` only.
- **Design system**: `design-system/smos-design-system.css` + `smos-app.css` imported as
  global CSS in `app/layout.tsx`; the theme bootstrap script from `design_system.js` runs
  in `<head>` (inline, before paint). CSS Modules allowed only for layout glue, never for
  colors/type.

---

## 3. Design-system plan (Phase A — the deliverable of the next session)

### A1. Token audit + application tokens (`design-system/smos-design-system.css`, additive)
- **Spacing scale** `--ds-space-1 … -10` on a 4-pt grid (4, 8, 12, 16, 20, 24, 32, 40, 48, 64). Existing components untouched; new components use only the scale.
- **Control metrics** `--ds-control-sm/md/lg` (28/36/44 px), `--ds-input-pad`, `--ds-icon`.
- **Focus** `--ds-focus` (2px accent ring + 2px offset), `--ds-focus-shell` for dark chrome.
- **Layers** `--ds-z-rail/panel/overlay/toast/palette`.
- **Density** `[data-density="compact"|"comfortable"]` switching the spacing scale.
- **Shell family** completed: keep `--ds-shell, -2, -3, -ink, -line, -mut`, add `--ds-shell-hover`, `--ds-shell-selected`, `--ds-shell-accent`, `--ds-shell-focus`, and dark-mode semantic tints readable on shell surfaces.
- **State colors for runs**: `--ds-run-queued / running / done / failed / awaiting` mapped to existing neutral/blue/green/red/amber — no new hues.
- Export: `scripts/lib/design_tokens.js` that parses the CSS `:root` block → `tokens.json` for JS consumers (charts, canvas). CSS stays the single source of truth.

### A2. Application component layer (`design-system/smos-app.css`, loaded after core)
Prefix `ds-` retained. States for every interactive component: default / hover / focus-visible / active / disabled / loading / selected.

| Group | Components |
|---|---|
| Layout | `ds-app` grid (rail + topbar + main + inspector), `ds-rail`, `ds-topbar`, `ds-statusbar`, `ds-panel`, `ds-split` (resizable), `ds-inspector` |
| Navigation | `ds-nav-item` (rail), `ds-tabs`, `ds-breadcrumb`, `ds-client-switcher`, `ds-palette` (⌘K command palette with `/skill` routing mirroring the CLI table in `CLAUDE.md`) |
| Data | `ds-grid` (dense table: sticky header, sortable, row select, mono numerics), `ds-kv` (key-value sheet), `ds-json` (collapsible JSON viewer for handoff files), `ds-file-chip` |
| Status | `ds-badge` (reuse), `ds-dot` (pulse for running), `ds-progress` (reuse), `ds-skeleton`, `ds-empty` |
| Pipeline | `ds-step` (reuse; add `.is-partial` tri-state to match `status.js` `partialStep`), `ds-track` (horizontal phase track for the client header) |
| Agent run | `ds-stream` (assistant text, markdown), `ds-tool-call` (collapsible: tool, args, result, duration), `ds-run-header` (session id, model, turns, elapsed), `ds-run-list` |
| Approvals | `ds-approval-card` (action, slug, summary, payload diff, required role, TTL countdown, Approve/Deny), `ds-permission-toast` (headless permission prompt bridge) |
| Forms | `ds-input`, `ds-select`, `ds-switch`, `ds-field` (label + hint + error), `ds-textarea`, `ds-form-row` |
| Feedback | `ds-toast` stack, `ds-dialog` (native `<dialog>`), `ds-confirm` (typed-confirmation for destructive/budget actions), `ds-inline-error` |
| Actions | `ds-btn` variants: primary / ghost / danger / icon; sizes sm/md/lg; loading state |

### A3. Living style guide — the review gate
`design-system/preview/index.html` (static, self-contained, opened directly or via `npx serve`):
every component in **light**, **dark**, and **inside the shell**, at 375 / 1024 / 1440 px,
with reduced-motion and keyboard-focus demos. Screenshot via Chrome DevTools MCP for
approval before any screen is coded. This is the "August Inspection" moment for the UI.

### A4. Spec + guardrails
- `design-system/MASTER.md` gains an **"Application layer (Console)"** section; component reference in `design-system/APP.md`.
- New test `test/ui-no-raw-hex.test.js`: no literal hex / no non-token font-family in `ui/**` and `smos-app.css` component rules (mirrors `hero-uniform`).
- Checklist additions: focus-visible on every control, ARIA `role="log"` + `aria-live="polite"` on streams, 44 px touch targets in comfortable density, no emoji as icons (SVG sprite `design-system/icons.svg`).

### A5. Screen inventory the system must serve (informs A2 scope; screens are Phase C)
1. **Clients board** — all clients, phase track, next action, pending approvals count, last run.
2. **Client workspace** — header (slug, status, spend, accounts), tabs: Pipeline · Runs · Reports · Data · Approvals · Profile.
3. **Run console** — compose (`/skill slug flags`), live stream, tool timeline, resume session.
4. **Approvals inbox** — global, from `approvals.js`; filters by role/TTL/action.
5. **Reports** — iframe viewer reusing `/bundle` hub nav.
6. **Data** — JSON handoff inspector per `paths.js` `DATA_FILES`.
7. **Settings / Health** — `claude --version`, login state, MCP servers, env keys present (never values), hooks loaded.

---

## 4. Phases after the design system (for sizing only)

| Phase | Scope | Depends on | Status |
|---|---|---|---|
| B. Next.js scaffold + runner | `ui/` App Router app: layout shell, server-side data loaders (status/clients/data/reports), `app/api/runs` spawner with stream-json → SSE, process registry, session resume | A | **Done** 2026-09-08 |
| C. Screens 1–7 | App Router routes `/`, `/clients/[slug]/(pipeline\|runs\|reports\|data\|approvals\|profile)`, `/approvals`, `/settings`; Client Components only where interactive; everything styled with `ds-*` | A, B | **Done** 2026-09-08 |
| D. Permission + approvals bridge | stdio MCP `--permission-prompt-tool`, `approvals.decide()` UI, hooks → local event POST | B | **Done** 2026-09-08 — the `--permission-prompt-tool` schema is best-effort and needs real-world verification; hooks→event-POST wiring not done (out of scope for this pass) |
| E. Skill launcher forms | Needs a `skills/manifest.json` (or `args:` frontmatter) since companions have no shared arg parser; until then the palette sends raw `/skill slug` text | C | **Data layer done** 2026-09-08 (`skills/manifest.json`, 42 entries) — **not yet wired** into `CommandPalette.tsx`, which still uses the simpler hand-authored `ui/lib/skill-routes.ts` and sends raw text |

Deliberate exclusions: no Tailwind/shadcn (would fight Ledger tokens), no separate API
server (Next.js route handlers + Server Actions cover it), no Electron/Tauri (browser +
`next start` is enough), no Agent SDK (terms), no cloud deploy of the operator UI (local
only; client-facing surfaces stay `/portal` + `/bundle` on Vercel).

---

## 5. Decisions
- **Framework: Next.js App Router (decided by owner, 2026-09-08).** Single app in `ui/`,
  Node runtime, TypeScript, React 19 (Next default), plain CSS from `design-system/`.

## 6. Open decisions (owner)
1. Default density: compact (recommended for an operator console) vs comfortable.
2. Whether the operator UI should also embed a generic chat with Claude Code (yes, as the Run console's free-text mode) or only skill-routed runs.
3. `ui/` as an npm workspace of the root `package.json` vs a fully independent package (recommended: workspace, so `npm test` at root can include the no-raw-hex UI test).
