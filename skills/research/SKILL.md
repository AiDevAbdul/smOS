---
name: research
description: Use this skill when the user asks for competitor research, ad library analysis, or competitive intel for a client (typically via `/research {slug}`). Pulls competitor ads from the Meta Ad Library and analyzes format, angles, offers, CTAs, and gaps; produces `competitor_intel.json` that feeds `/strategy-brief`.
---

# /research — Competitor Ad Intelligence

## Required Context

- `clients/{slug}/client_profile.json` — for `competitors`, `business.product_description`, `audience.geo_targets`
- Meta MCP server — `search_ad_library` (primary path)
- `scripts/meta-ad-library/` — direct Ad Library engine (fallback when MCP is unavailable, and the only path that produces the ranked HTML report)
- Supabase connector — for the `reports` + `competitor_snapshots` rows
- `META_ACCESS_TOKEN` env var (smOS root `.env`) — required for the script fallback and for the ranked HTML pass

Halt if `client.competitors` is empty — ask the user for at least 2 competitor names or Facebook Page IDs before continuing.

## Workflow

### Pass 1 — Discover competitor pages

For each entry in `client.competitors`:
- If it looks like a numeric Page ID, use it directly
- Otherwise call `search_ad_library({ search_terms: <name>, ad_reached_countries: <geo_targets> })` and pick the top page by ad volume that clearly matches the brand name

If a competitor has zero ads in the Ad Library, record it as `inactive` and continue — don't block.

### Pass 2 — Pull active ads per competitor

For each resolved Page ID, run in parallel:

```
search_ad_library({
  search_page_ids: [page_id],
  ad_reached_countries: client.audience.geo_targets,
  ad_active_status: "ACTIVE",
  limit: 50
})
```

The response already includes copy bodies, link titles/descriptions, snapshot URLs, spend ranges, and impression ranges — no detail fetch needed.

### Pass 3 — Analyze each competitor

For each competitor's ad set, derive:

- **Active ad count** and **spend range** (sum the per-ad spend ranges into a low/high band)
- **Format mix %:** classify each ad by inspecting `ad_snapshot_url` page or the presence of multiple `ad_creative_bodies` / link assets — bucket into image / video / carousel
- **Top copy angles:** cluster `ad_creative_bodies` into themes (pain, aspiration, social proof, urgency, price, authority). List the top 3 with example snippets
- **Top hooks:** extract the first sentence of each body, group near-duplicates, return the 5 most common
- **Common CTAs:** count `call_to_action_type` values across the set
- **Common offers:** scan bodies + link descriptions for offer language (% off, free trial, BOGO, money-back, free shipping) and tally
- **Visual style patterns:** brief one-line description per recurring pattern (e.g. "white background product shots", "UGC selfie videos", "before/after splits") — derived from snapshot URLs the user can spot-check

### Pass 4 — Gap analysis

Compare across all competitors and against `client.business.usp`:

- **Format gaps:** formats none of them are using (e.g. nobody runs carousels)
- **Angle gaps:** themes nobody is leaning on that the client's USP could own
- **Offer gaps:** offer types absent from the competitive set
- **Voice gaps:** tone/register the field is crowded around vs an open lane

Return 3–5 concrete gap statements, each tied to a recommended angle the client can take.

### Pass 4.5 — Ranked HTML + LLM angle classification

Run the shared engine to produce the visual report and enrich the angle analysis. The MCP path above gives you the JSON; this pass gives you the shareable artifact + better hook taxonomy.

```bash
# Reuse the page IDs already resolved in Pass 1
python scripts/meta-ad-library/client.py \
  --page-ids <ids…> --country <geo> --days 90 \
  --output clients/{slug}/reports/raw_<ts>.json

python scripts/meta-ad-library/analyzer.py \
  --input clients/{slug}/reports/raw_<ts>.json

# LLM-classify ad bodies into the 6-theme taxonomy (cached on disk)
python scripts/meta-ad-library/classifier.py \
  --analyzed clients/{slug}/reports/analyzed_<ts>.json \
  --raw clients/{slug}/reports/raw_<ts>.json

python scripts/meta-ad-library/report.py \
  --input clients/{slug}/reports/analyzed_<ts>.json \
  --output clients/{slug}/reports/competitor_report_<ts>.html
```

Merge `angle_analysis` from the classifier into the per-competitor records that feed the `competitor_intel.json` writeout below — the `top_angles` field should use `angle_analysis.dominant_angle` + `angle_analysis.examples` rather than regex guesses.

### Pass 4.6 — Diff against prior snapshot (if any)

Query Supabase for the most recent prior `competitor_snapshots` row with the same `client_id`. If one exists:

```bash
python scripts/meta-ad-library/differ.py \
  --supabase --prior <prior_snapshot_id> --current <new_snapshot_id> \
  --output clients/{slug}/reports/snapshot_diff_<ts>.json
```

Surface the diff summary (new ads, killed ads, spend-tier moves, dominant-format shifts, CTA changes) as a `since_last_run` section in `competitor_intel.json`. Skip silently on first run.

### Pass 5 — Persistence

1. Write `clients/{slug}/competitor_intel.json`:
   ```json
   {
     "generated_at": "...",
     "competitors": [
       {
         "name": "...",
         "page_id": "...",
         "status": "active|inactive",
         "active_ad_count": 0,
         "spend_range": { "low": 0, "high": 0, "currency": "..." },
         "format_mix": { "image": 0.0, "video": 0.0, "carousel": 0.0 },
         "top_angles": [{ "theme": "...", "example": "..." }],
         "top_hooks": ["..."],
         "ctas": { "SHOP_NOW": 0 },
         "offers": ["..."],
         "visual_patterns": ["..."]
       }
     ],
     "gaps": [
       { "type": "format|angle|offer|voice", "observation": "...", "recommended_angle": "..." }
     ]
   }
   ```
2. Insert row in Supabase `reports`: `client_id`, `type: 'competitor_intel'`, `summary_json` (top-level counts + gap list), `created_at`.
3. Run `python scripts/meta-ad-library/persist.py competitor --input clients/{slug}/reports/analyzed_<ts>.json --client-id <uuid> --slug {slug}` — writes the full payload to `competitor_snapshots` so `/strategy-brief`, `/before-after`, and future runs of `/research --since` can read it back without re-hitting the Ad Library.
4. (Optional) `python scripts/meta-ad-library/creatives.py --input clients/{slug}/reports/raw_<ts>.json --out clients/{slug}/swipe/` if `/audit-creative` is queued to run next — gives it real downloaded assets to inspect.
5. Print a one-line summary: `N competitors analyzed · M active ads observed · K gaps identified · ranked HTML at clients/{slug}/reports/competitor_report_<ts>.html.`

## Output

- `clients/{slug}/competitor_intel.json`
- `clients/{slug}/reports/competitor_report_<ts>.html` (ranked, shareable)
- `clients/{slug}/reports/snapshot_diff_<ts>.json` (when a prior snapshot exists)
- Row in `reports` table
- Row in `competitor_snapshots` table

## Error Handling

- Ad Library returns nothing for a known-active brand → log the searched terms and ask the user to supply a Page ID directly
- Geo filter returns empty → retry once with `["US"]` as a fallback and flag in the JSON
- Rate limit (code 17 / 613) → halt, surface the `fbtrace_id`, do not retry automatically

## Token Efficiency

- Run all competitor `search_ad_library` calls in parallel — they're independent
- Do not re-pull snapshots; reuse the URLs already in the search response
- Save the full raw response set to a single Supabase row so `/strategy-brief` reads from there instead of re-hitting the API

## PDF Rendering

Every report ships in HTML **and** PDF. After the HTML/markdown is written, run the shared helper:

```bash
python scripts/render_pdf.py <report.html> --output <report.pdf>
```

For markdown-first reports (audit_report.md, weekly_report.md), first convert markdown → HTML using your existing renderer, then call `render_pdf.py`. The helper uses headless Chromium (Playwright) so Apple-style gradients, charts, and table borders render correctly. First-time setup: `pip install playwright && python -m playwright install chromium`.
