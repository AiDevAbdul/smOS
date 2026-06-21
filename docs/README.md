# smOS — Build Documentation

This folder tracks the full build process of smOS, phase by phase.
Each file covers one phase: what was decided, what was built, what was tested, what was found, and what comes next.

**→ Want to *use* smOS, not read its build log? See [USAGE.md](USAGE.md).**

---

## Phase Index

| Phase | Title | Status | File |
|---|---|---|---|
| Phase 1 | Foundation — Meta MCP Server + Supabase Schema | ✅ Complete | [phase1.md](phase1.md) |
| Phase 2 | Intake & Audit Skills | ✅ Complete | [phase2.md](phase2.md) |
| Phase 3 | Research & Strategy Skills | ✅ Complete | [phase3.md](phase3.md) |
| Phase 4 | Creative & Launch | ✅ Complete | [phase4.md](phase4.md) |
| Phase 5 | Optimization Loop | ✅ Complete | [phase5.md](phase5.md) |
| Phase 6 | Reporting & Polish | ✅ Complete | [phase6.md](phase6.md) |

---

## Project Overview

**smOS** is an autonomous social media management OS built as a Claude Code plugin.
It manages Meta (Facebook/Instagram) ad accounts and organic pages end-to-end:
client onboarding → strategy → creative → campaign launch → daily optimization → reporting.

**Stack:**
- Claude Code (runtime + agent orchestration)
- Custom Meta MCP Server (Node.js, v25.0 API)
- Supabase (data persistence)
- Discord webhooks (notifications + approvals)
- Google Drive + Gmail (report storage + distribution, via Python connector scripts)

**Authentication:** System User Token (one long-lived token per ad account, stored in env vars)

**Target accounts:** Agencies managing multiple clients, in-house social teams, freelance media buyers.

---

## Key Files

```
smOS/
├── CLAUDE.md                       ← System constitution (read every session)
├── plugin.json                     ← Plugin manifest + MCP server config
├── .env.example                    ← All required environment variables
├── mcp/
│   └── meta-server/                ← Custom Meta API MCP server (v25.0)
├── skills/                         ← One folder per skill, each with SKILL.md + script
├── agents/                         ← optimizer.md, reporter.md, auditor.md, creative-agent.md
├── hooks/                          ← Guardrail hooks + shared _lib.js
├── templates/                      ← Output templates (weekly-report, before-after, etc.)
├── scripts/
│   ├── schema.sql                  ← Full Supabase database schema
│   ├── scheduler.js                ← Schedule definitions (read by install-crons.sh)
│   ├── install-crons.sh            ← Registers smOS jobs in native crontab
│   ├── run-agent.sh                ← Claude CLI wrapper invoked by cron
│   ├── baseline-snapshot.js        ← Captures /audit baseline to Supabase
│   ├── render_pdf.py               ← HTML → PDF via headless Chromium (Playwright)
│   └── lib/
│       ├── google_auth.py          ← One-time OAuth2 flow, stores refresh token
│       ├── drive_upload.py         ← Upload file to Google Drive, return share link
│       └── gmail_send.py           ← Send email with optional PDF attachment
└── docs/                           ← This folder
```
