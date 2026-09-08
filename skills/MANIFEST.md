# skills/manifest.json

`manifest.json` is a machine-readable index of every LOCAL (bundled) smOS skill —
one entry per companion CLI script under `skills/<slug>/<slug>.js` — for the
operator UI's future command-palette/launcher forms (see
`docs/ui-plan-design-system.md` § 4, Phase E: "Skill launcher forms — needs a
skills/manifest.json ... since companions have no shared arg parser"). Until a
UI wires it in, the palette sends raw `/skill` slug text; this file is what lets
a future launcher render a real form (positional args + flags) instead of a bare
text box.

## How it was generated

By hand, from direct inspection — not automated. For each directory under
`skills/` with a `<slug>.js` (or equivalent) companion:

1. Grepped the script's `process.argv` handling (usage comment header, plus
   `args[0]`, `args.includes("--flag")`, `args.indexOf("--flag")`,
   `args.find((a) => a.startsWith("--flag="))` patterns) to determine the
   positional args and recognized flags.
2. Cross-referenced the one-line intent + `/command` form from CLAUDE.md's
   `## Workflow Routing` table.
3. Where a companion takes a sub-action positional (not a flag) — e.g.
   `billing invoice|list|mark-paid`, `crm add|list|show|stage|...`,
   `catalog list|create|sync|feed|items|sets` — modeled it as an `args` entry
   with an `enum` rather than a flag.

## Keeping it in sync

There is **no automated sync**. If a skill's companion changes its flags,
subcommands, or usage shape, this file drifts silently until someone
hand-updates it. When touching a companion script's argv handling, update its
entry here in the same change.

## Notes / judgment calls

- `image-gen` has two companions sharing one `/image-gen` command:
  `image-gen.js` (organic, fills `content_calendar.json`) and
  `image-gen-ads.js` (paid, fills `ad_copy.json` angles) — both are listed as
  separate manifest entries (`slug: "image-gen"` and `slug: "image-gen-ads"`)
  since they have different flags and inputs, but share the same `/image-gen`
  command string.
- `/smos-status` maps to `skills/smos-status/status.js` (script filename
  doesn't match the directory slug) — same pattern is worth watching for if
  new skills are added inconsistently.
- `audit-creative` and `creative` take a required subcommand positional
  (`collect|aggregate`, `skeleton|lint`) rather than flags — both stages need
  Claude in the loop (vision scoring / copy generation) so the companion alone
  is not a full round-trip.
- Rows from CLAUDE.md's main Workflow Routing table NOT included above because
  they have no local companion script under `skills/`: `frontend-design` (the
  `skills/frontend-design/` dir on disk is a generic third-party design-guidance
  skill with only a `SKILL.md` + `LICENSE.txt`, not one of smOS's own
  slug-routed skills, and has no CLAUDE.md route). All other Workflow Routing
  rows resolved to a companion 1:1 or 1:2 (image-gen).
- The `external` block lists skills CLAUDE.md explicitly marks as **not
  bundled** (Strategic Intelligence Layer + Per-Platform Content Production
  tables) — included for completeness so a launcher can grey them out /
  explain why they're missing, rather than silently omitting them.
