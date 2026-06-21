# smOS — Agency OS Roadmap & Gap-Check

_Living document. Last updated 2026-06-22. Direction chosen: **Full Agency OS** — smOS should run the whole agency, not just the marketing execution._

This is the master gap-check: what a complete 2026 agency-grade social platform includes, what smOS already has, and the prioritized path to "zero to hero." Grounded in a current-state code audit + competitive research across Sprout, Hootsuite, Later, Metricool, AgencyAnalytics, Brandwatch, GoHighLevel, Vendasta, HoneyBook, and the AI-native cohort.

Status legend: ✅ built · 🟡 partial / contract-only · ⬜ gap
Tier legend: **TS** table-stakes · **DIFF** differentiator · **EDGE** cutting-edge (2026)

---

## Where smOS stands

smOS is **not behind on sophistication — it's narrow on coverage.** It's a deep Meta performance-marketing engine that already does what most "competitors" can't (real paid execution, not just deferring to Meta's native manager). 28/32 skills are fully built; 2 are stubs (`/pre-audit` Python-only, `/creative-agent`). It is **Meta-only** and has **no commercial back-office** — which is exactly the chosen build direction.

### Where smOS already beats the market
- **Real paid execution** — campaign/adset/ad creation, automated optimizer rules, CAPI setup, attribution, audience mapping. The SMM category is overwhelmingly organic-first; few do this.
- **L2 agentic architecture, default-PAUSED + hard guardrails** — the 2026 best-practice design; Meta's own Ads CLI (Apr 2026) mirrors it.
- **Decision logging with reasoning** (`optimizer_log`) — agent observability incumbents are racing to add.
- **Fail-closed AI-content disclosure** — ahead of Meta's Mar 2026 policy.
- **Phase 0 zero-start** — brand identity build + account/web bootstrap with 3 fail-closed human gates. Rare end-to-end.

---

## Gap-check by domain

### 1 · Publishing & Scheduling
| Feature | Tier | smOS |
|---|---|---|
| Multi-platform publishing (10–12 networks) | TS | ⬜ Meta-only |
| Visual content calendar | TS | 🟡 `/content-plan` builds a calendar; no visual grid UI |
| Queues / bulk scheduling / first-comment | TS | 🟡 `/publish` runs a calendar; no queues/bulk UI |
| Best-time-to-post AI | TS→DIFF | ⬜ |
| Approval workflows / no-login client sign-off | TS→DIFF | 🟡 Discord approvals; no client-facing review |
| Cross-platform atomization (1 asset → many native formats) | EDGE | ⬜ |
| Per-client trained brand-voice writer | EDGE | 🟡 `/creative` is voice-aware; not a trained model |

### 2 · Engagement / Inbox
| Feature | Tier | smOS |
|---|---|---|
| Unified inbox (comments+DMs+mentions) | TS | 🟡 `/inbox` live Graph pulls, Meta-only |
| Saved replies / team assignment / collision | TS | ⬜ |
| AI reply drafting (context+voice+history) | DIFF→TS | ⬜ |
| Guardrailed auto-moderation (hide/route/reply) | DIFF | ⬜ |
| SLA tracking | DIFF | ⬜ |

### 3 · Listening & Monitoring
| Feature | Tier | smOS |
|---|---|---|
| Brand/keyword/competitor monitoring | TS | 🟡 `/listening` live, Meta-scoped |
| Sentiment / share-of-voice | TS | 🟡 partial |
| Multimodal (logo/image/audio) detection | DIFF | ⬜ |
| Predictive crisis/spike → protocol | EDGE | 🟡 spend-spike anomaly exists (paid) |

### 4 · Analytics & Reporting
| Feature | Tier | smOS |
|---|---|---|
| Automated reports (HTML+PDF, scheduled) | TS | ✅ reporter agent + render_pdf |
| Cross-platform analytics | TS | ⬜ Meta-only |
| White-label reports | DIFF | 🟡 `/portal` read-only |
| ROI / multi-touch attribution | DIFF | 🟡 `/attribution` |
| GA4 / Looker connectors | DIFF | ⬜ |
| AI narrative insights / anomaly detection | EDGE | ✅ significance gates + Opportunity Score |

### 5 · Paid Ads Management
| Feature | Tier | smOS |
|---|---|---|
| In-tool campaign creation | DIFF (rare) | ✅ `/launch` |
| Automated rules (auto-pause/scale) | DIFF (rare) | ✅ `/scale` + optimizer agent |
| CAPI / conversions | DIFF | ✅ `/capi-setup` |
| Attribution / incrementality | DIFF | 🟡 `/attribution` |
| Cross-network ads | DIFF | ⬜ Meta-only |

### 6 · Content Creation
| Feature | Tier | smOS |
|---|---|---|
| AI copywriting / hashtags | TS | ✅ `/creative` |
| Asset library / DAM | DIFF | 🟡 `/assets` |
| AI image generation + upload | TS→DIFF | ✅ image/video upload shipping real assets |
| AI video generation | EDGE | ⬜ |
| Brand-locked generative (lock logo/colors) | EDGE | 🟡 brand_profile carries the kit; not wired to a generator |
| Canva integration | TS | ⬜ |

### 7 · Influencer / UGC / Advocacy
| Feature | Tier | smOS |
|---|---|---|
| Discovery + fraud detection | DIFF | ⬜ |
| Campaign mgmt + briefs | TS | ⬜ |
| Payments / escrow / affiliate | DIFF (moat) | ⬜ |
| UGC rights / licensing | DIFF | ⬜ |
| Creator CRM | DIFF | ⬜ |

_Entire untouched domain (~$32B market)._

### 8 · AI / Automation
| Feature | Tier | smOS |
|---|---|---|
| L2 autonomous-with-guardrails | EDGE (frontier) | ✅ core architecture |
| Autonomous paid optimization | DIFF→EDGE | ✅ optimizer agent |
| Agent observability / explainable logs | EDGE | ✅ `optimizer_log` with reasoning |
| Predictive performance/virality forecasting | DIFF | ⬜ |
| Action-capable MCP server (expose smOS) | EDGE (few have) | ⬜ |

### 9 · Agency Operations ← **CHOSEN PRIORITY**
| Feature | Tier | smOS |
|---|---|---|
| Client CRM / pipeline | TS (all-in-ones) | ⬜ |
| Proposals / pitch decks (AI-gen) | TS→DIFF | ⬜ |
| Contracts / e-sign | TS | ⬜ |
| Billing / invoicing (retainers) | TS | ⬜ |
| White-label client portal | DIFF | 🟡 `/portal` read-only |
| No-login client approval portal | DIFF | ⬜ |
| Roles / permissions | TS | ⬜ |
| Time tracking | DIFF (common gap) | ⬜ |
| Capacity / resource planning | DIFF (biggest gap) | ⬜ |
| Lead nurturing (email/SMS) | TS (all-in-ones) | 🟡 leads export CSV only |

_The clearest white space in the entire market: the SMM suites have **zero** commercial back-office; the all-in-ones (GoHighLevel, Vendasta, HoneyBook) own it but treat social as a thin module. smOS can own both._

### 10 · Integrations
| Feature | Tier | smOS |
|---|---|---|
| GA4 (non-negotiable) | TS | ⬜ |
| Slack / Teams | TS | ⬜ Discord-only |
| CRM (HubSpot/Salesforce) | TS (enterprise) | ⬜ |
| Shopify / commerce | TS | 🟡 MCP available, not wired into pipeline |
| Bitly / UTM / link tracking | TS | 🟡 UTM enforced by guard |
| Canva | TS | ⬜ |
| Looker Studio | DIFF | ⬜ |
| Zapier/Make/webhooks/public API | TS→DIFF | ⬜ |
| Action-capable MCP server | EDGE | ⬜ |

---

## Direction: Full Agency OS

The chosen north star is for smOS to run the **whole agency** — acquisition → contracting → execution → reporting → billing — not just marketing execution. That makes **Domain 9 (Agency Operations)** the near-term priority, layered on top of the existing execution engine.

### The commercial back-office to build
A new **Agency Ops layer** (sibling to the marketing skills), reusing existing infra (Supabase persistence, render_pdf HTML+PDF, the guard/approval pattern, per-client profiles):

1. **Client CRM / pipeline** — `clients` table already exists; extend to a lead→prospect→client pipeline with status, contacts, retainer terms. Feeds `/pre-audit` (acquisition) on the front and reporting on the back.
2. **Proposals (`/proposal`)** — AI-generated pitch deck from `/pre-audit` findings + a service/pricing catalog → HTML+PDF (reuse render_pdf). HoneyBook-style; biggest acquisition lever.
3. **Contracts + e-sign (`/contract`)** — generate scope/retainer agreement from the accepted proposal; integrate an e-sign provider (DocuSign/Dropbox Sign API).
4. **Billing / invoicing (`/billing`)** — recurring retainer invoices + ad-spend pass-through; Stripe API. Pairs with the CRM retainer terms.
5. **Client portal upgrade** — turn `/portal` from a read-only report page into a real white-label client portal: live dashboards, **no-login approval** of content/strategy, invoice view, asset downloads.
6. **Internal ops** — time tracking + capacity planning (the two near-universal market gaps) so the agency can see margin per client.

### Cheap, high-differentiation moats to fold in alongside
- **Expose smOS as an action-capable MCP server** — you're already an agent over the APIs; few competitors have this.
- **AI brand/compliance approval guardrails** — nobody in the market has it; the guard chokepoint is already the architecture.
- **GEO / AI-visibility audit** in `/pre-audit` — does the prospect appear in ChatGPT/Gemini/Perplexity answers? A fresh acquisition hook.

---

## Phased roadmap

**Phase 5 — Agency Ops foundation (chosen priority) — ✅ COMPLETE**
1. ✅ CRM/pipeline (`schemas/deal.js` + `/crm`, state machine + forecast)
2. ✅ `/proposal` (catalog-driven AI deck → HTML+PDF, advances deal to proposed)
3. ✅ `/pre-audit` Node wrapper (orchestrates the Python pipeline → HTML+PDF + CRM advance)
4. ✅ `/contract` + e-sign (Dropbox Sign, fail-closed to manual; won transition)
5. ✅ `/billing` (Stripe, fail-closed; retainer + setup + ad-spend, per-period idempotent ledger)
6. ✅ `/portal` upgrade (plan + invoice ledger + no-login mailto approvals)

_Lifecycle now runs end-to-end: `/pre-audit → /proposal → /contract → won → /intake → /billing`, all surfaced in `/portal`. Live Stripe/Dropbox-Sign sends are best-effort (no keys in env yet) and fail-closed to manual. 204 tests._

**Phase 6 — Connectors & moats (parallel, low effort)**
- GA4 + Slack/Teams connectors (Slack alongside Discord)
- Expose smOS as an MCP server
- AI brand/compliance approval guard
- GEO/AI-visibility audit in `/pre-audit`

**Phase 7 — Multi-platform (when breadth is needed)**
- Publish-once abstraction (base post + per-platform overrides + adapters; partial-failure first-class)
- Threads first (reuses Meta infra; ads = a placement flag in `/launch`)
- Then TikTok (organic+paid; plan the publishing-app audit), then Google Ads (MCC + dev token)

**Phase 8 — Organic depth & new domains (optional)**
- Visual calendar UI, per-client trained voice, AI inbox replies + auto-moderation, multimodal listening
- Influencer/UGC domain (discovery → rights → payments → attribution)

---

## Multi-platform feasibility (reference for Phase 7)
| Channel | Add priority | Organic API | Paid API | Main gate |
|---|---|---|---|---|
| Threads | 1st (cheapest) | publish + replies + insights | placement in Meta Marketing API | standard app review |
| TikTok | 2nd (demand) | publish + analytics; **no comment/DM API** | full Marketing API | publish-app audit (else SELF_ONLY) |
| Google Ads | 3rd (paid duopoly) | n/a | Search/PMax/Display/YouTube | MCC + dev token (backlogged 2026) |
| LinkedIn | B2B books | pages + comments + analytics; **no DMs** | full ads API | brutal partner approval |
| WhatsApp | conversational/non-US | template + session msgs | n/a | template approval + per-msg pricing |
| Pinterest | relevant verticals | pins + analytics | full + CAPI | Trial→Standard sandbox gate |
| X | situational | metered pay-per-use + 2M read cap | **ads API free** | cost modeling |

_Realistically end-to-end automatable: Meta, Threads, Google Ads, Pinterest, Snapchat/Reddit Ads, GBP. Gated/metered: TikTok, X, WhatsApp, YouTube. Not automatable: LinkedIn DMs, organic Snapchat, TikTok comments/DMs, YouTube Community posts._
