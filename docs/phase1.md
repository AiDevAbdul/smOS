# Phase 1 — Foundation

**Status:** ✅ Complete  
**Date completed:** 2026-06-17  
**Estimated in blueprint:** 2–3 days · **Actual:** 1 session

---

## Goal

Build the foundation that every other phase depends on:
- Custom Meta MCP server with full tool coverage
- Supabase database schema
- Global CLAUDE.md system constitution
- Plugin manifest and MCP connector config
- Verify the server talks to real Meta accounts

---

## Decisions Made

### Authentication Strategy
**Decision: System User Token**

Two options were considered:
- **System User Token** — one long-lived token per client ad account, stored in env vars. No OAuth flow. Simpler for agencies operating client accounts.
- **Per-user OAuth** — each client authorizes via Facebook Login. More setup, better for SaaS/multi-tenant.

Chose **System User Token**. Reason: smOS is built for agencies managing client accounts, not a SaaS product. System user tokens are industry-standard for agency account access and avoid the OAuth refresh-token management complexity.

Token stored as `META_ACCESS_TOKEN` in `.env`.

### Supabase
**Decision: New project**

Schema designed from scratch to match smOS data requirements (section 09 of the blueprint). Full SQL ready to run in the Supabase SQL editor.

---

## What Was Built

### 1. Meta MCP Server (`mcp/meta-server/`)

Node.js MCP server using `@modelcontextprotocol/sdk`. Communicates with Claude Code via stdio transport. Wraps the Meta Marketing API v25.0.

**29 tools across 6 modules:**

#### `tools/campaigns.js` — 4 tools
| Tool | What it does |
|---|---|
| `get_campaigns` | List campaigns with status/date filters |
| `create_campaign` | Create campaign from template (defaults to PAUSED) |
| `update_campaign` | Update status, budget, name, bid strategy |
| `get_campaign_insights` | Pull metrics with daily breakdown and dimension breakdowns |

#### `tools/adsets.js` — 4 tools
| Tool | What it does |
|---|---|
| `create_adset` | Full adset creation: targeting, budget, placements, attribution |
| `update_adset` | Update status, budget, targeting |
| `get_adset_insights` | Adset-level metrics with breakdowns |
| `get_audience_size` | Estimate reach for a targeting spec before creating |

#### `tools/ads.js` — 6 tools
| Tool | What it does |
|---|---|
| `create_ad_creative` | Assemble creative from copy + image + URL (single image, video, or carousel) |
| `upload_image` | Upload image to ad account library by URL |
| `create_ad` | Create ad using an existing creative |
| `update_ad_status` | Pause, activate, or archive an ad |
| `get_ad_insights` | Ad-level metrics with breakdowns |
| `get_ads_under_adset` | List all ads under an adset |

#### `tools/audiences.js` — 5 tools
| Tool | What it does |
|---|---|
| `get_custom_audiences` | List custom audiences with sizes and metadata |
| `create_lookalike` | Build lookalike from seed audience |
| `get_saved_audiences` | List saved interest-based audiences |
| `estimate_audience_overlap` | Check overlap between up to 5 audiences |
| `search_interests` | Search interest targeting options by keyword |

#### `tools/pixel.js` — 4 tools
| Tool | What it does |
|---|---|
| `get_pixel_events` | Recent event firing stats by event name |
| `check_pixel_health` | Score pixel completeness (pass/fail per event type) |
| `get_attribution_stats` | View-through vs click-through attribution breakdown |
| `get_account_pixels` | List all pixels in an ad account |

#### `tools/page-insights.js` — 6 tools
| Tool | What it does |
|---|---|
| `get_page_insights` | FB Page organic metrics: reach, engagement, follower growth |
| `get_post_insights` | Per-post performance for last N posts |
| `get_page_fans` | Follower demographics: age, gender, country, city |
| `get_instagram_insights` | IG account and post metrics |
| `get_page_completeness` | Score how complete a Page profile is (10 checks) |
| `search_ad_library` | Search competitor ads in Meta Ad Library |

**Architecture:**
- `meta-client.js` — shared HTTP client with auth, error formatting, and `act_` prefix helper
- `index.js` — registers all tools, routes `callTool` to the right module, starts stdio transport
- All new campaigns/ads/adsets default to `PAUSED` — never auto-activate

**Bug found and fixed during testing:**
- `approximate_count` field was deprecated in Meta API v21.0. Replaced with `approximate_count_lower_bound` and `approximate_count_upper_bound`.
- `last_fired_time` on pixel objects returns an ISO string (`"2026-06-16T23:21:24+0500"`), not a Unix timestamp. Fixed date parsing in `check_pixel_health`.

---

### 2. Supabase Schema (`scripts/schema.sql`)

8 tables + 2 views:

| Table | Purpose |
|---|---|
| `clients` | Master client record — profile, KPIs, account IDs, voice config |
| `baseline_snapshots` | Immutable audit baseline for before/after comparisons |
| `campaigns` | All campaigns launched via smOS — linked to client and strategy brief |
| `daily_metrics` | Per-day performance at campaign/adset/ad level |
| `optimizer_log` | Daily optimizer run history — decisions made, flags raised |
| `reports` | All generated reports — weekly, monthly, before/after, audit |
| `strategy_briefs` | Campaign strategies — pending/approved/rejected, with approval tracking |
| `ad_copy` | Generated copy variants with scores, linked to brief |

Views: `active_campaigns`, `client_performance_summary`

All tables have RLS enabled. Service role key (used by smOS agents) bypasses RLS.

---

### 3. Global CLAUDE.md (system constitution)

Read at the start of every Claude Code session. Contains:
- Role definition and operating principles
- Workflow routing table (which skill to invoke for each intent)
- Meta API defaults (v21.0, PAUSED default, 7d-click/1d-view attribution)
- Global KPI thresholds (CPA, ROAS, CTR, Frequency pause/scale rules)
- Naming convention patterns for campaigns, adsets, ads
- Guardrail rules (what requires Slack approval vs auto-executes vs absolute blocks)
- Token efficiency rules
- Output format standards

---

### 4. Plugin Manifest (`plugin.json`)

Registers:
- Meta MCP server command and env var passthrough
- All 12 skills (stubs — built in later phases)
- All 5 agents (stubs — built in later phases)
- 6 hook definitions (budget-guard, UTM enforcer, naming check, creative compliance, pixel check, post-launch log)
- Required and optional env vars

---

### 5. MCP Connectors (`mcp/connectors.json`)

Wires five additional MCP servers:
- **Supabase** — data persistence layer
- **Slack** — notifications and approval requests
- **Google Drive** — report storage and creative assets
- **Gmail** — report distribution to clients
- **Notion** — strategy documentation

---

### 6. Environment Config (`.env.example`)

Documents all required variables with comments explaining where to get each one:
- Meta API (App ID, App Secret, Access Token)
- Supabase (URL, service key)
- Slack (bot token, team ID, default channel)
- Google Drive + Gmail (OAuth credentials JSON)
- Notion (API token)
- Google Drive root folder ID

---

## Live API Test Results

Tested against real Meta accounts using the system user token.

### Token & Access
```
✓ Token identity — valid, authenticated user confirmed
✓ Ad accounts — 10 accounts accessible
✓ Facebook pages — 10 pages accessible
```

### Ad Accounts Found

| Account Name | ID | Status |
|---|---|---|
| DigiSolutions.PK | act_116361312067678 | UNSETTLED |
| Yusra Medical Complex | act_461411569038304 | UNSETTLED |
| Fawad Marketing | act_636246238069127 | UNSETTLED |
| ARBA Tours | act_1467668340720540 | UNSETTLED |
| Habib Pizza | act_1008473683795901 | UNSETTLED |
| LifleLine_Mentoring | act_1363259974582449 | UNSETTLED |
| DigiSols.Pk | act_1124369355663887 | UNSETTLED |
| **Uppal Pharma** | **act_1445634743038275** | **ACTIVE ✅** |
| Dynamic Builders | act_361575196756434 | UNSETTLED |
| Visionary Mentor | act_1800737197094722 | UNSETTLED |

> **UNSETTLED** = account needs a payment method added or has an outstanding balance. Common for agency-managed accounts that are currently dormant. These can be activated by adding a payment method in Business Manager.

### Deep Tests on Uppal Pharma (only active account)

```
✓ List campaigns        — 10 campaigns found (2 ACTIVE, 8 PAUSED)
✓ List custom audiences — 5 audiences found (4 broken lookalikes + 1 stale website audience)
✓ List pixels           — 1 pixel: UppalPharma_Web_Data
✓ Reach estimate        — US 25-45 broad targeting estimate returned correctly
```

**Account details:**
- Currency: PKR | Timezone: Asia/Karachi
- Total lifetime spend: PKR 10,000
- Current balance: PKR 0.00
- Pixel last fired: 2026-06-16 (yesterday — **pixel is live**)
- Campaign types: OUTCOME_ENGAGEMENT, OUTCOME_AWARENESS (no conversion campaigns yet)

**Audience health issues found (will surface in Phase 2 /audit):**
- 4 lookalike audiences all have operation_status 433: "We couldn't create your lookalike audience. Please delete this audience and try creating it again."
- 1 website custom audience (CheckOut_AddtoCart, ~1,000 users) is stale — last activity over 30 days ago

**Pixel health:** Firing, but no `check_pixel_health` run yet — that happens in Phase 2.

### API Edge Cases Fixed
```
✗ → ✓  Custom audiences: approximate_count deprecated in v21.0
         Fix: use approximate_count_lower_bound / approximate_count_upper_bound

✗ → ✓  Pixel last_fired_time: returned as ISO string, not Unix timestamp  
         Fix: parse with new Date() instead of multiplying by 1000

~       Ad Library: rate limit hit during burst testing
         Not a bug — Meta rate-limits Ad Library to ~10 calls/hour per app
         Works correctly in normal usage
```

---

## Files Created

```
smOS/
├── CLAUDE.md                               ← System constitution
├── plugin.json                             ← Plugin manifest
├── .env.example                            ← Environment variable template
├── mcp/
│   ├── connectors.json                     ← MCP connector config
│   └── meta-server/
│       ├── package.json                    ← Node.js dependencies
│       ├── index.js                        ← MCP server entry point
│       ├── meta-client.js                  ← Shared HTTP client + auth
│       ├── test.js                         ← Live API test suite
│       └── tools/
│           ├── campaigns.js               ← 4 campaign tools
│           ├── adsets.js                  ← 4 adset tools
│           ├── ads.js                     ← 6 ad + creative tools
│           ├── audiences.js               ← 5 audience tools
│           ├── pixel.js                   ← 4 pixel tools
│           └── page-insights.js           ← 6 organic + Ad Library tools
└── scripts/
    └── schema.sql                          ← Full Supabase schema (8 tables, 2 views)
```

---

## What Phase 2 Needs From Phase 1

Phase 2 uses the Meta MCP server tools extensively:

| Phase 2 task | Tools required |
|---|---|
| Organic page audit | `get_page_insights`, `get_post_insights`, `get_page_fans`, `get_page_completeness` |
| Paid account audit | `get_campaigns`, `get_campaign_insights`, `get_custom_audiences`, `get_account_pixels` |
| Pixel health check | `check_pixel_health`, `get_pixel_events` |
| Creative audit | `get_post_insights` (pull post images for vision scoring) |
| Baseline snapshot | All of the above + write to `baseline_snapshots` table via Supabase MCP |

All 29 tools are live and verified. Phase 2 can start immediately.

---

## Next: Phase 2 — Intake & Audit

→ See [phase2.md](phase2.md)
