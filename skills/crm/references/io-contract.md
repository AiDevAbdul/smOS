# CRM — I/O Contract

The exact command surface, the canonical deal schema, exit codes, example payloads, and
`sync` reconciliation. Readable standalone. Authoritative source: `skills/crm/crm.js` +
`schemas/deal.js`.

> **Last verified against `skills/crm/crm.js` + `schemas/deal.js`: 2026-06-22.**
> Re-diff on any change to those files (see SKILL.md → Keeping Current).

## 1. CLI surface

Invoke as `node skills/crm/crm.js <cmd> [slug] [...args]`.

| Command | Form | Effect |
|---------|------|--------|
| `add` | `add <slug> --name "..." [--email --contact-name --phone --stage --source --retainer --currency --setup-fee --owner]` | Create a new deal (rejects duplicate slug) |
| `list` | `list [--stage <stage>]` | Print pipeline summary + one row per deal; optional stage filter |
| `show` | `show <slug>` | Print the full normalized deal record |
| `stage` | `stage <slug> <newstage> [--note "..."] [--reason "..."] [--force]` | Advance stage through the state machine |
| `log` | `log <slug> --type <note\|call\|email\|meeting> --note "..."` | Append an activity |
| `set` | `set <slug> key=value [key=value ...]` | Patch fields (see allowed keys below) |
| `sync` | `sync` | Import `prospects/` + `clients/` into the pipeline |
| `next` | `next` | List active deals with a `next_action`, sorted by due date, flagging overdue |

### Flag/arg parsing
- `--flag value` → string; a bare `--flag` (no following value) → boolean `true`.
- `key=value` (used by `set`) → string value (everything after the first `=`).

### `set` allowed keys
- `link.<name>` → writes `links.<name>` (e.g. `link.proposal`, `link.pre_audit`, `link.contract`, `link.client_profile`).
- `retainer` → `deal.monthly_retainer` (coerced to number).
- `currency` → `deal.currency`.
- `email` → `contact.email`.
- Direct fields: `next_action`, `next_action_due`, `owner`, `source`, `expected_close`, `company_name`.
- Any other key → exit 1 (`Unknown field`).

## 2. Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage error (missing slug on `add`, unknown command, unknown `set` field, invalid target stage name) |
| 2 | Deal not found, or duplicate slug on `add` |
| 3 | Schema validation failed (e.g. `won` without `links.proposal`) |
| 4 | Illegal stage transition (without `--force`) |
| 1 (FATAL) | Uncaught error — printed as `[crm] FATAL: <message>` |

## 3. Deal schema (`schemas/deal.js`)

`normalize(raw)` is lenient (never throws, coerces aliases). `validate(obj)` is
fail-closed and returns `{ ok, errors[] }`.

```jsonc
{
  "id": "acme",                       // mirror of slug
  "slug": "acme",                     // REQUIRED, non-empty
  "company_name": "Acme Co",          // REQUIRED, non-empty
  "contact": { "name": null, "email": "a@acme.co", "phone": null },
  "stage": "proposed",                // REQUIRED, must be in STAGES
  "source": "referral",               // referral|inbound|outbound|pre-audit|...
  "services": [],                     // optional array
  "deal": {
    "monthly_retainer": 2500,         // number ≥ 0
    "setup_fee": 0,
    "currency": "USD"
  },
  "probability": 55,                  // 0–100; defaults to STAGE_PROBABILITY[stage]
  "expected_close": null,
  "owner": null,
  "next_action": "send deck",
  "next_action_due": "2026-06-25",    // ISO date string
  "activities": [
    { "at": "2026-06-22T10:00:00.000Z", "type": "stage", "note": "lead → contacted" }
  ],
  "links": {
    "pre_audit": "prospects/acme/pre_audit.html",
    "proposal": "clients/acme/proposal.pdf",
    "contract": null,
    "client_profile": null
  },
  "created_at": "2026-06-20T09:00:00.000Z",
  "updated_at": "2026-06-22T10:00:00.000Z",
  "won_at": null,
  "lost_at": null,
  "lost_reason": null
}
```

### Validation rules (fail-closed)
- `slug` non-empty.
- `company_name` non-empty.
- `stage` ∈ `STAGES`.
- `probability` in `[0, 100]`.
- `deal.monthly_retainer` ≥ 0.
- **If `stage === "won"`: `links.proposal` must be a non-empty string.**

## 4. Example stdout payloads

**`crm add acme --name "Acme Co" --retainer 2500`**
```json
{ "added": "acme", "stage": "lead",
  "pipeline": { "total": 1, "by_stage": { "lead": 1, ... },
                "weighted_pipeline_annual": 3000, "active_mrr": 0 } }
```

**`crm list`**
```json
{ "pipeline": { "total": 3, "by_stage": {...},
                "weighted_pipeline_annual": 48600, "active_mrr": 2500 },
  "deals": [ { "slug": "acme", "company": "Acme Co", "stage": "proposed",
               "prob": 55, "retainer": "USD 2500", "next": "send deck" } ] }
```

**`crm stage acme won`** (after proposal link set)
```json
{ "slug": "acme", "from": "negotiating", "to": "won", "probability": 100,
  "next": "Run /intake to onboard, then /contract + /billing" }
```

**`crm next`**
```json
{ "today": "2026-06-22",
  "needs_attention": [ { "slug": "acme", "stage": "proposed",
    "action": "send deck", "due": "2026-06-21", "overdue": true } ] }
```

## 5. `sync` — first-run reconciliation

Before Phase 5 the lifecycle lived in two disconnected places: `prospects/<slug>/`
(pre-audit artifacts) on the acquisition side and `clients/<slug>/` + the Supabase
`clients` table on the delivery side. `crm sync` folds both into one pipeline so the CRM
reflects reality on day one. It never duplicates an existing deal.

| Source dir | Detection | Resulting deal |
|------------|-----------|----------------|
| `prospects/<slug>/` | `pre_audit.html` present | `stage=audited`, `source=pre-audit`, `links.pre_audit=prospects/<slug>/pre_audit.html` |
| `prospects/<slug>/` | no audit html | `stage=lead`, `source=pre-audit`, `links.pre_audit=null` |
| `clients/<slug>/` | `client_profile.json` present, deal already exists | only patch `links.client_profile` |
| `clients/<slug>/` | `client_profile.json` present, no deal yet | `stage=won`, `source=intake`, `won_at=now`, `links.client_profile` set + `links.proposal` placeholder (`clients/<slug>/`) so the `won` gate passes |

Output: `{ "synced": true, "added": <n>, "pipeline": {…summary…} }`.

> The `won` placeholder proposal link is a deliberate convenience so legacy signed
> clients aren't blocked by the proposal gate. After `sync`, replace placeholders with
> the real proposal artifact where one exists.

## 6. Edge cases

- **Corrupt/missing `pipeline.json`** → `loadPipeline()` returns `[]` (treats as empty); a write recreates the directory.
- **Idempotent re-stage** (set a deal to its current stage) → allowed, no transition error.
- **`won` deal weight** counts full annual (`retainer × 12`), not probability-weighted.
- **`lost`/`churned`** contribute 0 to the weighted pipeline and are excluded from the active set.
- **`sync` of an already-present slug** → does not duplicate; for a client dir it only patches `links.client_profile` on the existing deal.
- **`sync` of a signed client with no proposal** → created at `won` with a placeholder `links.proposal` (the client dir) so the gate passes — review and replace with the real artifact.
- **Supabase unset** → `persist()` returns `{ skipped: true }`; local write is unaffected.
- **Supabase error** → returned as `{ error }` but never thrown; pipeline write already committed.
