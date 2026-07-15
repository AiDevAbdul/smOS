---
name: auditor
description: Use this skill to run the monthly structural-health audit for a client's live Meta ad account — naming drift, audience overlap, creative fatigue, pixel completeness, budget allocation, and zombie campaigns (typically via `/auditor {slug}` or the scheduled first-Monday-of-month run). This is the code backing for `agents/auditor.md`; it never mutates anything — pause/scale stays with `/optimizer`, targeting changes stay with a human.
---

# /auditor — Monthly Structural Health (G13)

Runs the 8-step loop specified in `agents/auditor.md` against the guarded Meta
chokepoint and writes `clients/{slug}/monthly_health_report.json`. Read-only:
every check is a GET; nothing is paused, scaled, or retargeted here.

## What This Skill Does

- Pulls the account's full campaign → adset → ad tree (active + recent).
- Flags naming-convention violations using the exact regex `hooks/naming-check.js` enforces at create time.
- Flags active adset pairs with resolved custom audiences whose overlap exceeds 40% (`estimate_audience_overlap`).
- Flags ads active ≥14 days with CTR_7d < 0.6×CTR_30d or frequency_7d > 4.0.
- Checks the pixel fires every event the client's `conversion_events` expect.
- Flags adsets in the bottom ROAS quartile still holding >10% of 30d spend.
- Flags active campaigns with zero impressions in the last 7 days ("zombies") — surfaced for review, never auto-paused (that's `/optimizer`'s job).
- Scores 0–100 (100 minus weighted deductions per category, floored at 0) and writes the report.

## What This Skill Does NOT Do

- Does not pause, scale, or change budgets/targeting — `/optimizer` and `/scale` own mutations.
- Does not run naming/overlap/fatigue checks against Meta itself for validation — it reuses the same pure logic the create-time hook and `/creative-intel` already encode, so results can't drift from what the live guards would say.
- Does not feed the report into `/strategy-brief` automatically — the operator (or `/strategy-brief`) reads `monthly_health_report.json` on the next run.

## Invocation

```
node skills/auditor/auditor.js <slug>
```

**Inputs:** `clients/{slug}/client_profile.json` (`accounts.ad_account_id`, `accounts.pixel_id`, `conversion_events`, `kpis`); env `META_ACCESS_TOKEN` (required), `META_APP_SECRET` (optional).
**Outputs:** `clients/{slug}/monthly_health_report.json` (see shape below); stdout one-line JSON summary (`slug`, `score`, `headline_issues`, `path`). Progress goes to stderr.

## Report Shape

```json
{
  "slug": "...", "generated_at": "...", "ad_account_id": "act_...",
  "naming_violations": [{ "level": "campaign|adset|ad", "id": "...", "name": "...", "reason": "..." }],
  "audience_overlap_pairs": [{ "adset_a": "...", "adset_b": "...", "overlap_pct": 0 }],
  "fatigued_ads": [{ "id": "...", "name": "...", "ctr_7d": 0, "ctr_30d": 0, "frequency_7d": 0, "days_active": 0 }],
  "pixel_gaps": { "checked": true, "missing_events": [] },
  "budget_misallocations": [{ "id": "...", "name": "...", "roas": 0, "spend_share_pct": 0 }],
  "zombie_campaigns": [{ "id": "...", "name": "..." }],
  "summary": { "score": 0, "headline_issues": ["..."] }
}
```

## Domain Standards

### Must Follow
- [ ] Reuse `checkNaming` from `scripts/lib/guards.js` — never re-implement the naming regex.
- [ ] Budget-allocation quartiles require ≥4 spending adsets; below that, skip (quartiles are meaningless on a tiny sample).
- [ ] Fatigue requires ≥14 days of delivery before flagging — never guess on a young ad.
- [ ] A Graph call that fails degrades that one check to an honest `error`/`null` — never silently substitutes 0.

### Must Avoid
- Do not pause, scale, or archive anything from this skill — it is read-only by design.
- Do not report a zombie campaign as "handled" — it is surfaced for human/optimizer review only.

### Score formula (CONSTANT)
Start at 100; subtract naming ×5, overlap-pair ×10, fatigued-ad ×3, missing-pixel-event ×15, misallocated-adset ×8, zombie ×10; floor at 0.
