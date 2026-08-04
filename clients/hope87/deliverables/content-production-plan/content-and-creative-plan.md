# HOPE'87 — Content & Creative Production Plan

**Client:** HOPE'87 (est. 1987, 9-country humanitarian/development NGO)
**Audience:** Pakistani diaspora, Austria + Germany, ages 25–55
**Cause focus:** Skills-development & livelihood programs
**Voice:** Warm, trustworthy, community-rooted, humble-but-credible; storytelling over statistics; soft CTAs
**Grounding data:** `clients/hope87/profile.json`, `prospects/hope87/synthesis.json` (audit score 26/100; posting cadence collapsed to 0.75x/week vs. ≥3x/week target; Islamic Relief Worldwide runs ~35 ads/month in AT+DE, 76 of 104 ads carousel format)

**Note on execution:** smOS has no bilingual content-generation tooling and no brand-refresh skill for an existing brand (`/brand-visual` and `/brand-social` are gated to zero-start clients only). This is a **human-executed brief** — a designer and videographer deliver against the specs below. smOS's role is the strategy layer, the copy (via `/creative`), and the calendar (via `/content-plan`), not the asset production itself.

---

## 1. Social Media Rebrand Direction

### 1.1 Profile picture treatment
- Keep the existing HOPE'87 logo mark (no new logo — this is a refresh, not a rebrand from zero).
- Reset it on a solid brand-color circle/square background (not the current inconsistent crop) so it reads clearly at 32px in a feed.
- Deliver at 500x500 min, transparent-background master + solid-background export for each platform's mask shape.
- If current logo file is low-res or has compression artifacts, vectorize before this step — flag to client if no vector source exists.

### 1.2 Cover photo concept (Facebook)
- **Concept:** "Hands at work" — a warm, candid photo (not a posed stock shot) of a program participant actively engaged in a skills-training session (sewing, carpentry, tailoring, computer literacy — whatever program has current photo assets). Avoid generic "sad child" poverty imagery entirely; this NGO's differentiator is dignity + capability-building, not charity-as-pity.
- **Composition:** subject on the right two-thirds, left third left clear/darker for a text lockup: "Building Skills. Building Futures." (EN) / "Fähigkeiten aufbauen. Zukunft schaffen." (DE) — pick per-market page or rotate.
- **Safe zone:** Facebook cover is 820x312 desktop / crops to ~640x360 mobile — keep all text and faces inside the central 640x312 safe area.
- Refresh quarterly, tied to whichever program has the freshest photo/video assets that quarter.

### 1.3 Instagram highlight covers
Produce **5 highlight covers**, one flat icon style (line-art, single brand color on brand-neutral background, no photos in the icon itself — keeps the profile grid uncluttered):
1. **Impact Stories** — icon: a simple upward path/growth arrow
2. **Programs** — icon: tools/hands icon (ties to skills-training)
3. **Donate** — icon: heart-in-hand
4. **Community** — icon: two overlapping figures
5. **News/Updates** — icon: a simple megaphone or bell

Spec: 1080x1080 source, circle-safe (keep icon within center 800px), single accent color per icon on brand base color, consistent stroke weight across the set.

### 1.4 Post/story template system
Three reusable templates, each defined by content zones so any team member can populate them without a designer redoing layout each time.

**Template A — Quote/Testimonial Card**
- Zone 1 (top, ~15%): small circular photo of the speaker (program graduate, trainer, or community donor) + name + role/location (e.g. "Amina, Skills Program Graduate — Lahore")
- Zone 2 (center, ~55%): the quote itself, large serif or humanist sans, max ~220 characters so it doesn't shrink below legible size
- Zone 3 (bottom, ~20%): HOPE'87 logo mark + one-line context tag (e.g. "Livelihood Program, 2026")
- Zone 4 (footer strip, ~10%): handle/website bar (consistent across all templates — see `skills/image-gen` bar convention already used for paid creative)
- Use case: testimonials, donor quotes, staff reflections. This is the highest-trust, lowest-production-cost template — reuse constantly.

**Template B — Impact-Stat Card**
- Zone 1 (top): one number, huge (e.g. "240 graduates in 2026") — never a raw statistic without a name/place attached in the caption, per the "storytelling over statistics" voice rule; the card leads with the number but the caption always names the person/place behind it
- Zone 2 (mid): one supporting photo (real program photo, not stock) as a background treatment behind/beside the number, not competing with it
- Zone 3 (bottom): one-sentence context line ("Since January, 240 young people completed vocational training through HOPE'87's Skills for the Future program.")
- Zone 4 (footer): logo + handle bar
- Use case: monthly/quarterly milestone posts, program-anniversary posts. Cap frequency — this is a supporting template, not the lead format (voice is storytelling-first).

**Template C — Program-Spotlight Card**
- Zone 1 (top ~10%): program name as a small eyebrow label (e.g. "PROGRAM SPOTLIGHT · Tailoring & Design")
- Zone 2 (center ~60%): full-bleed photo or short video-still of the program in action
- Zone 3 (bottom ~20%): 1–2 sentence description of what the program does and who it serves
- Zone 4 (footer ~10%): soft CTA lockup ("Learn how your donation trains a graduate → link in bio") + logo/handle bar
- Use case: rotating through each of the livelihood/skills programs one at a time — this is the template that carries the donation-cause narrative week to week.

All three templates share: the same footer handle/contact bar, the same logo placement rules, the same two-color accent system (one primary brand color + one warm neutral), and a 4x5 (1080x1350) master size that crops cleanly to 1x1 and 9x16 for Stories.

---

## 2. Graphics Production Plan (Initial Package)

Sized to launch the rebrand + first donation campaign together. All assets tied to the skills-development/livelihood cause specifically — not generic NGO stock imagery.

| Asset | Quantity | Notes |
|---|---|---|
| Profile picture (refreshed) | 1 | Master + platform crops |
| Facebook cover photo | 1 (+1 seasonal alt) | "Hands at work" concept, ready to swap for Ramadan/Qurbani appeal windows |
| Instagram highlight covers | 5 | Impact Stories, Programs, Donate, Community, News |
| Quote/Testimonial cards (Template A) | 6 | 3 program graduates + 2 trainers + 1 donor/community voice |
| Impact-Stat cards (Template B) | 3 | Graduate count, countries active, years of operation (1987–present) |
| Program-Spotlight cards (Template C) | 4 | One per active livelihood/skills program (tailoring, carpentry, computer literacy, vocational trades — adjust to actual current program roster) |
| Carousel ad sets (donation campaign) | 3 carousels x 4–5 cards each | Directly answers the Islamic Relief benchmark (76/104 of their ads are carousel) — carousel format is proven to work with this exact audience/category, so it's a format worth matching even while the message differs |
| Static single-image ad variants | 6 | 2 per creative angle (see Section 4), for placements/tests where carousel underperforms |
| Story-format vertical cuts of the above | 8 | 9:16 crops of the strongest cards, for IG/FB Stories and Reels cover frames |

**Total initial package: ~37 static/graphic assets.** Deliverable as layered source files (Figma/PSD) plus flattened exports at each required aspect ratio, so future in-house updates don't require re-briefing a designer from scratch.

---

## 3. Video Production Plan (Initial Package)

### 3.1 Formats
| Asset | Quantity | Length | Subtitles |
|---|---|---|---|
| Impact-story mini-documentaries | 2 | 90–120 sec | Burned-in EN + separate DE-subtitled export |
| Reels-ready cutdowns (from the above) | 2 per long-form = 4 total | 15–30 sec | Burned-in, both languages as separate exports |
| Trainer/program explainer | 1 | 60 sec | Burned-in EN + DE |
| Donor-testimonial short (if a diaspora donor is willing to appear) | 1 | 30–45 sec | Burned-in EN + DE |

**Total: ~8 finished video assets** from one shoot day (or two half-days if program sites are geographically split).

### 3.2 Suggested shot list / interview subjects
Given this is a training/livelihood NGO, the strongest footage is people mid-skill, not people talking to camera about hardship:
1. **Program graduate (primary subject)** — b-roll of them actually practicing their trained skill (sewing at a machine, working a piece of furniture, at a till/desk in a job they got post-training) + a short seated interview: what they did before, what the program taught them, what's different now. Keep questions oriented to dignity and capability, not deficit ("what can you do now" not "how poor were you").
2. **A second graduate, different program** — for variety across the 4 program-spotlight cards' worth of content.
3. **A trainer/instructor** — b-roll of them teaching, interview on what change they see in participants over a training cycle. This is a credibility anchor — it shows the org has real staff and real curriculum, not just beneficiaries.
4. **Wide/establishing shots of the training facility** — clean, well-lit, not "poverty porn" framing. This is deliberate: HOPE'87's brand asset is community trust and long-standing credibility (est. 1987), so the facility should read as established and functioning, not makeshift.
5. **Optional: a diaspora donor in Austria/Germany** — even a phone-shot testimonial clip works, and it's high-trust content for the exact audience being targeted (peer social proof from within the diaspora community itself).

### 3.3 Caption/subtitle requirement
Every video asset ships with **burned-in captions in both languages as separate export files** (not toggleable — Meta doesn't reliably render toggle-captions across all surfaces). This is a hard requirement, not optional polish: diaspora audiences scrolling Facebook/Instagram on mobile in transit or shared spaces overwhelmingly watch muted, and a video with no captions loses the message entirely in the first 3 seconds where the hook needs to land. Caption style: high-contrast, bottom-third, sans-serif, max 2 lines on screen at once, synced to speech (not paraphrased summary blocks).

---

## 4. Ad Creative Angles (Donation Campaign)

Informed by the competitive benchmark — Islamic Relief Worldwide runs ~35 ads/month in AT+DE, 76 of 104 carousel format — but differentiated on message and pacing, not copied on execution.

### Angle 1 — "One Skill, One Future" (carousel, program-spotlight)
- **Hook:** "Amina couldn't find work. Six months later, she runs her own tailoring stall."
- **Core message:** Donations fund a specific, named training pathway with a visible before/after outcome — leads with an individual's trajectory, not an appeal for the org in general. Each carousel card advances one step of that person's journey (enrolled → trained → working), ending on a soft-CTA card ("Support the next graduate").
- **Format:** 4-card carousel, Template C spotlight style, using real program-graduate footage/photos from the video shoot.
- **Differentiation from Islamic Relief:** their carousels tend to be broad appeal/crisis-response; this leads with a single named person's skills journey — matches the audit's "storytelling over statistics" voice mandate directly.

### Angle 2 — "Trusted Since 1987" (single image/static, credibility-led)
- **Hook:** "Since 1987, we've trained people to build their own futures — not just survive today."
- **Core message:** Leverages HOPE'87's actual differentiator (decades of on-the-ground credibility, 9-country footprint) against a diaspora audience that is often wary of newer or less-vetted appeals in their feed. Pairs the impact-stat card (graduate count / years active) with one line of program specificity, soft CTA ("See how your donation is used").
- **Format:** single static image (Template B impact-stat treatment), used for cold top-of-funnel placements and retargeting warm audiences with the org's credibility.
- **Differentiation:** trust/tenure-led rather than urgency-led — deliberately calmer pacing than a 35-ads/month cadence built on frequent crisis-appeal churn.

### Angle 3 — "From Training to Independence" (carousel or short video, aspirational/livelihood-specific)
- **Hook:** "A sewing machine. A few months of training. A small business of her own."
- **Core message:** Frames the donation as funding *independence*, not charity — directly ties to the skills-development/livelihood cause focus (not general humanitarian relief). Shows the tangible chain: donation → training slot → tool/equipment → income. Ends on the softest CTA of the three ("Learn more about the program" rather than a hard "Donate now"), suited to cold/upper-funnel audiences before retargeting pushes harder.
- **Format:** either the 15–30 sec Reels cutdown (video-native placements) or a 4–5 card carousel version for feed/carousel-only placements — test both.
- **Differentiation:** most competitor appeals in this category default to relief/crisis framing; this angle is explicitly livelihood/economic-independence framing, which is HOPE'87's actual program strength and a distinct market position vs. Islamic Relief Worldwide's broader humanitarian-relief messaging.

---

## 5. Bilingual Content Approach (EN/DE)

Practical production rule, tiered by asset type and cost of getting it wrong:

- **Full separate human copywriting (EN + DE, each written natively, not translated):**
  - Ad primary text, headlines, and CTAs (highest-stakes copy — literal translation loses persuasive nuance and soft-CTA tone; write once per language against the same brief)
  - Donation-flow landing page copy
  - Cover photo / highlight cover text lockups (short, high-visibility, must land culturally)

- **Machine-translated + human-reviewed (fast-turn, lower-stakes):**
  - Organic post captions (Templates A/B/C card captions) — draft in EN, machine-translate to DE, then a native German speaker on the team does a light pass for tone/idiom before publishing. This keeps cadence achievable without a full bilingual copywriter on every single post.
  - Story-format text overlays and quick-turn Reels captions

- **Burned-in subtitles (video):** always fully separate exports per language (not machine-generated auto-captions) — accuracy matters more here since these are the primary hooks for muted viewing, and mistranslated subtitles on a testimonial undermine the trust the whole campaign is built on.

- **Visual assets (graphics/photos):** produced once, language-agnostic where possible (numbers, photos, icons) — only the text overlay changes per language. This is why the template system in Section 1.4 keeps text in a defined zone separate from the photo — one design, two language exports, not two separate designs.

- **What stays English-only:** internal reporting, ad account naming/labels, and any asset targeted at non-diaspora general AT/DE audiences if the campaign later expands beyond the core Pakistani-diaspora segment (not in scope for this initial package, but noted so it isn't accidentally bilingual-forced later).

---

## 6. Production Cadence (Ongoing, Post-Launch)

Fixes the audit-flagged gap: cadence has collapsed to 0.75 posts/week against a ≥3x/week maintained-account benchmark, with an 11.6-day gap since last post at time of audit.

**Weekly organic rhythm (steady-state, once initial package ships):**
- **3 feed posts/week** — rotating Templates A/B/C so no single format runs back-to-back (e.g. Mon: Quote/Testimonial, Wed: Program-Spotlight, Fri: Impact-Stat or community/news update)
- **2 Reels/week** — cut from the standing video library (Section 3) plus new short-form b-roll captured opportunistically at program sites; Reels carry reach/discovery, feed posts carry engagement/saves per the audit's own recommendation
- **Daily-to-3x/week Stories** — lower-effort reshares of feed content, highlight-cover-consistent, used to keep the account "alive" between main posts (this is what closes the 11.6-day-gap problem specifically — Stories require near-zero incremental production once the template system exists)

**Monthly cadence:**
- 1 new Program-Spotlight card per active program (rotating through the roster established in Section 2)
- 1 impact-stat/milestone post
- 1 fresh testimonial (recycle the video-shoot library first; re-shoot quarterly once it's exhausted)

**Paid cadence (ties to Section 4 angles):**
- Launch with the 3 angles running in parallel as a controlled test (not simultaneously scaling any one) — start conservatively, well below Islamic Relief Worldwide's ~35 ads/month volume; the goal at launch is establishing *any* paid footprint in AT/DE (currently zero), not immediately matching competitor volume
- Refresh/rotate creative on a **2–3 week cycle** per angle to manage fatigue, restocking from the standing graphics/video library rather than commissioning net-new shoots each cycle
- Re-evaluate cadence and budget at the 60/90-day marks per the synthesis report's existing `next_steps` (Ramadan/Qurbani seasonal-appeal iteration at day 60; full benchmark comparison at day 90)

**Resourcing implication:** the initial package (Section 2 + 3) is sized to cover roughly 6–8 weeks of steady-state posting once live, giving the content team a runway to schedule the next production cycle before the library runs dry — avoiding a repeat of the cadence collapse that produced the current 0.75x/week gap.
