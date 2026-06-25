---
name: audit
description: Use this skill when the user asks to audit a client's Meta presence or asks for a baseline of their organic + paid accounts (typically via `/audit {slug}`). Pulls a full Facebook Page + Instagram + ad-account snapshot via the Graph API, computes a 0–100 health score, fills `audit_report.md`, and writes the immutable `baseline_snapshot.json` that every future `/before-after` report compares against.
---

# /audit — Account + Page Audit (Phase 1)

Capture a complete, point-in-time snapshot of a client's Meta presence — organic (Facebook Page + Instagram) and paid (ad account, pixel, audiences) — score it 0–100, and freeze it as the immutable baseline. This baseline is load-bearing: `/before-after` refuses to run against an unlocked snapshot, so a correct audit run is the foundation of the agency's signature progress deliverable.

## What This Skill Does

- Run `skills/audit/audit.js <slug> [--no-paid] [--no-ig]`, the deterministic data-fetch + transform + template-fill companion.
- Fetch three passes in parallel via `createGraph()`: Facebook Page (profile, 60-day posts, 90-day insights), Instagram (profile, 60-day media, 28-day insights), ad account (account, lifetime campaigns, custom audiences, pixel stats).
- **Reuse the prospect-stage pre-audit instead of re-deriving public data.** The script auto-loads `prospects/{slug}/page_audit.json` (override via `accounts.pre_audit_slug`; else matched by website/handle) and carries forward the website/tracking signals the Graph API can't return — **is the pixel installed on the site**, GA4/GTM IDs, conversion-events, mobile-responsive, plus the Ad Library `verdict`. Live API is always the source of truth; pre-audit only fills what the API can't, falls back for blocked IG (clearly labeled a public estimate), and **corroborates the pixel finding** (account-side health × on-site install → a single high-confidence cross-reference).
- Derive metrics: page completeness, follower growth (`page_daily_follows`; net delta is deprecated by Meta), posts/week, **days-since-last-post (window-independent dormancy probe)**, format mix, engagement rate, best/worst post, lifetime spend, best CPA/ROAS, naming compliance, zombie campaigns, audience health, pixel-health class.
- Compute the weighted 0–100 health score (weights in `references/domain-standards.md`). **Permission-blocked components (e.g. engagement when `pages_read_user_content` is absent) are dropped and the remaining weights renormalized — never scored as a zero.**
- Write `clients/{slug}/audit_raw.json`, fill `templates/audit-report.md` → `clients/{slug}/audit_report.md`, and write `clients/{slug}/baseline_snapshot.json` (locked only when real FB engagement was captured).
- After the script returns: append the qualitative analysis (Top-3 wins / issues / next steps) into the report, render HTML + PDF via the standardized renderer, and insert the Supabase `reports` row.

## What This Skill Does NOT Do

- Score creative quality (visual/CTA/text-density via vision) — that is `/audit-creative`, which reuses this audit's post list and appends to the report.
- On-demand performance deep-dives, segment breakdowns, or fatigue analysis — that is `/analyze`.
- Compare against the baseline / compute deltas — that is `/before-after` (it consumes the `baseline_snapshot.json` this skill writes).
- Competitor / Ad Library research — that is `/research`.
- Any account mutation. `/audit` is strictly read-only (GET only).

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `skills/audit/audit.js`, `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`), `scripts/audit_report_html.js` (standardized renderer), `schemas/baseline_snapshot.js`, `templates/audit-report.md`, `scripts/render_pdf.py` |
| **Pre-audit (reused)** | `prospects/{slug}/page_audit.json` (+ `synthesis.json`) — public website/tracking + Ad Library data carried forward; set `accounts.pre_audit_slug` if the prospect dir name differs from the client slug |
| **Conversation** | The `{slug}`; whether the user wants to skip paid (`--no-paid`) or IG (`--no-ig`) |
| **Skill References** | Scoring weights, thresholds, taxonomies, I/O contract (see Reference Files) |
| **Client Profile** | `clients/{slug}/client_profile.json` (`accounts.facebook_page_id`, `instagram_business_id`, `ad_account_id`, `pixel_id`, `currency`) + per-client `CLAUDE.md` KPI overrides |

## Clarifications

> Before asking: check the conversation, the client profile, and prior handoff files.
> Only ask for what cannot be determined. Domain knowledge is embedded in `references/` — never ask the user for thresholds, weights, or naming rules.

**Required (must resolve before running):**
1. Which client `{slug}`? (Must have `clients/{slug}/client_profile.json`.)

**Optional (ask only if relevant):**
2. Skip the paid audit (`--no-paid`) — e.g. a first-time advertiser with no ad account?
3. Skip Instagram (`--no-ig`) — e.g. Facebook-only client?

## Workflow

1. Confirm `clients/{slug}/client_profile.json` exists; if not, halt and name the missing file.
2. Run `node skills/audit/audit.js {slug}` (add `--no-paid` / `--no-ig` when requested). The script fetches, derives, scores, writes `audit_raw.json` + `audit_report.md`, and writes `baseline_snapshot.json` if absent.
3. Read the JSON summary the script prints to stdout (health score, follower counts, spend, pixel health, paths, errors).
4. Read `audit_raw.json` and write the qualitative analysis into the report: replace the `_(Claude to fill)_` placeholders for Top-3 wins, Top-3 issues, Top-3 next steps — grounded only in the raw data.
5. Render HTML + PDF via the **one standardized renderer** — `node scripts/audit_report_html.js {slug}` (reads `audit_raw.json` + the filled `audit_report.md`, writes `clients/{slug}/reports/{date}_audit.html`), then `python scripts/render_pdf.py <report.html>`. Never hand-write a per-client HTML; if a section is missing, edit `scripts/audit_report_html.js` so every client inherits it.
6. Insert a Supabase `reports` row. **Use the real schema** (`report_type` enum, `report_url`, `generated_at`, `generated_by`, `key_metrics` jsonb — NOT `type`/`summary_json`). Run `scripts/baseline-snapshot.js` for the immutable `baseline_snapshots` row (`raw_data` jsonb). Do not re-fetch Meta data — downstream skills read `audit_raw.json` / Supabase.
7. Output one line to the user: health score + report path.

## Input / Output Specification

**Inputs:** CLI arg `<slug>`; flags `--no-paid`, `--no-ig`; reads `clients/{slug}/client_profile.json`; env `META_ACCESS_TOKEN` (+ optional `META_APP_SECRET`) via `scripts/lib/load-env.js`.
**Outputs:** `clients/{slug}/audit_raw.json`, `clients/{slug}/audit_report.md` (+ `.html`/`.pdf`), `clients/{slug}/baseline_snapshot.json`, a JSON summary on stdout, and a Supabase `reports` row.
(Full schemas, the stdout summary shape, and edge cases: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Account IDs, currency, timezone, follower/spend volumes | Three-pass structure; parallel fetch |
| Which passes run (`--no-paid`, `--no-ig`, or `TBD` IDs auto-skip) | Health-score weights & formula |
| KPI targets/benchmarks (per-client `CLAUDE.md`) | Naming regex `^[A-Z]+_[A-Z0-9]+_\d{6}$`, pixel-health classes |
| Whether the baseline locks (depends on real FB engagement) | Baseline immutability rule (never overwrite an existing snapshot) |

## Domain Standards

### Must Follow
- [ ] Run the `.js` companion for all fetch/derive/fill — never hand-fetch or hand-score.
- [ ] Treat `TBD`/empty IDs via `isTbd()` as a clean skip, not an error.
- [ ] Fill qualitative sections ONLY from `audit_raw.json` — never invent metrics.
- [ ] Ship the report as both HTML and PDF (`scripts/render_pdf.py`).
- [ ] Leave an existing `baseline_snapshot.json` untouched — baselines are immutable.

### Must Avoid
- Overwriting a locked baseline, or hand-locking an unlocked one.
- Requesting IG `impressions` (deprecated; use `views`/`reach` — see references).
- Requesting deprecated Page insight metrics `page_fans` / `page_fan_adds` / `page_fan_removes` / `page_impressions_unique` (they 400 "must be a valid insights metric"; use `page_daily_follows` / `page_post_engagements` / `page_views_total`).
- Calling `/{page}/posts` or fetching Page Insights with the **user** token — both need a **page access token** (resolved from `/me/accounts`) and `/posts` needs `pages_read_user_content`; use `/published_posts` with a minimal-fields fallback.
- Auto-retrying Meta errors or proceeding past a `TokenExpiredError`.
- Asking the user for thresholds/weights that live in `references/`.

### Output Checklist (verify before delivery)
- [ ] `audit_raw.json`, `audit_report.md`, `baseline_snapshot.json` all written.
- [ ] Health score present (0–100) and matches the stdout summary.
- [ ] Top-3 wins / issues / next-steps placeholders replaced with data-grounded text.
- [ ] HTML + PDF produced; Supabase `reports` row inserted.
- [ ] Baseline lock state correct (locked iff real FB engagement captured).

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `client_profile.json` | Script exits code 2; halt and name the path — never guess IDs. |
| No `{slug}` arg | Script exits code 1 with usage; ask for the slug. |
| `TBD`/empty account ID | Pass returns `{skipped, reason}`; note it in the report, do not error. |
| Page Insights empty | Surfaced as `insights_error` + `fbtrace_id`; flag likely Page-role/permission gap. |
| Ad account has no spend | All paid metrics return zero; flag "first-time advertiser" and weight score accordingly. |
| Meta API error | Logged with code/type/`fbtrace_id`; transient codes auto-retry in `meta-graph.js` (do not add retries). |
| Expired/invalid token (190/102/463/467) | `TokenExpiredError`, non-retryable — stop and prompt re-auth. |
| `baseline_snapshot.json` already exists | Not overwritten (immutable); proceed with the existing baseline. |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, retry/backoff/guard chokepoint), `scripts/lib/load-env.js`, `schemas/baseline_snapshot.js` (`normalize`), `templates/audit-report.md`, `scripts/render_pdf.py`.
- **External APIs:** Meta Graph + Marketing API **v25.0**, read-only (rate limits + endpoints in `references/api-reference.md`).
- **Runtime:** Node ≥18 (ESM, native `fetch`/`axios`); Python + Playwright/Chromium for PDF (`pip install playwright && python -m playwright install chromium`).
- **Secrets:** `META_ACCESS_TOKEN` / `META_APP_SECRET` resolved from `~/.config/smos/.env` (chmod 600) or `SMOS_ENV_FILE` — never hardcoded, never logged. `appsecret_proof` is HMAC-derived per call.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Graph API root | https://developers.facebook.com/docs/graph-api/ | Page/IG node + edge fields |
| Pages API — Posts/feed | https://developers.facebook.com/docs/pages-api/posts/ | Page post + engagement fields |
| Page node | https://developers.facebook.com/docs/graph-api/reference/page/ | `fan_count`, `about`, completeness fields |
| Marketing API root | https://developers.facebook.com/docs/marketing-api/ | Campaign/insights/custom-audience reads |
| IG Media Insights | https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ | `impressions`→`views` deprecation, `reach` |
| Handle Errors | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes, `fbtrace_id`, recovery |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | Codes 4/17/613, `X-App-Usage` headers |

For patterns not covered here, fetch the official docs above, then apply the same conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Health-score weights/formula, pixel-health & audience taxonomies, naming regex, ER benchmarks, good/bad audit examples |
| `references/api-reference.md` | Exact endpoints/fields/version/rate-limits per pass, with cited URLs |
| `references/io-contract.md` | Full `audit_raw.json` + `baseline_snapshot.json` schemas, stdout summary shape, template vars, edge cases |
