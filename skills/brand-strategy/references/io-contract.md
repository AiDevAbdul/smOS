# Brand Strategy — I/O Contract

Full input/output contract for `/brand-strategy` and its companion `brand-strategy.js`.
Self-contained: schema, example payloads, CLI surface, exit codes, edge cases.

---

## 1. Inputs

| Input | Required | Source |
|-------|----------|--------|
| `clients/{slug}/client_profile.json` | yes | `/intake` |
| `clients/{slug}/competitor_intel.json` | optional | `/research` |
| `clients/{slug}/pre_audit` artifacts | optional | `/pre-audit` |
| `strategy.json` (you author) | yes (for `--in`) | this skill |

---

## 2. The `strategy` schema (from `schemas/brand_profile.js`)

`--in` accepts a flat object that `normalizeStrategy` maps into the canonical shape. Both
the flat aliases and the nested canonical forms are accepted (aliases in parentheses):

```jsonc
{
  "purpose":   "string|null",
  "mission":   "string|null",
  "vision":    "string|null",
  "values":    ["string", ...],                 // required non-empty at validate
  "persona":   "string|object|null",            // alias: target_persona
  "archetype_primary":   "one of 12|null",       // or nested archetype.primary
  "archetype_secondary": "one of 12|null",       // or nested archetype.secondary
  "value_proposition":   "string|null",          // alias: value_prop
  "differentiation":     "string|null",          // alias: competitive_differentiation
  "positioning_statement": "string|null",        // alias: positioning — REQUIRED
  "messaging_pillars":   ["string", ...],         // alias: pillars
  "essence": "string|null",                      // alias: brand_essence
  "promise": "string|null"                       // alias: brand_promise
  // positioning_approved_at is NEVER set via --in; only via --approve-positioning
}
```

The 12 valid archetypes: `innocent, everyman, hero, outlaw, explorer, creator, ruler,
magician, lover, caregiver, jester, sage` (compared lowercase).

**Stage validation (`stage:"strategy"`) requires:**
- `positioning_statement` non-empty,
- `values` non-empty,
- `archetype.primary` (if present) is one of the 12.

---

## 3. Example `strategy.json`

```json
{
  "purpose": "To free skilled tradespeople from the marketing they were never trained to do.",
  "mission": "We run done-for-you social campaigns for independent auto detailers.",
  "vision": "Every great detailer's calendar is full without them touching an ad.",
  "values": ["Craft over hype", "Plain-English reporting", "Senior hands only", "Show the work"],
  "persona": "Owner-operators 30-50, $80-150k revenue; motivated to win back evenings, afraid of wasting ad spend, triggered by a rival's busy weekend.",
  "archetype_primary": "caregiver",
  "archetype_secondary": "sage",
  "value_proposition": "We keep your weekends booked while you stay in the bay.",
  "differentiation": "Senior media managers run every account; competitors hand juniors a template.",
  "positioning_statement": "For independent auto detailers who can't afford a marketing team, BlueRose is the done-for-you social engine that books appointments while they work, because every campaign is run by senior media managers, not templates.",
  "messaging_pillars": ["Proof in bookings", "We sweat the craft", "No jargon", "Always senior hands"],
  "essence": "effortless craft",
  "promise": "You detail; we keep the calendar full."
}
```

---

## 4. CLI surface & outputs

### Persist the strategy layer
```
node skills/brand-strategy/brand-strategy.js {slug} --in strategy.json
```
On success prints (gate still unstamped):
```json
{
  "slug": "blue-rose-auto",
  "layer": "strategy",
  "status": "draft",
  "positioning": "For independent auto detailers ...",
  "approved": false,
  "next": "Present the positioning statement to the client. On approval: --approve-positioning"
}
```

### Stamp the positioning gate (HUMAN only)
```
node skills/brand-strategy/brand-strategy.js {slug} --approve-positioning
```
On success prints:
```json
{
  "slug": "blue-rose-auto",
  "gate": "positioning",
  "approved_at": "2026-06-22T12:00:00.000Z",
  "status": "positioning_approved",
  "next": "/brand-name"
}
```

Both write `clients/{slug}/brand_profile.json` (the strategy layer is merged into any
existing profile; other layers are preserved).

---

## 5. Exit codes

| Exit | Cause | Fix |
|------|-------|-----|
| 0 | Success | — |
| 1 | No `{slug}`, or neither `--in` nor `--approve-positioning` given | Pass slug + one action |
| 2 | `--in` path not found | Correct the path to `strategy.json` |
| 3 | `--approve-positioning` but `positioning_statement` empty | Write/persist the strategy first |
| (throws) | Stage validation fails (empty `values`, bad archetype, missing positioning) | Fix the named field, re-run `--in` |

---

## 6. Edge cases

- **No existing profile:** `loadBrand` returns a draft skeleton, so `--in` works on a
  fresh client; but you should still confirm `client_profile.json` exists (intake done).
- **Re-running `--in`:** safe and idempotent at the layer level — it deep-merges, so a
  second run with new fields updates only those; it never wipes `verbal`/`visual`.
- **Alias drift:** `positioning`/`positioning_statement`, `value_prop`/`value_proposition`,
  `pillars`/`messaging_pillars` all normalize to the canonical key — pick either.
- **Bad archetype casing:** `"Caregiver"` is accepted (compared lowercase); a non-archetype
  like `"guru"` fails validation with a named error.
- **Approving twice:** stamping again simply overwrites `positioning_approved_at` with a
  new timestamp; status stays `positioning_approved`. Avoid unless re-confirming.
- **`positioning_approved_at` cannot be set via `--in`:** `normalizeStrategy` reads it but
  the documented path to set it is `--approve-positioning`. Never hand-edit the JSON to
  fake the gate.

---

Source of truth for schema/exit codes: `schemas/brand_profile.js` +
`skills/brand-strategy/brand-strategy.js`. Update this file in the same edit if either
changes. Last verified: 2026-06-22.
