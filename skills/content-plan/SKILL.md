---
name: content-plan
description: Use this skill when the user asks to build an organic content strategy, content calendar, or posting plan for a client (typically `/content-plan {slug}`). Produces content pillars + a Reels-first calendar that `/publish` consumes. This is the generator `/publish` assumes already exists.
---

# /content-plan — Organic Content Strategy Engine (Phase 2.2)

Closes the organic gap: smOS could *publish* a calendar but had nothing to *write*
one. This produces the content pillars and a Reels-first calendar, with Social-SEO
(Phase 2.6) baked into every item (keyword-first captions + alt text).

## Required Context

- `clients/{slug}/client_profile.json` — voice, audience, `accounts.facebook_page_id` / `instagram_business_id`
- `clients/{slug}/baseline_snapshot.json` (optional) — current cadence/engagement to set targets against
- `clients/{slug}/competitor_intel.json` (optional) — angles + top formats to react to

## Output (canonical contracts)

- `clients/{slug}/content_plan.json` — `schemas/content_plan.js` shape: `{ pillars[], items[] }`
- `clients/{slug}/content_calendar.json` — the SAME items, in the shape `/publish` reads
  (status `pending`, `publish_at` set). `/content-plan` → `/publish` is now a real handoff.

## Workflow

1. Load the profile (halt if missing — never blank-page generate).
2. Derive 3–5 **pillars** from voice + audience + competitor angles, each with a weekly cadence and SEO keywords.
3. Generate a `period` (default: next 4 weeks) calendar, **Reels-first** (≥50% reels), distributing items across pillars per cadence.
4. For each item, fill keyword-first `message`, `hashtags`, and `alt_text` (Social-SEO).
5. Validate against `contentPlan.validate(plan, { requirePublishable: true })` — halt on errors rather than emit an unpublishable calendar.
6. Write `content_plan.json` + `content_calendar.json`; best-effort persist to Supabase `content_plans`.

## Token Efficiency

- Pillars + calendar are template-filled from the profile, not blank-page generated.
- The calendar IS the handoff to `/publish` — no re-derivation downstream.

## Safety

- New calendar items are `status: pending` — nothing publishes until `/publish` runs.
- AI-assisted captions are the writer's; the skill never marks an item published.
