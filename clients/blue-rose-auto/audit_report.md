# /audit — Blue Rose Auto (Public-Side Only)

**Date:** 2026-06-18
**Mode:** Planning — no Meta API access yet. Paid-side and live-page-insights sections are deferred.

---

## Sources used

- https://blueroseauto.com/ (public web)
- https://www.facebook.com/BlueRoseAuto (Meta-gated, only the title was readable)
- https://www.instagram.com/blueroseauto/ (Meta-gated, content not readable without API)

---

## Website (blueroseauto.com)

| Check | Result |
|---|---|
| Domain reachable | ✓ |
| Service catalog visible | ✓ — mechanical, collision, detailing, ceramic, PPF, tint, wraps, upfitting |
| USP visible above the fold | ✓ — "30+ years", ASE-certified, Tesla-capable |
| Primary CTAs present | ✓ — "Book Now" + "Get a Quote" |
| Phone number visible | ✓ — (541) 641-8877 |
| Email visible | ✓ — contact@blueroseauto.com |
| Physical address visible | ✓ — 3436 Olympic St, Springfield, OR 97478 |
| Service area listed | ✓ — Eugene + 9 satellite towns |
| Meta Pixel detected on landing page | ⚠ Could not verify without inspecting page source / network requests |
| Conversions API endpoint configured | ⚠ Unknown — needs Pixel ID + access to Events Manager |
| SSL certificate | ✓ — HTTPS |
| Mobile responsive | Not measured (need rendering tool) |
| Page load speed | Not measured (need Lighthouse via chrome-devtools MCP) |

**Site completeness score: 8/10** — strong fundamentals; the two unknowns (Pixel + perf) drop it from 10.

---

## Facebook Page (BlueRoseAuto)

Cannot extract — Meta blocks public scraping of structured page data. Once `META_ACCESS_TOKEN` + `facebook_page_id` are provided, `/audit` rerun will pull:
- Follower count, likes, page rating, response rate
- About / services / hours completeness
- Last 30 days post cadence, engagement rate by post type
- Verified-page status
- Page categories alignment with auto repair / collision / detailing

**Placeholder completeness: pending API.**

---

## Instagram Business (@blueroseauto)

Same gating — needs `instagram_business_id`. Once provided, `/audit` will pull:
- Follower / following / post count
- Bio + link-in-bio quality
- Reach + impressions trend (30d)
- Best-performing post format (Reel / carousel / single image)
- Story cadence

**Placeholder completeness: pending API.**

---

## Ad Account

Cannot audit — no `ad_account_id` provided. New to paid Meta per intake.

When live, the paid audit will check:
- Pixel firing rate + event coverage (PageView, ViewContent, Lead, Schedule, Purchase)
- Conversions API status
- Custom audiences in place (pixel-30d, pixel-60d, IG engagers 365d, FB engagers 365d, customer list)
- Existing campaigns (none expected — net-new account)

---

## Baseline snapshot

A baseline snapshot for `/before-after` will be locked the moment Meta access is granted. For now an interim public-only snapshot has been saved:

`clients/blue-rose-auto/baseline_snapshot.json` (interim, marked as `meta_metrics_pending`)

---

## Top 5 quick wins (orderable independently of paid launch)

1. **Verify Meta Pixel** is installed on `blueroseauto.com` and that `Lead` + `Schedule` events fire from form submit and Book Now click handlers — required before any LEADS campaign launches (pixel-check hook will block otherwise).
2. **Conversions API** wired alongside the pixel — Springfield/Eugene Apple/iOS share is meaningful for auto buyers; CAPI recovers ~30% attribution lost to ITP.
3. **Page categories review** — confirm FB page lists "Auto Repair", "Detailing", "Collision Repair" as primary categories; mismatched primary category dampens local discoverability.
4. **Instagram bio rework** — single best-converting CTA link (Linktree or direct `/get-a-quote`); current bio not visible to confirm.
5. **Lookalike seed prep** — export last 12 months of customer phone+email to a CSV; this becomes the seed for LAL 1%/3%/5% audiences in the audience map.

---

## Sections deferred to live audit

- Paid account structure tree
- Pixel event coverage & firing health
- Custom audience inventory
- Page insights (followers, reach, engagement)
- Instagram insights
- Naming convention drift across existing entities (none expected — net-new account)

Re-run `/audit blue-rose-auto` once `ad_account_id`, `facebook_page_id`, `instagram_business_id`, and `pixel_id` are filled in `client_profile.json`.
