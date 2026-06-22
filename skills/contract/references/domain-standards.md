# Contract — Domain Standards

Embedded expertise for the `/contract` skill. Defines what a smOS service agreement
contains, where each value comes from, and the rules that govern its lifecycle.
Self-contained: do not read the `.js` to understand the domain — consult this file.

---

## 1. The agreement structure (10 numbered sections)

`buildContractMarkdown` always emits these sections in order. They are CONSTANT; only the
interpolated values vary.

| # | Section | Content source |
|---|---------|----------------|
| — | Title + `_Effective {date}_` + disclaimer | `today()`; disclaimer is hardcoded |
| 1 | Parties | `agency.name`/`agency.email` (catalog); `client.company`, optional `contact_name`/`contact_email` (deal) |
| 2 | Services | `pkg.name` + `pkg.includes[]` (catalog package) |
| 3 | Fees | Monthly retainer (per-deal override > `pkg.monthly_retainer`), `pkg.setup_fee`, `terms.ad_spend` |
| 4 | Term & Renewal | `terms.contract_length_months`, then month-to-month |
| 5 | Payment | `terms.payment` |
| 6 | Cancellation | `terms.cancellation` |
| 7 | Intellectual Property | Hardcoded: client owns accounts/pages/pixels/brand/work product; agency keeps tools/process/smOS |
| 8 | Confidentiality | Hardcoded mutual-confidentiality clause |
| 9 | Limitation of Liability | Hardcoded: capped at last 3 months' fees; no results guarantee |
| 10 | Signatures | Markdown table: agency name pre-filled, client name from deal or blank line |

### Why the IP/confidentiality/liability clauses are hardcoded
They are agency-policy constants that should be identical across every client. Pricing and
scope vary per deal and therefore live in `config/services.json`. If a clause must change,
edit `buildContractMarkdown` (so every future contract inherits it) — never hand-edit one
client's `agreement.md`.

---

## 2. Fee-sourcing rules (the order of precedence)

1. **Monthly retainer** = `deal.deal.monthly_retainer` if `> 0`, else `pkg.monthly_retainer`.
   The per-deal value can differ from catalog list price (negotiated discount/uplift).
2. **Setup fee** = `pkg.setup_fee` (catalog only; not negotiated per-deal in this version).
3. **Ad spend** = `terms.ad_spend` string — always billed separately, paid directly to Meta,
   never inside the retainer. This MUST stay explicit so a client never thinks media is included.

All currency renders as `{pkg.currency} {amount.toLocaleString()}` (e.g. `USD 3,000`).

---

## 3. Package selection (delegated to `/proposal`'s `pickPackage`)

Same logic as the proposal, so contract and proposal never quote different packages:

- `--package <id>` → exact match (throws if the id is unknown, listing valid ids).
- else closest catalog package to `deal.deal.monthly_retainer`.
- else default `growth`, else the first package.

The three catalog packages (from `config/services.json`): `starter`, `growth`, `scale`.

---

## 4. Stage-transition rules (the sales pipeline state machine)

Defined in `schemas/deal.js`. `/contract` only ever performs two transitions:

| Trigger | From (allowed) | To | Guard |
|---------|----------------|----|-------|
| generate (default) | `proposed`, `contacted` | `negotiating` | `isValidTransition`; if illegal, stage is left unchanged (no crash) |
| `--mark-signed` | `proposed`, `negotiating` | `won` | `isValidTransition` AND `validate()` requires `links.proposal` |

**Load-bearing invariant:** a deal cannot become `won` without `links.proposal` on file
(schema-enforced, fail-closed). This guarantees the paper trail: pre-audit → proposal →
contract → win. `/contract` additionally requires `links.contract` before `--mark-signed`.

Terminal/other stages (`lost`, `churned`) are managed by `/crm`, not here.

---

## 5. Attorney-review policy (honesty principle)

The agreement is a **template**, never represented as binding or attorney-reviewed text.
Every artifact (Markdown, HTML, PDF) and the CLI JSON carry the disclaimer. This mirrors the
trademark-clearance honesty in `/brand-name`: the tool produces a starting point and tells the
human exactly where professional review is required. Do not remove or soften the disclaimer.

---

## 6. E-signature policy (best-effort, fail-closed)

- No `DROPBOX_SIGN_API_KEY` → manual mode, with a reason string. **Not an error.**
- Key set but no `client.contact_email` on the deal → manual mode (can't address a signer).
- Provider returns non-2xx or throws → manual mode with the status/message. **Never claim "sent".**
- Only a 2xx response yields `{ sent: true, mode: "dropbox_sign", request_id }`.

The live provider call is unverified against production; treating any non-success as manual is
deliberate so the skill never lies about delivery.

---

## 7. Good vs bad examples

**Good — generate then send, then record signature**
```
node skills/contract/contract.js acme            # → negotiating, agreement.{md,html,pdf}
node skills/contract/contract.js acme --send     # e-sign attempt (or manual fallback)
# client signs out-of-band
node skills/contract/contract.js acme --mark-signed   # → won, won_at stamped
```

**Good — override package for a custom scope**
```
node skills/contract/contract.js acme --package scale
```

**Bad — trying to win a deal that never had a proposal**
```
node skills/contract/contract.js acme --mark-signed
# exit 5: deal.stage=won requires links.proposal (run /proposal before marking won)
```

**Bad — hand-editing pricing into one client's agreement.md**
Edit `config/services.json` (or negotiate via `deal.deal.monthly_retainer`) instead, so the
HTML/PDF regenerate consistently and the contract matches the invoice.

---

## Keeping current

- Clause wording / IP / liability changes → edit `buildContractMarkdown` in `contract.js`.
- Pricing, package scope, term/payment/cancellation → edit `config/services.json`.
- Stage rules → `schemas/deal.js` (`TRANSITIONS`, `validate`).
- E-sign endpoint/version → see `api-reference.md`; re-verify against the live Dropbox Sign docs.

**Last verified:** 2026-06-22
