# /research — Domain Standards

Embedded expertise for competitor Ad Library analysis. Read this file when classifying
angles, deriving gaps, or resolving competitor names. Self-contained — no runtime
discovery required.

## 1. Competitor Resolution Heuristic

A `profile.competitors` entry is either a numeric Page ID or a brand name.

- **Numeric** (`/^\d{6,}$/`) → used directly as the Page ID, no search.
- **Name** → Graph `/ads_archive` search with `ad_active_status: "ACTIVE"`, `fields: page_id,page_name`, `limit: 25`. Tally `page_id` across returned ads; pick the **most frequent** match (the brand running the most active ads in-country). Carry `ad_count_in_country` for transparency.
- **No ads returned** → `status: "inactive_or_not_found"`, keep in output but exclude from the fetch pass.
- **Ads returned but no `page_id`** → `status: "no_page_id_in_ads"`.
- **Search error** → `status: "error:<message>"`.

**Halt gate:** fewer than 2 competitors in the profile is a hard stop — never fabricate competitors to satisfy it. Zero resolved page IDs (after search) is also fatal; ask the user for explicit Page IDs.

## 2. The 6-Theme Angle Taxonomy

`classifier.py` clusters every `ad_creative_bodies` string into one dominant angle. The closed taxonomy:

| Theme | Signal | Example hook |
|-------|--------|--------------|
| **pain** | Names a problem/frustration | "Tired of bloating after every meal?" |
| **aspiration** | Paints the desired end-state | "Wake up to skin that glows." |
| **social_proof** | Reviews, counts, testimonials | "Join 40,000 happy sleepers." |
| **urgency** | Scarcity / deadline | "48 hours left — then it's gone." |
| **price** | Cost, discount, value framing | "Half the price of a salon visit." |
| **authority** | Credentials, science, expert | "Formulated by board-certified dermatologists." |

Do not invent a 7th theme. If a body fits none, classify by the strongest secondary signal; never leave it unlabeled.

## 3. Gap Categories

Compare the competitive set against `business.usp` and surface 3–5 concrete gaps, each tied to a recommended client angle.

| Gap `type` | What it means |
|-----------|---------------|
| `format` | A format nobody runs (e.g. no carousels) the client could own |
| `angle` | A theme nobody leans on that the client's USP fits |
| `offer` | An offer type absent from the set (free trial, BOGO, money-back…) |
| `voice` | A tone/register the field is crowded around vs. an open lane |

A gap statement is only useful if actionable: pair the observation with a `recommended_angle`.

## 4. Spend & Impression Bands

The Ad Library returns spend/impressions as **ranges, not exact numbers**. Aggregate by summing per-ad lower bounds into a band low and upper bounds into a band high — never report a single point estimate. Always carry the `currency`.

## 5. Good vs. Bad Output

**Good** — actionable, schema-correct:
```json
{ "type": "angle",
  "observation": "All 4 competitors lead with price; none use authority/science.",
  "recommended_angle": "Lead with the clinical-study angle our USP supports." }
```

**Bad** — vague, no recommendation, wrong field:
```json
{ "observation": "Competitors are doing ads.", "format_mix": {"image": 0.5} }
```
`format_mix` is NOT part of the schema and `observation` alone is not a gap.

## 6. Degraded-but-Valid States

- Empty `angles` array is valid (schema allows it) when no competitor URLs resolve — `/strategy-brief` falls back to defaults. Do not error.
- A competitor with `status: inactive_or_not_found` is reported, not dropped.
- A missing PDF or diff is acceptable; a missing `competitor_intel.json` is not.

## 7. Keeping Current

- The angle taxonomy and gap categories are deliberately fixed; change them only with a corresponding `classifier.py`/`analyzer.py` update.
- If Meta changes Ad Library field names or the version pin, update `references/api-reference.md` first, then this file's examples. Re-verify the source URLs and bump the SKILL.md "Last verified" date.
