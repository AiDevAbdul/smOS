# smOS Shared Documentation Map

> Verified against live official sources as of **2026-06-22**. The project pins **Meta Graph API v25.0** — confirmed current (latest version, released 2026-02-18; no newer version exists). All Meta URLs resolve on `developers.facebook.com`; Stripe on `docs.stripe.com`; Dropbox Sign on `developers.hellosign.com`; accessibility on `w3.org`. Per-skill `references/api-reference.md` files cite from this canonical map so URLs stay consistent.

## 1. Graph API — Root, Versioning & Changelog

| Resource | URL | Use For |
|---|---|---|
| Graph API docs root | https://developers.facebook.com/docs/graph-api/ | Top-level entry: nodes, edges, fields |
| Versions list | https://developers.facebook.com/docs/graph-api/changelog/versions/ | Confirm current version + lifecycle dates (v25.0 latest, released 2026-02-18) |
| Changelog (overview) | https://developers.facebook.com/docs/graph-api/changelog | Per-version breaking-change / deprecation notes |
| v25.0 changelog | https://developers.facebook.com/docs/graph-api/changelog/version25.0/ | Exactly what changed in the pinned version |
| Versioning guide | https://developers.facebook.com/docs/graph-api/guides/versioning/ | Lifecycle / 2-year window; how to pin a version in calls |

## 2. Marketing API — Campaign / AdSet / Ad Creation & Objectives

| Resource | URL | Use For |
|---|---|---|
| Marketing API root | https://developers.facebook.com/docs/marketing-api/ | Entry point for the ad-creation pipeline |
| Campaign node (Ad Campaign Group) | https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/ | Create campaign: `objective`, `special_ad_categories`, `bid_strategy`, `status` |
| Create campaign edge (act_/campaigns POST) | https://developers.facebook.com/docs/marketing-api/reference/ad-account/campaigns/ | POST edge for creating campaigns on an ad account |
| AdSet node | https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/ | Create adset (slug `ad-campaign` = "Ad Set"): `targeting`, `optimization_goal`, `billing_event`, `daily_budget`, `bid_strategy` (`LOWEST_COST_WITHOUT_CAP`) |
| Ad node | https://developers.facebook.com/docs/marketing-api/reference/adgroup/ | Create ad (slug `adgroup` = "Ad"): `creative`, `adset_id`, `status` |
| Campaign structure guide | https://developers.facebook.com/docs/marketing-api/campaign-structure/ | How campaign → adset → ad nest |
| Basic ad creation walkthrough | https://developers.facebook.com/docs/marketing-api/get-started/basic-ad-creation/create-an-ad-campaign/ | End-to-end PAUSED-default creation example |
| Outcome objectives (ODAX) reference | https://developers.facebook.com/blog/post/2023/02/13/outcome-driven-ad-experiences-update/ | The six `OUTCOME_*` enums: `OUTCOME_SALES`, `OUTCOME_LEADS`, `OUTCOME_TRAFFIC`, `OUTCOME_ENGAGEMENT`, `OUTCOME_AWARENESS`, `OUTCOME_APP_PROMOTION` |

> URL-slug gotcha: `reference/ad-campaign-group/` is the **Campaign**; `reference/ad-campaign/` is the **AdSet**; `reference/adgroup/` is the **Ad**.

## 3. Marketing API — Ad Rules (adrules_library)

| Resource | URL | Use For |
|---|---|---|
| Ad Account adrules_library | https://developers.facebook.com/docs/marketing-api/reference/ad-account/adrules_library/ | POST `act_<id>/adrules_library`: `name`, `evaluation_spec`, `execution_spec`, `status` |
| Ad Rule node | https://developers.facebook.com/docs/marketing-api/reference/ad-rule/ | Fields/operators of an individual rule object |
| Execution Spec | https://developers.facebook.com/docs/marketing-api/ad-rules/overview/execution-spec/ | `execution_type`: PAUSE, CHANGE_BUDGET, REBALANCE_BUDGET, NOTIFICATION… |
| Schedule-based rules | https://developers.facebook.com/docs/marketing-api/ad-rules/guides/scheduled-based-rules/ | `evaluation_type = SCHEDULE`; `schedule_type` enum: SEMI_HOURLY, HOURLY, DAILY |
| Advanced scheduling | https://developers.facebook.com/docs/marketing-api/ad-rules/guides/advanced-scheduling | Custom day/time evaluation windows |
| Ad Rules engine overview | https://developers.facebook.com/docs/marketing-api/ad-rules | Trigger-based vs schedule-based evaluation model |

## 4. Ad Library API (ads_archive)

| Resource | URL | Use For |
|---|---|---|
| Ads Archive (ads_archive) | https://developers.facebook.com/docs/graph-api/reference/ads_archive/ | Public ad-library search: `search_terms`, `ad_reached_countries`, `ad_type`, `ad_active_status`, `media_type`, `publisher_platforms`, `search_page_ids` (≤10), `search_type`, `ad_delivery_date_min/max`, `languages`, `bylines` |
| Archived Ad node | https://developers.facebook.com/docs/graph-api/reference/archived-ad/ | Returned fields: `ad_creative_bodies`, `ad_snapshot_url`, `page_id/name`, `impressions`, `spend`, `funding_entity`, demographic/region distribution |

## 5. Conversions API (CAPI) + Pixel/Dataset

| Resource | URL | Use For |
|---|---|---|
| CAPI overview | https://developers.facebook.com/docs/marketing-api/conversions-api/ | Server-side event sending; events link to a **Dataset ID** (formerly Pixel ID) |
| Using the API | https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api/ | Endpoint `POST /{API_VERSION}/{DATASET_ID}/events` |
| Server Event Parameters | https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event/ | `event_name`, `event_time`, `action_source`, `user_data`, `custom_data` |
| Main Body Parameters | https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/main-body/ | The `test_event_code` parameter for Events Manager Test Events |
| Dataset Quality API | https://developers.facebook.com/docs/marketing-api/conversions-api/dataset-quality-api/ | Event match quality scoring; confirms dataset terminology |

## 6. Product Catalog / Advantage+ Catalog (DPA)

| Resource | URL | Use For |
|---|---|---|
| Catalog reference (fields) | https://developers.facebook.com/docs/marketing-api/catalog/reference/ | Required feed fields (id, title, description, availability, condition, price, link, image_link, brand) |
| Catalog Fields (Commerce) | https://developers.facebook.com/docs/commerce-platform/catalog/fields/ | Detailed field defs + accepted enum values |
| Product Item node | https://developers.facebook.com/docs/marketing-api/reference/product-item/ | `availability` enum (`in stock`, `out of stock`, `available for order`, `preorder`, `discontinued`); `condition` enum (`new`, `refurbished`, `used`) |
| Catalog Batch API guide | https://developers.facebook.com/docs/marketing-api/catalog-batch | Bulk updates; many items per HTTP request |
| items_batch reference | https://developers.facebook.com/docs/marketing-api/reference/product-catalog/items_batch/ | Batch schema; **5,000 items per batch request** |

## 7. Lead Ads

| Resource | URL | Use For |
|---|---|---|
| Lead Ads guide | https://developers.facebook.com/docs/marketing-api/guides/lead-ads/ | End-to-end lead-ads flow |
| Retrieving Leads | https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/ | `GET /{leadgen_form_id}/leads`, `GET /{lead_id}`; **90-day retention** |
| Page leadgen_forms edge | https://developers.facebook.com/docs/graph-api/reference/page/leadgen_forms/ | `GET /{page_id}/leadgen_forms` — list forms on a Page |
| Lead Ads webhooks | https://developers.facebook.com/docs/marketing-api/guides/lead-ads/quickstart/webhooks-integration | Real-time `leadgen` webhook (preferred over polling) |

## 8. Domain Verification

| Resource | URL | Use For |
|---|---|---|
| Domain Verification overview | https://developers.facebook.com/docs/sharing/domain-verification/ | Verify owned domains (`owned_domains` in Business Manager) |
| Verifying Your Domain | https://developers.facebook.com/docs/sharing/domain-verification/verifying-your-domain/ | Three methods: DNS **TXT record**, **meta tag** in `<head>`, **HTML file** upload |
| Domain Verification FAQ | https://developers.facebook.com/docs/sharing/domain-verification/faq/ | Propagation, multi-business conflicts |

## 9. Instagram Platform — Publishing, Limits, Insights

| Resource | URL | Use For |
|---|---|---|
| Content Publishing guide | https://developers.facebook.com/docs/instagram-platform/content-publishing/ | Two-step flow: `POST /{ig-user-id}/media` then `POST /{ig-user-id}/media_publish`; 100 posts/24h limit |
| Create Media container | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/ | `/media` params (image/video/reels/carousel) |
| Publish Media | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media_publish/ | Publish a created container |
| Content Publishing Limit | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit/ | `GET /{ig-user-id}/content_publishing_limit` — read live quota before posting |
| Media Insights | https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ | Per-media metrics; documents `impressions`→`views` change |

## 10. Facebook Pages API

| Resource | URL | Use For |
|---|---|---|
| Pages API — Posts | https://developers.facebook.com/docs/pages-api/posts/ | Publish via `POST /{page-id}/feed` with a Page token |
| Page `/feed` edge | https://developers.facebook.com/docs/graph-api/reference/page/feed/ | Full `/feed` params (message, link, scheduled posts) |
| Pages API — Get Started | https://developers.facebook.com/docs/pages-api/getting-started/ | Obtain a Page token (`pages_manage_posts`, `pages_read_engagement`) |
| Page node | https://developers.facebook.com/docs/graph-api/reference/page/ | Page fields; retrieve `access_token` |

## 11. Error Codes, Rate Limiting & Error Handling

| Resource | URL | Use For |
|---|---|---|
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error-code table, recovery best practices, `fbtrace_id` |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | App/user/BUC limits; `X-App-Usage` / `X-Business-Use-Case-Usage` headers; codes 4 / 17 / 613 |
| Marketing API Rate Limiting | https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/ | Ad-account-specific limits and ads-management subcodes |

## 12. AI-Content Disclosure Policy

| Resource | URL | Use For |
|---|---|---|
| Meta AI Disclosures policy | https://transparency.meta.com/policies/other-policies/meta-AI-disclosures | Canonical policy: disclose/label AI-generated or AI-altered photorealistic content |
| Labeling AI-Generated Content (announcement) | https://about.fb.com/news/2024/04/metas-approach-to-labeling-ai-generated-content-and-manipulated-media/ | Effective dates; label-vs-remove approach (source for the smOS `ai-disclosure` guard) |

## 13. Stripe API (retainer billing)

| Resource | URL | Use For |
|---|---|---|
| API Reference (root) | https://docs.stripe.com/api | Top-level reference; shows the current pinned version |
| Versioning | https://docs.stripe.com/api/versioning | Pin via `Stripe-Version` header (current: `2026-05-27.dahlia`) |
| Invoices | https://docs.stripe.com/api/invoices | Create/finalize/send retainer invoices |
| Customers | https://docs.stripe.com/api/customers | Create client as Customer; attach payment method |
| Subscriptions | https://docs.stripe.com/api/subscriptions | Recurring monthly retainer billing |
| Idempotent requests | https://docs.stripe.com/api/idempotent_requests | `Idempotency-Key` on retries so invoices never double-bill |

## 14. Dropbox Sign API (formerly HelloSign, v3)

| Resource | URL | Use For |
|---|---|---|
| Signature Request docs (parent) | https://developers.hellosign.com/api/signature-request | All signature-request endpoints (send, list, get, status) |
| Developer docs home | https://developers.hellosign.com/ | Auth, base host `api.hellosign.com`, test_mode |
| Send Signature Request (REST endpoint) | https://api.hellosign.com/v3/signature_request/send | POST endpoint to fire a service-agreement e-sign request |

## 15. IG/FB Profile, Cover & Story Spec Dimensions

| Resource | URL | Use For |
|---|---|---|
| Meta Ads Guide (image/video specs) | https://www.facebook.com/business/ads-guide | Official placement-by-placement creative specs |
| Meta Business Help Center | https://www.facebook.com/business/help | Authoritative fallback for Page profile/cover guidance |

Verified recommended sizes: FB profile 170×170 (upload ≥360×360, 1:1) · FB cover 851×315 desktop · IG profile 320×320 (1:1) · IG Stories/Reels **1080×1920 (9:16)** · IG feed square 1080×1080, portrait 1080×1350, landscape 1080×566.

## 16. WCAG 2.x AA Contrast

| Resource | URL | Use For |
|---|---|---|
| Understanding SC 1.4.3 Contrast (Minimum) | https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html | Canonical 4.5:1 (normal) / 3:1 (large) AA contrast rule for brand-color & deliverable checks |

---

## Version notes (verified facts)

- **Graph API v25.0 is current** — latest version, released **2026-02-18**, no newer version exists and no deprecation scheduled. The project's pin is correct.
- **Marketing API objectives**: legacy objectives were consolidated into the six `OUTCOME_*` enums; legacy-objective campaign *creation* was deprecated in Marketing API **v17.0** (existing campaigns unaffected).
- **Ad Rules `schedule_type`**: SEMI_HOURLY / HOURLY / DAILY confirmed across the schedule-based-rules and execution-spec guides (no single enum page exists).
- **Pixel → Dataset rename**: Pixel ID and Dataset ID are the same identifier; CAPI events POST to `/{DATASET_ID}/events`. `test_event_code` is a main-body parameter.
- **Catalog batch limit**: 5,000 items per batch request. `availability` and `condition` enums verified above.
- **Lead retention**: 90 days via API/Ads Manager/Business Suite; webhooks recommended to avoid expiry + rate limits.
- **IG `impressions` → `views`**: for media created on/after **2024-07-02**, `impressions` requests after **2025-04-21** error out; use `views`. Applies through v25.0.
- **IG publish limit**: guide states 100 API-published posts per rolling 24h (carousel = 1 post); the `content_publishing_limit` reference shows a conservative default — read the live `quota_total` per account rather than hardcoding.
- **Rate-limit error codes**: code 4 (app-level), code 17 (user-level, `API_EC_USER_TOO_MANY_CALLS`), code 613 (custom limit). Note: "code 17 subcode 613" is not a distinct documented pairing — 613 is its own top-level code; cite the rate-limiting page.
- **Meta AI disclosure**: "Made with AI"/"AI info" labeling began **May 2024**; July 2024 Meta shifted from removing manipulated media to labeling. Advertisers must self-disclose photorealistic AI imagery/video.
- **Stripe API version**: current pinned string is **`2026-05-27.dahlia`** (set via `Stripe-Version` header).
- **Dropbox Sign**: docs remain on **`developers.hellosign.com`**; REST base host **`https://api.hellosign.com/v3`** (API **v3**).
- **WCAG AA contrast**: 4.5:1 normal text, 3:1 large text (≥18pt, or ≥14pt bold); thresholds are exact — do not round.
