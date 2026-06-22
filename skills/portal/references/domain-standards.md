# /portal — Domain Standards

Embedded expertise for the white-label client portal. Read this when you need the section
taxonomy, the exact formulas, the white-label/privacy rules, the source-of-truth constant
inventory (with remediation paths), or good/bad examples. Self-contained — no runtime discovery.

## The portal's job

A client portal is the agency's single client-facing surface. It must answer, in one
glance, four questions the client actually has:

1. **What am I paying for?** (Your Plan)
2. **What do I owe?** (Billing)
3. **What do you need from me?** (Awaiting Your Approval)
4. **Is it working?** (Paid Performance, Community, Content Calendar, Market Listening)

Everything else — internal pipeline forecasts, other clients, agency margins — is invisible.

## Section taxonomy (fixed order)

| # | Heading | Data source | Populated when | Fallback line |
|---|---------|-------------|----------------|---------------|
| 1 | Your Plan | CRM deal (`getDeal`) | `deal.deal.monthly_retainer` > 0 | _Plan details will appear once your agreement is active._ |
| 2 | Billing | invoice ledger (`listInvoices`) | ≥1 invoice | _No invoices issued yet._ |
| 3 | Awaiting Your Approval | `content_plan.json` items, status `pending` | ≥1 pending (max `approval_cap`, default 8) | _Nothing needs your approval right now._ |
| 4 | Paid Performance | `performance_analysis.json` → `.summary` | summary present | _Performance data will appear once campaigns are live._ |
| 5 | Community | `inbox.json` → `.items` | ≥1 item | _No community activity captured yet._ |
| 6 | Content Calendar | `content_plan.json` → `.items` / `.pillars` | ≥1 item | _Your content calendar will appear here._ |
| 7 | Market Listening | `listening_snapshot.json` competitors/mentions | either non-empty | _Listening insights will appear here._ |

The order is CONSTANT — clients learn the layout. Never reorder per client.

## Formulas (exact — do not approximate)

- **Outstanding balance** = computed **per currency**: for each distinct `invoice.currency`,
  Σ `invoice.total` (that currency) − Σ `invoice.total` where `status === "paid"` (that currency).
  Displayed as one term per currency joined with ` · ` (e.g. `USD 3,000 · EUR 1,200`). Totals are
  **never** summed across currencies.
- **Pay-now link** appears only when `invoice.stripe.hosted_url` exists AND `status !== "paid"`.
  Otherwise the cell shows the raw status string (`draft|sent|paid|void`).
- **Inbox SLA breach** = item where `first_reply_due_at` is set, `Date.parse(first_reply_due_at) < now`,
  and `state !== "replied"`. Surfaced as "**N** awaiting reply".
- **Approval cap**: show at most the first `approval_cap` pending content items
  (`config/services.json → portal.approval_cap`, default 8 when unset or ≤ 0). More than the cap
  means the client is behind — the agency follows up directly rather than flooding the page.

## No-login approval contract

Approvals must work from a static HTML file with no backend, so each pending item gets two
`mailto:` links to the agency email:

- Subject: `[APPROVE] {clientName} post {item.id}` or `[CHANGES] {clientName} post {item.id}`
- Body: `Post: {date} · {platform}/{format}\nCaption: {first 140 chars}\n\nDecision: `
- All subject/body content is `encodeURIComponent`-escaped.

A hosted deployment MAY swap the `mailto:` action for a POST endpoint, but the default and
the guarantee is mailto. The operator records the client's emailed decision back into
`content_plan.json` via the owning organic skill.

## White-label & privacy rules

- Title and brand come from `client_profile.json` `business.name` (fallback `name`, then slug).
- Agency identity (email) comes from `config/services.json` `agency.email`; if unset, the script
  falls back to the `hello@agency.co` placeholder **and prints a `WARN:` to stderr** so a wrong
  contact email cannot ship unnoticed (see § Source-of-Truth Constants).
- Never render smOS, internal tooling names, pipeline `probability`, `weightedValue`, other
  clients' data, or agency-internal CRM fields (owner, next_action, lost_reason).
- Self-contained: `md_to_html` inlines all CSS — no CDN, no external fonts/images. The file
  must open offline and survive being emailed as an attachment.
- Accessibility: the shared design tokens target WCAG AA contrast (4.5:1 normal / 3:1 large).

## Source-of-Truth Constants (single inventory + remediation paths)

The two tunable business policies are now **config-driven** (no code edit needed); the two
version pins live in another skill's domain and need a tracked "keep current" path. This is the
single place that audits them, so a maintainer never has to grep the script.

| Constant | Current value | Where set | True invariant? | How to change / keep current |
|----------|--------------|-----------|-----------------|------------------|
| Approval cap | `8` (default) | `config/services.json → portal.approval_cap` | No — business policy | Edit the config key. Code falls back to 8 only when the key is absent or ≤ 0. No code edit. |
| Agency email | `agency.email` | `config/services.json → agency.email` | No — placeholder fallback | Set the real email in config. If unset, the script uses `hello@agency.co` **and warns on stderr** (`WARN:`), so a wrong contact email cannot ship unnoticed. No code edit. |
| Stripe API version | `2026-05-27.dahlia` | stamped upstream by `/billing` into the stored `hosted_url`; cited in `references/api-reference.md` | Pinned upstream | Portal makes no Stripe call and displays no version string, so it cannot introduce drift. "Keep current" = reconcile against `skills/references-shared.md` § 13 on the Last-verified date. |
| Meta Graph API version | `v25.0` | owned by paid/organic skills; cited in `references/api-reference.md` | Pinned upstream | Portal makes no Meta call and displays no version string. Reconcile against `references-shared.md` § 1 on each Last-verified pass. |

**Keeping current (single source of truth):** the portal reads no version constant of its own —
all version facts trace to `skills/references-shared.md`. On each Last-verified date, re-read that
canonical map and reconcile the rows above in one place. Any version drift can only live in *these
docs*, never in rendered output.

## Mixed-currency ledger — handled per currency

The Billing section is robust to mixed currencies. Each invoice row prints its **own**
`invoice.currency` (not the first invoice's), and the Outstanding line groups balances per
currency:

```
byCurrency[c].issued = Σ invoice.total            where invoice.currency == c
byCurrency[c].paid   = Σ invoice.total            where invoice.currency == c AND status == paid
Outstanding = join over c of  "{c} {issued − paid}"   with " · "
```

So a USD 3,000 + EUR 1,200 ledger renders `**Outstanding: USD 3,000 · EUR 1,200**` — never a
wrong single sum. Almost every client is single-currency (retainers are contracted in one
currency), so this normally renders one term; the per-currency grouping is the safety net that
makes the section correct zero-shot rather than relying on an operational guard.

## Good vs bad

**Good — graceful degradation:**
> ## Paid Performance
> _Performance data will appear once campaigns are live._

Section still renders; client sees a calm placeholder, not a crash or a blank.

**Bad — halting on missing optional data:**
> `Error: cannot read property 'summary' of null`

Never. Optional artifacts are read through `readJson`, which returns null and triggers the
fallback line.

**Good — billing honesty:**
> Outstanding: USD 3,000 (one unpaid invoice with a Pay-now link)

**Bad — a Pay-now link on a paid or backend-less invoice.** Pay-now is gated on
`stripe.hosted_url && status !== "paid"`.

**Good — mixed-currency total (handled):**
> Outstanding: USD 3,000 · GBP 2,400 (grouped per currency, never summed)

**Bad — mixed-currency total:**
> Outstanding: USD 5,400 (summed across a USD 3,000 and a GBP 2,400 invoice)

Meaningless figure — the script groups per currency precisely to avoid this (see § Mixed-currency ledger).

**Bad — leaking internal forecast:**
> Weighted pipeline value: $36,000 at 75% probability

That is internal CRM data and must never reach the client page.

**Bad — shipping the sentinel email:**
> [Approve](mailto:hello@agency.co?...)

`config/services.json` `agency.email` was unset; the placeholder was used. The script printed a
`WARN:` to stderr — do not ship a portal whose run log carries that warning. Set `agency.email`
and re-run.
