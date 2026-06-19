---
name: intake
description: Use this skill when the user asks to onboard a new client or run new-client intake (typically via `/intake`). Walks the user through a 9-group Q&A, produces a structured profile JSON, generates a per-client `CLAUDE.md` constitution, and inserts a row in the Supabase `clients` table.
---

# /intake — Client Onboarding

## Required Context

Load only these fields — no global state needed.

- Working directory: should be the smOS root
- Supabase connector (via MCP) — for the `clients` table insert

## Workflow

Conversational, one question at a time. Use the questions from `templates/intake-questions.md` verbatim. After each answer:

1. Parse it into the right slot in the profile JSON
2. If ambiguous, ask ONE clarifying follow-up
3. Move to the next question

Do NOT batch all 9 groups into one prompt — that produces shallow answers. Ask group-by-group.

### Steps

0. **Hydrate from `/pre-audit` if it ran.** Derive the candidate slug, then check for `prospects/{slug}/page_audit.json` and the most recent `prospect_audits` row in Supabase. If found, pre-fill: business name, niche, FB page URL, IG handle, website, competitors list, country. Confirm each field with the user instead of re-asking. After intake completes, update `prospect_audits.converted = true`, stamp `converted_at`, and copy `prospects/{slug}/pre_audit.html` to `clients/{slug}/baseline/pre_audit.html`.

1. **Greet + confirm.** "I'll ask you 9 short groups of questions to set up this client. Should take ~10 minutes. Ready?" (Skip groups whose fields were already hydrated in step 0 — confirm them in one batch instead.)

2. **Run Q&A** following `templates/intake-questions.md` order:
   - Business basics
   - Target audience
   - Brand voice
   - Accounts & access
   - KPI targets
   - History
   - Competitive context
   - Assets
   - Approval preferences

3. **Derive slug** from client name: lowercase, hyphens, alphanumeric only.
   Example: "Uppal Pharma" → `uppal-pharma`

4. **Detect account currency + timezone** by calling `get_campaigns` (or any account-level Meta API call) on the provided ad account — store these in the profile.

5. **Build `clients/{slug}/client_profile.json`** matching this schema:
   ```json
   {
     "slug": "...",
     "name": "...",
     "business": { "product_description", "price_low", "price_high", "business_model", "usp", "conversion_event" },
     "audience": { "age_low", "age_high", "gender", "geo_targets", "pain_points": [] },
     "voice": { "tone", "restricted_words": [], "cta_style" },
     "accounts": { "ad_account_id", "pixel_id", "page_id", "ig_account_id", "bm_id", "currency", "timezone" },
     "kpis": { "target_cpa", "target_roas", "monthly_budget_low", "monthly_budget_high" },
     "history": { "previous_spend", "what_worked", "what_failed" },
     "competitors": ["..."],
     "assets": { "formats_available": [], "brand_guidelines_url", "brand_colors": [] },
     "approvals": { "channel", "daily_cap", "extra_rules": [] }
   }
   ```

6. **Generate `clients/{slug}/CLAUDE.md`** by filling `templates/client-claude.md`. For KPI thresholds that the user didn't specify, fall back to the global defaults in `/Users/apple/abdul/smOS/CLAUDE.md`:
   - CPA pause: 3× target after $50 spend
   - ROAS pause: < 1.0 after $100 spend
   - ROAS scale: > 3.0 for 3 consecutive days
   - CTR pause: < 0.5% after $30 spend
   - Frequency cap: > 4.0 in 7-day window

7. **Insert row into Supabase `clients` table** with columns: `slug`, `name`, `profile` (the full JSON), `kpis`, `account_ids`, `voice`, `status: 'active'`.

8. **Confirm + next step.** "Profile saved for {name}. Run `/audit` next to pull the baseline state of their accounts."

## Output Files

- `clients/{slug}/client_profile.json`
- `clients/{slug}/CLAUDE.md`
- Supabase row in `clients`

## Error Handling

- If ad account ID is provided but Meta API returns 100/auth error → halt, surface the error, ask user to verify the System User token has access to this account
- If pixel ID is invalid → still save the profile but flag pixel as `unverified` in the JSON
- If page ID is invalid → same — flag but don't block
- Never guess a missing field. If the user skips a question, store `null` and surface a list of skipped fields at the end
