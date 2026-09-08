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

## What's here (Phase B)

- `app/page.tsx` — Clients board, reads `skills/smos-status/status.js` output
  for every `clients/*` slug (via `lib/status.ts`, which shells out to the
  existing CLI contract rather than importing its `main()`).
- `app/clients/[slug]/page.tsx` — minimal per-client pipeline view (Phase C
  will build out the full Pipeline/Runs/Reports/Data/Approvals/Profile tabs).
- `app/approvals/page.tsx` — read-only listing over `data/approvals/*.json`
  (`lib/approvals.ts`). Deciding an approval from the UI is Phase D.
- `app/runs/` — the run console: POSTs a prompt to `/api/runs`, which spawns
  `claude -p <prompt> --output-format stream-json --verbose [--resume <id>]`
  in the repo root via `lib/registry.ts`, then tails it over SSE
  (`/api/runs/[runId]/stream`). The registry (not the route handler) owns the
  child process and its event buffer, so a dropped/reconnected browser tab
  replays from any `since` offset instead of losing or duplicating output.
- `app/api/reports/[...path]` — serves rendered report HTML/PDF for an iframe
  viewer, from `clients/<slug>/reports/<date>/<file>` or
  `public/reports/<slug>/<file>` (path-traversal guarded).

## Design system

`app/layout.tsx` imports `../../design-system/smos-design-system.css` and
`smos-app.css` directly — there is no UI-specific fork. `public/icons.svg` is
a symlink to `design-system/icons.svg` (one sprite, one source of truth).
`test/ui-no-raw-hex.test.js` (repo root) enforces token discipline against
`ui/**/*.css` once any exist — components here use only `ds-*` classes and CSS
custom properties, no raw hex/inline styles beyond CSS-variable references.

## Not yet built (see docs/ui-plan-design-system.md § 4)

- Full screen set (Phase C): tabs, dense data grid views over `paths.js`
  `DATA_FILES`, command palette (⌘K), Settings/Health.
- Permission-prompt bridge + approvals decide UI (Phase D) — `claude -p` runs
  currently execute with the default permission mode; no
  `--permission-prompt-tool` wiring yet.
- Skill launcher forms (Phase E) — blocked on a `skills/manifest.json` schema;
  the palette/compose box sends raw prompt text today.
