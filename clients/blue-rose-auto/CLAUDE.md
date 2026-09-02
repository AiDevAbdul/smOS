# Blue Rose Auto — Client Constitution

Overrides and extends the global `/Users/apple/abdul/smOS/CLAUDE.md` for this client only.

## Identity

- **Brand:** Blue Rose Auto Care & Repair Services
- **Location:** Springfield, OR (serving Eugene + 30mi radius)
- **Engagement start:** 2026-06-18
- **Status:** Active — live Meta accounts, real spend (see `profile.json.accounts`; ~$615/week as of 2026-08-31, see `reports/2026-08-31/weekly.md`)

## Voice

- Confident, hands-on, craftsman tone — never salesy
- Lead with proof: "30+ years", "ASE-certified", "Tesla-capable"
- Forbidden words: miracle, guaranteed, cure, best ever, lowest prices anywhere
- Forbidden tactics: fake urgency ("only 3 spots left"), inflated claims

## KPI Overrides (override globals from /Users/apple/abdul/smOS/CLAUDE.md)

| Metric | Pause threshold | Scale threshold |
|---|---|---|
| CPA (leads) | > $105 after $50 spend (3× target $35) | n/a |
| CTR (link) | < 0.5% after $30 spend | n/a |
| Frequency (7d) | > 3.5 (tighter than global 4.0 — small geo) | n/a |
| CPM (aware) | > $15 → flag | n/a |
| ROAS proxy | < 1.0 after $100 | > 1.5 for 3 days |

Tighter frequency cap because the served population is small (30mi radius around Springfield/Eugene); audiences saturate faster than national.

## Geo & Targeting

- Default geo: 30mi radius around Springfield, OR 97478
- Service area whitelist (for ZIP-targeted adsets): see `client_profile.json.location.service_area`
- Default age: 28–60
- Default gender: all (balanced)
- Repair adsets: broad income, "auto repair / brake / oil change" interest stack
- Cosmetic adsets: higher-income ZIPs OR luxury vehicle interests (BMW, Porsche, Tesla, Mercedes-Benz) + "car detailing / ceramic coating / paint protection"

## Conversion Events

- **Lead** — quote form submission (primary)
- **Schedule** — Book Now appointment (primary)
- **Phone Call** — ad-driven calls (secondary; harder to attribute)

## Budget Posture

- Confirmed monthly budget: **$1,500/mo** (`profile.json.monthly_budget.client_confirmed`).
- Any single-day budget increase > $200 requires explicit human approval (tighter than the global $500 default — small-shop budget hygiene).

## Approvals

- Approvals route via Discord (`profile.json.approvals.discord_channel_id`, webhook env `DISCORD_APPROVALS_WEBHOOK_BLUE_ROSE_AUTO`).
- Pre-launch artifacts (strategy brief, ad copy, campaign JSON) require human "approve" before `/launch` is allowed to fire MCP create calls.

## Accounts (live)

- Page: `1709708972688957` · IG: `17841417245534835` · Ad account: `act_1999616770762846`
- Pixel: `1798280031363662` (client-owned; see `profile.json.accounts.legacy_pixel_note` — a
  prior agency-owned pixel `2183558222437003` is being retired, do not point new dev work at it)
- CAPI status: `clients/blue-rose-auto/capi_report.json` (regenerate via `/capi-setup`) —
  `Lead` healthy (100% server-side), `Schedule` never fired as of 2026-08-31; the pixel-check
  guard (`scripts/lib/guards.js::checkPixel`) enforces "pixel firing" before any conversion-
  objective `create_campaign` call.
