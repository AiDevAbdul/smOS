# pre-audit — Public-Data Scrape & API Reference

Exact recipes for the public surfaces this skill reads. All are **unauthenticated** — no
client Meta token. Self-contained: every endpoint, header, version, and failure mode is
here. URLs cited from `skills/references-shared.md` (verified 2026-06-22, Meta Graph API
**v25.0**).

> **These recipes are implemented as code**, not run by hand. `scripts/meta-ad-library/collectors.py`
> holds the FB/IG/website scrapers (each pass returns a dict with an explicit `status`);
> `collect.py` orchestrates all four passes into `data/raw/*.json`; `normalize.py` flattens
> them into `data/signals.csv`; `build.py` derives the render JSONs + score. The wrapper
> `pre-audit.js --collect` runs the chain. The recipes below document *what the code does*
> — edit `collectors.py` if a surface's markup changes, not a per-prospect script.

## Pass 1 — Facebook Page (public, no token)

Desktop `www.facebook.com/<handle>` and `mbasic.facebook.com` both return **HTTP 400** to
unauthenticated scrapers and are dead paths. The Graph API `/<page>` requires *Page Public
Metadata Access* (returns `OAuthException` **code 10** without it) — also not a fallback.
Use `m.facebook.com` with an iOS Safari UA and an `en_US` locale cookie:

```bash
curl -sL \
  -A "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1" \
  -H "Accept-Language: en-US,en;q=0.9" \
  -b "locale=en_US" \
  "https://m.facebook.com/<handle>?locale=en_US"
```

Without the `locale=en_US` cookie+param, Facebook serves a geo-guessed locale (Urdu seen in
the wild), breaking the regex extraction. Extract from the HTML:

| Signal | Where | Notes |
|---|---|---|
| Likes / "talking about this" / "were here" | `og:description` | Format: `"<Name>, <City>. 1,766 likes · 2 talking about this · 247 were here. <tagline>"` |
| Profile picture present | `og:image` | true/false |
| Latest content type | `og:type` | `video.other` = video; `website` = static |
| Canonical numeric page ID | `fb://profile/(\d+)` in `al:android:url` meta | Use to retry Ad Library if the vanity URL didn't resolve |
| Verified badge | `verified` token near page name in body | |
| Public rating | `\d\.\d\s*(out of|stars?|/5)` | Often absent if reviews disabled |

If status ≠ 200: save raw with `fetch_status: "blocked_<code>"` and mark the FB sub-tree
`unverified`. Never infer signals from absence.

## Pass 1 — Instagram (public JSON, no token)

Use the `web_profile_info` JSON endpoint, **not** the HTML page (data is locked behind a JS
shadow DOM). The `X-IG-App-ID` header is required — without it the endpoint returns empty.
`936619743392459` is Instagram's stable public web app ID.

```bash
curl -sL \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" \
  -H "X-IG-App-ID: 936619743392459" \
  "https://www.instagram.com/api/v1/users/web_profile_info/?username=<handle>"
```

From `data.user`:

- `biography`, `external_url`, `bio_links[].url`, `category_name`, `is_business_account`, `is_verified`
- `edge_followed_by.count` (followers), `edge_follow.count` (following), `edge_owner_to_timeline_media.count` (lifetime posts)
- `edge_owner_to_timeline_media.edges[].node.taken_at_timestamp` → recent post epochs → posts/week and recency (use the audit date, see `domain-standards.md`).

A 429 here means rate-limited — back off and retry once, otherwise mark IG `unverified`.

## Pass 2 & 3 — Meta Ad Library (`ads_archive`)

Reuse `scripts/meta-ad-library/client.py` (the same engine `/research` uses). It queries the
public **Ad Library API** — `https://graph.facebook.com/v25.0/ads_archive`.

```bash
# self-check
python scripts/meta-ad-library/client.py --urls <prospect_fb_url> --country <country> --days 90 \
  --output prospects/{slug}/reports/raw_self_<ts>.json
# competitors
python scripts/meta-ad-library/client.py --urls <comp1> <comp2> <comp3> --country <country> --days 90 \
  --output prospects/{slug}/reports/raw_competitors_<ts>.json
python scripts/meta-ad-library/analyzer.py   --input    <raw_competitors>
python scripts/meta-ad-library/classifier.py --analyzed <analyzed> --raw <raw_competitors>
python scripts/meta-ad-library/report.py     --input    <classified> --output prospects/{slug}/reports/competitors_<ts>.html
```

Key `ads_archive` request fields: `search_terms` / `search_page_ids` (≤10), `ad_reached_countries`,
`ad_active_status`, `ad_type`, `media_type`, `publisher_platforms`, `ad_delivery_date_min/max`.
Returned per-ad (`archived-ad` node): `ad_creative_bodies`, `ad_snapshot_url`, `page_id/name`,
`impressions`, `spend`, `funding_entity`, region/demographic distribution.

**Rate limits / errors** (Graph API rate-limiting page): code **4** app-level, code **17**
user-level, code **613** custom limit; HTTP **429** = throttled. `client.py` handles all
three — 429 AND 400 with error code 4/17/613 — with exponential backoff (30s × 2^retry,
up to 3 retries) before giving up on that term. Log full error (code/type/`fbtrace_id`).

**Creative-matrix scoring (competitors).** After the competitor ad pull, `collect.py` calls
`classifier.score_creative_matrix(name, ads, cache_dir, stats)` (in `classifier.py`) when
`ANTHROPIC_API_KEY` is set. It sends the ad bodies + CTAs + format mix + longevity stats to
Claude and gets back the five 0–10 dimensions (`hook_strength`, `visual_strategy`,
`cta_match`, `psychological_trigger`, `run_duration_score`) the report table renders. Scores
are **content-addressed cached** (`.cache/meta-ad-library/matrix_<hash>.json`) so identical
ad copy always returns identical scores — the pipeline stays reproducible. No key ⇒ skipped
(fail-soft), report shows "—". This is the ONLY LLM/non-deterministic step, and it is
confined to the collect stage; `normalize.py`/`build.py` remain pure functions of the CSV.

## Pass 4 — Niche playbook (optional)

`market.py` reads category definitions from `data/niches/<niche>.json` (via
`load_niche_categories()`). Each category carries `search_terms` (2 seed terms) and
`synonym_terms` (10–12 curated synonyms). Use `--niche` to name the strategy playbook
(matches `scripts/meta-ad-library/niches/<niche>.json`) and `--fetch` to pull live data:

```bash
# Render from pre-fetched category JSONs in reports/ (fast, no API calls)
python scripts/meta-ad-library/market.py --niche automotive \
  --output prospects/{slug}/reports/market_<ts>.html

# Fetch + render (requires META_ACCESS_TOKEN, uses semantic term expansion)
python scripts/meta-ad-library/market.py --niche automotive --fetch \
  --country <country> --days 90 \
  --output prospects/{slug}/reports/market_<ts>.html
```

Category data files (`reports/cat_*.json`) are written by `--fetch` and read by analysis.
The `--no-llm` flag skips LLM term expansion (seed + synonyms only, still 12–14 terms/cat).

If `data/niches/<niche>.json` is absent, **skip silently** and flag as a gap ("no niche
playbook on file"). Never block. Pass the resulting HTML to the wrapper via `--niche-html`.

## Pass 5 — Website tracking surface

`curl` the homepage; parse `<head>` + first ~100KB of body. Detection regexes:

| Signal | Match |
|---|---|
| Meta Pixel installed | `fbq\(` OR `fbevents\.js` OR data-domain check tag |
| Pixel ID | `fbq\(['"]init['"],\s*['"](\d+)['"]` |
| GTM (classic) | `googletagmanager\.com/gtm\.js` OR `GTM-[A-Z0-9]{4,}` OR `googletagmanager\.com/ns\.html` |
| Google Tag (modern) | `googletagmanager\.com/gtag/js\?id=(GT-[A-Z0-9]+)` → treat as `gtm: true`, capture ID |
| gtag loader present | `gtag\(` + `dataLayer` together → `google_tag_loader: true` |
| GA4 | `gtag/js\?id=G-[A-Z0-9]+` OR `gtag\(['"]config['"],\s*['"]G-` |
| Conversion event | `gtag\('event','purchase'\)` OR `ttq\.track` OR `fbq\('track','Purchase'\)` |
| Responsive | `<meta name="viewport"` |
| Load proxy | response byte size + count of external `<script>` tags |

On timeout/non-200: continue, mark the tracking section `unverified` in the report.

## Tavily fallback (soft-block recovery)

The FB (`m.facebook.com`) and IG (`web_profile_info`) passes soft-block
unpredictably. When a **primary** pass returns non-`ok`, the collector re-fetches
the *same public page* through Tavily's REST API (`scripts/meta-ad-library/tavily.py`:
`extract` → `search`) and re-parses it (`parse_facebook_text` / `parse_instagram_text`).

- **Key-gated** on `TAVILY_API_KEY` (resolved via `load_env`, i.e. `~/.config/smos/.env`
  then repo `.env`). No key ⇒ fallback is a no-op and the pass stays honestly blocked.
- On success the pass returns `status: "ok"` plus provenance fields `collected_via:"tavily"`
  and `primary_status:"<the block>"` (both flow into `signals.csv`). Data flows and the
  data-quality gate stays confident — the signal *was* recovered, just from a sanctioned
  source.
- **Partial by design:** Tavily recovers counts (likes / talking-about; followers /
  following / posts) and IG bio when present; per-post timestamps are unavailable, so IG
  `posts_per_week` / `recency_days` stay `null` — never fabricated.
- Website pass has **no** Tavily fallback (tracking pixels live in `<script>` tags that
  content-extraction strips; the prospect's own site is also the least-blocked surface).

**Scraper-health canary** — `scripts/meta-ad-library/scraper_health.py` probes the primary
collectors against stable public targets (default NASA) and reports per-pass whether the
*primary* path still parses (vs. Tavily saving it). Exit `0` healthy · `1` a primary FB/IG
path rotted (fallback covering) · `2` a pass returned no data at all. Run weekly via cron to
catch silent scraper rot before a prospect run does.

## Render & PDF (no external API)

`scripts/meta-ad-library/pre_audit_report.py` (standardized template) → HTML;
`scripts/render_pdf.py` (headless Chromium via Playwright) → PDF. The wrapper invokes both.
First-time: `pip install playwright && python -m playwright install chromium`.

**Last verified:** 2026-07-15 (added Tavily fallback + scraper-health canary)
