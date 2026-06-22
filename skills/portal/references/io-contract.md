# /portal — I/O Contract

Exact inputs, outputs, exit codes, and edge cases for `node skills/portal/portal.js <slug>`.
Self-contained — read this to know precisely what the script consumes and emits.

## Invocation

```
node skills/portal/portal.js <slug>
```

`<slug>` is the only argument. The script resolves everything relative to repo ROOT.

## Inputs

### Required

| Path | Shape used | Notes |
|------|-----------|-------|
| `clients/{slug}/client_profile.json` | `business.name` (→ `name` → `slug`) | Missing file = HALT (exit 3) |

### Optional artifacts (read via `readJson`; null → "no data yet")

| Path | Shape used |
|------|-----------|
| `clients/{slug}/performance_analysis.json` | `.summary { spend, conversions, cpa, roas, ctr }` |
| `clients/{slug}/inbox.json` | `.items[] { first_reply_due_at, state }` |
| `clients/{slug}/content_plan.json` | `.pillars[]`, `.items[] { id, status, publish_at, platform, format, message }` |
| `clients/{slug}/listening_snapshot.json` | `.competitors[]`, `.mentions[]` |
| `config/services.json` | `.agency.email` (fallback `hello@agency.co` + stderr `WARN:`); `.portal.approval_cap` (default 8) |

### Store-backed inputs

| Source | Lib | Shape used |
|--------|-----|-----------|
| CRM deal | `getDeal(slug)` (`crm-store.js`) | `deal.deal { monthly_retainer, currency }`, `deal.links.contract` |
| Invoice ledger | `listInvoices(slug)` (`billing-store.js`) | `[]{ id, period, currency, total, status, stripe.hosted_url }` |

Deal shape: `schemas/deal.js`. Invoice shape: `schemas/invoice.js` (`STATUSES = draft|sent|paid|void`).

## Outputs

### File

`clients/{slug}/portal.html` — self-contained HTML rendered by `mdToHtml(md, { title, subtitle })`.

### stdout JSON summary

```json
{
  "portal": "/abs/path/clients/acme/portal.html",
  "client": "Acme Co",
  "sections": {
    "plan": true,
    "billing": 2,
    "approvals": 3,
    "paid": true,
    "organic": true,
    "content": true,
    "listening": false
  }
}
```

- `plan` (bool): a CRM deal was found.
- `billing` (int): number of invoices in the ledger.
- `approvals` (int): pending content items shown (≤ `portal.approval_cap`, default 8).
- `paid|organic|content|listening` (bool): whether each artifact was present.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Portal rendered; summary printed |
| 2 | Missing `<slug>` arg (`usage: portal.js <slug>`) |
| 3 | `client_profile.json` not found (`HALT: <path> not found.`) |

## Example: minimal billing section (input → output)

Ledger `billing/acme/ledger.json`:

```json
[
  { "id": "INV-2026-05", "period": "2026-05", "currency": "USD", "total": 3000,
    "status": "paid", "line_items": [{ "description": "May retainer", "amount": 3000 }] },
  { "id": "INV-2026-06", "period": "2026-06", "currency": "USD", "total": 3000,
    "status": "sent", "line_items": [{ "description": "June retainer", "amount": 3000 }],
    "stripe": { "hosted_url": "https://invoice.stripe.com/i/acct_x/test_y" } }
]
```

Rendered Billing section:

```
## Billing
| Invoice | Period | Amount | Status |
|---|---|--:|---|
| INV-2026-05 | 2026-05 | USD 3,000 | paid |
| INV-2026-06 | 2026-06 | USD 3,000 | [Pay now](https://invoice.stripe.com/i/acct_x/test_y) |

**Outstanding: USD 3,000**
```

Each row prints its own `invoice.currency`. The Outstanding line groups balances per currency
(joined with ` · `), so a USD + EUR ledger renders `**Outstanding: USD 3,000 · EUR 1,200**` —
never a single cross-currency sum.

## Example: approval item (input → output)

`content_plan.json` item:

```json
{ "id": "p_042", "status": "pending", "publish_at": "2026-06-25T14:00:00Z",
  "platform": "instagram", "format": "reel", "message": "Behind the scenes at the new studio launch event" }
```

Rendered line (mailto bodies URL-encoded):

```
- **2026-06-25 · instagram/reel** — Behind the scenes at the new studio launch event  ·  [Approve](mailto:hello@agency.co?subject=...) · [Request changes](mailto:hello@agency.co?subject=...)
```

## Edge cases

| Case | Behavior |
|------|----------|
| No invoices | "_No invoices issued yet._"; no outstanding line |
| All invoices paid | Outstanding renders `0` per currency; no Pay-now links |
| Invoice unpaid but no `stripe.hosted_url` | Cell shows raw status (`sent`/`draft`), no link |
| More pending items than the cap | Only first `approval_cap` (default 8) shown; summary `approvals` ≤ cap. Cap from `config/services.json → portal.approval_cap` — see `references/domain-standards.md` § Source-of-Truth Constants |
| `content_plan.json` present but no `pending` items | "_Nothing needs your approval right now._" |
| Corrupt JSON in any optional artifact | `readJson` catches, returns null → fallback line |
| `client_profile.json` lacks `business.name` | Falls back to `name`, then `slug` for the title |
| Mixed-currency ledger | Each row prints its own currency; Outstanding grouped per currency (`USD x · EUR y`) — never a wrong single sum. See `references/domain-standards.md` § Mixed-currency ledger |
| `config/services.json` missing / no `agency.email` | Falls back to `hello@agency.co` AND prints `WARN:` to stderr (exit still 0). Do not ship a portal whose run produced the warning; set `agency.email` and re-run |
| `portal.approval_cap` unset or ≤ 0 | Defaults to 8 |
| Inbox item missing `first_reply_due_at` | Not counted as a breach |
