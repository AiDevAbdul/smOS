# smOS — Social Media Operating System
### Full System Blueprint · Claude Code + Meta API

---

> **What this is:** smOS is an autonomous social media management operating system built as a Claude Code plugin. It handles every layer of social media work — from client onboarding and auditing, through strategy and creative, to campaign execution, daily optimization, and board-level reporting — with minimal human input required beyond decisions that genuinely need a human.
>
> **Who it is for:** Agencies managing multiple clients. In-house social teams. Freelance media buyers who want to operate at agency scale. Anyone who wants Claude Code to act as a senior social media manager that never sleeps.

---

## Table of Contents

1. [OS Philosophy](#01--os-philosophy)
2. [System Map](#02--system-map)
3. [Plugin Architecture](#03--plugin-architecture)
4. [CLAUDE.md — The System Constitution](#04--claudemd-the-system-constitution)
5. [Data Collector: /intake & /audit](#05--data-collector-intake--audit)
6. [Skills Library](#06--skills-library)
7. [Autonomous Agent Team](#07--autonomous-agent-team)
8. [Hooks: Guardrail System](#08--hooks-guardrail-system)
9. [Data Architecture](#09--data-architecture)
10. [MCP Server Stack](#10--mcp-server-stack)
11. [Reporting & Before/After System](#11--reporting--beforeafter-system)
12. [Build Roadmap](#12--build-roadmap)
13. [Token Cost Efficiency](#13--token-cost-efficiency)

---

## 01 — OS Philosophy

Most "automation" tools automate individual tasks. smOS is designed as an **operating system** — a coordinated environment where data flows automatically between layers, agents share context, decisions are logged, and the system improves over time from its own history.

### The Three Design Laws

**1. Collect once, reference forever.**
Client data is captured once at intake. Every downstream agent pulls from that store — nobody asks the same question twice.

**2. Templates over generation.**
Every repeatable output (campaign brief, audit report, weekly report, ad copy) is a structured template that Claude fills, not a blank page it writes from scratch. This cuts token cost by 60–80% on routine tasks.

**3. Store everything.**
Every action, decision, result, and error is logged to Supabase. The system gets smarter with every campaign because it always has history to reason from.

### What "Autonomous" Actually Means

smOS does not remove humans from the loop. It removes humans from the **routine**. Humans approve strategy, review creative direction, and make budget decisions. The OS handles execution, monitoring, optimization, and reporting automatically.

| Human decides | smOS executes |
|---|---|
| Campaign objective & budget | Campaign structure, adsets, targeting |
| Brand voice & offer | Copy variants, headlines, CTAs |
| KPI thresholds | Daily monitoring, pausing, scaling |
| Strategic direction | Weekly analysis & recommendations |
| Client relationship | Reports, audits, before/after data |

---

## 02 — System Map

smOS has six layers. Each layer feeds the next. Data flows down automatically; results and learnings flow back up.

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1 · INTAKE & AUDIT                                       │
│  /intake  /audit  /audit-creative  /baseline                    │
│  Entry point. Runs once per client. Establishes baseline.       │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2 · STRATEGY & RESEARCH                                  │
│  /research  /competitor-scan  /audience-map  /strategy-brief    │
│  Transforms data into actionable campaign strategy.             │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3 · CREATIVE PRODUCTION                                  │
│  /creative  /copy-variants  /creative-score  /brief-to-design   │
│  Generates all ad copy, hooks, CTAs, and creative briefs.       │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 4 · CAMPAIGN EXECUTION                                   │
│  /launch  /validate  /post-campaign  /structure-check           │
│  Builds and launches campaigns via Meta API with guardrails.    │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 5 · OPTIMIZATION ENGINE                                  │
│  optimizer-agent (daily)  budget-scaler  ad-pauser              │
│  Runs daily without human input. Scales winners, kills losers.  │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 6 · REPORTING & INSIGHT                                  │
│  /report  /monthly-review  /before-after  reporter-agent        │
│  Weekly reports, before/after comparisons, strategic reviews.   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 03 — Plugin Architecture

smOS ships as a single Claude Code plugin. One command installs everything.

```
/plugin install smOS
```

### Directory Structure

```
smOS/
├── plugin.json                   ← manifest, version, permissions
│
├── CLAUDE.md                     ← system constitution (read every session)
│
├── mcp/
│   ├── meta-server/              ← Meta Marketing + Graph API (custom build)
│   │   ├── index.js
│   │   └── tools/
│   │       ├── campaigns.js
│   │       ├── adsets.js
│   │       ├── ads.js
│   │       ├── insights.js
│   │       ├── audiences.js
│   │       ├── creative.js
│   │       ├── pixel.js
│   │       └── page-insights.js
│   └── connectors.json           ← wires Slack, Supabase, Drive, Notion
│
├── skills/
│   ├── intake.md
│   ├── audit.md
│   ├── audit-creative.md
│   ├── research.md
│   ├── strategy-brief.md
│   ├── creative.md
│   ├── launch.md
│   ├── analyze.md
│   ├── scale.md
│   ├── report.md
│   ├── before-after.md
│   └── monthly-review.md
│
├── agents/
│   ├── optimizer.md              ← daily automation agent
│   ├── reporter.md               ← weekly report agent
│   ├── researcher.md             ← on-demand research agent
│   ├── creative-agent.md         ← copy generation agent
│   └── auditor.md                ← monthly health audit agent
│
├── hooks/
│   ├── pre-launch.js             ← validates before any API write
│   ├── budget-guard.js           ← prevents overspend
│   ├── naming-check.js           ← enforces naming conventions
│   ├── utm-enforcer.js           ← ensures tracking params
│   ├── post-launch.js            ← Slack notification + DB log
│   └── creative-compliance.js    ← text % check, restricted words
│
├── templates/
│   ├── campaign.json             ← campaign creation template
│   ├── adset.json                ← adset template
│   ├── ad-copy.md                ← copy template with fill slots
│   ├── audit-report.md           ← audit report template
│   ├── weekly-report.md          ← weekly report template
│   ├── before-after.md           ← comparison report template
│   └── strategy-brief.md         ← strategy template
│
└── scripts/
    ├── baseline-snapshot.js      ← saves audit baseline to Supabase
    ├── before-after-compare.js   ← pulls and diffs against baseline
    ├── creative-scorer.js        ← scores copy variants
    └── scheduler.js              ← cron trigger config
```

---

## 04 — CLAUDE.md: The System Constitution

CLAUDE.md is read at the start of every Claude Code session. It is the brain of smOS — persistent awareness of account config, KPI thresholds, naming rules, guardrails, and workflow instructions without re-providing context each time.

**Two variants:**
- `smOS/CLAUDE.md` — global system rules, default thresholds, workflow logic
- `{client}/CLAUDE.md` — generated per client at `/intake`, contains all client-specific data

### Global CLAUDE.md Contents

| Section | Contents |
|---|---|
| System identity | Role definition, what smOS is, how to behave |
| Workflow routing | Which skill to use for which task type |
| Default KPI thresholds | Global fallback CPA, ROAS, CTR, frequency limits |
| Naming conventions | Regex patterns for campaigns, adsets, ads |
| Guardrail rules | What requires Slack approval, what auto-executes |
| Token rules | Context injection limits, when to load full vs partial profile |
| Meta API defaults | API version, default placements, bid strategies |
| Output formats | How reports are structured, what gets stored |

### Client CLAUDE.md — Generated at Intake

```markdown
# Client: [NAME]
# Generated: [DATE] by smOS /intake

## Account
- Ad Account ID: act_XXXXX
- Business Manager: XXXXX
- Pixel ID: XXXXX
- Facebook Page ID: XXXXX
- Instagram Account ID: XXXXX
- Currency: USD | Timezone: America/New_York

## Business Profile
- Product/Service: [compressed, max 2 lines]
- Price Point: $XX | Model: [subscription/one-time/lead-gen]
- USP: [1 sentence]
- Geographic target: [countries/regions]
- Best-performing angles: [list from audit or intake]

## Audience
- Primary: [age range], [gender], [interests summary]
- Secondary: [if applicable]
- Exclusions: [existing customers, competitors, etc.]
- Lookalikes: [seed audiences available]

## KPI Thresholds (override global defaults)
- Max CPA: $XX
- Min ROAS: X.Xx
- Pause ad if CTR < X% after $XX spend
- Scale budget 20% if ROAS > X.Xx for 3 consecutive days
- Frequency cap: X per X days
- Alert threshold: spend > $XXX/day requires Slack approval

## Brand Voice
- Tone: [2-3 adjectives]
- Avoid: [restricted words, competitor names, claims]
- CTA style: [soft/direct/urgency]
- Max primary text: 125 chars

## Campaign Naming
- Campaign:  [OBJECTIVE]_[AUDIENCE_CODE]_[YYYYMM]
- AdSet:     [PLACEMENT]_[AGE]_[INTEREST_CODE]
- Ad:        [FORMAT]_[HOOK_CODE]_[v1/v2/v3]

## Tracking
- UTM template: utm_source=facebook&utm_medium=paid&utm_campaign=[name]
- Conversion event: [Purchase/Lead/CompleteRegistration]
- Attribution: 7-day click, 1-day view

## History
- Audit date: [DATE]
- Baseline snapshot ID: [supabase_row_id]
- Previous best CPA: $XX ([campaign name])
- Previous best ROAS: X.Xx ([campaign name])
- Known failed approaches: [summary]
```

---

## 05 — Data Collector: /intake & /audit

The intake and audit are the most important skills in smOS. Every downstream operation depends on their output. They run **once per client**.

### /intake — Guided Onboarding

Runs a structured Q&A that collects all business and account information in logical groups. Saves output to three places: client `CLAUDE.md`, `client_profile.json` in Supabase, and Google Drive.

| Group | Questions asked | Output field |
|---|---|---|
| Business basics | What do you sell? Price? Model? USP? | product, price, model, usp |
| Target audience | Who buys it? Age, gender, location, pain points? | audience.* |
| Brand voice | Tone? What to avoid? Any restricted claims? | voice.* |
| Accounts & access | Ad account ID, pixel, page IDs, BM ID? | account.* |
| KPI targets | CPA goal? ROAS target? Budget range? | kpis.* |
| History | Run ads before? What worked? What failed? | history.* |
| Competitive context | Who are your top 3 competitors? | competitors[] |
| Assets | Any creative assets available? Brand guidelines? | assets.* |
| Approval preferences | What needs human sign-off vs auto-execute? | guardrails.* |

### /audit — Baseline Measurement

Pulls live data from Meta Graph API and Marketing API to establish the "before" snapshot.

#### Organic Audit — Data Points
- Page completeness score: bio, CTA button, contact info, cover image, profile image, category, pinned post
- Follower count + 90-day growth trend
- Post frequency (posts per week, last 60 days)
- Content format mix: video %, image %, carousel %, Reels %
- Average engagement rate per format type
- Best and worst performing posts (engagement + reach)
- Posting time distribution vs peak audience activity
- Response rate and average response time
- Caption analysis: average length, CTA presence, hashtag count

#### Paid Audit — Data Points
- Account age, spend history, payment method status
- Pixel installation and event firing status (PageView, AddToCart, Purchase, Lead)
- Custom audiences: sizes, freshness, overlap
- Lookalike audiences: seed quality, coverage
- Campaign history last 12 months: objectives used, total spend
- Best-performing campaigns: ROAS, CPA, CTR, top creative
- Worst-performing campaigns: failure reason analysis
- Account structure health: naming consistency, zombie campaigns, budget waste
- Frequency and fatigue patterns from historical data

### /audit-creative — Visual Quality Scoring

Pulls last 20–30 post images and ad creatives via API. Passes each to Claude vision for scoring:

| Dimension | What is checked | Score |
|---|---|---|
| Visual quality | Clarity, composition, production value | 1–10 |
| Brand consistency | Colors, fonts, logo usage match brand | 1–10 |
| CTA presence | Clear call to action visible in creative | Yes/No |
| Text compliance | Text overlay under 20% of image area | Pass/Fail |
| Messaging clarity | Value proposition legible at small size | 1–10 |

### Baseline Snapshot

After the audit completes, smOS saves a timestamped `baseline_snapshot` row to Supabase. This is the immutable "before" that all future reports compare against.

```json
{
  "client_id": "brandx",
  "snapshot_date": "2025-01-15",
  "followers_fb": 2400,
  "followers_ig": 1800,
  "avg_engagement_rate": 0.8,
  "posts_per_week": 1.2,
  "content_quality_score": 5.4,
  "page_completeness_score": 62,
  "pixel_health": "partial",
  "custom_audience_count": 2,
  "historical_best_cpa": null,
  "historical_best_roas": null,
  "total_historical_spend": 0,
  "audit_report_url": "drive://..."
}
```

---

## 06 — Skills Library

Each skill is a markdown file defining a deterministic workflow. Skills load only the context fields they need, fill pre-built templates, and produce structured JSON outputs.

### Token Efficiency Design
- Each skill declares required context fields in frontmatter — Claude loads only those fields, not the full client profile
- All output is template-fill, not free generation
- Expensive operations save results to Supabase so they are not re-run
- Skills chain via JSON handoff — each reads the previous skill's output file

---

### Research & Strategy Skills

#### `/research` — Competitor & Market Intelligence
> **Needs:** `client.competitors`, `client.product`, `client.audience`
> **Outputs:** `competitor_intel.json`

Pulls competitor ads from Meta Ad Library API. Analyzes creative formats, angles, offers, CTAs. Identifies gaps and opportunities. Saves to Supabase.

#### `/audience-map` — Audience Architecture
> **Needs:** `client.audience`, `client.account.pixel_id`, `client.account.ad_account_id`
> **Outputs:** `audience_map.json`

Builds structured audience targeting plan using Meta audience insights. Creates interest clusters, behavior segments, and lookalike strategy.

#### `/strategy-brief` — Campaign Strategy
> **Needs:** `client.*`, `audit_summary`, `competitor_intel`, `audience_map`
> **Outputs:** `strategy_brief.json` + `strategy_brief.md` (requires human approval)

Synthesizes intake + audit + research into a structured campaign strategy. Defines objective hierarchy, budget allocation, creative direction, and success metrics.

---

### Creative Skills

#### `/creative` — Full Creative Package
> **Needs:** `client.voice`, `client.audience`, `brief.offer`, `brief.angles`
> **Outputs:** `ad_copy.json`

Generates complete creative package from strategy brief. Produces 3 copy variants per ad angle, scored and ranked.

#### `/copy-variants` — A/B Copy Testing Set
> **Needs:** `client.voice`, `brief.single_angle`
> **Outputs:** `copy_variants.json`

Generates 3 headline variants, 3 primary text variants, and 3 CTA variants for a given angle. Scores each against engagement prediction heuristics.

---

### Campaign Execution Skills

#### `/launch` — Campaign Builder & Publisher
> **Needs:** `client.account`, `client.kpis`, `strategy_brief`, `ad_copy`, `audience_map`
> **Outputs:** `campaign_log.json` + Slack notification

Reads all strategy files, fills campaign template, fires pre-launch hooks, posts to Meta API, logs to Supabase, notifies Slack.

#### `/analyze` — Performance Deep Dive
> **Needs:** `client.account`, `client.kpis`
> **Outputs:** `performance_analysis.json`

Pulls last 7/14/30 days data from Meta API. Segments by campaign, adset, ad, placement, age, gender, device. Flags underperformers, identifies winners.

#### `/scale` — Scaling Execution
> **Needs:** `client.kpis`, `performance_analysis`
> **Outputs:** `scaling_log.json` + Slack notification

Reads performance analysis. Applies scaling rules from client CLAUDE.md. Executes budget increases on winners, pauses losers, duplicates best-performing adsets.

---

### Reporting Skills

#### `/report` — Weekly Client Report
> **Needs:** `client.*`, `baseline_snapshot`, `performance_analysis`
> **Outputs:** `weekly_report.pdf` + Slack + email

Generates structured weekly report. Pulls current metrics + historical from Supabase. Fills template, exports PDF, distributes automatically.

#### `/before-after` — Before/After Comparison
> **Needs:** `client.*`, `baseline_snapshot`
> **Outputs:** `before_after_report.pdf`

Compares current metrics against the immutable baseline from `/audit`. Generates a delta table showing percentage change across all KPIs.

#### `/monthly-review` — Strategic Monthly Review
> **Needs:** `client.*`, `baseline_snapshot`, all monthly performance data
> **Outputs:** `monthly_review.pdf` + `strategy_recommendations.json`

Deeper than weekly report. Reviews full month trends, audience fatigue, creative lifecycle, and strategic recommendations for the month ahead.

---

## 07 — Autonomous Agent Team

Five specialized subagents. Some scheduled, some on-demand, some event-triggered. Each is a self-contained markdown file.

---

### OPTIMIZER AGENT
**Schedule: Daily 8:00 AM**

The core automation loop. Every morning, pulls previous 24h metrics for all active campaigns, compares against KPI thresholds, and executes decisions without human input — unless a decision exceeds the approval threshold.

**Decision logic:**
1. Pull last 24h metrics for all active clients
2. For each ad: compare CPA, CTR, ROAS, frequency against thresholds
3. Auto-pause: any ad with CPA > max after minimum spend reached
4. Auto-pause: any ad with frequency > cap for the window
5. Auto-scale: any adset with ROAS > min for 3 consecutive days → +20% budget
6. Flag for human review: any anomalies (spend spike, CTR collapse, delivery issue)
7. Log all decisions with reasoning to Supabase `optimizer_log` table
8. Send daily digest to Slack: actions taken, flags raised, top performers

---

### REPORTER AGENT
**Schedule: Monday 9:00 AM**

Generates and distributes weekly client reports automatically. No human trigger required.

**Steps:**
1. Pull 7-day metrics from Meta API for all active clients
2. Pull historical comparison data from Supabase
3. Fill `weekly_report.md` template with real data
4. Generate formatted PDF
5. Upload to client Drive folder
6. Send to Slack client channel with summary stats
7. Send via email to client contact from client profile
8. Update Supabase `reports` table with metadata

---

### RESEARCHER AGENT
**Trigger: On-demand via /research**

Deep competitive and market intelligence. Runs when a new client onboards or when a strategy refresh is needed.

**Steps:**
1. Pull all active competitor ads from Meta Ad Library API
2. Analyze by: creative format, copy angle, offer type, CTA, visual style
3. Identify: gaps in competitor messaging, underused angles, seasonal patterns
4. Pull Google Trends data for product category keywords
5. Generate competitive intelligence report
6. Save structured `competitor_intel.json` to Supabase
7. Flag top 3 creative opportunities for strategy brief

---

### CREATIVE AGENT
**Trigger: On-demand or pre-launch**

Generates all ad copy and creative briefs. Produces multiple variants, scores them, and ranks them before they go to `/launch`.

**Steps:**
1. Load client voice, audience, and strategy brief from context
2. Generate 5 hook options for each campaign angle
3. For each hook: write 3 primary text variants + 3 headline variants
4. Score each variant: clarity, specificity, emotional trigger, CTA strength
5. Rank all variants and flag top pick per angle
6. Generate creative brief for design team (size specs, copy placement, visual direction)
7. Check all copy against restricted words list from client profile
8. Save ranked `ad_copy.json` to Supabase

---

### AUDITOR AGENT
**Schedule: Monthly + on-demand**

Monthly account health check. Broader than the optimizer — structural issues, fatigue trends, creative lifecycle, pixel health drift.

**Steps:**
1. Pull full account structure and flag naming convention drift
2. Analyze audience overlap across active adsets
3. Detect creative fatigue: engagement decline curves per creative
4. Check pixel event firing completeness
5. Review budget allocation efficiency across objectives
6. Identify and flag zombie campaigns (active but no spend/delivery)
7. Generate `monthly_health_report.json`
8. Feed recommendations into next strategy brief

---

## 08 — Hooks: Guardrail System

Hooks fire automatically at lifecycle events — before and after Meta API calls — to enforce rules and prevent costly mistakes.

### PreToolUse Hooks (fire before API writes)

#### `budget-guard` → PreToolUse: meta_create_campaign, meta_update_budget
Checks proposed budget against daily cap in client CLAUDE.md. If > 2x current budget OR > absolute cap, blocks the action and sends Slack approval request. Does not proceed until approval received.

#### `utm-enforcer` → PreToolUse: meta_create_ad
Validates all destination URLs contain required UTM parameters. If missing or malformed, injects the correct UTM template from client profile and logs the correction.

#### `naming-check` → PreToolUse: meta_create_campaign, meta_create_adset, meta_create_ad
Validates the proposed name matches the naming convention regex from client CLAUDE.md. Blocks and corrects if non-compliant.

#### `creative-compliance` → PreToolUse: meta_create_ad
Checks ad copy against restricted words list. Validates primary text character count. Flags potential Meta policy violations. Blocks if violations found.

#### `pixel-check` → PreToolUse: meta_create_campaign
Before launching a conversion campaign, verifies the pixel is installed and the target conversion event fired in the last 7 days. Blocks conversion objective campaigns if pixel is not firing.

---

### PostToolUse Hooks (fire after API writes)

#### `post-launch-log` → PostToolUse: meta_create_campaign
Logs all campaign details to Supabase `campaigns` table: campaign ID, structure, budget, targeting, creative IDs, launch timestamp, and strategy brief reference.

#### `slack-notify` → PostToolUse: meta_create_campaign, meta_pause_ad, meta_update_budget
Sends formatted Slack notification to client channel. Launch notifications include: campaign name, budget, objective, audience summary. Optimization actions include: reason + before/after metrics.

#### `performance-snapshot` → PostToolUse: meta_pause_ad
Before pausing any ad, captures a final performance snapshot to Supabase: total spend, impressions, clicks, conversions, final CPA/ROAS, and the threshold rule that triggered the pause.

---

## 09 — Data Architecture

smOS stores everything in Supabase. Schema designed for three needs: context injection, historical analysis, and before/after comparison.

### clients
```sql
clients {
  id:           uuid PRIMARY KEY
  slug:         text              -- e.g. "brandx"
  name:         text
  created_at:   timestamp
  profile:      jsonb             -- full client profile from /intake
  kpis:         jsonb             -- KPI thresholds
  account_ids:  jsonb             -- ad account, pixel, page, BM IDs
  voice:        jsonb             -- brand voice config
  status:       enum (active/paused/offboarded)
}
```

### baseline_snapshots
```sql
baseline_snapshots {
  id:                       uuid PRIMARY KEY
  client_id:                uuid REFERENCES clients
  snapshot_date:            date
  -- Organic
  followers_fb:             int
  followers_ig:             int
  avg_engagement_rate:      decimal
  posts_per_week:           decimal
  content_quality_score:    decimal
  page_completeness_score:  int
  -- Paid
  pixel_health:             enum (none/partial/full)
  custom_audience_count:    int
  total_historical_spend:   decimal
  historical_best_cpa:      decimal
  historical_best_roas:     decimal
  audit_report_url:         text
  raw_data:                 jsonb   -- full audit payload
}
```

### campaigns
```sql
campaigns {
  id:                 uuid PRIMARY KEY
  client_id:          uuid REFERENCES clients
  meta_campaign_id:   text
  name:               text
  objective:          text
  budget_daily:       decimal
  status:             text
  launched_at:        timestamp
  launched_by:        text        -- skill or agent name
  strategy_brief_id:  uuid
  structure:          jsonb       -- full adset/ad tree
}
```

### daily_metrics
```sql
daily_metrics {
  id:               uuid PRIMARY KEY
  client_id:        uuid REFERENCES clients
  campaign_id:      text
  adset_id:         text
  ad_id:            text
  date:             date
  spend:            decimal
  impressions:      int
  clicks:           int
  ctr:              decimal
  cpc:              decimal
  conversions:      int
  cpa:              decimal
  roas:             decimal
  frequency:        decimal
  reach:            int
  optimizer_action: text   -- null / scaled / paused / flagged
  optimizer_reason: text
}
```

### optimizer_log
```sql
optimizer_log {
  id:             uuid PRIMARY KEY
  client_id:      uuid REFERENCES clients
  run_date:       date
  actions_taken:  jsonb   -- [{type, entity_id, reason, before, after}]
  flags_raised:   jsonb   -- items needing human review
  digest_sent:    boolean
  digest_url:     text
}
```

### reports
```sql
reports {
  id:            uuid PRIMARY KEY
  client_id:     uuid REFERENCES clients
  report_type:   enum (weekly/monthly/before_after/audit)
  period_start:  date
  period_end:    date
  generated_at:  timestamp
  generated_by:  text      -- agent or skill name
  report_url:    text      -- Drive URL
  slack_sent:    boolean
  email_sent:    boolean
  key_metrics:   jsonb     -- summary KPIs for quick lookup
}
```

---

## 10 — MCP Server Stack

smOS connects to eight MCP servers. The Meta MCP server is built custom. The others are existing connectors.

| Server | Role | Key tools |
|---|---|---|
| **Meta MCP** (custom) | Core — all Meta API operations | campaigns, adsets, ads, insights, audiences, pixel, page insights, Ad Library |
| **Supabase** | Data persistence layer | Query/insert all smOS tables |
| **Slack** | Notifications & approvals | Digests, approval decisions, reports |
| **Google Drive** | Report storage & assets | Store PDFs, read creative assets |
| **Gmail** | Report distribution | Weekly/monthly reports to clients |
| **Notion** | Strategy documentation | Strategy briefs, campaign plans, client wikis |
| **Google Calendar** | Scheduling | Campaign dates, report schedules, review dates |
| **Browserbase/Playwright** | Web research | Competitor landing pages, Ad Library UI |

### Meta MCP Server — Tool Inventory

**Campaign Management**
- `get_campaigns` — list with filters (status, objective, date)
- `create_campaign` — full campaign creation from template
- `update_campaign` — status, budget, name, bid strategy
- `get_campaign_insights` — metrics with breakdown options

**AdSet Management**
- `create_adset` — targeting, budget, schedule, placements
- `update_adset` — status, budget, targeting
- `get_adset_insights` — adset-level metrics + breakdowns
- `get_audience_size` — estimated reach for targeting spec

**Ad & Creative Management**
- `create_ad` — ad with creative, call to action, URL
- `update_ad_status` — pause, archive, activate
- `get_ad_insights` — ad-level metrics, creative performance
- `upload_image` — upload creative to ad account image library
- `create_ad_creative` — assemble creative object from components

**Audience Management**
- `get_custom_audiences` — list, sizes, freshness
- `create_lookalike` — from seed audience + country + size
- `get_saved_audiences` — interest-based audiences in account
- `estimate_audience_overlap` — check for overlap between adsets

**Pixel & Tracking**
- `get_pixel_events` — recent event firing status
- `check_pixel_health` — completeness score for conversion tracking
- `get_attribution_stats` — view vs click attribution breakdown

**Page & Organic Insights**
- `get_page_insights` — reach, engagement, follower growth
- `get_post_insights` — per-post performance metrics
- `get_page_fans` — follower demographics
- `get_instagram_insights` — IG account and post metrics

**Research**
- `search_ad_library` — competitor ads by page, keyword, date range
- `get_ad_library_detail` — creative details for specific competitor ads

---

## 11 — Reporting & Before/After System

### Before/After Report — The Signature Deliverable

Generated by `/before-after`. Compares current performance against the immutable baseline. The primary client retention and upsell tool.

| Metric | Baseline (Audit Date) | Current | Change |
|---|---|---|---|
| Facebook followers | 2,400 | 3,100 | +29% ↑ |
| Instagram followers | 1,800 | 2,450 | +36% ↑ |
| Avg engagement rate | 0.8% | 2.1% | +162% ↑ |
| Posts per week | 1.2 | 4.0 | +233% ↑ |
| Content quality score | 5.4 / 10 | 7.8 / 10 | +44% ↑ |
| Page completeness | 62% | 100% | +38pts ↑ |
| Monthly ad spend | $0 | $3,200 | New ↑ |
| Cost per lead | — | $11.40 | New ↑ |
| ROAS | — | 4.2x | New ↑ |
| Pixel events/mo | 0 | 1,240 | New ↑ |

### Weekly Report Structure
- Executive summary: 3 key numbers, 1 win, 1 flag
- Spend & delivery overview: budget paced, impressions, reach
- Performance KPIs: CPA vs target, ROAS vs target, CTR by placement
- Top performer this week: best ad with stats
- Optimizer actions taken: what was paused/scaled and why
- Recommendations for next week: 2–3 specific actions
- Running before/after delta against baseline

### Monthly Strategic Review
- Full month performance trend (from Supabase history)
- Audience fatigue analysis: frequency curves, engagement decay
- Creative lifecycle: which creatives peaked and need refreshing
- Audience performance ranking: which segments performing best
- Budget efficiency analysis: CPM by placement, audience, creative type
- Competitive landscape update: new competitor ads from Ad Library
- Strategic recommendations for month ahead
- Updated before/after comparison since audit date

---

## 12 — Build Roadmap

Build smOS in six phases. Each phase delivers usable value before the next begins.

---

### Phase 1 — Foundation `2–3 days`

- Meta MCP server: implement core tools (campaigns, adsets, ads, insights)
- Supabase schema: create all tables, indexes, RLS policies
- Global CLAUDE.md: system constitution, defaults, workflow routing
- Connect existing MCPs: Slack, Supabase, Google Drive, Gmail
- **Test:** manually call Meta API tools via Claude Code, verify data flow

---

### Phase 2 — Intake & Audit `2–3 days`

- `/intake` skill: guided Q&A, output to `client_profile.json` + CLAUDE.md
- Meta MCP: add page insights, post insights, Instagram insights tools
- `/audit` skill: organic page audit + paid account audit
- `/audit-creative` skill: vision scoring for creative quality
- `baseline-snapshot.js`: saves immutable baseline to Supabase
- **Test:** full intake → audit → baseline save for a real client

---

### Phase 3 — Research & Strategy `2 days`

- Meta MCP: add Ad Library search tools
- `/research` skill: competitor ad scraping + analysis
- `/audience-map` skill: audience architecture from Meta insights
- `/strategy-brief` skill: synthesize into campaign strategy
- Approval workflow: Slack message with approve/reject for strategy
- **Test:** research → audience map → strategy brief for a campaign

---

### Phase 4 — Creative & Launch `2–3 days`

- `/creative` skill + creative agent: copy generation + scoring
- `/launch` skill: campaign builder with template fill
- All PreToolUse hooks: budget guard, UTM enforcer, naming check, creative compliance, pixel check
- All PostToolUse hooks: launch log, Slack notify, performance snapshot
- **Test:** strategy brief → creative → launch with all hooks firing

---

### Phase 5 — Optimization Loop `2–3 days`

- `/analyze` skill: performance deep dive with breakdowns
- `/scale` skill: scaling execution from analysis
- Optimizer agent: daily cron with full decision logic
- Scheduler config: cron setup in Claude Code
- Optimizer digest: Slack format for daily summary
- **Test:** run optimizer agent manually, verify decisions against thresholds

---

### Phase 6 — Reporting & Polish `2–3 days`

- `/report` skill: weekly report generation + PDF export
- `/before-after` skill: baseline comparison report
- `/monthly-review` skill: strategic review + trend analysis
- Reporter agent: Monday morning scheduled send
- `/plugin install`: package everything as installable smOS plugin
- **Test:** full cycle — intake → audit → launch → optimize → weekly report → before/after

> **Total estimated build time:** 12–17 days working solo with Claude Code. The Meta MCP server is the longest single piece. Every other phase builds on a working foundation.

---

## 13 — Token Cost Efficiency

smOS is designed to be economical. The intake-once, template-fill architecture means most operations cost a fraction of what free-generation approaches cost.

| Operation | Naive approach | smOS approach | Saving |
|---|---|---|---|
| /launch a campaign | 15,000–20,000 tokens | 2,500–4,000 tokens | ~80% |
| Daily optimizer run (per client) | 8,000–12,000 tokens | 1,500–2,500 tokens | ~80% |
| /report weekly | 10,000–15,000 tokens | 2,000–3,500 tokens | ~78% |
| /creative (3 ad angles) | 8,000–12,000 tokens | 2,000–3,000 tokens | ~75% |
| /research competitor scan | 12,000–18,000 tokens | 4,000–6,000 tokens | ~67% |

### How the savings are achieved

- **Context injection:** skills declare required fields — Claude loads only those, not the full client profile on every call
- **Template fill vs generation:** structured JSON templates replace blank-page writing for all campaign structures
- **Cached research:** competitor intel and audience data stored in Supabase, not re-fetched or re-analyzed each session
- **Batched operations:** optimizer agent processes all clients in one session, not separate calls
- **Structured outputs:** skills produce JSON, not prose — downstream agents parse data, not interpret summaries

---

*smOS Blueprint · Claude Code + Meta API*