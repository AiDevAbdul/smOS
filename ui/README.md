# smOS Operator UI

Local Next.js (App Router) console for the whole smOS pipeline. Runs on the
operator's `claude` CLI subscription login — no `ANTHROPIC_API_KEY` needed or
wanted. See `docs/ui-plan-design-system.md` for the full research/plan.

## Run it

```sh
npm install        # from the repo root (workspaces: ["ui"])
npm run ui         # next dev, http://localhost:3000
```

Or `cd ui && npm run dev` directly.

**Auth:** the UI shells out to the `claude` binary on PATH using the terminal's
existing login. If `ANTHROPIC_API_KEY` (or any other API-key auth source) is
set in the shell that starts `npm run ui`, `claude` will prefer it over the
subscription OAuth login and runs will behave differently (synthetic/empty
responses, connectors disabled) — unset it before starting the dev server.

## What's here

- `app/page.tsx` — Clients board, reads `skills/smos-status/status.js` output
  for every `clients/*` slug (via `lib/status.ts`, which shells out to the
  existing CLI contract rather than importing its `main()`).
- `app/clients/[slug]/` — the full client workspace: `layout.tsx` +
  `components/ClientTabs.tsx` route Pipeline / Runs / Reports / Data /
  Approvals / Profile as tabs; `/clients/[slug]` redirects to `./pipeline`.
  Reports opens dated + public-hub renders in an iframe
  (`components/ReportViewer.tsx`); Data is a collapsible JSON inspector
  (`components/JsonViewer.tsx`) over every `paths.js` `DATA_FILES` entry that
  exists on disk; Profile reads `profile.json`; the client-scoped Approvals
  tab is read-only and links to the global inbox for decisions.
- `app/approvals/page.tsx` — the global Approvals inbox, decidable in-UI:
  `components/ApprovalDecision.tsx` posts to
  `app/api/approvals/[id]/decide`, which wraps
  `scripts/lib/approvals.js`'s fail-closed `decide()` and surfaces its
  errors (expired/wrong-role/already-decided) verbatim.
- `app/runs/` — the run console: POSTs a prompt to `/api/runs`, which spawns
  `claude -p <prompt> --output-format stream-json --verbose [--resume <id>]`
  in the repo root via `lib/registry.ts`, then tails it over SSE
  (`/api/runs/[runId]/stream`). The registry (not the route handler) owns the
  child process and its event buffer, so a dropped/reconnected browser tab
  replays from any `since` offset instead of losing or duplicating output.
  An opt-in checkbox routes the run's tool-use permission checks through the
  UI (`components/PermissionBanner.tsx` polls and renders Allow/Deny) via a
  headless permission-prompt bridge — see below.
- `app/settings/page.tsx` + `lib/health.ts` — `claude --version`
  (best-effort), a read-only summary of `hooks/hooks.json`, env var **names**
  present under an allowlist (never values), and MCP servers found on disk.
- `components/CommandPalette.tsx` — ⌘K/Ctrl+K overlay backed by
  `lib/skill-routes.ts` (mirrors CLAUDE.md's Workflow Routing table; external
  /not-bundled skills show as unavailable rather than pretending to run).
  Hands off to `/runs?slug=&prompt=`.
- `app/api/reports/[...path]` — serves rendered report HTML/PDF for the
  Reports tab's iframe viewer, from `clients/<slug>/reports/<date>/<file>`
  or `public/reports/<slug>/<file>` (path-traversal guarded).
- `mcp/ui-permission-bridge/` (repo root, not under `ui/`) — a standalone
  stdio MCP server implementing Claude Code's `--permission-prompt-tool`
  contract: bridges a run's tool-use permission requests to
  `app/api/permissions` and blocks until a human decides in the UI. Opt-in
  per run (default off — existing runs are unaffected). **The exact
  request/response schema is a best-effort implementation** (see the header
  comment in `index.js`) and needs verification against the installed CLI.
  Registering it with Claude Code (`claude mcp add` or a `.mcp.json` entry)
  is documented there too — not auto-registered.

## Design system

`app/layout.tsx` imports `../../design-system/smos-design-system.css` and
`smos-app.css` directly — there is no UI-specific fork. `public/icons.svg` is
a symlink to `design-system/icons.svg` (one sprite, one source of truth).
`test/ui-no-raw-hex.test.js` (repo root) enforces token discipline against
`ui/**/*.css` once any exist — components here use only `ds-*` classes and CSS
custom properties, no raw hex/inline styles beyond CSS-variable references.

## Not yet built (see docs/ui-plan-design-system.md § 4)

- `skills/manifest.json` (Phase E's data layer, 42 entries) exists but isn't
  wired into `CommandPalette.tsx` yet — the palette still uses the simpler,
  independently-authored `lib/skill-routes.ts` and sends raw prompt text
  rather than rendering a real per-skill args/flags form.
- Hooks → local event POST (part of Phase D) — hooks still run exactly as
  they do from the terminal; they don't push lifecycle events into the UI.
- Real-world verification of the permission-prompt-tool bridge's request/
  response schema (see `mcp/ui-permission-bridge/index.js`'s header comment).
