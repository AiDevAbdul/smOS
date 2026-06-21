# Blue Rose Auto — Client Constitution

Overrides and extends the global `/Users/apple/abdul/smOS/CLAUDE.md` for this client only.

## Identity

- **Brand:** Blue Rose Auto Care & Repair Services
- **Location:** Springfield, OR (serving Eugene + 30mi radius)
- **Engagement start:** 2026-06-18
- **Status:** Planning mode (no live Meta accounts yet)

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

- No confirmed monthly budget yet. Planning assumption: **$1,500–$3,000/mo** (~$50–$100/day split across 2–3 adsets).
- Any single-day budget increase > $200 requires explicit human approval (tighter than the global $500 default — small-shop budget hygiene).

## Approvals

- All approvals route to **this planning thread** until a Discord webhook is set up.
- Pre-launch artifacts (strategy brief, ad copy, campaign JSON) require human "approve" before `/launch` is allowed to fire MCP create calls.

## Blockers Before Going Live

- Facebook Page ID
- Instagram Business Account ID
- Ad Account ID (`act_…`)
- Pixel ID
- Confirmed monthly ad budget
- Discord approvals webhook URL (or written confirmation that this thread stays the approval channel)

Until all six land, **no `meta_create_*` calls are permitted**. All output stays as planning artifacts in `clients/blue-rose-auto/`.
