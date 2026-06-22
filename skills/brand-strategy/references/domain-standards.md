# Brand Strategy — Domain Standards

Self-contained domain expertise for `/brand-strategy`. This is the embedded knowledge the
skill applies; it is NOT discovered at runtime. Thresholds and taxonomies here are exact.

---

## 1. The strategy layer (what gets produced)

A brand strategy is the strategic core that gates all later identity work. The required
fields (enforced by `schemas/brand_profile.js`→`strategy`) and their definitions:

| Field | Definition | Constraint |
|-------|------------|-----------|
| `purpose` | Why the brand exists beyond profit | 1 sentence |
| `mission` | What it does, for whom, today | 1 sentence, present tense |
| `vision` | The future state it is building toward | 1 sentence, aspirational |
| `values` | Beliefs that govern behavior | **3–5 items, non-empty (validator)** |
| `persona` | The primary audience (demographics + psychographics) | object/string |
| `archetype.primary` | One of the 12 archetypes | **must be one of 12, lowercase** |
| `archetype.secondary` | Optional supporting archetype | one of 12 or null |
| `value_proposition` | The core promise of value to the customer | 1–2 sentences |
| `differentiation` | Why this brand vs. the competitive set | 1–2 sentences |
| `positioning_statement` | Internal anchor (formula below) | **required, non-empty (validator)** |
| `messaging_pillars` | The 3–5 themes all messaging ladders up to | 3–5 items |
| `essence` | The brand in 2–3 words (its soul) | short phrase |
| `promise` | The single guarantee to every customer | 1 sentence |
| `positioning_approved_at` | Human gate timestamp | set ONLY via `--approve-positioning` |

---

## 2. The positioning statement formula

The positioning statement is an **internal anchor**, not a public slogan or tagline (a
tagline is `/brand-name`'s job). Use this canonical formula:

> **For** [target audience] **who** [need/want], **[brand]** is the [category/frame of
> reference] **that** [key benefit/point of difference], **because** [reason to believe].

**Good:**
> "For independent auto detailers who can't afford a marketing team, BlueRose is the
> done-for-you social engine that books appointments while they work, because every
> campaign is run by senior media managers, not templates."

**Bad (slogan, not positioning — no audience, no RTB):**
> "BlueRose: detailing, elevated." ← This is a tagline; it belongs in `/brand-name`.

A complete statement names: audience, need, category frame, differentiated benefit, and a
reason to believe (RTB). If any of the five is missing, the positioning is incomplete.

---

## 3. The 12 brand archetypes

`archetype.primary` MUST be exactly one of these 12 (lowercase). Validation rejects any
other value. Pick the one whose core desire matches the brand's relationship to the
customer; a secondary may add nuance.

| Archetype | Core desire | Voice cue |
|-----------|-------------|-----------|
| `innocent` | Safety, simplicity, optimism | warm, honest |
| `everyman` | Belonging, the common good | down-to-earth, relatable |
| `hero` | Mastery, prove worth through action | bold, courageous |
| `outlaw` | Liberation, break the rules | rebellious, raw |
| `explorer` | Freedom, discover the new | adventurous, independent |
| `creator` | Innovation, build something of value | imaginative, expressive |
| `ruler` | Control, order, prestige | authoritative, refined |
| `magician` | Transformation, make dreams real | visionary, inspiring |
| `lover` | Intimacy, connection, pleasure | sensual, warm |
| `caregiver` | Service, protect and nurture | compassionate, reassuring |
| `jester` | Joy, live in the moment | playful, irreverent |
| `sage` | Truth, understanding, wisdom | thoughtful, expert |

**How to pick:** map the customer's deepest desire in the category to a core desire above.
Counter-position against the dominant competitor's archetype where a gap exists (e.g. a
`sage` brand entering a category of `hero` shouters can own credibility). State the
rationale — the chosen archetype constrains voice (`/brand-name`) and visuals
(`/brand-visual`), so the choice must be defensible.

---

## 4. Persona model

Capture both halves; psychographics drive messaging more than demographics.

- **Demographics:** age band, location, income, role/lifecycle stage.
- **Psychographics:** primary motivation, top fear/objection, buying trigger, the job
  they are "hiring" the brand to do.

**Good:** "Owner-operators, 30–50, $80–150k revenue; motivated to win back evenings,
afraid of wasting ad spend, triggered by a competitor's busy weekend."
**Bad:** "Everyone who wants detailing." ← Not a persona; no psychographics, no edge.

---

## 5. Value proposition, pillars, essence, promise

- **Value proposition:** the concrete value exchange ("we book your weekends full while
  you detail"). Distinct from positioning (which frames the category).
- **Messaging pillars (3–5):** the recurring themes every piece of content ladders to.
  Too few = thin; too many = unfocused. Each pillar must be provable.
- **Essence:** 2–3 words capturing the soul (e.g. "effortless craft"). Not a slogan.
- **Promise:** the single guarantee every customer can count on.

---

## 6. Quality gate summary

A strategy is delivery-ready when: positioning follows the 5-part formula; archetype is
1 of 12; values number 3–5; pillars number 3–5; persona has psychographics; and the
positioning has been shown to the human and left **unstamped** until they approve.

---

Source of truth for fields/archetypes: `schemas/brand_profile.js` (`normalizeStrategy`,
`ARCHETYPES`). Update this file in the same edit if that schema changes.
Last verified: 2026-06-22.
