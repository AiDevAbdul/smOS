// ui/lib/skill-routes.ts — mirrors CLAUDE.md's "## Workflow Routing" table
// (plus the two external/not-bundled tables) for the command palette.
//
// This is a plain data file: no logic, no imports. Keep it in sync with
// CLAUDE.md by hand whenever the routing table changes — the palette is a
// convenience UI over that table, not a second source of truth.

export interface SkillRoute {
  /** The slash command or bare skill name, exactly as CLAUDE.md writes it. */
  command: string;
  /** Human-readable description of the user intent this routes. */
  label: string;
  /** false for the two "external skills NOT bundled with smOS" tables. */
  available: boolean;
  /** Shown inline when available is false. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Main Workflow Routing table (all installed / bundled with smOS).
// ---------------------------------------------------------------------------
export const SKILL_ROUTES: SkillRoute[] = [
  { command: "/pre-audit", label: "Pre-sale prospect audit (no client API access)", available: true },
  { command: "/crm", label: "Agency sales/client pipeline (CRM)", available: true },
  { command: "/smos-status", label: "Client status — what's done, what's remaining", available: true },
  { command: "/proposal", label: "Generate a client proposal / pitch", available: true },
  { command: "/contract", label: "Generate service agreement + e-sign", available: true },
  { command: "/billing", label: "Issue retainer invoices (Stripe)", available: true },
  { command: "/intake", label: "New client onboarding", available: true },
  { command: "/brand-strategy", label: "Zero-start — brand strategy + positioning", available: true },
  { command: "/brand-name", label: "Zero-start — name + verbal identity (3-gate screen)", available: true },
  { command: "/brand-visual", label: "Zero-start — visual identity (logo/color/type)", available: true },
  { command: "/brand-book", label: "Zero-start — brand guidelines (HTML+PDF)", available: true },
  { command: "/brand-social", label: "Zero-start — social profile assets + bios", available: true },
  { command: "/setup-accounts", label: "Zero-start — Meta account bootstrap (Page/IG/ad acct/pixel)", available: true },
  { command: "/setup-web", label: "Zero-start — domain + landing + domain verification", available: true },
  { command: "/audit", label: "Account + page audit", available: true },
  { command: "/audit-creative", label: "Creative quality review", available: true },
  { command: "/research", label: "Competitor research", available: true },
  { command: "/audience-map", label: "Audience targeting plan", available: true },
  { command: "/strategy-brief", label: "Campaign strategy", available: true },
  { command: "/creative", label: "Write ad copy", available: true },
  { command: "/image-gen", label: "Generate branded poster imagery (organic + paid, logo/contact/handles composited in)", available: true },
  { command: "/creative-test", label: "Design or evaluate a structured creative test (hook/concept/format)", available: true },
  { command: "/launch", label: "Launch a campaign", available: true },
  { command: "/analyze", label: "Check performance", available: true },
  { command: "/scale", label: "Scale winners / kill losers", available: true },
  { command: "/report", label: "Weekly client report", available: true },
  { command: "/before-after", label: "Show before/after", available: true },
  { command: "/monthly-review", label: "Full monthly review", available: true },
  { command: "/publish", label: "Publish / run content calendar", available: true },
  { command: "/capi-setup", label: "Conversions API (CAPI) setup", available: true },
  { command: "/catalog", label: "Product catalog / DPA setup", available: true },
  { command: "/leads", label: "Lead forms + lead retrieval", available: true },
  { command: "/rules", label: "Automated optimizer rules", available: true },
  { command: "/creative-intel", label: "Competitor creative intel", available: true },
  { command: "/content-plan", label: "Organic content strategy + calendar", available: true },
  { command: "/inbox", label: "Unified social inbox (comments/DMs/mentions)", available: true },
  { command: "/attribution", label: "Incrementality / conversion lift", available: true },
  { command: "/listening", label: "Social listening + organic competitor benchmark", available: true },
  { command: "/assets", label: "Creative asset library (DAM)", available: true },
  { command: "/portal", label: "Client-facing white-label dashboard", available: true },
  { command: "/bundle", label: "Bundle all reports into one shareable client hub (single link)", available: true },
];

// ---------------------------------------------------------------------------
// Strategic Intelligence Layer — external skills NOT bundled with smOS.
// ---------------------------------------------------------------------------
const EXTERNAL_NOTE = "external skill, not bundled — invoking would silently no-op per CLAUDE.md";

export const STRATEGIC_INTELLIGENCE_ROUTES: SkillRoute[] = [
  { command: "marketing-psychology", label: "Apply psychology / persuasion to ad copy or creative", available: false, note: EXTERNAL_NOTE },
  { command: "customer-research", label: "Mine audience voice-of-customer (Reddit, G2, forums, transcripts)", available: false, note: EXTERNAL_NOTE },
  { command: "ab-testing", label: "Design an A/B test with statistical rigor", available: false, note: EXTERNAL_NOTE },
  { command: "content-strategy", label: "Plan a content strategy (pillars, topic clusters, editorial calendar)", available: false, note: EXTERNAL_NOTE },
  { command: "competitor-profiling", label: "Research / profile competitors from their URLs", available: false, note: EXTERNAL_NOTE },
  { command: "social", label: "Create/repurpose organic social content (LinkedIn, IG, TikTok, FB)", available: false, note: EXTERNAL_NOTE },
  { command: "firecrawl-deep-research", label: "Deep multi-source research with citations (pre-audit enrichment)", available: false, note: EXTERNAL_NOTE },
  { command: "keyword-research", label: "Find keywords, search volume, topic clusters, long-tail terms", available: false, note: EXTERNAL_NOTE },
  { command: "social-media-trends-research", label: "Track trending topics, Google Trends, Reddit signals for content timing", available: false, note: EXTERNAL_NOTE },
  { command: "brave-search", label: "Real-time web search inside the agent loop (research, news, SERP data)", available: false, note: EXTERNAL_NOTE + " (MCP)" },
];

// ---------------------------------------------------------------------------
// Per-Platform Content Production — external skills NOT bundled with smOS.
// ---------------------------------------------------------------------------
export const CONTENT_PRODUCTION_ROUTES: SkillRoute[] = [
  { command: "social", label: "Repurpose one pillar into many platform-native posts (LinkedIn/X/IG/TikTok/FB)", available: false, note: EXTERNAL_NOTE },
  { command: "facebook-posts", label: "Write a Facebook post (format-typed variants, FB algo best-practice)", available: false, note: EXTERNAL_NOTE },
  { command: "linkedin-posts", label: "Write a LinkedIn post / document-carousel / poll (B2B)", available: false, note: EXTERNAL_NOTE },
  { command: "video-shorts", label: "Script + produce short-form video (TikTok / Reels / Shorts)", available: false, note: EXTERNAL_NOTE },
  { command: "remotion", label: "Script + produce short-form video (TikTok / Reels / Shorts)", available: false, note: EXTERNAL_NOTE },
  { command: "social-media-trends-research", label: "Time content to trends before producing", available: false, note: EXTERNAL_NOTE },
];

/** Flat list consumed by the command palette. */
export const ALL_SKILL_ROUTES: SkillRoute[] = [
  ...SKILL_ROUTES,
  ...STRATEGIC_INTELLIGENCE_ROUTES,
  ...CONTENT_PRODUCTION_ROUTES,
];
