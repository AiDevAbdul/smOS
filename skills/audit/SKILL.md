---
name: audit
description: Use this skill when the user asks to audit a client's Meta presence or asks for a baseline of their organic + paid accounts (typically via `/audit {slug}`). Pulls a full snapshot and produces `audit_report.md` — the immutable 'before' state that all future before/after reports compare against.
---

# /audit — Account + Page Audit

## Required Context

Load only the client's profile and account IDs.

- `clients/{slug}/client_profile.json` — read this; do not load global state
- `clients/{slug}/CLAUDE.md` — read for KPI thresholds and naming conventions
- Meta MCP server — all live API calls
- Supabase connector — for `reports` and `baseline_snapshots` rows

## Workflow

Three audit passes, then synthesis, then baseline snapshot. Run the three passes in parallel where possible — they hit different parts of the API.

### Pass 1 — Organic Audit (Facebook Page)

Tools used:
- `get_page_completeness({page_id})` → completeness score + per-field check
- `get_page_insights({page_id, metrics: ["page_fans","page_fan_adds","page_fan_removes","page_impressions_unique","page_post_engagements","page_views_total"], period: "day", days: 90})` → 90-day trend
- `get_page_fans({page_id})` → follower demographics
- `get_post_insights({page_id, limit: 30})` → last 30 posts with per-post metrics
- `get_page_creatives({page_id, limit: 30})` → for format-mix detection (status_type / media_type)
- `get_page_videos({page_id, limit: 20})` → Reels + video performance

Derive:
- 90-day follower delta (fan_adds − fan_removes)
- Posts/week = post count / weeks_in_window
- Format mix %: count posts by `media_type` / `status_type` (photo, video, link, status, carousel)
- Avg engagement rate by format = (reactions + comments + shares) / impressions, grouped by media_type
- Best/worst post = top/bottom by engagement rate
- Posting time distribution: bucket post `created_time` into hour-of-day, day-of-week

### Pass 2 — Organic Audit (Instagram)

If `ig_account_id` is set in the profile:
- `get_instagram_insights({ig_user_id, metrics: ["reach","accounts_engaged","follower_count","profile_views","website_clicks"], period: "day", days: 28})`
- Pull recent IG media via direct Graph API call (`/{ig_user_id}/media`) for format mix — there's no dedicated MCP tool yet, so use the raw `mcp__claude_ai_*` path or call Graph directly through `meta-client.js`

Note: IG `impressions` metric is deprecated as of April 2025 — do NOT request it.

### Pass 3 — Paid Audit (Ad Account)

Tools used:
- `get_campaigns({ad_account_id, status: ["ACTIVE","PAUSED","ARCHIVED"]})` → full campaign history
- `get_campaign_insights({campaign_id, date_preset: "lifetime"})` → for top N campaigns
- `get_custom_audiences({ad_account_id})` → list + health
- `check_pixel_health({pixel_id})` → fire status + event-by-event
- `get_account_pixels({ad_account_id})` → confirm pixel is account-linked
- `get_attribution_stats({pixel_id})` → recent attribution

Derive:
- Total historical spend (sum of lifetime campaign spend)
- Best CPA / best ROAS across campaigns with sufficient spend (>$50)
- Audience inventory: count healthy vs broken (`operation_status` 200 = healthy, 433 = broken)
- Zombie campaigns: status=ACTIVE but no delivery in last 14d (zero impressions)
- Naming compliance: regex-match each campaign name against `^[A-Z]+_[A-Z0-9]+_\d{6}$`
- Frequency issues: any active adset with frequency > 4.0 in last 7d

### Pass 4 — Synthesis

Fill `templates/audit-report.md` with the data from passes 1–3. Compute:

- **Overall health score (0–100):** weighted average of:
  - Page completeness (15%)
  - Pixel health (20%): full=100, partial=60, none=0
  - Audience health % (15%): healthy_count / total_count × 100
  - Naming compliance % (10%)
  - Organic posting consistency (10%): score by posts/week vs target of 3
  - Engagement rate vs industry benchmark (15%)
  - Account financial health (15%): balance status, payment method valid

- **Top 3 wins:** what's working — strongest signal in the data
- **Top 3 issues:** highest-impact problems blocking results
- **Top 3 next steps:** concrete, ordered actions

### Pass 5 — Persistence

1. Save `clients/{slug}/audit_report.md` (the filled template)
2. Insert row in Supabase `reports` table: `client_id`, `type: 'audit'`, `report_url`, `created_at`, `summary_json`
3. Call `scripts/baseline-snapshot.js` to write the immutable baseline snapshot
4. Output a one-line summary to the user with the health score and link to the report

## Output

- `clients/{slug}/audit_report.md`
- Row in `reports` table
- Row in `baseline_snapshots` table
- (Optional) Upload report to client's Google Drive folder if connector is wired

## Error Handling

- If the ad account has no spend history → all paid metrics return zero; flag "first-time advertiser" and weight health score accordingly
- If Page Insights returns empty → likely a permissions issue; surface the fbtrace_id and instructions to grant Page roles to the System User
- If Instagram account isn't linked → skip Pass 2 silently, note in report

## Token Efficiency

- All API responses are saved to Supabase before this skill returns, so subsequent skills (`/audit-creative`, `/strategy-brief`) read from Supabase rather than re-hitting Meta
- The 30-post creative list from `get_page_creatives` is reused by `/audit-creative` — don't re-fetch
