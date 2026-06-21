---
name: launch
description: Use this skill when the user asks to launch a campaign, push a brief live, or build the campaign structure on Meta (typically via `/launch {slug}`). Builds the campaign/adset/ad tree from an approved strategy brief + ad copy + audience map — everything created PAUSED, requires explicit human confirmation before activation.
---

# /launch — Campaign Build & Push

## Required Context

- `clients/{slug}/client_profile.json` — for `accounts.ad_account_id`, `accounts.pixel_id`, `accounts.page_id`, `accounts.ig_account_id`, `audience.geo_targets`
- `clients/{slug}/strategy_brief.json` + approved row in Supabase `strategy_briefs`
- `clients/{slug}/ad_copy.json`
- `clients/{slug}/audience_map.json`
- `clients/{slug}/CLAUDE.md` — for KPI thresholds and daily caps
- Meta MCP server — `create_campaign`, `create_adset`, `create_ad_creative`, `upload_image`, `create_ad`, `update_ad_status`, `update_campaign`
- Supabase connector — `campaigns` row + `campaign_log`
- Discord connector — for the launch notification + activation confirmation

## Launch Sequence

### Step 1 — Validate

- Verify `strategy_briefs` row exists with `status: 'approved'`. Halt if not.
- Verify `ad_copy` row exists for the same `brief_id`. Halt if not.
- Verify required account IDs are present and non-null.

### Step 2 — Fill `templates/campaign.json`

For each phase in `strategy_brief.objective_hierarchy`, fill the template with:
- Campaign name following convention: `[OBJECTIVE_CODE]_[AUDIENCE_CODE]_[YYYYMM]`
- Daily budget from `strategy_brief.budget_allocation.adsets`
- Objective mapped from brief phase (CONV → `OUTCOME_SALES`, TRAFFIC → `OUTCOME_TRAFFIC`, LEADS → `OUTCOME_LEADS`, ENGAGE → `OUTCOME_ENGAGEMENT`, AWARE → `OUTCOME_AWARENESS`)
- `special_ad_categories: []` unless the profile says otherwise

For each adset, fill `templates/adset.json` with:
- Adset name following convention: `[PLACEMENT]_[AGE_RANGE]_[INTEREST_CODE]`
- Audience from `audience_map` (interest cluster IDs, behavior IDs, RT layer IDs, or LAL spec)
- Geo from `audience.geo_targets`
- Placements per `strategy_brief.creative_angles[i].format` (FEED for image/carousel, REELS+STORY for video, etc.)
- Optimization goal and billing event matching the campaign objective
- Attribution: 7-day click, 1-day view (global default)

### Step 3 — Pre-launch hooks (BLOCKING)

Each hook fires automatically per `plugin.json` matcher. The skill does NOT call hooks directly — it just calls the MCP create_* tools and the harness runs the hooks. If any hook exits non-zero, the create call is blocked.

Hooks that will run:
- `naming-check.js` on every create
- `budget-guard.js` on `create_campaign` / `update_campaign`
- `pixel-check.js` on conversion-objective `create_campaign`
- `creative-compliance.js` on `create_ad`
- `utm-enforcer.js` on `create_ad`

If a hook blocks, surface the stderr message verbatim to the user and halt — do not retry around it. The user fixes the underlying input.

### Step 4 — Create campaigns (PAUSED)

For each filled campaign template, call `create_campaign` with `status: "PAUSED"`. Collect campaign IDs. Do them sequentially — the hook chain runs per call.

### Step 5 — Create adsets (PAUSED)

For each adset under each campaign, call `create_adset` with `status: "PAUSED"` and the parent `campaign_id`. Collect adset IDs.

### Step 6 — Create ad creatives + ads (PAUSED)

For each angle in `ad_copy.angles`:
1. For each `top_pick` (and any explicitly flagged secondary variants), call `create_ad_creative` with the chosen primary text, headline, CTA, page_id, ig_account_id, and destination URL (with UTMs — `utm-enforcer` will fix if missing).
2. For each adset assigned to this angle, call `create_ad` with the creative ID, ad name following convention `[FORMAT]_[HOOK_CODE]_v[N]`, status `PAUSED`.

Asset handling: if the client has uploaded creative images locally, call `upload_image` first and use the returned hash on the creative. If only design-brief direction exists (no rendered images yet), halt before step 6 with a message: `N creative slots ready — supply rendered images at clients/{slug}/creatives/ then resume.`

### Step 7 — Human activation gate

After all entities are created PAUSED:

1. Build `clients/{slug}/campaign_log.json` with the full tree (campaign IDs, adset IDs, ad IDs, names, budgets, audiences) and `status: "paused"` at the root.
2. Post a Discord message to `approvals.channel`:
   > `Campaigns built for {name}. {N} campaigns · {M} adsets · {K} ads · total daily {currency}{X}. All PAUSED. Reply 'activate' to set everything to ACTIVE, or 'activate <campaign_name>' to roll out one at a time.`
3. Listen for the reply.
4. On `activate` → call `update_campaign({status:"ACTIVE"})` on each campaign, then `update_ad_status` on each ad. Log activations to Supabase `campaign_log`.
5. On `activate <name>` → activate only that subtree.
6. On `cancel` or 24h timeout → leave PAUSED, surface state to user, halt.

### Step 8 — Post-launch logging

The `post-launch.js` PostToolUse hook fires automatically after each `create_campaign` — it inserts into Supabase `campaigns` and sends a per-campaign Discord ping. The skill does not duplicate that work; it only writes the consolidated `campaign_log.json` and the final activation state.

## Output

- `clients/{slug}/campaign_log.json` (full tree + activation state)
- Rows in `campaigns` table (one per campaign, via post-launch hook)
- Discord notification(s) in client channel

## Error Handling

- Any hook block → halt, surface verbatim, do not retry
- Meta API 4xx on `create_*` → log full error (code, type, fbtrace_id) to `error_log`, halt; do not auto-rollback already-created entities — surface what was created and let the user decide
- Activation step times out → leave everything PAUSED; this is the safe default
- Image upload fails for one creative but not others → continue with the working ones, flag the failed slots in `campaign_log.json`

## Token Efficiency

- All structure decisions come from `strategy_brief.json` — never re-derive them
- Read `ad_copy.json` and `audience_map.json` once each
- Hooks run out-of-process; the skill does not invoke or wait on them explicitly
