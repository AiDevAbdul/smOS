#!/usr/bin/env node
// scheduler.js — registers smOS scheduled agents with Claude Code's cron system.
//
// This script declares the schedule; the actual cron registration is performed
// by `claude scheduler sync` reading the SCHEDULES export below.
//
// Each entry maps to an agent in agents/ and a cron expression in the
// optimizer's / reporter's client timezone. For multi-tenant runs the agent
// itself iterates active clients — the scheduler fires once globally.
//
// Cron format: `m h dom mon dow` in the server's TZ (UTC by default).

export const SCHEDULES = [
  {
    name: "smos-optimizer-daily",
    agent: "optimizer",
    cron: "0 8 * * *",                 // 08:00 server TZ
    description: "Daily auto-pause / auto-scale loop for every active client",
    args: {},
    timeout_minutes: 30,
  },
  {
    name: "smos-reporter-weekly",
    agent: "reporter",
    cron: "0 9 * * 1",                 // Mondays 09:00
    description: "Weekly client report — performance, deltas, recommendations",
    args: {},
    timeout_minutes: 45,
  },
  {
    name: "smos-auditor-monthly",
    agent: "auditor",
    cron: "0 10 1-7 * 1",              // First Monday of the month at 10:00
    description: "Monthly structural health audit — naming, overlap, fatigue, pixel, allocation, zombies",
    args: {},
    timeout_minutes: 60,
  },
];

// CLI entry: print the schedule list as JSON (consumed by `claude scheduler sync`)
if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(JSON.stringify(SCHEDULES, null, 2) + "\n");
}
