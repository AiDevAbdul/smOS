# brand-social — Domain Standards

Self-contained embedded expertise for dressing a brand's social surface at 2026 specs.
Read this before producing any asset or bio.

## 1. Platform dimensions (2026, mobile-first)

All sizes are pixels. Source: Meta Ads Guide and Business Help Center (see SKILL.md
Documentation table). Verified recommended sizes from `skills/references-shared.md §15`.

### Facebook
| Asset | Dimensions | Notes |
|-------|-----------|-------|
| Profile picture | 320×320 (upload ≥360×360, 1:1) | Renders as a circle; keep the mark centered |
| Cover photo | 851×315 (desktop) | Desktop and mobile crop differently — keep content centered, avoid edges |

### Instagram
| Asset | Dimensions | Notes |
|-------|-----------|-------|
| Profile picture | 320×320 (1:1) | Renders ~110px circle on mobile |
| Feed (portrait, default) | 1080×1350 (4:5) | Preferred feed ratio for reach |
| Feed (square) | 1080×1080 (1:1) | |
| Feed (landscape) | 1080×566 | |
| Story / Reels | 1080×1920 (9:16) | |
| Highlight cover | design at 1080×1920 | Keep the icon in the **center 720×720 safe zone**; ship a matching set |

### Story safe margins
- Top ~250px and bottom ~310px are reserved by platform UI — keep critical content out of these zones.

## 2. Template family taxonomy

Ship this fixed set, all on locked fonts/colors/logo:

| Template | Purpose |
|----------|---------|
| `quote` | Pull-quote / brand voice statement |
| `tip` / carousel cover | Educational tip or carousel lead slide |
| `promo` | Offer / launch / CTA |
| `testimonial` | Social proof |
| `story-CTA` | Vertical story with action button, respecting safe margins |

## 3. Bio formulas

### Instagram (3-line)
`Identity + Value + CTA`. Put the **searchable keyword in the indexed Name field** (the bold
line above the bio), not buried in the bio body. IG bio body cap ≈ 150 chars.

**Good:**
```
Name field: GreenLeaf · Organic Skincare
Bio: Plant-based skincare made in small batches 🌿
     Dermatologist-tested, never tested on animals
     👇 Shop the bestsellers
```
**Bad (keyword not indexed, no CTA, wall of text):**
```
Name field: GreenLeaf
Bio: We are a company that believes in skincare and we make products that we think you will love and we hope you will too thanks for visiting
```

### Facebook
`Problem → Solution → Reward`. Front-load the **first ~155 chars** (the truncation point in
most surfaces). Set the Page CTA button (Shop Now / Book Now / Sign Up).

**Good:** "Tired of skincare that irritates? GreenLeaf is plant-based, dermatologist-tested,
and cruelty-free — so sensitive skin finally gets results. Shop the line →"

## 4. Restricted-word handling

Strip any token present in `client_profile.voice.restricted_words` from all bios, the
hashtag, and template copy — case-insensitive, whole-word. If a restricted word is the only
natural phrasing, rewrite around it; never ship copy containing it.

## 5. Profile-picture contrast

Logo mark sits on a brand color. Verify the mark/background pair meets WCAG 2.1 AA: **4.5:1**
for normal-weight marks, **3:1** for large/bold marks. Thresholds are exact — do not round.

## 6. Link-in-bio structure

Order destinations by value, highest first (e.g. primary offer → newsletter → secondary
product → about). Single URL field on IG; lead with the highest-value action.

## 7. Branded hashtag

One short, ownable, on-brand hashtag (campaign-agnostic). Verify it is not already saturated
by an unrelated brand before locking.

## 8. AI-generated assets

If the profile picture or cover is AI-generated, `visual.ai_generated` must be `true` in the
brand profile (set upstream in `/brand-visual`). This carries through to `ai_disclosed` on any
ad built from it, satisfying Meta's AI-disclosure policy and the smOS `ai-disclosure` guard.
