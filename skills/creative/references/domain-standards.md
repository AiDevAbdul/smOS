# /creative — Domain Standards

Self-contained copywriting expertise for the smOS creative package. Everything here is
encoded in `creative.js`; this file is the human-readable source of truth. Read it before
filling a draft.

## 1. Length limits (CONSTANT — `LIMITS` in creative.js)

| Variant kind | Hard limit (chars) | Truncate point | Notes |
|--------------|--------------------|----------------|-------|
| `hook` | 60 | 60 | Lead line; must read in <3s |
| `primary_text` | 500 | 125 | Meta truncates the feed preview at ~125 chars — front-load the value |
| `headline` | 40 | 40 | Below the image/CTA |
| `description` | 30 | 30 | Link description (optional surface) |

Over-limit variants are flagged (`over_limit: true`) and counted in `summary.over_limit`.
The scorer also docks **clarity** when a variant exceeds its truncate point or hard limit.

## 2. Scoring rubric (CONSTANT — `scoreVariant`)

Each variant is scored 0–10 on four axes; **composite = average of the four**, rounded to 1 dp.

| Axis | What it rewards | What it penalizes |
|------|-----------------|-------------------|
| `clarity` | Fits well under truncate point; simple words | >3 commas/semicolons; >2 words longer than 12 chars; over hard limit (−4) |
| `specificity` | Digits, `$/£/€` amounts, `%`, proper nouns | Vague hype: "amazing", "incredible", "best ever", "unbelievable", "game-changer" (−2) |
| `emotional_trigger` | Matches an `audience.pain_points` keyword; second-person ("you/your"); `?`/`!` | Engagement bait (−3) |
| `cta_strength` | (text) action verbs + urgency words; (CTA kind) **9 if a valid enum value, else 0** | — |

Top pick per angle = the hook whose `best_combo.overall` (avg of hook + best primary +
best headline + best CTA) is highest. Exactly one `top_pick: true` per angle.

> The heuristic scorer is deterministic and consistent, not a replacement for editorial
> judgment. Use it to rank/sanity-check, then choose the human-best top pick if scores tie.

## 3. Valid Meta CTA enum (CONSTANT — `VALID_CTAS`, 31 values)

```
SHOP_NOW LEARN_MORE SIGN_UP GET_OFFER BOOK_TRAVEL BOOK_NOW BUY_NOW CONTACT_US
DOWNLOAD GET_QUOTE SUBSCRIBE WATCH_MORE APPLY_NOW BUY_TICKETS ORDER_NOW
GET_SHOWTIMES SEE_MENU CALL_NOW MESSAGE_PAGE DONATE_NOW GET_DIRECTIONS
WHATSAPP_MESSAGE SEND_MESSAGE NO_BUTTON REQUEST_TIME INSTALL_MOBILE_APP USE_APP
INSTALL_APP PLAY_GAME LISTEN_MUSIC OPEN_LINK
```

Any CTA outside this set is flagged `valid: false` and scored 0. Match the CTA to the
funnel stage (awareness → `LEARN_MORE`/`WATCH_MORE`; consideration → `SIGN_UP`/`GET_QUOTE`;
conversion → `SHOP_NOW`/`BUY_NOW`/`ORDER_NOW`/`GET_OFFER`).

## 4. Engagement-bait blocklist (CONSTANT — `ENGAGEMENT_BAIT`)

Never write: "tag a friend", "comment below", "share this", "like if", "share if",
"double tap", "smash that". These tank reach under Meta policy and dock `emotional_trigger`.

## 5. Hook archetypes (VARIES — chosen per angle)

Lead each angle with its archetype, inherited from the brief's `creative_angles[i].hook`:

- **Pain / problem** — name the friction in the prospect's words.
- **Aspiration** — paint the after-state outcome.
- **Authority / proof** — numbers, credentials, social proof.
- **Curiosity / pattern-break** — open a loop the body closes.

## 6. Design brief (CONSTANT sizes; VARIES direction)

Each angle's design brief ships fixed sizes and copy zones:

- Sizes: `1080x1080` (feed), `1080x1920` (story/reels), `1200x628` (link).
- Copy zones: center-safe for 1:1; bottom-third for 9:16; left-third for 1.91:1 (CTA bug area).
- Visual direction: "Lead with the {archetype}. {brief direction}" — reference `assets.brand_colors`.

If the brief implies AI-generated imagery, the downstream `/launch` ad must set
`ai_disclosed: true` (Meta policy). This skill only writes the brief, not the asset.

## 7. Good vs bad examples

| Variant | Verdict | Why |
|---------|---------|-----|
| `Lost 12 lbs in 6 weeks — here's the plan` (hook) | Good | Specific number, outcome, fits 60 |
| `The most amazing offer you'll ever see!!!` (hook) | Bad | Vague hype, no specificity, exclamation spam |
| `Book your free 15-min audit today` (primary) | Good | Action verb + urgency + concrete, short |
| `Tag a friend who needs this 👇` (primary) | Bad | Engagement bait — blocked, −3 emotional |
| `SHOP_NOW` (cta) | Good | Valid enum, scores 9 |
| `BUY_THE_THING` (cta) | Bad | Not in enum, `valid:false`, scores 0 |

## Keeping current

- CTA enum and length limits are Meta-defined — re-verify against the Meta Ads Guide
  (https://www.facebook.com/business/ads-guide). On fetch: open a Feed/Reels placement,
  read the **Call to action** dropdown and diff its values against `VALID_CTAS` (31); read
  the recommended-resolution rows and confirm 1080×1080 / 1080×1920 / 1200×628 and the
  ~125-char primary-text truncation are unchanged.
- If Meta adds/removes CTA values or changes truncation/sizes, update `VALID_CTAS` / `LIMITS`
  in `creative.js` first, then mirror the change here. Do not hardcode values only in docs.

**Verification date:** see the single canonical **Last verified** line in `../SKILL.md`
(Documentation & References). This file does not carry its own date — re-verify all
references together and bump only the SKILL.md line.
