# smOS Operator UI

Local Next.js (App Router) console for the whole smOS pipeline. Runs on the
operator's `claude` CLI subscription login — no `ANTHROPIC_API_KEY` needed or
wanted. See `docs/ui-plan-design-system.md` for the full research/plan.

## Run it

```sh
npm install        # from the repo root (workspaces: ui, mcp/ui-permission-bridge)
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
  headless permission-prompt bridge — see below. The launcher itself has two
  modes: **Skill** renders the selected skill's real positional args and flags
  from `skills/manifest.json` (`components/runs/SkillForm.tsx`) and shows the
  exact invocation it composes, and **Free text** is the original textarea.
- `app/settings/page.tsx` + `lib/health.ts` — `claude --version`
  (best-effort), a read-only summary of `hooks/hooks.json`, env var **names**
  present under an allowlist (never values), and MCP servers found on disk.
- `components/CommandPalette.tsx` — ⌘K/Ctrl+K overlay backed by
  `lib/skills-manifest.ts` (generated from `skills/manifest.json`, so it can't
  drift from the skills themselves; `lib/skill-routes.ts` remains the fallback
  for the external /not-bundled skills, which show as unavailable rather than
  pretending to run). Clients are searchable alongside skills. Picking a
  bundled skill hands off to its launcher form via
  `/runs?skill=<slug>&slug=<client>`; anything typed beyond the command and a
  slug is passed through verbatim as `/runs?prompt=` instead.
- `app/api/reports/[...path]` — serves rendered report HTML/PDF for the
  Reports tab's iframe viewer, from `clients/<slug>/reports/<date>/<file>`
  or `public/reports/<slug>/<file>` (path-traversal guarded).
- `mcp/ui-permission-bridge/` (repo root, not under `ui/`) — a standalone
  stdio MCP server implementing Claude Code's `--permission-prompt-tool`
  contract: bridges a run's tool-use permission requests to
  `app/api/permissions` and blocks until a human decides in the UI. Opt-in
  per run (default off — existing runs are unaffected). **The request/response
  schema is verified against Claude Code 2.1.265** — probe MCP server plus a
  real `claude -p` run on both the allow and deny path; the header comment in
  `index.js` records the exact wire. `lib/registry.ts` registers the server
  per run via an inline `--mcp-config`, so no `claude mcp add` or `.mcp.json`
  is needed. It is a root workspace, so its `@modelcontextprotocol/sdk`
  dependency is installed by the repo-root `npm install` along with `ui`.

## Design system

`app/layout.tsx` imports `../../design-system/smos-design-system.css` and
`smos-app.css` directly — there is no UI-specific fork. `public/icons.svg` is
a symlink to `design-system/icons.svg` (one sprite, one source of truth).
`test/ui-no-raw-hex.test.js` (repo root) enforces token discipline against
`ui/**/*.css` once any exist — components here use only `ds-*` classes and CSS
custom properties, no raw hex/inline styles beyond CSS-variable references.

## Not yet built (see docs/ui-plan-design-system.md § 4)

- Hooks → local event POST (part of Phase D) — hooks still run exactly as
  they do from the terminal; they don't push lifecycle events into the UI.

One manifest quirk the launcher works around: `/image-gen` is the command for
**two** entries (`image-gen` organic, `image-gen-ads` paid), so the skill
picker is keyed on the unique `slug`, and a shared command composes a prompt
that names the companion script. `test/skill-command.test.js` asserts
`/image-gen` is the only such collision — a new one fails there first.
