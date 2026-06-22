# brand-name — I/O Contract

Full input/output schemas, CLI modes, exit codes, and example payloads for
`skills/brand-name/brand-name.js`. Read this when constructing `verbal.json` or
parsing the script's stdout. Source of truth for shapes: `schemas/brand_profile.js`.

## CLI Modes

```
node skills/brand-name/brand-name.js <slug> --screen "Acme,Northwind,Lumina"
node skills/brand-name/brand-name.js <slug> --in verbal.json
node skills/brand-name/brand-name.js <slug> --approve-name
```

| Mode | Effect | Precondition |
|------|--------|--------------|
| `--screen "A,B,C"` | Screens comma-separated names; writes `verbal.name_candidates`; prints table | none (runs even before positioning approval) |
| `--in verbal.json` | Deep-merges + validates the `verbal` stage; carries chosen name's screen row onto `name_screening` | `positioning_approved_at` set |
| `--approve-name` | Stamps `verbal.name_approved_at`, sets `status: named` | `verbal.name` set AND `name_screening.attorney_clearance_flagged === true` |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Missing `<slug>`, or no mode flag given, or fatal error |
| 2 | `--in` path not found |
| 3 | Positioning not approved, or `--approve-name` with empty `verbal.name` |
| 4 | `--approve-name` refused — `attorney_clearance_flagged` not set |

## Screen-Row Schema (one per candidate, in `verbal.name_candidates[]`)

```json
{
  "name": "Lumina",
  "domain_com_available": null,
  "domain": "lumina.com",
  "trademark_knockout_clear": false,
  "trademark_note": "3 potentially conflicting live mark(s) — attorney review required",
  "handles_available": {
    "instagram": null,
    "facebook": null,
    "x": true,
    "tiktok": true,
    "linkedin": null
  },
  "attorney_clearance_flagged": true
}
```

Field semantics: `*_available` / `*_clear` ∈ `{true | false | null}` where `null` = unknown
(verify manually); `true` only when definitively free/clear; `attorney_clearance_flagged`
always `true`. See `references/api-reference.md` for per-gate mapping.

## `--screen` stdout

```json
{
  "slug": "acme",
  "screened": [ { /* screen-row */ } ],
  "note": "domain/trademark 'null' = unknown, verify manually. Trademark is a knockout only — attorney clearance still required."
}
```

## `verbal.json` Input Schema (matches `brand_profile.js → normalizeVerbal`)

```json
{
  "name": "Lumina",
  "tagline": "Light the way forward.",
  "voice": {
    "traits": ["Confident", "Warm", "Plainspoken"],
    "spectrums": { "formal_casual": "casual", "serious_funny": "serious" },
    "do": ["Use plain verbs", "Lead with the benefit"],
    "dont": ["Jargon", "Hype superlatives"]
  },
  "messaging_house": {
    "roof": "The simplest way to see your whole business.",
    "walls": ["Clarity", "Speed", "Trust"],
    "foundation": ["One dashboard", "Sub-second sync", "SOC 2 certified"]
  },
  "elevator_pitch": "Lumina gives small teams one clear view of every metric, instantly.",
  "boilerplate": "Lumina is a analytics platform for small teams ... "
}
```

Accepted aliases (normalizer): `name|brand_name`; `voice.traits` ← `voice_traits`;
`voice.do|dont` ← `voice_do|voice_dont`; `name_candidates|candidates`. Unknown keys are
preserved by the deep-merge but not validated.

## `--in` stdout

```json
{ "slug": "acme", "layer": "verbal", "name": "Lumina", "status": "draft",
  "next": "Confirm attorney clearance, then --approve-name" }
```

## `--approve-name` stdout

```json
{ "slug": "acme", "gate": "name", "name": "Lumina",
  "approved_at": "2026-06-22T12:00:00.000Z", "status": "named", "next": "/brand-visual" }
```

## Validation (fail-closed, `stage: "verbal"`)

`saveBrand(slug, {verbal}, {stage:"verbal"})` throws (no partial write) if:
- `strategy.positioning_approved_at` is not set ⇒ `"/brand-name requires strategy.positioning_approved_at …"`.
- `verbal.name` is missing ⇒ `"verbal.name is missing"`.

## Edge Cases

| Case | Behavior |
|------|----------|
| Name with spaces/punctuation | `handleize` strips to `[a-z0-9]` for domain/handle URLs; original kept in `name` |
| Empty entry in `--screen` list | Skipped |
| Chosen name absent from prior `name_candidates` | `name_screening` not back-filled; `--approve-name` will then refuse (exit 4) until re-screened |
| All gates `null` | Persists fine; treat as "nothing proven free" — human + attorney must verify before approval |
| Re-running `--screen` | Overwrites `name_candidates[]` (array replace, not merge) |
