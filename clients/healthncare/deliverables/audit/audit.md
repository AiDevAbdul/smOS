# Audit Report — Wellness & Care
**Audit date:** 2026-09-09
**Ad Account:** `act_1837020087281652` · **Currency:** USD · **Timezone:** Asia/Karachi

---

## Executive Summary

- **Overall health score:** 25/100
- **Top 3 wins to surface to client:**
  1. _(Claude to fill — top win from organic data)_
  2. _(Claude to fill)_
  3. _(Claude to fill)_
- **Top 3 issues blocking results:**
  1. _(Claude to fill — highest-impact gap)_
  2. _(Claude to fill)_
  3. _(Claude to fill)_

---

## Organic Audit — Facebook Page

- **Page name:** —
- **Followers:** — (new follows, 90d: —)
- **Page completeness:** —/100
- **Posts (last 60 days):** — (—/week) · last post — days ago
- **Format mix:** 0% video · 0% image · 0% carousel · 0% link
- **Avg engagement rate:** —%
- **Best post:** — — —% ER
- **Worst post:** — — —% ER

### Completeness checks
_(no data)_

## Organic Audit — Instagram

- **Followers:** 1
- **Posts (last 60 days):** 8 (0.9/week)
- **Format mix:** 0% Reels · 100% image · 0% carousel
- **Avg engagement rate:** 175%
- **Reach (28d):** 0
- **Profile views (28d):** 0

---

## Paid Audit — Ad Account

- **Account status:** ACTIVE
- **Account age:** 7.8743981481481 days
- **Total historical spend:** USD 22.16
- **Current balance / payment method:** USD 5.12
- **Campaigns lifetime:** 2 (2 active)
- **Best CPA seen:** —
- **Best ROAS seen:** —

### Pixel Health

- **Pixel ID:** `1720541425873368`
- **Status (account-side):** none (—)
- **Installed on website:** unknown
- **Events firing:** —
- **Missing events (recommended to add):** _(review Standard Events list)_


### Website & Tracking — carried from pre-audit (none found)

> Public website-scrape signals from the prospect-stage pre-audit — the Graph API does not expose these. Not re-fetched.

- **Meta Pixel on site:** unknown
- **Conversion events on site:** unknown
- **Google Analytics 4:** unknown
- **Google Tag Manager:** unknown
- **Mobile responsive:** unknown
- **Ad Library history:** —

### Audiences

- **Custom audiences:** 0 (0 healthy, 0 broken/stale)
- **Lookalikes:** _(see audiences)_ (— healthy, — broken)
- **Audiences needing attention:**
  _(none)_

### Account Structure Health

- **Naming convention compliance:** 0% of campaigns follow `[OBJECTIVE]_[AUDIENCE_CODE]_[YYYYMM]`
- **Zombie campaigns** (active, no delivery in 14d): 0
- **Frequency issues** (any active adset > 4.0): _(see /analyze)_

---

## Creative Audit

_Run 2026-09-09 by `/audit-creative`. Source: `creative_audit_summary.json`._

**Assets found:** 3 (0 organic, 3 ad creatives) · **scored:** 2 · **unscorable:** 1
**Overall creative health score:** 4.7/10

| Format | Visual quality | Brand consistency | CTA presence | Text density compliant | Messaging clarity |
|---|---|---|---|---|---|
| Image | 5 | 6 | 100% | 0% | 3 |
| Video | — | — | — | — | — |
| Carousel | — | — | — | — | — |

**Brand voice violations:** none (`voice.restricted_words` is empty — no avoid-list has been
declared for this client, so this line is *unchecked*, not *clean*).

### Coverage caveats (read before acting on the score above)

- **Organic = 0.** The Page-posts fetch failed with Meta error code **190 (invalid/expired
  access token)**. The IG baseline shows 8 posts in the last 60 days, so organic creative
  exists and simply was not readable. This audit covers **paid creative only**.
- **Only 2 of 3 ad creatives are scored.** Creative `1078327524568395` returned no
  `image_url` and no `object_story_spec` — only a 64×64 thumbnail. Its full-resolution
  source lives in Page post `1250910034777823_122105267889439767`, which needs the same
  page token that failed with code 190. Scored `null`, not guessed.
- **The 2 scored creatives are the same image.** `2900008553682236` and
  `2240826259824853` are byte-identical (160,388 bytes each) with identical copy. The
  score therefore reflects **one** creative, and no top-3/bottom-3 ranking is reportable —
  both weight to 5.2. There is no creative variance in this account yet to rank.

### Findings on the one distinct creative

1. **Truncated headline.** The overlay reads "POV: YOU'VE TRIED KETO, INTERMITTENT
   FASTING, THE CABBAGE…" — cut off mid-sentence. The joke's payoff ("…soup thing, and a
   gym membership you used twice") only exists in the body copy, which is not visible in
   feed. This is why `messaging_clarity` is 3: at thumbnail size the image states no
   benefit, no offer, and no product.
2. **Image contradicts the offer.** The background pairs breaded meat and chickpeas with a
   blurred bare torso — food photography on a weight-loss ad reads as a recipe post, and
   the two subjects do not cohere.
3. **Off-palette logo.** The declared brand colors are Dark Green / Light Green; the
   headline accent and footer rule honor that, but the cross logo is blue/teal. Hence
   `brand_consistency` 6 rather than 8+.
4. **Text density ~26% — non-compliant.** Above the 20% bar (headline block + eyebrow chip
   + button + footer). Meta no longer hard-rejects for this, but it suppresses delivery.
5. **CTA present** ("Learn More" button, on-image) — the one clear strength.

### What this means for the next step

There is effectively **one** ad creative in this account, it is a template with a broken
headline, and its duplicate is burning a second creative slot for no test value. Before
`/launch` scales anything: fix the headline truncation, replace the food photo with a
product or transformation subject, and use `/creative` + `/image-gen` to produce genuine
variants rather than copies. Re-run this audit once the page token is repaired to get the
organic half and the third creative.

---

## Recommended Next Steps

1. _(Claude to fill)_
2. _(Claude to fill)_
3. _(Claude to fill)_

---

## Baseline Snapshot

This audit's metrics are saved as the immutable baseline in `baseline_snapshots` table. All future before/after reports compare against this row.

- **Snapshot ID:** _(set after baseline-snapshot.js)_
- **Saved at:** 2026-09-09T06:43:51.540Z
