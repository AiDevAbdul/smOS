# content-plan — Per-Platform Content Specs (SOP)

The single source of truth for **platform-native** production specs, copy limits,
algorithm signals, and publish-path status across the five platforms smOS produces
for. `/content-plan` reads this when fanning one pillar into platform variants; the
creative agent (`/creative`, `social`, `facebook-posts`, `linkedin-posts`,
`video-shorts`) reads it to shape assets correctly; `/publish` reads §"Publish path"
to know what it can dispatch vs hand off to a human.

> **Freshness:** verified mid-2026. Spec numbers are from official platform/developer
> docs; algorithm *weightings* are directional (third-party guides citing platform
> reps), not contractual. Re-verify §"Publish path" before relying on any API limit —
> these change without notice. Last research sweep: **2026-06-29**.

> **Why this lives in `references/`, not a binder:** an SOP outside the skill system
> drifts and stops being enforced. Edit this file once → every content deliverable and
> the routing layer inherit it. See [[project_design_system]] for the same principle
> applied to visual style.

---

## 0. Cross-platform rules (apply everywhere)

- **Vertical-first.** 9:16 (1080×1920) is the default for video on every platform; the
  hook must land in the **first 1–3 seconds** or distribution collapses.
- **Front-load the hook + primary keyword** before the "…more" / "See more" truncation
  point — every platform truncates captions, most at ~125 chars or less.
- **Hashtags are de-emphasized everywhere in 2026.** 3–5 targeted tags is current best
  practice on every platform (FB lower, 1–3). Stuffing is neutral-to-negative.
- **Search/SEO is now a primary discovery lever** (TikTok, IG, YouTube, LinkedIn all
  operate as search surfaces) — keyword-first captions, on-screen text, and alt text
  matter as much as hashtags.
- **AI-content disclosure is mandatory** on GenAI-derived media (Meta + YouTube enforce
  it; undisclosed AI is down-ranked or removed). The `ai-disclosure` guard in
  `scripts/lib/guards.js` already enforces the Meta side — extend the same flag to
  YouTube uploads.
- **Original content wins; reposting is penalized** (explicit on IG; directional on the
  rest).

---

## 1. Facebook (Meta)

**Media**
| Placement | Recommended | Ratio |
|---|---|---|
| Feed portrait (best mobile reach) | 1080 × 1350 | 4:5 |
| Feed square | 1080 × 1080 | 1:1 |
| Feed link/landscape | 1200 × 630 | 1.91:1 |
| Reels / Stories | 1080 × 1920 | 9:16 |

- **Reels:** 9:16, 1080×1920, **3–90 s**, MP4 H.264/AAC, 24–60 fps. Burn in captions.
- **Feed video:** up to 240 min / 10 GB; 16:9, 1:1, or 4:5.

**Copy:** max 63,206 chars; only first **~125 chars / 3 lines** show before "See more."
Optimal **40–80 chars** for reach. Hashtags **1–3** (weak signal on FB). Native link
posts get reduced reach → post media natively, **link in first comment**.

**Algorithm 2026:** Reels-first / video-dominant (video shared ~12× more). Watch time is
the core Reels signal; **shares & saves outweigh likes**; early engagement velocity
decisive. Cadence ~4.7 posts/week median — overposting hurts. Best Tue/Wed/Thu.

**Publish path: ✅ AUTOMATED (built).** Graph API v25.0 — `/publish` already dispatches
feed/photo/video. **Reels** use the 3-phase `/{page-id}/video_reels` flow
(`start` → upload to `rupload.facebook.com` → `finish` + `video_state=PUBLISHED`); the
old single-shot path is deprecated. Scopes: `pages_manage_posts` + `pages_read_engagement`
+ `pages_show_list` (Page/System-User token). **Rate cap: 30 Reels/24h per Page.**
Requires App Review + Business Verification (see `docs/agency-foundation.md`).

---

## 2. Instagram (Meta)

**Media**
- **Feed image default is now 4:5 — 1080 × 1350.** New **3:4 (1080×1440)** ratio added in
  2025; profile grid thumbnails now preview in **3:4** (moved off square). API: **JPEG only.**
- **Reels / Stories:** 9:16, 1080×1920; safe zone ≈ 1080×1610.
- **Reels: up to 3 minutes** (extended). Feed video is now published as Reels.

**Copy:** max 2,200 chars; ~125 visible before "…more." Hook in first 125 chars.
Hashtags **3–5** (de-emphasized — now topical/search context, not a reach lever).
Captions not clickable → **link in bio** + Stories link stickers. Set **`alt_text`**
on images (field added Mar 2025; also a Social-SEO signal).

**Algorithm 2026 (per Mosseri):** top signals are **watch time (#1), sends-per-reach
(DM shares), likes-per-reach.** **Sends/shares weighted far above likes** for reaching
new audiences — design posts to be DM-shared. Separate algos per surface (Reels = watch
time + sends; Feed = relationship; Stories = recency; Explore = velocity). **Original
content favored; 10+ reposts/30 days can exclude you from recommendations.** Reels-first
for reach; carousels strong for saves/dwell.

**Publish path: ✅ AUTOMATED (built).** Two-step container flow:
`POST /{ig-id}/media` → `POST /{ig-id}/media_publish`. Reels poll
`GET /{container-id}?fields=status_code` until `FINISHED`. Carousels = child containers →
parent (≤10 items) → publish (1 post). Stories supported (`media_type=STORIES`).
⚠️ **Scope rename Jan 27, 2025:** use **`instagram_business_content_publish`**
(IG-Login) — legacy `instagram_basic`/`instagram_content_publish` deprecated.
**Rate cap: 100 posts/rolling 24h** (carousel = 1) — check via `/content_publishing_limit`.

---

## 3. TikTok

**Media**
- **9:16, 1080 × 1920**, MP4 (Android) / MOV (iOS), H.264, ≤60 fps.
- Length: **3 s min**; in-app **up to 10 min**, uploaded **up to 60 min**. **Optimal 15–30 s.**
- File ≤ ~287 MB. Photo carousels: 2–10 images, 1080×1920.
- Keep key elements in the **center safe zone** (UI overlays cover edges).

**Copy:** native caption max **4,000 chars** (raised 2,200 → 4,000 as an explicit
**SEO play**). ⚠️ But the Content Posting API `post_info.title` is capped at **~2,200
runes** — programmatic captions must respect 2,200, not 4,000. Only ~80–150 chars show
before "…more" → front-load hook + keyword. Hashtags **3–5**. Optimal ~150–300 chars.

**Algorithm 2026:** ranks on **watch time, completion rate, replays/rewatches, shares.**
**~70% completion is the viral-push threshold; ≥80% is strong.** Hook in first 1–2 s.
Cadence **3–5×/week** (daily for ramp). Trending audio still a discovery lever.
**TikTok is now a search engine — 84% of searches are exploratory** → keyword-first
captions/on-screen text/voiceover carry equal-or-greater weight than hashtags.

**Publish path: ⚙️ NOT BUILT — gated.** Content Posting API has two modes:
- **Upload (draft / inbox)** — pushes media into the creator's app as a draft; human
  finalizes. Scope **`video.upload`**. **Works pre-audit** → ship this first.
- **Direct Post** — publishes/schedules straight to profile. Scope **`video.publish`**.
  **Requires a content-posting audit (~2–4 weeks)**; unaudited apps force SELF_ONLY
  visibility, dev mode caps 5 authorizations/24h.
- **Caps:** 6 req/min per token; **25 videos/account/day.**
- **SOP until audit clears:** TikTok ends at **Upload-draft + human-finalize**.

---

## 4. LinkedIn

**Media**
- **Images:** 1:1 (1080×1080), 1.91:1 (1200×627), or **4:5 (1080×1350, best mobile)**.
  Max 5 MB, JPG/PNG. Multi-image via the MultiImage API.
- **Document ("carousel") posts:** PDF/PPTX/DOCX rendered as swipeable slides — slides
  1080×1080 or 1080×1350, **≤100 MB / 300 pages**, optimal **5–10 slides**. ⚠️ The true
  API `Carousel` object is **sponsored-only**; organic "carousels" are **document posts**.
- **Video:** 3 s–10 min, ≤5 GB, 1:1 / 16:9 / 9:16, MP4 H.264/AAC.

**Copy:** max 3,000 chars (Pages truncate ~700 on some surfaces). "See more" cutoff
**~140 chars mobile / ~210 desktop** — hook must land there. Optimal ~150–250 words.
Hashtags **3–5** (roughly reach-neutral in 2026; aid search). Hashtag-following was
removed (2024).

**Algorithm 2026:** ⚠️ **interest-graph** replaced social-graph. **Dwell time** is the
primary quality signal (61+ s ≈ 13× the engagement of a 0–3 s view). **Comments ≫ likes.**
**Knowledge/expertise relevance prioritized** (educational > promo). ⚠️ **Outbound links
suppress reach ~60%, AND the "link in first comment" workaround is now ALSO penalized
(early 2026)** — deliver value natively, link secondarily. Cadence 2–5×/week; first ~60 min
+ author replies decisive.

**Publish path: ⚙️ NOT BUILT — gated.** Publish to a Company Page via the **Posts API**
(`POST /rest/posts`, `author=urn:li:organization:{id}`, header `LinkedIn-Version`).
⚠️ `ugcPosts`/`shares` deprecated → Posts API is the path. Supported organic types: Text,
Image, Video, **Document**, Article, MultiImage, Poll. **Organic Carousel NOT supported**
— use document posts. Scopes: **`w_organization_social`** (+ `r_organization_social`,
`rw_organization_admin`). **Gate:** runs through the **Community Management API**
(Marketing Developer Platform) — vetted, tiered (Development → Standard via screencast
demo + Technical Sign-Off). **Not open self-serve.**

---

## 5. YouTube

**Media**
- **Shorts:** 9:16, **≤3 minutes** (extended from 60 s, Oct 2024), 1080×1920 (4K vertical
  ok). Must be ≤180 s + 9:16 to hit the Shorts shelf. `#Shorts` no longer required.
- **Long-form:** 16:9 (1920×1080 native; up to 8K), ≤256 GB / 12 h, MP4 H.264/AAC.
- **Thumbnail:** 1280×720, 16:9, ≤2 MB, JPG/PNG.

**Copy:** title **100 chars** (keyword in first ~60); description **5,000 chars**, optimal
200–500 words with keyword above the "…more" fold. Tags ~10–20 (minimal role now).

**Algorithm 2026:** ⚠️ **viewer satisfaction now outweighs raw watch time** (post-watch
surveys, returns, session continuation). ⚠️ **Shorts and long-form ranked by two separate
models** — Shorts = swipe-vs-watch in first 1–3 s + replays + shares; long-form =
**session contribution** ahead of average view duration. CTR (thumbnail+title) + retention
core. **Disclosed AI is not penalized; undisclosed detected AI is down-ranked/removed.**

**Publish path: ⚙️ NOT BUILT — gated.** Data API v3 `videos.insert` (Shorts use the same
endpoint, classified by 9:16 + ≤180 s). Scopes: `youtube.upload` / `youtube.force-ssl`.
**Quota: 1,600 units/upload; default 10,000/day ≈ 6 uploads/day.** ⚠️ **Hard gate:**
videos uploaded from **unverified projects lock to PRIVATE** until a **compliance audit**
passes (audit also lifts the quota). Set the **AI-content label** on GenAI-derived video.

---

## 6. Publish-path summary (what `/publish` can do today)

| Platform | Automated publish? | Path | Pre-req before live |
|---|---|---|---|
| Facebook | ✅ built | Graph API v25.0 (`/feed`, `/photos`, `/videos`, `/video_reels`) | App Review + Biz Verification |
| Instagram | ✅ built | Graph API v25.0 (container → publish) | `instagram_business_content_publish` scope |
| TikTok | ⚙️ not built | Content Posting API — **Upload-draft first**, Direct Post post-audit | Content-posting audit (~2–4 wk) for Direct Post |
| LinkedIn | ⚙️ not built | Posts API (Company Page) | Community Management API tiered approval |
| YouTube | ⚙️ not built | Data API v3 `videos.insert` | Compliance audit (lifts private-lock + quota) |

**SOP rule for un-built platforms:** the content chain ends at
**finished asset + platform-native caption handed to the human** — `/publish` must NOT
fake a dispatch it cannot perform (per the smOS constitution: "Missing client data: halt
and ask… do not guess"). When the audit/approval for a platform clears, flip its row to
✅ and wire the dispatcher.
