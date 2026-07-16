# Proposal — Domain Standards

Embedded expertise for `/proposal`. Read this when you need the package taxonomy,
the selection algorithm, pricing rules, the CRM transition matrix, or what a good
proposal looks like. Self-contained — no need to read other files first.

---

## 1. The service catalog is the single source of truth

All pricing, packages, and terms come from `config/services.json`. The script never
invents a number. To change pricing, **edit the catalog**, not `proposal.js`.

Catalog shape (see `io-contract.md` for the full schema):

```
{
  "agency": { name, tagline, email, website, logo_url },
  "packages": [ { id, name, monthly_retainer, currency, setup_fee, best_for, includes[] }, ... ],
  "terms":    { contract_length_months, ad_spend, payment, cancellation }
}
```

### Standard package taxonomy (default catalog)

| id | Name | Monthly | Setup | Best for |
|----|------|--------:|------:|----------|
| `starter` | Starter | $1,500 | $500 | New advertisers validating their first paid channel |
| `growth` | Growth | $3,000 | $750 | Brands with proof of concept ready to scale spend |
| `scale` | Scale | $6,000 | $1,000 | Established brands optimizing for efficiency at volume |

`includes[]` is cumulative in spirit ("Everything in Starter", etc.) but the script
prints each package's own list verbatim — it does not merge tiers.

---

## 2. Package-selection precedence (CONSTANT — do not change per client)

`pickPackage(catalog, { packageId, retainer })` resolves in this exact order:

1. **Explicit** — `--package <id>` given and found → use it. If the id is not in the
   catalog, **throw** listing available ids (never silently substitute).
2. **Closest-to-retainer** — no explicit id but the deal has `monthly_retainer > 0` →
   pick the package minimizing `|package.monthly_retainer − retainer|`.
3. **Default** — otherwise the package with `id === "growth"`, else the first package.

### Pricing rule

- The **headline monthly price** = the deal's `monthly_retainer` if `> 0`, else the
  package's `monthly_retainer`. (A negotiated per-deal number can override the list price.)
- The **setup fee** always comes from the package (`pkg.setup_fee`) — never overridden.
- Currency comes from the package (`pkg.currency`).

Worked examples:

| Input | Result |
|-------|--------|
| `--package scale`, deal retainer 2000 | Scale, headline $2,000/mo (deal overrides), setup $1,000 |
| no flag, deal retainer 2800 | Growth (|3000−2800|=200 < |1500−2800|), headline $2,800/mo |
| no flag, deal retainer 0 | Growth default, headline $3,000/mo |
| `--package gold` (not in catalog) | **Throws**: `No package "gold". Available: starter, growth, scale` |

---

## 3. CRM transition matrix (gated by `schemas/deal.js`)

The proposal advances the deal to `proposed` **only if** the state machine permits it
from the current stage. This is enforced by `isValidTransition(from, to)`.

Lifecycle order: `lead → contacted → audited → proposed → negotiating → won → lost → churned`.

| Current stage | `proposed` reachable? | What `/proposal` does |
|---------------|:---------------------:|-----------------------|
| `lead` | yes | set `stage=proposed`, set `links.proposal` |
| `contacted` | yes | set `stage=proposed`, set `links.proposal` |
| `audited` | yes | set `stage=proposed`, set `links.proposal` |
| `proposed` | already there | keep `proposed`, refresh `links.proposal` |
| `negotiating` | no | **keep** `negotiating`, only set `links.proposal` |
| `won` / `lost` / `churned` | no | **keep** current, only set `links.proposal` |

Rationale: never regress a deal that has progressed past proposal. A `won` deal
*requires* `links.proposal` to validate, so setting the link on later stages is
correct and safe.

Every CRM write appends an activity:
`{ at: ISO8601, type: "proposal", note: "proposed <Name> (<CUR> <monthly>/mo)" }`.

---

## 4. Proposal document anatomy (CONSTANT structure)

The proposal is the **opportunity-led Phase-2 sibling of the `/pre-audit` report**, built
as structured HTML (`buildProposalHtml`) on the shared design system — never the generic
`mdToHtml` path. A Markdown twin (`buildProposalMarkdown`) is emitted only for portability.
Both keep the same section order:

1. **Hero** (canonical `ds-hero` via `heroHeader`) — addressed to the CLIENT
   (`A growth engine for <Company>`), eyebrow `Growth Proposal · <Agency>`, "Prepared for
   <Company> · by <Agency> · <date>", and — when `/pre-audit` ran — snapshot pills:
   audit score, upside, follower count, competitor outspend.
2. **Continuity recall band** (`.prop-recall`) — quotes the Phase-1 score + upside + the
   audit headline verbatim. Omitted if no audit snapshot is available.
3. **The opportunity** — two columns (`.prop-col--win` / `--gap`) from the audit's
   `wins_tiers`/`gaps_tiers` (falls back to flat `wins`/`gaps`, then a grounded sentence).
4. **Recommended package** — a **"start here → step up" tier pair** (`pickTierPair`): the
   recommended tier featured, paired with the tier below (entry) when one exists. Each tier
   shows name, price/mo, setup, `best_for`, and `includes[]`.
5. **ROI band** (`.prop-roi`, dark) — the audit's top `opportunities` framed as what the
   retainer works toward, with an "targets locked at onboarding" disclaimer. Omitted if the
   audit produced no opportunities.
6. **How we work** — three translated cards (approve-before-spend / changes logged /
   fixed-cadence reporting). Client-facing language only — no `smOS`/`PAUSED`/API jargon.
7. **Your first 90 days** — a `ds-roadmap` 30/60/90 (from the audit `recommendations`,
   else a generic arc).
8. **Terms** — contract length, ad-spend handling, payment, cancellation (all from `terms`).
9. **Next step** — accept CTA (`mailto` approve) + a signature/date block + a validity date.

Exemplar rendering: `templates/proposal-report.html` (regenerate by running the skill).

### Hardcoded prose is an intentional CONSTANT (with an escape hatch)

Unlike pricing (catalog-driven), a few prose blocks are **hardcoded English copy** inside
`proposal.js` — the **"How we work"** cards, the **generic-opportunity fallback** sentence,
and the generic 30/60/90 roadmap used when `/pre-audit` produced no findings.

This is deliberate: it is fixed agency boilerplate, identical across every prospect, and
not a per-client variable — so it lives in code as a CONSTANT rather than as a value the
model improvises (the skill's own "does NOT invent prose" principle still holds, because
the copy is committed and reviewed, never generated at runtime). **If an agency needs this
copy to vary** (white-label, different methodology), externalize it into
`config/services.json` (e.g. an `agency.how_we_work` / `agency.generic_opportunity`
string) and have the builders read it — the same catalog-driven pattern used for pricing.
Do **not** let the model free-write replacement prose at generation time.

---

## 5. Pre-audit findings mapping

`loadFindings(slug)` reads the first of `prospects/{slug}/synthesis.json` then
`page_audit.json`. It maps loosely so different audit shapes still work:

- **wins** ← `findings.wins` || `findings.strengths`
- **gaps** ← `findings.gaps` || `findings.opportunities` || `findings.weaknesses`

List items may be strings or objects; objects render as `x.text || x.title ||
JSON.stringify(x)`. Missing/unparsable findings are non-fatal.

---

## 6. Good vs bad

**Good**

- Catalog edited to add a `retention` tier → `--package retention` works with zero code change.
- Prospect audited first → opportunity section cites their real gaps ("no retargeting, 0.4% CTR").
- Deal at `audited` → cleanly advances to `proposed`, PDF linked, activity logged.

**Bad**

- Writing a custom price into the document because "the client asked for a discount" — instead
  set the deal's `monthly_retainer` (overrides headline) or add a catalog tier.
- Forcing `stage=proposed` on a `won` deal — the matrix forbids the regression.
- Treating a missing PDF (no Playwright) as failure — HTML still ships and is linked.

---

## Keeping current

- Pricing/packages/terms change → edit `config/services.json` only.
- Stage rules change → they live in `schemas/deal.js` (`STAGES`, `TRANSITIONS`); this skill
  reads them, never duplicates them. Update the matrix table above if the schema changes.
- Re-verify downstream doc URLs against `skills/references-shared.md`.

**Last verified:** 2026-06-22
