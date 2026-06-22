# content-plan — Domain Standards

Embedded expertise for the Organic Content Strategy Engine. Self-contained; read
this to understand the thresholds, taxonomies, and formulas the skill encodes —
without re-discovering them at runtime.

## 1. Pillar Taxonomy

A content plan has **3–5 pillars**. Each pillar has an `intent` drawn from this
controlled vocabulary (`schemas/content_plan.js` documents `educate|inspire|convert|community`):

| Intent | Purpose | Typical formats |
|--------|---------|-----------------|
| `educate` | Teach the audience; build authority | reels, carousel |
| `convert` | Drive action — proof, offer, CTA | carousel, image |
| `community` | Humanize the brand; behind-the-scenes | reels, story |
| `inspire` | Aspirational / motivational | reels, image |

The skill's **default 4-pillar set** (used when the profile gives no overrides):

| id | name | intent | cadence_per_week | default format |
|----|------|--------|------------------|----------------|
| `educate` | Educate | educate | 2 | reels |
| `proof` | Social Proof | convert | 1 | carousel |
| `behind` | Behind the Scenes | community | 1 | reels |
| `offer` | Offer / CTA | convert | 1 | image |

Pillar `keywords` are seeded from the profile: `seo_keywords` → `voice.keywords`
→ `[niche, "local", "tips"]` fallback, sliced to 8, paired with the niche.

## 2. Reels-First Mandate (≥50%)

**Rule:** at least 50% of calendar items must be `reels`. Reels carry the highest
organic reach on Meta surfaces, so the calendar is Reels-weighted by construction.

With the default pillar set and Mon/Wed/Fri (3 posts/week) round-robin distribution,
`educate` (reels) and `behind` (reels) account for 2 of every 4 items → exactly 50%
of the rotation is reels before any uplift. Verify the realized share:

```
reels_share = items.filter(i => i.format === "reels").length / items.length
assert reels_share >= 0.5
```

If a custom pillar set drops below 50% reels, raise reels-format pillars' cadence
or convert an image/carousel pillar to reels — do not ship a sub-50% calendar.

## 3. Cadence & Scheduling

- **Period:** `--weeks=N` weeks, default 4.
- **Post days:** Monday / Wednesday / Friday (offsets `[0,2,4]`) within each week.
- **Slot:** 13:00 UTC ("1pm default slot").
- **Start:** the next Monday relative to run time (`nextMonday`). Deterministic — no
  randomness — so re-runs over the same week are byte-stable.
- **Distribution:** pillars are assigned round-robin across the post slots, so cadence
  is approximate over the period rather than strictly per-week.

Total items = `weeks × 3`. Example: 4 weeks → 12 items.

## 4. Social-SEO Layer (Phase 2.6) — non-optional

Every calendar item MUST carry:

- `keywords` — array, keyword-first; the first keyword leads the caption.
- `hashtags` — derived from keywords (`#` + alphanumeric-stripped), length > 1.
- `alt_text` — descriptive, keyword-bearing, e.g. `"Educate reels about <kw> for <niche>"`.

Captions are written keyword-first: `"[<Pillar>] <keyword>: <copy>"`. The skill
emits a placeholder copy body for the creative agent — the SEO scaffolding is real,
the marketing prose is a stub.

## 5. Format → Media Requirements (publishable gate)

`validate(plan, { requirePublishable: true })` enforces what `/publish` needs:

| format | requires |
|--------|----------|
| `image` | `image_url` |
| `video`, `reels` | `video_url` |
| `carousel` | `items[]` with ≥2 slides |
| all except `story` | non-empty `message` |
| all | valid `publish_at`, `id`, `platform`, `format`, `status` |

A freshly generated plan has carousel slides but **no media URLs** (those come from
`/creative` / the asset library), so the default skeleton legitimately fails the
publishable gate — that is why `--draft` exists.

## 6. Good vs Bad

**Good — publishable item:**
```json
{
  "id": "acme-2026-06-29-educate",
  "pillar_id": "educate",
  "platform": "instagram",
  "format": "reels",
  "publish_at": "2026-06-29T13:00:00.000Z",
  "message": "[Educate] gutter cleaning: 3 signs your gutters are overflowing",
  "keywords": ["gutter cleaning", "roofing"],
  "hashtags": ["#guttercleaning", "#roofing"],
  "alt_text": "Educate reels about gutter cleaning for roofing",
  "video_url": "https://cdn.example.com/acme/educate-w1.mp4",
  "status": "pending"
}
```

**Bad — silent failure risks (never ship):**
- Reels share < 50% → violates Reels-first mandate.
- Item missing `alt_text` / `keywords` → SEO not optional; validation context aside, this defeats Phase 2.6.
- `status: "published"` set here → only `/publish` may mark published.
- Non-deterministic dates → re-runs churn the calendar and break the `/publish` handoff diff.
- Emitting a media-less plan without `--draft` → `/publish` would fail; the skill must HALT exit 4 instead.

## Keeping Current

- Default pillar set, cadence, post-days, and the ≥50% reels constant live in
  `skills/content-plan/content-plan.js` (`PILLAR_DEFS`, `POST_DAYS`, `FORMATS_BY_PILLAR`).
  If those change, update the tables above.
- Format / platform / state vocabularies are owned by `schemas/content_plan.js`
  (`FORMATS`, `PLATFORMS`, `ITEM_STATES`). Treat that file as source of truth.

**Last verified:** 2026-06-22
