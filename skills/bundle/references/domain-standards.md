# bundle — Domain Standards

Embedded rationale for the deliverables hub. Self-contained.

## Why a numbered journey (not a flat list)

A client doesn't experience deliverables as a folder of files — they experience an
engagement that *progresses*. The hub mirrors the smOS pipeline as a numbered path so the
client reads their own story start→end: where they began (Pre-Audit), what we found
(Audit, Research), what we decided (Strategy, Audience), what we made (Creative, Content
Plan), and how it's performing (Reports). The bold circular step numbers make that arc
legible at a glance.

## Phase order is fixed; presence is dynamic

The 8-phase order is constant (it is the pipeline). Which phases are *present* depends on
how far the engagement has progressed.

- **Present phase** → active numbered step + an "Open" button (or several, for the reports group).
- **Missing phase** → muted, dashed "In progress" step with an inert button. This is the
  default because the roadmap should communicate the *whole* journey — a gap reads as
  "coming next," not "broken." Use `--only-ready` only when the client should see a clean
  list of just-finished work (e.g. a mid-engagement check-in).

## Newest wins

Reports accumulate (multiple weekly/monthly files). For single-instance phases the newest
filename wins (dates sort lexicographically descending). The `reports` group keeps **all**
matches, newest-first, each as its own button — the client can open any past report.

## Design-system discipline

The roadmap is the `ds-roadmap` component in `design-system/smos-design-system.css`
(`ds-step`, `ds-step-num`, `ds-step-body`, `ds-btn`). Never inline hex or fork styles in
`bundle.js` — if the roadmap needs a visual change, edit the CSS once so every future hub
inherits it (the same single-source-of-truth rule as every other smOS deliverable).

## Self-contained copies

Every smOS report inlines its CSS at render time, so copying the `.html` into
`public/reports/{slug}/` yields a working, offline-safe file with no asset rewriting. The
hub links to siblings by relative filename, so the whole folder is portable.

## Boundary with /portal

`/portal` is a *live dashboard* — it aggregates current metrics, billing, and approvals
into one generated page. `/bundle` is an *archive hub* — it links to the finished report
documents themselves. They are complementary: portal answers "how are we doing right now,"
bundle answers "show me everything you've delivered."
