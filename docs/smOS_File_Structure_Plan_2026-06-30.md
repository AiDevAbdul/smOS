# smOS — File & Folder Structure: Deep Dive + Restructure Plan
**Date:** 2026-06-30 · **Goal:** turn the flat, format-mixed file sprawl into a clean, predictable, maintainable layout — and make it stay clean by centralizing path logic.

---

## 1. What's actually messy (evidence)

I walked every data-producing directory. The core problem is that **four different *kinds* of file are dumped into the same folder**: source-of-truth JSON (engine data), human-facing renders (`.md` / `.html` / `.pdf` of the same content), dated recurring reports, and internal state files. Nothing separates them.

**`clients/blue-rose-auto/` — flat dump of 28 files.** One folder holds:

- raw engine data: `client_profile.json`, `audit_raw.json`, `audience_map.json`, `strategy_brief.json`, `ad_copy.json`, `content_plan.json`, `content_calendar.json`, `launch_plan.json`, `launch_artifacts.json`, `competitor_intel.json`, `baseline_snapshot.json`, `inbox.json`
- the *same* artifacts rendered 3 ways: `ad_copy.md` / `.html` / `.pdf`, `audience_map.md/html/pdf`, `content_plan.md/html/pdf`, `strategy_brief.md/html/pdf` — so each deliverable's three formats sit next to unrelated raw JSON
- state/instructions: `pixel_install_instructions.md`
- **2.2 MB of PDFs in one client folder** (7 files, 185–443 KB each)

**`clients/<slug>/reports/` — dated-file soup.** Weekly reports, audits, a competitor report, and `content_sops.html` all share one flat folder, each in several formats, plus a `sent.json` *state* file mixed in. Date formats are inconsistent: `2026-06-19`, `2026-06-25`, and a timestamped `competitor_report_2026-06-30T04-25-17`.

**Top-level `reports/` is misnamed.** It holds **global research cache** (`cat_*.json` niche caches + `*_market_research.html`), not client reports. It collides conceptually with `clients/*/reports/` and `data/reports/`.

**`data/reports/market-research/` is empty/dead** (0 code references) — a duplicate concept of the top-level `reports/`.

**`prospects/<slug>/` repeats the same mess** at smaller scale: `pre_audit.html/.pdf` + `page_audit.json` + `synthesis.json` flat, with a nested `reports/` holding raw scrape dumps named inconsistently (`raw_self_20260621.json`, `raw_self_1782275843.json` — epoch vs date).

**`public/reports/` is generated output that isn't treated as such.** It's the published white-label hub (numbered HTML). Only `.vercel` is gitignored — `public/` itself isn't — so build output would be committed. It also contains a **typo-slug duplicate `bluersoeauto`** (the real slug is `blue-rose-auto`).

**Test fixtures pollute real data dirs.** `clients/__bv_test_*`, `clients/_gatetest`, `clients/it-intake-audit-fixture`, `billing/__portal_test_*` live alongside the real `blue-rose-auto`/`port-co`. They're gitignored, but they clutter the working tree and make `ls clients/` confusing.

**`.gitignore` gaps.** `reports/*.pdf` is ignored but `clients/**/*.pdf` is **not** — the 2.2 MB of regenerable client PDFs would be committed and bloat the repo. HTML renders (also regenerable) aren't ignored either.

**Root cause (the part that matters most):** there is **no central path module**. Every skill hardcodes its own `resolve(dir, "ad_copy.json")` / `resolve(clientDir, "reports")`. Paths are constructed in **23 files under `skills/` + `scripts/`**. So the layout can't be changed in one place, and every new skill reinvents where to put things — which is why it drifted.

---

## 2. Design principles for the clean structure

1. **Separate by concern, not by client whim.** Four buckets, always: `data/` (engine source-of-truth JSON), `deliverables/` (human/client renders), `reports/` (dated recurring outputs), `state/` (internal bookkeeping).
2. **Keep an artifact's formats together, apart from raw data.** All three renditions of "strategy brief" (`.md/.html/.pdf`) live in one place; the raw `strategy_brief.json` the engine reads lives in `data/`.
3. **One folder per report run, dated.** No more flat dated-file soup; raw data travels with its report as `.raw.json`.
4. **Generated, regenerable files are gitignored** (`.pdf`, `.html`, `public/`); source data (`.json`) and authored markdown stay in git.
5. **One source of truth for paths** — a `scripts/lib/paths.js` module every skill imports. Change the layout once, everywhere follows.
6. **Names are consistent:** kebab-case slugs and artifact names; dates always `YYYY-MM-DD`.

---

## 3. Proposed canonical structure

### Per client

```
clients/<slug>/
├── CLAUDE.md                       # client config (unchanged)
├── profile.json                    # was client_profile.json (canonical identity)
├── data/                           # engine-owned JSON — read/written by skills
│   ├── baseline_snapshot.json
│   ├── audit_raw.json
│   ├── competitor_intel.json
│   ├── audience_map.json
│   ├── strategy_brief.json
│   ├── ad_copy.json
│   ├── content_plan.json
│   ├── content_calendar.json
│   ├── launch_plan.json
│   ├── launch_artifacts.json
│   ├── creative_test_plan.json
│   └── inbox.json
├── deliverables/                   # human-facing renders, grouped per artifact
│   ├── strategy-brief/strategy-brief.{md,html,pdf}
│   ├── ad-copy/ad-copy.{md,html,pdf}
│   ├── audience-map/audience-map.{md,html,pdf}
│   └── content-plan/content-plan.{md,html,pdf}
├── reports/                        # dated recurring reports, one folder per run
│   └── <YYYY-MM-DD>/
│       ├── weekly.{md,html,pdf}
│       ├── weekly.raw.json
│       ├── audit.{md,html,pdf}
│       ├── before-after.{md,html,pdf}
│       ├── monthly-review.{md,html,pdf}
│       └── competitor.{html,pdf}
└── state/                          # internal bookkeeping, never shared
    ├── sent.json
    └── pixel_install_instructions.md
```

### Per prospect (same model, smaller)

```
prospects/<slug>/
├── data/            # page_audit.json, competitor_summary.json, synthesis.json, raw/*.json
│   └── raw/         # raw scrapes, consistently named raw_self_<YYYY-MM-DD>.json
└── deliverables/    # pre-audit/pre-audit.{html,pdf}
```

### Global / top-level

```
data/
├── niches/                    # unchanged (auto.json, dental.json, …)
└── research-cache/            # ← renamed from top-level reports/
    ├── niches/cat_*.json      # niche category caches
    └── market-research/*.html # market research renders
public/                        # GENERATED web hub — gitignored (build output)
proposals/<slug>/ , contracts/<slug>/   # already clean per-client (keep; gitignored)
billing/<slug>/ledger.json     # real ledgers only — fixtures moved out
logs/                          # unchanged (gitignored)
```

**Removed / cleaned:** delete the dead `data/reports/`; delete the typo slug `bluersoeauto` (prospects + public); relocate all test fixtures out of `clients/` and `billing/` into `test/fixtures/` (or have tests write to a temp dir).

---

## 4. The maintainability fix: `scripts/lib/paths.js`

A single module that every skill imports, so paths are never hardcoded again:

```js
// scripts/lib/paths.js  (illustrative API)
export const clientRoot      = (slug) => …/clients/<slug>
export const clientProfile   = (slug) => clientRoot(slug)/profile.json
export const clientData      = (slug, file) => clientRoot(slug)/data/<file>
export const clientDeliverable = (slug, artifact, ext) =>
                 clientRoot(slug)/deliverables/<artifact>/<artifact>.<ext>
export const clientReport    = (slug, date, type, ext) =>
                 clientRoot(slug)/reports/<date>/<type>.<ext>
export const clientState     = (slug, file) => clientRoot(slug)/state/<file>
export const prospectData / prospectDeliverable = …
export const researchCache   = (file) => …/data/research-cache/<file>
```

Skills change from `resolve(dir, "ad_copy.json")` → `clientData(slug, "ad_copy.json")` and from `resolve(clientDir, "reports", \`${end}_weekly.md\`)` → `clientReport(slug, end, "weekly", "md")`. One file owns the layout forever after.

---

## 5. Migration plan (phased, safe — full 262-test suite as the gate)

**Phase 1 — Foundations (no behavior change).**
Add `scripts/lib/paths.js`. Add `scripts/migrate-layout.js` — an idempotent mover with `--dry-run` that relocates existing files (and a back-compat *reader* shim: if a new path is missing, fall back to the old location so nothing breaks mid-migration).

**Phase 2 — Rewire skills (23 files).**
Replace hardcoded paths with `paths.js` calls, skill by skill, running that skill's tests after each. Update each `SKILL.md` "Writes:" line and the CLAUDE.md "Output Formats" section to match.

**Phase 3 — Migrate existing data.**
Run `migrate-layout.js` on `blue-rose-auto`, the prospects, `port-co`. Verify the published hub still resolves. Run the full suite (262 tests).

**Phase 4 — Hygiene.**
`.gitignore`: add `*.pdf`, `clients/**/deliverables/**/*.html`, `public/`. Relocate test fixtures to `test/fixtures/`. Delete dead `data/reports/` and the typo slug. Rename top-level `reports/` → `data/research-cache/`.

**Phase 5 — Lock it in.**
Add a test asserting skills don't write outside the four sanctioned buckets, so the layout can't silently drift again.

**Risk & mitigation:** 23 files touch paths; the back-compat reader + per-skill test runs + the dry-run mover + the full suite contain the blast radius. Migration is reversible (it moves, doesn't delete; originals can be restored from git for tracked files).

---

## 6. Effort

| Phase | Work | Effort |
|---|---|---|
| 1 | `paths.js` + dry-run mover | ~0.5 day |
| 2 | Rewire 23 skills + docs | ~1–1.5 days |
| 3 | Migrate data + verify | ~0.25 day |
| 4 | gitignore + fixtures + renames + deletions | ~0.25 day |
| 5 | Drift-guard test | ~0.25 day |

Net: ~2.5 days for a permanently clean, self-policing layout.

---

## 7. Execution status — "Foundations first" (done this session)

You chose **by-artifact** grouping and **foundations first**. Completed and verified:

- **`scripts/lib/paths.js`** — the single source of truth for every data path (by-artifact
  deliverables, four buckets, plus legacy back-compat resolvers). Locked in by
  **`test/paths.test.js`** (6 tests) so the layout can't silently drift.
- **`scripts/migrate-layout.js`** — idempotent, **dry-run by default**, never deletes
  (moves only). Verified: it correctly plans **39 moves** for `blue-rose-auto` and **8** for
  prospect `abdulwahab`, with **zero unclassified files**. Not applied to live data yet
  (that's the deferred follow-up, after skills are rewired onto `paths.js`).
- **`.gitignore`** — now ignores regenerable renders (`*.pdf`, generated `*.html`,
  `public/reports/`) so the 2.2 MB of client PDFs and build output stop bloating the repo.
- **`public/reports/index.json`** — the stray typo-slug (`bluersoeauto`) entry removed, so
  the published hub no longer links a duplicate page (3 clean entries remain).
- **`scripts/cleanup-layout.sh`** — one-shot script for the physical dir operations
  (delete empty `data/reports/`, rename `prospects/bluersoeauto → blue-rose-auto`, remove
  the stray `public/reports/bluersoeauto/`). These are **deletes/renames the Cowork sandbox
  mount blocks (EPERM)** — run this script once in your normal environment.

**Deferred to the follow-up (as agreed):** rewiring the 23 skills onto `paths.js`, renaming
top-level `reports/ → data/research-cache/`, running `migrate-layout.js --apply` on live
data, relocating test fixtures, and the §5 Phase-5 drift-guard test.

---

## 8. Execution status — Skill rewire (Phase 2, done this session)

The skills are now wired onto the centralized path module — running the migration is safe.

- **`clientFile()` classifier added to `paths.js`** — one function maps any logical filename
  to its canonical bucket (profile / data / deliverables-by-artifact / state), prefers the
  canonical path on reads, falls back to the legacy flat location, and creates parent dirs
  on writes. The bucket rules now live in exactly one place.
- **~27 skills rewired** onto `clientFile` / `clientReport` (paid core, organic, aux, and the
  report-cluster) — reads and writes both routed through the module. Dated reports now write
  to `reports/<YYYY-MM-DD>/<type>.{md,html,pdf,raw.json}`.
- **Shared loaders rewired:** `guards.loadClientProfile` and `tokens.loadProfile` resolve
  `profile.json` with `client_profile.json` fallback.
- **Hub readers rewired:** `bundle.js` (deliverables + a dual-layout dated-report scanner),
  `portal.js`, and `render-report.js` — all resolve via `clientFile`/`prospectData` with
  legacy fallback, so they work both before and after migration.
- **Test harness + e2e updated** to assert against resolved (canonical-or-legacy) paths.
- **End-to-end verified:** applied `migrate-layout.js --apply` to a copy of `blue-rose-auto`
  → clean four-bucket layout; then `bundle` resolved all 9 hub phases, and `content-plan` +
  `portal` read `profile.json` and wrote to `deliverables/` on the migrated layout. **All 268
  tests pass** (262 baseline + 6 new), proving cross-skill data flow survives the rewire.

**Now safe to run on your live data** (in your environment — the sandbox mount blocks moves):

```
node scripts/migrate-layout.js --all            # dry run, review
node scripts/migrate-layout.js --all --apply     # perform the moves
```

**Still remaining (smaller, clearly-scoped):** rename top-level `reports/ → data/research-cache/`
(touches research.py / report.py and ~5 readers), relocate test fixtures out of `clients/`,
and add the §5 drift-guard test that asserts skills only write inside the four buckets.
