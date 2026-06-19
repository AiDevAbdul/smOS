---
name: pre-audit
description: Use this skill when the user asks to audit, scope, or pitch an unsigned prospect before client onboarding (typically via `/pre-audit`). Produces a branded HTML sales artifact scored 0–100 from public data only — Facebook Page, Instagram, Meta Ad Library, website, competitor outspend — with wins, gaps, and opportunities. No client API access required.
---

# /pre-audit — Pre-Onboarding Prospect Audit

The "before contract" companion to `/audit`. Where `/audit` needs ad account + pixel access, `/pre-audit` runs entirely on public surfaces — Facebook Page, Instagram profile, Meta Ad Library, the prospect's website, and competitor Ad Library data. Output is a sales asset you send to close the deal, not a client deliverable.

## Required Context

Conversational intake (one Q at a time, then run):

1. **Business name** (used as report title)
2. **Niche** (auto, HVAC, dental, roofing, e-com, B2B SaaS, fitness, legal — used to look up `data/niches/<niche>.json` if available)
3. **Facebook Page URL** (`https://www.facebook.com/<slug>/`)
4. **Instagram handle** (optional)
5. **Website URL**
6. **Top 3 named competitors** (optional — if none given, derive from niche category sweep)
7. **Country** (default `US`)

No Supabase client row needed — this prospect hasn't signed yet. Save under `prospects/{slug}/` not `clients/{slug}/`.

## Workflow

Five passes, public data only. Run passes 1, 2, 3, 5 in parallel; pass 4 depends on 3.

### Pass 1 — Public Page Audit (Facebook + Instagram)

No API token required. Both endpoints below are public, but **the desktop URLs are blocked to unauthenticated scrapers** (Facebook returns HTTP 400, Instagram returns HTML with the data locked behind a JS shadow DOM). Use the mobile/JSON fallbacks below — these are what actually work in production.

**Facebook — use `m.facebook.com` with iOS Safari UA and an `en_US` locale cookie:**

```bash
curl -sL \
  -A "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1" \
  -H "Accept-Language: en-US,en;q=0.9" \
  -b "locale=en_US" \
  "https://m.facebook.com/<handle>?locale=en_US"
```

Without the locale cookie+param Facebook serves the page in whatever locale it geo-guesses (we've seen Urdu in the wild), which makes the regex extraction below brittle.

Extract from the response HTML:
- `og:description` → likes, "talking about this", "were here" counts (format: `"<Name>, <City>. 1,766 likes · 2 talking about this · 247 were here. <tagline>"`)
- `og:image` → profile picture present (true/false)
- `og:type` → `video.other` means latest content is video; `website` means static page
- `fb://profile/(\d+)` in the al:android:url meta → canonical numeric page ID (use this to retry Pass 2 if the vanity URL didn't resolve in the Ad Library)
- Verified badge: search for `verified` near the page name in the HTML body
- Public rating: parse for `\d\.\d\s*(out of|stars?|/5)` — often absent if owner has disabled reviews

Facebook desktop (`www.facebook.com/<handle>`) and `mbasic.facebook.com` both return HTTP 400 for our UA — skip them, they no longer work for unauth'd scraping. The Graph API `/v21.0/<page>` endpoint requires `Page Public Metadata Access` (code 10 OAuthException without it), so also not a fallback path.

**Instagram — use the public `web_profile_info` JSON endpoint, not the HTML page:**

```bash
curl -sL \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" \
  -H "X-IG-App-ID: 936619743392459" \
  "https://www.instagram.com/api/v1/users/web_profile_info/?username=<handle>"
```

The `X-IG-App-ID` header is required — without it the endpoint returns an empty response. The ID above is Instagram's public web app ID and is stable. From the returned JSON, pull from `data.user`:

- `biography`, `external_url`, `bio_links[].url`, `category_name`, `is_business_account`, `is_verified`
- `edge_followed_by.count` (followers), `edge_follow.count` (following), `edge_owner_to_timeline_media.count` (lifetime posts)
- `edge_owner_to_timeline_media.edges[].node.taken_at_timestamp` → recent post timestamps. Compute posts/week from `len(timestamps) / (span_days / 7)` and recency from `(now - max(timestamps))`. **Use the audit's current date, not a hardcoded epoch** — otherwise recency goes negative.

Save the merged result to `prospects/{slug}/page_audit.json`. If the FB fetch returns anything other than HTTP 200, save what you got with `"fetch_status": "blocked_<code>"` and mark the FB sub-tree `unverified` in the scorer — don't fabricate signals from absence.

### Pass 2 — Are-They-Running-Ads Check

Reuse `scripts/meta-ad-library/client.py` on the prospect's own page:

```bash
python scripts/meta-ad-library/client.py \
  --urls <prospect_fb_url> --country <country> --days 90 \
  --output prospects/{slug}/reports/raw_self_<ts>.json
```

Derive:
- Currently running ads? (yes/no/never)
- Active ad count + how long active
- Format mix
- Estimated spend tier (if any spend data)
- Tracker maturity proxy: are they running conversion-objective ads at all?

This is *the* signal that tells you advertiser maturity. Most prospects are in one of three buckets: **never run ads** (greenfield — easy win), **running ads but losing money** (you replace incumbent), **running ads competently** (harder sell, need clear gap pitch).

### Pass 3 — Competitor Outspend Scan

Reuse the `/research` engine on named competitors (or top 5 competitors by ad volume from the niche category sweep).

```bash
python scripts/meta-ad-library/client.py \
  --urls <comp1> <comp2> <comp3> --country <country> --days 90 \
  --output prospects/{slug}/reports/raw_competitors_<ts>.json
python scripts/meta-ad-library/analyzer.py --input <…>
python scripts/meta-ad-library/classifier.py --analyzed <…> --raw <…>
python scripts/meta-ad-library/report.py --input <…> --output prospects/{slug}/reports/competitors_<ts>.html
```

Derive the sales-pitch number: `outspend_ratio = max(competitor_monthly_spend) / max(prospect_monthly_spend, 1)`. This becomes the "they're outspending you NX:1" headline in the pre-audit report.

### Pass 4 — Niche Benchmark (Category Playbook)

If `data/niches/<niche>.json` exists, run the market sweep to surface category-wide hooks, CTAs, and formats:

```bash
python scripts/meta-ad-library/market.py --niche-config data/niches/<niche>.json \
  --output prospects/{slug}/reports/market_<ts>.html
```

If the niche file doesn't exist, skip silently and flag as a gap in the report ("no niche playbook on file yet — running blind on category benchmarks"). Don't block.

### Pass 5 — Website + Tracking Surface

curl the website, parse the HTML head + first 100KB of body:

- Meta Pixel installed? (look for `fbq(`, `fbevents.js`, or the data-domain check tag)
- Pixel ID extractable? (regex `fbq\(['"]init['"],\s*['"](\d+)['"]`)
- Google Tag / GTM present? Match ANY of:
  - Classic GTM container: `googletagmanager\.com/gtm\.js` OR `GTM-[A-Z0-9]{4,}` OR `googletagmanager\.com/ns\.html` (the noscript iframe)
  - Modern unified Google Tag loaded via gtag.js: `googletagmanager\.com/gtag/js\?id=(GT-[A-Z0-9]+)` — the `GT-` prefix is a Google Tag container (what the new Google Tag UI also surfaces as "Tag Manager"). Treat as `gtm: true` and capture the ID.
  - `gtag\(` + `dataLayer` together (gtag.js loader present) → record `google_tag_loader: true` even if no container ID was found.
- GA4 present? `gtag/js\?id=G-[A-Z0-9]+` or `gtag\(['"]config['"],\s*['"]G-`
- Conversion tracking surface (any of: gtag('event', 'purchase'), ttq.track, fbq('track', 'Purchase'))
- Mobile-responsive viewport meta tag
- Page load proxy: response size, count of external script tags

A missing pixel on a business that's running ads = the #1 sales angle. They are flying blind.

### Pass 6 — Score + Synthesis

Weighted 0–100 health score:

| Dimension | Weight | Source |
|---|---|---|
| Page completeness | 15% | Pass 1 |
| Posting consistency | 10% | Pass 1 (posts/week vs target 3) |
| Ad maturity | 20% | Pass 2 |
| Outspend gap (inverse) | 15% | Pass 3 (closer to competitors = higher score) |
| Pixel + tracking | 25% | Pass 5 |
| Niche playbook alignment | 15% | Pass 4 vs Pass 2 (using benchmark hooks/CTAs?) |

Compute:
- **Top 3 wins** — what they're doing right (gives the report credibility, not just a pitch)
- **Top 3 gaps** — highest-impact missing pieces
- **Top 3 opportunities** — concrete actions, ordered by impact-per-dollar

### Pass 7 — Render Branded HTML (standardized template)

Use the shared, templated renderer — **do not** write per-prospect Python scripts. Every pre-audit ships with the same Apple-style design system used across smOS reports.

```bash
python scripts/meta-ad-library/pre_audit_report.py \
  --page-audit prospects/{slug}/page_audit.json \
  --competitors prospects/{slug}/competitor_summary.json \
  --synthesis prospects/{slug}/synthesis.json \
  --business "<Business Name>" --slug {slug} \
  --output prospects/{slug}/pre_audit.html \
  [--niche-html prospects/{slug}/reports/market_<ts>.html]
```

The template is fixed (don't customize per-prospect) and renders these sections in order:

1. **Hero** — business name + Ducker Creative byline + outspend headline + page snapshot pills
2. **Score Hero** — 0–100 conic-gradient gauge + competitor outspend ratio block
3. **Score Breakdown** — six weighted dimensions with bars
4. **Wins & Gaps** — two-column card layout (green ticks / red X's)
5. **Competitor Outspend** — ranked 90-day table
6. **Tracking Surface** — Pixel / GTM / GA4 / conversion events / viewport
7. **Niche Playbook** — embedded link to `market_<ts>.html` (only if `--niche-html` passed)
8. **Three Opportunities** — numbered cards with title / impact / effort

If you need a section the template doesn't have, edit `scripts/meta-ad-library/pre_audit_report.py` so every future prospect gets it — never fork the design per-prospect.

### Pass 7b — Render PDF

Every report ships in HTML **and** PDF. Use the shared helper:

```bash
python scripts/render_pdf.py prospects/{slug}/pre_audit.html \
  --output prospects/{slug}/pre_audit.pdf
```

This uses headless Chromium (Playwright) so the Apple-style gradients, conic gauge, and table borders all render correctly. The template includes a `@media print` block that strips shadows and prevents card splits across pages.

First-time setup on a fresh machine:

```bash
pip install playwright && python -m playwright install chromium
```

### Pass 8 — Persist + Open

```bash
python scripts/meta-ad-library/persist.py prospect \
  --report prospects/{slug}/pre_audit.html \
  --slug {slug} --business "<name>" --score <int> \
  --summary '{"wins":[…],"gaps":[…],"opportunities":[…],"outspend_ratio":<float>}'
```

Open the HTML in browser. Print one-line summary: `Pre-audit complete · score {N}/100 · outspend ratio {X}:1 · prospects/{slug}/pre_audit.html`.

## Output

- `prospects/{slug}/page_audit.json`
- `prospects/{slug}/competitor_summary.json`
- `prospects/{slug}/synthesis.json`
- `prospects/{slug}/reports/raw_self_<ts>.json`
- `prospects/{slug}/reports/competitors_<ts>.html`
- `prospects/{slug}/reports/market_<ts>.html` (if niche file exists)
- `prospects/{slug}/pre_audit.html` — the sales artifact (interactive)
- `prospects/{slug}/pre_audit.pdf` — the sales artifact (shareable)
- Row in `prospect_audits` table

## Conversion Hand-off

When this prospect signs and you run `/intake {slug}`:
- Intake checks for `prospects/{slug}/page_audit.json` — hydrates `client_profile.json` defaults so you don't re-ask page URL, IG handle, website, niche, competitors
- Intake updates `prospect_audits.converted = true` and stamps `converted_at`
- The pre-audit report itself is copied to `clients/{slug}/baseline/pre_audit.html` so the "before" story stays attached to the client file forever

## Error Handling

- Meta Ad Library rate-limit (429) → backoff 30s, retry once, then proceed without the affected competitor
- Page URL returns 404 → halt and ask user to verify the URL
- Website fetch times out → continue, mark pixel/tracking section as `unverified` in the report
- No competitors named AND no niche file → ask user for at least 2 named competitors before continuing

## Token Efficiency

- Reuses the same `scripts/meta-ad-library/` engine as `/research` — no duplication
- LLM classifier (`classifier.py`) caches on disk → second run on same competitors is free
- No client API token needed → no permission setup before running, you can pitch a prospect within an hour of first contact
