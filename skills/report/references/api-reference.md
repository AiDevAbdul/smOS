# /report — API Reference

Exact external endpoints `/report` touches. Self-contained. The skill itself only
**reads** Meta Insights; the agent runs the Google distribution scripts.

## Meta Graph API — version & client

- **Pinned version:** `v25.0` (`scripts/lib/meta-graph.js` `API_VERSION`; base `https://graph.facebook.com/v25.0`). Confirmed current — released 2026-02-18, no newer version.
- **Client:** `createGraph(token, opts)` returns a graph with `.get(path, params)` and `.act(id)` (prefixes `act_`). It auto-attaches `appsecret_proof` (HMAC-SHA256 of the token with `META_APP_SECRET`) and handles retry/pagination.
- **Auth:** `META_ACCESS_TOKEN` + `META_APP_SECRET` from env via `loadEnv()`. Read-only — no campaign/adset/ad writes.

## Insights calls used

All four hit `GET /act_<id>/insights` with `time_range={"since","until"}`.

| Call | `level` | Extra params | Fields |
|------|---------|--------------|--------|
| Current week | `account` | — | `INSIGHT_FIELDS` (below) |
| Prior week | `account` | — | `INSIGHT_FIELDS` |
| Placement breakdown | `account` | `breakdowns=publisher_platform,platform_position` | `spend,impressions,clicks,ctr` |
| Top ad | `ad` | `limit=200`, `sort=spend_descending` | `ad_id,ad_name,spend,impressions,clicks,ctr,frequency,actions,action_values,purchase_roas` |

`INSIGHT_FIELDS` (account rollup):
```
spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,actions,action_values,
purchase_roas,cost_per_action_type,inline_link_clicks,inline_link_click_ctr
```

Key field semantics:
- `actions` / `action_values`: arrays of `{action_type, value}`; matched by the §3 event lists in `domain-standards.md`.
- `purchase_roas`: array; `[0].value` is the reported ROAS when present.
- `ctr` / `inline_link_click_ctr`: already **percentages**.

| Resource | URL | Use For |
|----------|-----|---------|
| Insights edge | https://developers.facebook.com/docs/marketing-api/insights/ | `time_range`, `level`, `breakdowns`, `sort`, paging |
| Ad insights fields | https://developers.facebook.com/docs/marketing-api/reference/adgroup/insights/ | Field defs for the fields above |
| Breakdowns | https://developers.facebook.com/docs/marketing-api/insights/breakdowns/ | Valid `publisher_platform`, `platform_position` values |
| Versions list | https://developers.facebook.com/docs/graph-api/changelog/versions/ | Confirm v25.0 current |

## Rate limits & errors

- Marketing-API insights count against ads-management Business-Use-Case limits; watch the `X-Business-Use-Case-Usage` response header.
- Relevant codes: **4** (app-level throttle), **17** (`API_EC_USER_TOO_MANY_CALLS`, user-level), **613** (custom limit). Do **not** auto-retry on rate-limit; `report.js` records the error into `errors[]` and still emits the report.
- All errors carry `code`, `type`, `message`, `fbtrace_id` — log the full object to `error_log`.

| Resource | URL | Use For |
|----------|-----|---------|
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | Header reading, code 4/17/613 |
| Marketing API Rate Limiting | https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/ | Ad-account-specific limits |
| Handle Errors | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error-code table + `fbtrace_id` |

## Distribution (agent-run, after files exist)

`report.js` does NOT call these — the agent does, using the script outputs.

| Step | Command | Notes |
|------|---------|-------|
| PDF | embedded: `writeHtmlAndPdf` → `python3 scripts/render_pdf.py <html> --output <pdf>` | headless Chromium (Playwright); the ONE authoritative PDF path |
| Drive | `python3 scripts/lib/drive_upload.py <pdf_path> --folder-id <drive_folder_id>` | prints JSON with `drive_link` |
| Gmail | `python3 scripts/lib/gmail_send.py --to <email> --subject "..." --body "..." --attachment <pdf_path>` | |
| Auth | `python3 scripts/lib/google_auth.py` (one-time) | both Google scripts share `~/.config/smos/google_token.json` |

Google Drive/Gmail are Google Workspace APIs (OAuth user token on disk). Treat upload/send
failures as non-fatal: log to `error_log`, note in the digest, do not auto-retry.

**Last verified:** 2026-06-22
