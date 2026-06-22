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

### Standard package taxonomy (Ducker Creative default catalog)

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

The Markdown template (`buildProposalMarkdown`) always emits these sections, in order:

1. **Title** — `Proposal — <Company>`, agency name + email + tagline.
2. **The opportunity** — from `/pre-audit`: `wins` under "What's working", `gaps` under
   "Where we see upside". If neither present, a single grounded sentence. If no audit
   at all, generic paid+organic framing.
3. **Recommended package** — name, `best_for`, headline `CUR price/month · one-time setup`,
   the `includes[]` list.
4. **How we work** — the smOS narrative: campaigns launch PAUSED, sign-off gated,
   every optimization logged, HTML+PDF reporting on cadence.
5. **Terms** — contract length, ad-spend handling, payment, cancellation (all from `terms`).
6. **Next step** — reply-to-approve CTA pointing at e-sign + onboarding.

### Hardcoded prose is an intentional CONSTANT (with an escape hatch)

Unlike pricing (catalog-driven), two prose blocks are **hardcoded English copy** inside
`buildProposalMarkdown` (`proposal.js` §"How we work" and the generic-opportunity
fallback sentences):

- the **"How we work"** paragraph (the smOS operating-system pitch), and
- the **generic-opportunity fallback** sentences used when `/pre-audit` produced no
  `wins`/`gaps`.

This is deliberate: it is fixed agency boilerplate, identical across every prospect, and
not a per-client variable — so it lives in code as a CONSTANT rather than as a value the
model improvises (the skill's own "does NOT invent prose" principle still holds, because
the copy is committed and reviewed, never generated at runtime). **If an agency needs this
copy to vary** (white-label, different methodology), externalize it into
`config/services.json` (e.g. an `agency.how_we_work` / `agency.generic_opportunity`
string) and have `buildProposalMarkdown` read it — the same catalog-driven pattern used
for pricing. Do **not** let the model free-write replacement prose at generation time.

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
