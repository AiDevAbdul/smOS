# Phase 2 — Intake & Audit

**Status:** 🟡 In progress  
**Depends on:** Phase 1 complete ✅  
**Estimated in blueprint:** 2–3 days

---

## Goal

Build the entry point for every client. After Phase 2, smOS can onboard a brand new client, pull a full audit of their organic and paid presence, score their creative quality, and save an immutable baseline snapshot to Supabase — all in a single session.

---

## What Gets Built

### `/intake` Skill (`skills/intake.md`)

Guided Q&A that collects all business and account information needed to run smOS.

**9 question groups:**
1. Business basics — product, price, model, USP
2. Target audience — age, gender, location, pain points
3. Brand voice — tone, restrictions, CTA style
4. Accounts & access — ad account ID, pixel, page IDs, BM ID
5. KPI targets — CPA goal, ROAS target, budget range
6. History — previous ad experience, what worked, what failed
7. Competitive context — top 3 competitors (for Phase 3 research)
8. Assets — creative assets available, brand guidelines
9. Approval preferences — what needs human sign-off vs auto-execute

**Outputs:**
- `clients/{slug}/client_profile.json` — structured JSON
- `clients/{slug}/CLAUDE.md` — generated client constitution (populated template from section 04)
- Row inserted into `clients` table in Supabase

---

### `/audit` Skill (`skills/audit.md`)

Pulls live data from Meta API to establish the "before" state.

**Organic audit (via `get_page_insights`, `get_post_insights`, `get_page_fans`, `get_page_completeness`):**
- Page completeness score
- Follower count + 90-day growth trend
- Post frequency (posts/week, last 60 days)
- Content format mix (video %, image %, carousel %, Reels %)
- Avg engagement rate per format
- Best/worst performing posts
- Posting time distribution vs peak audience activity
- Response rate and avg response time

**Paid audit (via `get_campaigns`, `get_campaign_insights`, `get_custom_audiences`, `check_pixel_health`):**
- Account age, spend history, payment method status
- Pixel health score + event-by-event check
- Custom audience inventory (sizes, freshness, health status)
- Lookalike audience quality
- Campaign history last 12 months
- Best/worst performing campaigns
- Account structure health (naming, zombie campaigns, budget waste)
- Frequency and fatigue patterns

**Output:** `clients/{slug}/audit_report.md` + row in `reports` table

---

### `/audit-creative` Skill (`skills/audit-creative.md`)

Pulls last 20–30 post images and ad creatives. Uses Claude vision to score each one:

| Dimension | Check | Score |
|---|---|---|
| Visual quality | Clarity, composition, production value | 1–10 |
| Brand consistency | Colors, fonts, logo match brand | 1–10 |
| CTA presence | Clear call to action visible | Yes/No |
| Text compliance | Text overlay under 20% of image | Pass/Fail |
| Messaging clarity | Value prop legible at small size | 1–10 |

**Output:** Creative scores added to `audit_report.md`

---

### Baseline Snapshot (`scripts/baseline-snapshot.js`)

After audit completes, saves an immutable timestamped row to `baseline_snapshots` table. This becomes the permanent "before" that all future before/after reports compare against.

```json
{
  "client_id": "...",
  "snapshot_date": "2026-XX-XX",
  "followers_fb": ...,
  "followers_ig": ...,
  "avg_engagement_rate": ...,
  "posts_per_week": ...,
  "content_quality_score": ...,
  "page_completeness_score": ...,
  "pixel_health": "full | partial | none",
  "custom_audience_count": ...,
  "total_historical_spend": ...,
  "historical_best_cpa": ...,
  "historical_best_roas": ...,
  "audit_report_url": "drive://..."
}
```

---

## Test Target

**Uppal Pharma** (`act_1445634743038275`) — the only active account from Phase 1 testing.

Known state going in (from Phase 1 API tests):
- Pixel is live (fired 2026-06-16)
- 4 broken lookalike audiences (operation_status 433)
- 1 stale website custom audience
- 10 campaigns (ENGAGEMENT/AWARENESS focus, no conversions)
- Balance: PKR 0.00
- Currency: PKR | Timezone: Asia/Karachi

Expected audit findings:
- Pixel health: partial (fires, but conversion events unknown)
- Audiences: flagged as needing recreation
- Campaign structure: no conversion campaigns yet
- Account balance: flagged (no current budget to run ads)

---

## Decisions Locked

- [x] **Intake style:** Conversational Q&A (one question at a time, follow-ups on ambiguous answers)
- [x] **Facebook Page:** `https://www.facebook.com/uppalpharmaofficial` → **Page ID `240040362681990`** (Uppal Pharma, 80,884 fans, Medical & health, unverified)
- [x] **Instagram:** `https://www.instagram.com/uppalpharmaoffical/` — IG Business Account ID needs to be resolved at audit time via Page → `instagram_business_account` edge (requires Page Access Token first)
- [x] **Website:** `https://uppalpharma.com/`
- [x] **KPI targets:** Use global defaults from root CLAUDE.md until `/intake` collects specifics from client

## Research Findings (informed the build)

- **IG `impressions` metric deprecated April 2025** → `get_instagram_insights` defaults updated to `reach, accounts_engaged, follower_count, profile_views, website_clicks`
- **Format mix is not a native metric** — must aggregate post-level by `status_type` / `media_type`. The `/audit` skill does this in synthesis.
- **Three MCP read-tool gaps filled**:
  1. `get_page_creatives` — full-res images via `full_picture`, carousel sub-attachments
  2. `get_page_videos` — Reels + video thumbnails via `/videos`
  3. `list_ad_creatives` — bulk account-level read of creatives (only write path existed before)
- **Vision scoring pattern**: pass image URLs (not downloads), batch 5–8 per call, force structured JSON output. ~60k tokens for 30 creatives.

## Known Access Gap (must resolve before /audit test)

The Uppal Pharma Page is **not under our System User's managed pages**. Public profile reads work, but `/page/insights` and `/page/posts` return OAuth errors (code 190 / code 100).

**Required fix before `/audit` can run:**
1. Add the System User as an admin of the Uppal Pharma Page via Business Manager
2. After that, `/audit` will call `GET /{page_id}?fields=access_token` to obtain a Page Access Token, then use it for insights/posts calls

This is a configuration step, not a code change. The skill assumes the token will be obtainable; if not, Pass 1 surfaces the error with the fix instructions.

## What Got Built

**MCP additions** (`mcp/meta-server/tools/page-insights.js`):
- `get_page_creatives` — full-res images + carousel detection for creative audit
- `get_page_videos` — Reels and video thumbnails
- `list_ad_creatives` — bulk read of ad creatives (account-wide)
- `get_instagram_insights` defaults updated (drop deprecated `impressions`)

**Skills** (`skills/`):
- `skills/intake.md` — 9-group conversational Q&A; outputs `client_profile.json` + per-client `CLAUDE.md` + Supabase `clients` row
- `skills/audit.md` — 5-pass workflow: organic FB → organic IG → paid account → synthesis → persistence
- `skills/audit-creative.md` — batched vision scoring across 5 dimensions; appends to audit report

**Scripts** (`scripts/`):
- `scripts/baseline-snapshot.js` — immutable baseline row writer (refuses overwrite); programmatic + CLI usage

**Templates** (`templates/`):
- `templates/intake-questions.md` — verbatim Q&A script
- `templates/client-claude.md` — per-client constitution template with all fill slots
- `templates/audit-report.md` — audit report template (also referenced in Phase 3)

## Original Decision Stubs (resolved above)

---

## Previous Phase

← [Phase 1 — Foundation](phase1.md)

## Next Phase

→ [Phase 3 — Research & Strategy](phase3.md)
