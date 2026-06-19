# smOS — Usage Guide

How to drive smOS day-to-day. Read [README.md](README.md) for what it is; read this when you want to *use* it.

---

## 1. One-time setup

### Prerequisites

- macOS / Linux with Python 3.10+ and Node 18+
- Claude Code installed (`claude` CLI on `$PATH`)
- A Meta Business Manager with at least one ad account you control
- A Supabase project (free tier is fine)
- A Slack workspace where you can install a bot

### Install steps

```bash
# 1. Clone or open the smOS folder in Claude Code
cd /path/to/smOS
claude .

# 2. Copy the env template and fill it in
cp .env.example .env
# Edit .env — see "Environment variables" below

# 3. Initialize the Supabase schema
psql "$SUPABASE_URL" -f scripts/schema.sql
# Or paste scripts/schema.sql into the Supabase SQL editor

# 4. Install Python deps for the Meta Ad Library engine
pip install requests

# 5. Install MCP server deps
cd mcp/meta-server && npm install && cd ../..
```

### Environment variables

Required (smOS won't run without these):

| Var | Where to get it |
|---|---|
| `META_ACCESS_TOKEN` | Meta Business → System Users → Generate Token, scopes: `ads_management`, `ads_read`, `business_management`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_manage_insights` |
| `META_APP_ID` | developers.facebook.com → your App → App ID |
| `META_APP_SECRET` | same App → Settings → Basic |
| `SUPABASE_URL` | Supabase project → Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase project → Settings → API → service_role key (NOT anon) |
| `SLACK_BOT_TOKEN` | api.slack.com → your App → OAuth → Bot User Token (xoxb-…) |
| `SLACK_DEFAULT_CHANNEL` | Channel ID where approvals/digests land (e.g. `C012345ABCD`) |

Optional but recommended:

| Var | What unlocks |
|---|---|
| `ANTHROPIC_API_KEY` | LLM angle classifier in `/research` and `/pre-audit` (without it, falls back to regex hooks) |
| `GOOGLE_DRIVE_FOLDER_ID` | Auto-upload weekly reports |
| `GMAIL_FROM_ADDRESS` | Auto-email reports |
| `NOTION_TOKEN` | Mirror reports into Notion |

### Sanity check

```bash
# Should print your ad account name + ID
node mcp/meta-server/index.js --self-test

# Should print {"ok":true} and a row count
node -e "console.log(require('@supabase/supabase-js').createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY).from('clients').select('count'))"
```

---

## 2. The mental model

smOS is **skill-driven**. Each slash command in Claude Code maps to one skill in `skills/`. You don't write code — you talk to Claude, and Claude runs the skill that matches your intent.

There are three lifecycles:

1. **Pre-sale** — `/pre-audit` (no client API access required, public data only)
2. **Onboarding** — `/intake` → `/audit` → `/research` → `/audience-map` → `/strategy-brief`
3. **Operating** — `/creative` → `/launch` → daily `/analyze` → `/scale` → weekly `/report` → monthly `/monthly-review` → `/before-after`

The full routing table lives in [CLAUDE.md](../CLAUDE.md).

**Two hard rules**:
- Every new campaign/adset/ad is created with status `PAUSED`. You activate manually.
- Anything above your guardrail thresholds (budget +$500/day, daily budget >$200, off-hours actions) routes to Slack for approval before executing.

---

## 3. Workflows by scenario

### Scenario A — "I'm pitching a new prospect tomorrow"

You don't have their ad account yet. You want a sales artifact.

```
You: /pre-audit
Claude asks: business name, niche, FB page URL, IG handle, website, 3 competitors, country.
Claude runs: public page scrape + Meta Ad Library on prospect + competitors + pixel check.
Output: prospects/{slug}/pre_audit.html — branded report, scored 0–100,
        with "they're outspending you NX:1" headline + 3 wins / 3 gaps / 3 opportunities.
```

Open the HTML, send it as your pitch. Takes ~5 minutes. No client login needed.

When they sign, `/intake {slug}` auto-hydrates from the pre-audit — you don't re-ask the same questions.

### Scenario B — "Client just signed, set them up"

```
You: /intake
Claude walks you through 9 question groups (~10 min): business basics, audience,
voice, accounts, KPIs, history, competitors, assets, approvals.
Output: clients/{slug}/client_profile.json + clients/{slug}/CLAUDE.md + Supabase clients row.

You: /audit {slug}
Claude runs 5 passes: organic FB + organic IG + paid + synthesis + baseline snapshot.
Output: clients/{slug}/audit_report.md with a 0–100 health score and 3 wins / 3 issues / 3 next steps.
This is the "before" state — every future before/after comparison hangs off this snapshot.
```

### Scenario C — "Plan a campaign for an active client"

```
/research {slug}        → competitor_intel.json + ranked HTML report (5 min)
/audience-map {slug}    → audience_map.json (interest clusters + retargeting + LAL strategy)
/strategy-brief {slug}  → strategy_brief.json + strategy_brief.md (the plan)
/creative {slug}        → ad_copy.json (variants scored by hook strength)
/launch {slug}          → creates campaign/adsets/ads in Meta as PAUSED, waits for your activation
```

Each step reads from the previous step's output. You can re-run any step without re-running the whole chain.

### Scenario D — "Daily ops"

```
/analyze {slug}     → pulls yesterday's metrics, flags anything outside KPI bands
/scale {slug}       → pauses underperformers, recommends scale-ups (executes ≤20% scale-ups
                      automatically, anything bigger routes to Slack approval)
```

Or skip the manual loop and let the **optimizer agent** run on cron (see `agents/optimizer.md`).

### Scenario E — "Weekly and monthly reports"

```
/report {slug}              → weekly_report.md (last 7 days vs prior 7 days)
/before-after {slug}        → comparison vs the baseline snapshot from /audit
/monthly-review {slug}      → full month review with strategy reset recommendations
```

Reports auto-upload to Google Drive and post to Slack if those connectors are wired.

---

## 4. The Meta Ad Library engine (`scripts/meta-ad-library/`)

Shared by `/research`, `/pre-audit`, and `/research-market`. You normally don't touch these directly — the skills call them — but they're scriptable when you want one-offs.

| Script | Purpose |
|---|---|
| `client.py` | Fetch ads from the Meta Ad Library API by URL, page ID, or keyword |
| `analyzer.py` | Score competitors (volume / spend / format / cadence / impressions) |
| `classifier.py` | LLM-classify ad copy into 6-theme angle taxonomy (cached on disk) |
| `report.py` | Render the Apple-style HTML report |
| `differ.py` | Diff two snapshots — surface new ads, killed ads, spend-tier moves |
| `persist.py` | Write snapshots to Supabase (`competitor_snapshots` / `market_snapshots` / `prospect_audits`) |
| `creatives.py` | Download ad images/videos to `clients/{slug}/swipe/` |
| `market.py` | Category-level sweep across a niche using `data/niches/<niche>.json` |

### One-off competitor scan

```bash
export META_ACCESS_TOKEN=…
python scripts/meta-ad-library/client.py \
  --urls https://www.facebook.com/Nike/ https://www.facebook.com/Adidas/ \
  --country US --days 90 \
  --output reports/raw.json

python scripts/meta-ad-library/analyzer.py --input reports/raw.json
python scripts/meta-ad-library/report.py --input reports/analyzed.json --open
```

### Diff against a prior snapshot

```bash
# Snapshot IDs come from the `competitor_snapshots` table in Supabase
python scripts/meta-ad-library/differ.py \
  --supabase --prior <prior_id> --current <new_id>
```

---

## 5. Naming convention (enforced)

The `naming-check` hook blocks any create_* call where the entity name doesn't match:

| Entity | Pattern | Example |
|---|---|---|
| Campaign | `[OBJECTIVE]_[AUDIENCE_CODE]_[YYYYMM]` | `CONV_LAL1PCT_202606` |
| AdSet | `[PLACEMENT]_[AGE_RANGE]_[INTEREST_CODE]` | `FEED_2545_FITNESS` |
| Ad | `[FORMAT]_[HOOK_CODE]_[VERSION]` | `IMG_PAIN_v1` |

If you bypass this convention by editing in Ads Manager directly, the `/analyze` skill will flag those entities as non-compliant in your next report.

---

## 6. Guardrails — what auto-runs vs what asks first

**Auto (no approval):**
- Pausing ads below KPI thresholds (after the minimum spend bar is reached)
- Scaling budget by ≤20% on qualifying adsets
- Generating + sending reports
- Writing to Supabase

**Slack approval required:**
- Single budget increase >$500/day
- New campaign launch with daily budget >$200
- Any action outside 6 AM – 9 PM client timezone
- Removing an audience exclusion
- Changing campaign targeting

**Hard-blocked (only with explicit override):**
- Delete a campaign/adset/ad — smOS archives instead
- Increase lifetime budget on a live campaign
- Change objective on a running campaign
- Remove the pixel from an ad account

Full ruleset in [CLAUDE.md § Guardrail Rules](../CLAUDE.md#guardrail-rules).

---

## 7. File layout (where things land)

```
smOS/
├── clients/{slug}/
│   ├── CLAUDE.md                    ← per-client constitution (KPI overrides)
│   ├── client_profile.json          ← /intake output
│   ├── audit_report.md              ← /audit output
│   ├── competitor_intel.json        ← /research output
│   ├── audience_map.json            ← /audience-map output
│   ├── strategy_brief.json + .md    ← /strategy-brief output
│   ├── ad_copy.json                 ← /creative output
│   ├── baseline/pre_audit.html      ← copied from prospects/ on conversion
│   ├── reports/                     ← per-run HTML reports + raw API dumps
│   └── swipe/                       ← downloaded competitor creatives
├── prospects/{slug}/
│   ├── page_audit.json              ← /pre-audit Pass 1
│   ├── pre_audit.html               ← the sales artifact
│   └── reports/                     ← raw + competitor analysis
├── data/niches/                     ← shared niche playbooks (auto.json, …)
└── .cache/meta-ad-library/          ← LLM classifier cache (disk-cached responses)
```

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `META_ACCESS_TOKEN not set` | Token missing from env | `source .env` then re-run, or restart Claude Code so it picks up the new `.env` |
| Meta API returns code 100 | Token doesn't have access to the requested ad account | Re-issue System User token in BM, attach the ad account to the System User |
| Meta API returns 17 / 613 | Rate limited | Wait the `Retry-After` window; don't retry in a tight loop |
| Pixel-check blocks a launch | Pixel isn't firing or isn't linked to the ad account | Visit Events Manager, fire a test event, confirm pixel is linked under Business Settings → Data Sources |
| `naming-check` blocks a create | Entity name doesn't match the regex | Rename the entity to fit `[OBJECTIVE]_[AUDIENCE_CODE]_[YYYYMM]` (or equivalent for adset/ad) |
| `/pre-audit` says "no niche playbook on file" | `data/niches/<niche>.json` doesn't exist yet | Run anyway — Pass 4 will skip and flag it as a gap. Add the niche file later. |
| LLM classifier errors out | `ANTHROPIC_API_KEY` missing | Set the key, OR skip the classifier pass — analyzer regex hooks still work, just less accurate |
| Supabase insert fails on `competitor_snapshots` | You haven't re-applied the updated schema | Re-run `psql … -f scripts/schema.sql` (it's idempotent on the new tables) |

For anything else: check `error_log` in Supabase — every Meta API failure logs `fbtrace_id`, `code`, `type`, and `error_subcode` there.

---

## 9. Extending smOS

- **New skill** — add `skills/<name>.md`, register in `plugin.json` `skills[]`, add a row to the CLAUDE.md routing table.
- **New hook** — add the script to `hooks/`, register in `plugin.json` `hooks[]` with the right `event` + `matcher`.
- **New niche playbook** — drop a JSON file in `data/niches/<niche>.json` mirroring `data/niches/auto.json`. `/pre-audit` and `/research-market` pick it up automatically.
- **New report template** — add to `templates/`, point the relevant skill at it.

When in doubt, mimic an existing file in the same folder. The structure is consistent on purpose.

---

## 10. The shortest possible "first run"

You have an ad account, a Supabase project, a Slack workspace. You want to see smOS work end-to-end on a real client.

```
1. cp .env.example .env  → fill in the 7 required vars
2. psql "$SUPABASE_URL" -f scripts/schema.sql
3. claude . → /intake → answer the 9 question groups
4. /audit {slug} → review the health score
5. /research {slug} → review competitor_intel.json + the ranked HTML
6. /strategy-brief {slug} → review the plan
7. /creative {slug} → review ad copy variants
8. /launch {slug} → campaign created in Meta as PAUSED
9. Eyeball it in Ads Manager. Activate manually. You're live.
```

Time, end-to-end on a clean account: ~45 minutes.
