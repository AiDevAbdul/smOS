# smOS — Build Documentation

This folder tracks the full build process of smOS, phase by phase.
Each file covers one phase: what was decided, what was built, what was tested, what was found, and what comes next.

**→ Want to *use* smOS, not read its build log? See [USAGE.md](USAGE.md).**

---

## Phase Index

| Phase | Title | Status | File |
|---|---|---|---|
| Phase 1 | Foundation — Meta MCP Server + Supabase Schema | ✅ Complete | [phase1.md](phase1.md) |
| Phase 2 | Intake & Audit Skills | 🔲 Not started | [phase2.md](phase2.md) |
| Phase 3 | Research & Strategy Skills | 🔲 Not started | [phase3.md](phase3.md) |
| Phase 4 | Creative & Launch | 🔲 Not started | [phase4.md](phase4.md) |
| Phase 5 | Optimization Loop | 🔲 Not started | [phase5.md](phase5.md) |
| Phase 6 | Reporting & Polish | 🔲 Not started | [phase6.md](phase6.md) |

---

## Project Overview

**smOS** is an autonomous social media management OS built as a Claude Code plugin.
It manages Meta (Facebook/Instagram) ad accounts and organic pages end-to-end:
client onboarding → strategy → creative → campaign launch → daily optimization → reporting.

**Stack:**
- Claude Code (runtime + agent orchestration)
- Custom Meta MCP Server (Node.js, v21.0 API)
- Supabase (data persistence)
- Slack (notifications + approvals)
- Google Drive + Gmail (report storage + distribution)

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
│   ├── meta-server/                ← Custom Meta API MCP server
│   └── connectors.json             ← Slack, Supabase, Drive, Gmail, Notion
├── skills/                         ← Skill files (built phase by phase)
├── agents/                         ← Agent files (built phase by phase)
├── hooks/                          ← Guardrail hooks (built Phase 4)
├── templates/                      ← Output templates (built phase by phase)
├── scripts/
│   └── schema.sql                  ← Full Supabase database schema
└── docs/                           ← This folder
```
