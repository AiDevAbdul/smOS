---
name: portal
description: Use this skill to generate a client-facing white-label dashboard via `/portal {slug}` — one self-contained HTML page blending paid performance, organic activity, the client's retainer plan, their invoice ledger, and no-login (mailto) content approvals. This skill should be used when the user asks to build, refresh, or send a client portal / white-label reporting page for a single client. It only reads already-persisted local artifacts and ledgers — it never fetches live Meta/Stripe data, issues invoices, or touches the CRM.
---

# /portal — Client Portal + White-Label Reporting (Phase 2.5 → Phase 5)

Render a per-client, read-only HTML dashboard that blends paid + organic results with the
Phase 5 commercial layer (plan, invoices, approvals) into one self-contained file. Every
section degrades to a "no data yet" line, so the portal runs even before campaigns are live.
The output is a hosted/emailed page, not a PDF deliverable.

## What This Skill Does

- Run `node skills/portal/portal.js <slug>` to render `clients/{slug}/portal.html`.
- Load the client profile + whatever artifacts exist, offline-safe — missing inputs never halt.
- Build seven sections in fixed order: Your Plan, Billing, Awaiting Your Approval, Paid Performance, Community, Content Calendar, Market Listening.
- Read the CRM deal (`crm-store.js → getDeal`) for the retainer plan and the invoice ledger (`billing-store.js → listInvoices`) for the billing table + per-currency outstanding balance.
- Emit `mailto:` Approve / Request-changes links for up to `approval_cap` (default 8) pending content items — no login, no backend.
- Render through `md_to_html.js → mdToHtml` shared tokens into one self-contained HTML file, then print a JSON summary of which sections had data.

## What This Skill Does NOT Do

- Issue/finalize invoices — that is `/billing` (this skill only displays the ledger).
- Create or advance the CRM deal / retainer terms — that is `/crm` (read-only here).
- Generate the proposal or contract — `/proposal` and `/contract`.
- Trigger any paid/organic action (launch, scale, publish, reply) — approvals are client-initiated emails the operator later records via `/inbox` or `/publish`.
- Produce a PDF — unlike `/report` or `/before-after`, the portal is an HTML page, not a `render_pdf.py` deliverable.
- Fetch live Meta/Stripe data — it reads already-persisted local artifacts and ledgers only.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/crm-store.js` (`getDeal`), `scripts/lib/billing-store.js` (`listInvoices`), `scripts/lib/md_to_html.js` (`mdToHtml`), `scripts/lib/load-env.js`; `config/services.json` (`agency.email`, `portal.approval_cap`); `schemas/deal.js`, `schemas/invoice.js` |
| **Conversation** | Which `{slug}`; whether the user wants it hosted/emailed after render |
| **Skill References** | Section taxonomy, formulas, source-of-truth constants in `references/domain-standards.md`; I/O shapes in `references/io-contract.md` |
| **Client Profile** | `clients/{slug}/client_profile.json` (`business.name` → white-label title) |

## Clarifications

> Before asking: check the conversation, the client profile, and the prior handoff files
> (`performance_analysis.json`, `inbox.json`, `content_plan.json`, `listening_snapshot.json`).
> Only ask the user for what cannot be determined from disk. Section logic, thresholds, and
> formulas live in `references/` — never ask the user for them.

**Required (must resolve before running):**
1. The client `{slug}` — must have `clients/{slug}/client_profile.json` on disk.

**Optional (ask only if relevant):**
2. After rendering, should the operator host or email the file? (Delivery is out of scope for the script.)
3. A non-default approval cap? (Set `config/services.json → portal.approval_cap`; default 8 — no code edit.)

## Workflow

1. Confirm `clients/{slug}/client_profile.json` exists (the script HALTs with exit 3 otherwise).
2. Confirm `config/services.json` has `agency.email` set. If absent, the script prints a `WARN:` to stderr and falls back to the `hello@agency.co` placeholder — do not ship that page; fix the config and re-run.
3. Run `node skills/portal/portal.js <slug>`.
4. The script loads the profile, CRM deal, invoice ledger, and any of `performance_analysis.json`, `inbox.json`, `content_plan.json`, `listening_snapshot.json`.
5. It assembles the seven Markdown sections, fills mailto approval links with the resolved agency email, and renders one self-contained HTML via `mdToHtml`.
6. It writes `clients/{slug}/portal.html` and prints a JSON summary of populated sections.
7. Verify the JSON summary + the stderr stream (no `WARN:`), open the HTML, confirm no smOS branding leaked, then hand off for hosting/emailing if requested.

## Input / Output Specification

**Inputs:** CLI arg `<slug>` · `clients/{slug}/client_profile.json` (required) · optional artifacts `performance_analysis.json`, `inbox.json`, `content_plan.json`, `listening_snapshot.json` · `config/services.json` (`agency.email`, `portal.approval_cap`) · CRM deal (`crm/pipeline.json`) + `billing/{slug}/ledger.json` via the store libs.
**Outputs:** `clients/{slug}/portal.html` (self-contained) + a stdout JSON summary `{ portal, client, sections{ plan, billing, approvals, paid, organic, content, listening } }`.
(Full schemas, example payloads, exit codes, edge cases: `references/io-contract.md`.)

## Variability Analysis

One concept per row — VARIES = per client/run; CONSTANT = encoded in the skill.

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Client name / white-label title | Seven-section order + heading labels |
| Retainer amount, currency, agreement-on-file flag | "no data yet" graceful-degrade pattern |
| Invoice rows, statuses, amounts, currencies | Outstanding-balance formula: `sum(total) − sum(paid)`, computed **per currency** |
| Whether a Stripe `hosted_url` exists per invoice | Pay-now gating: link shown only when `stripe.hosted_url` set AND `status ≠ paid` |
| Pending content items | Mailto Approve / Request-changes contract; `APPROVE` / `CHANGES` subject verbs |
| Paid / organic / content / listening metric values | KPI table columns (Spend, Conversions, CPA, ROAS, CTR) |
| Inbox interaction timestamps | SLA-breach rule: `first_reply_due_at` past AND `state ≠ replied` |
| Agency email (`config/services.json → agency.email`) | Placeholder sentinel `hello@agency.co` used **only** as last resort, with a stderr `WARN:` |
| Approval cap (`config/services.json → portal.approval_cap`) | Default cap 8 when config key absent |

> Both previously-hardcoded business policies are now config-driven: `portal.approval_cap`
> (default 8) and the `agency.email` fallback (now warns loudly on stderr). Changing the cap
> or contact email requires **no code edit** — only `config/services.json`. See
> `references/domain-standards.md` § Source-of-Truth Constants.

## Domain Standards

### Must Follow
- [ ] White-label: use only the client's name/brand and the agency identity — never leak smOS branding into client-visible copy.
- [ ] Read-only marketing-side: emit no action that touches Meta / Stripe / publish.
- [ ] Self-contained HTML: no external assets, so it hosts or emails as one file.
- [ ] Show only this client's data — never pipeline forecasts or other clients.
- [ ] Approvals must be no-login `mailto:` links to the resolved agency email.
- [ ] Verify no stderr `WARN:` fired (real `agency.email` resolved) before shipping.

### Must Avoid
- Hardcoding the agency email or approval cap at the call site — both resolve from `config/services.json`.
- Halting on a missing optional artifact — degrade to "no data yet".
- Writing a per-client renderer — always use `mdToHtml` shared tokens.
- Summing invoice totals across currencies — Billing groups outstanding per currency.

### Output Checklist (verify before delivery)
- [ ] `clients/{slug}/portal.html` exists and opens standalone (no broken external refs).
- [ ] Seven section headings present, in order, each populated or showing a graceful fallback.
- [ ] Billing outstanding equals issued − paid, reported **per currency** (no cross-currency total).
- [ ] Pay-now links appear only on unpaid Stripe invoices.
- [ ] Pending-content approve/changes links are valid `mailto:` to the real agency email (not the sentinel).
- [ ] No smOS branding visible; only client + agency identity.
- [ ] stdout JSON summary printed, no stderr `WARN:`, and the summary matches the visible sections.

## Error Handling

| Scenario | Action |
|----------|--------|
| No `<slug>` arg | Print `usage: portal.js <slug>`, exit 2 |
| `client_profile.json` missing | Print `HALT: <path> not found.`, exit 3 — never guess the profile |
| Optional artifact missing / corrupt JSON | `readJson` returns null; section renders "no data yet" (no halt) |
| `config/services.json` missing / no `agency.email` | Fall back to `hello@agency.co` AND print `WARN:` to stderr — operator must fix config and re-run before shipping |
| `portal.approval_cap` unset / non-positive | Default to 8 (no halt) |
| Mixed-currency ledger | Outstanding grouped per currency (`USD x · EUR y`); never a wrong single sum |
| CRM deal / ledger absent | Plan + Billing render their fallback lines |
| Supabase pointer / mirror persist fails | Best-effort only; HTML still written (do not fail the render) |

## Dependencies & Security

- **Scripts:** `skills/portal/portal.js` (the automation entry point; CLI `node skills/portal/portal.js <slug>`).
- **Reuses:** `scripts/lib/crm-store.js` (`getDeal`), `scripts/lib/billing-store.js` (`listInvoices`), `scripts/lib/md_to_html.js` (`mdToHtml`), `scripts/lib/load-env.js`; schemas `schemas/deal.js`, `schemas/invoice.js`.
- **External APIs:** none at render time — the portal reads persisted artifacts/ledgers. Stripe `hosted_url` is a pass-through link already stored by `/billing` (version pins + rate limits in `references/api-reference.md`).
- **Secrets:** no tokens needed to render; any Supabase mirror write (via the store libs) uses env-resolved keys — never hardcoded or logged. Output HTML contains only client-facing data; mailto links expose the agency email by design.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Stripe Invoices | https://docs.stripe.com/api/invoices | Source of the `hosted_url` Pay-now link shown in Billing |
| Stripe Versioning | https://docs.stripe.com/api/versioning | The `Stripe-Version` pin (`2026-05-27.dahlia`) stamping the stored `hosted_url` |
| WCAG 2.1 SC 1.4.3 Contrast | https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html | 4.5:1 / 3:1 AA contrast for the white-label palette |
| Meta Business Help Center | https://www.facebook.com/business/help | Authoritative reference for client-facing metric definitions |

To verify a version or field, fetch the official URL above, then apply the same conventions.
See `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Section taxonomy, balance/SLA/Pay-now formulas, white-label rules, the source-of-truth constants table (approval cap, email fallback, version pins), good/bad section examples |
| `references/api-reference.md` | Stripe `hosted_url` + version pins (Stripe `2026-05-27.dahlia`, Meta v25.0), Supabase mirror details, why no API is called at render, cited URLs, and how displayed-context versions stay current |
| `references/io-contract.md` | Full input/output JSON schemas, example payloads, exit codes, mixed-currency + every edge-case handling rule |
