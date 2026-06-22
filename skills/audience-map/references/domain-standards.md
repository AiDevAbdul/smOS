# Audience-Map Domain Standards

Embedded expertise for `/audience-map`. These are the thresholds, taxonomies, and
formulas the skill applies — encoded so the skill never needs runtime discovery and
never asks the user for them.

---

## 1. Seed-term extraction

Source fields, in order of signal strength:
1. `business.product_description`
2. `business.usp`
3. `audience.pain_points[]`
4. `audience.interests[]` (explicit, highest precision — user-forced seeds)

Rules:
- Lowercase, strip punctuation to `[a-z\s-]`.
- Keep single words with **length ≥ 4** that are not stopwords.
- Also emit **2-gram and 3-gram phrases** (words length ≥ 3, non-stopword) — phrases match
  Meta interests far better than single tokens (e.g. "strength training" beats "training").
- Cap the seed set at **25** terms.

Stopwords include the usual function words plus business-generic nouns that never make good
interests: `service(s)`, `product(s)`, `customer(s)`, `business(es)`, `based`.

**Good seed:** `marathon training`, `plant based protein`, `home espresso`.
**Bad seed:** `our`, `service`, `customers`, `the best` (generic / stopword-laden).

---

## 2. Interest size thresholds

| Bound | Rule | Why |
|-------|------|-----|
| `audience_size_lower` | **≥ 100,000** | Below this, delivery is starved and CPMs spike. |
| `audience_size_upper` | **≤ 50,000,000** | Above this, the interest is a near-broad signal and dilutes the cluster. |

An interest missing a bound passes that side of the filter (do not drop on a null bound).
Dedup by interest `id` — Meta often returns the same interest under multiple seeds.

---

## 3. Cluster taxonomy

Cluster by the **second segment of Meta's `path`** array. Meta returns paths like
`["Interests", "Sports and outdoors", "Strength training"]` — segment index `1`
("Sports and outdoors") is the theme bucket. Fall back to `topic` when `path` is absent,
else bucket `General`.

- Sort buckets by interest count, keep the **top 5**.
- Cap each cluster at **8 interests**.
- Cluster ID = `INT_<LABEL>` uppercased, non-alphanumerics → `_`, truncated to 20 chars
  (e.g. `INT_SPORTS_AND_OUTDOO`).
- `size_estimate_lower/upper` = sum of the kept interests' bounds.

A healthy cluster mixes sizes: one or two broad anchors (>5M) plus narrower, intent-rich
interests. Minimum viable plan = **3 clusters**; fewer triggers a diagnostics issue
(broaden product description or add `audience.interests`).

**Good cluster:** "Strength training" with `Powerlifting`, `CrossFit`, `Bodybuilding.com`,
`Olympic weightlifting` — coherent theme, mixed sizes.
**Bad cluster:** "General" holding 8 unrelated interests — means paths were missing; revisit seeds.

---

## 4. Behavior segments by business model

Pick **2–4** segments. Mapping (case-insensitive match on `business.business_model`):

| Model matches | Behaviors |
|---------------|-----------|
| `dtc` / `ecom` / `e-commerce` | Engaged Shoppers; Online Spenders — Premium Brands |
| `local` / `service` | Frequent Travelers (disposable-income proxy); New Movers |
| `b2b` | Small Business Owners; Business Decision Makers |
| (none matched) | Engaged Shoppers (default general purchase intent) |

Each segment carries a one-line `rationale`.

---

## 5. Retargeting layers

Standard warm pool, always include the four base layers; add the fifth conditionally.

| Layer name | Source | Window | Include when |
|------------|--------|--------|--------------|
| `RT_PIX_30D` | pixel | 30d | always |
| `RT_PIX_90D` | pixel | 90d | always |
| `RT_PIX_180D` | pixel | 180d | always |
| `RT_PAGE_365D` | page + IG engagers | 365d | always |
| `RT_ATC_30D_NONPURCH` | pixel ATC minus purchasers | 30d | only if `conversion_event` matches `purchase\|atc\|cart\|checkout` |

Naming convention: `RT_<SOURCE>_<WINDOW>`. Each layer records its `source_id` from the
profile and `verified: !isTbd(source_id)` — a TBD pixel/page marks the layer unverified
rather than dropping it.

---

## 6. Lookalike strategy

Seed selection priority (first match on a custom audience with `operation_status.code === 200`):
`purchas` → `buyer` → `customer` → `atc|add to cart` → `video 70/75` → `engag`.

- If a priority match is found → `health: healthy`.
- If none match → use the first custom audience; `health: healthy` if status 200 else `degraded`;
  add a `fallback_note`.
- If **no** custom audiences exist → `seed: null`, `health: missing`, note: recommend creating
  `purchasers_365d` once the pixel logs 1000+ purchases.
- Offline mode → `health: skipped_offline`.

Recommend three **percentage sizes: 1%, 3%, 5%** of the geo footprint. Smaller % = tighter
similarity (use first); larger % = reach (use once 1% saturates). Countries come from
`audience.geo_targets`, falling back to `location.country`, falling back to `["US"]`.

A purchaser seed should have **>1000 members** to be statistically useful; below that, prefer the
best engagement source and flag it.

---

## 7. Exclusions

Defaults always emitted:
- `all_time_purchasers` (custom_audience) — avoid re-prospecting buyers in cold campaigns.
- `employees_and_insiders` (custom_audience) — exclude staff if such a list exists.
- If `voice.restricted_words` is non-empty → a `creative_constraint` entry carrying the list
  (enforced downstream by the creative-compliance / brand-compliance guard, not here).

Geo exclusions (e.g. non-serviced regions) are only added when the profile explicitly flags them —
never inferred silently.
