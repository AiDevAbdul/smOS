-- smOS Supabase Schema
-- Run this in the Supabase SQL editor after creating a new project

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── clients ────────────────────────────────────────────────────────────────
CREATE TYPE client_status AS ENUM ('active', 'paused', 'offboarded');

CREATE TABLE clients (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug         text UNIQUE NOT NULL,
  name         text NOT NULL,
  created_at   timestamptz DEFAULT now(),
  profile      jsonb DEFAULT '{}',      -- full profile from /intake
  kpis         jsonb DEFAULT '{}',      -- KPI thresholds
  account_ids  jsonb DEFAULT '{}',      -- ad_account_id, pixel_id, page_id, ig_id, bm_id
  voice        jsonb DEFAULT '{}',      -- brand voice config
  status       client_status DEFAULT 'active'
);

CREATE INDEX idx_clients_slug ON clients (slug);
CREATE INDEX idx_clients_status ON clients (status);

-- ─── baseline_snapshots ─────────────────────────────────────────────────────
CREATE TYPE pixel_health_status AS ENUM ('none', 'partial', 'full');

CREATE TABLE baseline_snapshots (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id               uuid REFERENCES clients (id) ON DELETE CASCADE,
  snapshot_date           date NOT NULL,
  -- Organic
  followers_fb            int DEFAULT 0,
  followers_ig            int DEFAULT 0,
  avg_engagement_rate     decimal(6, 4) DEFAULT 0,
  posts_per_week          decimal(4, 2) DEFAULT 0,
  content_quality_score   decimal(4, 2) DEFAULT 0,
  page_completeness_score int DEFAULT 0,
  -- Paid
  pixel_health            pixel_health_status DEFAULT 'none',
  custom_audience_count   int DEFAULT 0,
  total_historical_spend  decimal(12, 2) DEFAULT 0,
  historical_best_cpa     decimal(10, 2),
  historical_best_roas    decimal(6, 4),
  audit_report_url        text,
  raw_data                jsonb DEFAULT '{}',
  created_at              timestamptz DEFAULT now()
);

CREATE INDEX idx_baseline_client ON baseline_snapshots (client_id);
CREATE INDEX idx_baseline_date ON baseline_snapshots (snapshot_date);

-- ─── campaigns ──────────────────────────────────────────────────────────────
CREATE TABLE campaigns (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id          uuid REFERENCES clients (id) ON DELETE CASCADE,
  meta_campaign_id   text UNIQUE NOT NULL,
  name               text NOT NULL,
  objective          text NOT NULL,
  budget_daily       decimal(10, 2),
  budget_lifetime    decimal(10, 2),
  status             text DEFAULT 'PAUSED',
  launched_at        timestamptz DEFAULT now(),
  launched_by        text,                         -- skill or agent name
  strategy_brief_id  uuid,
  structure          jsonb DEFAULT '{}',           -- full adset/ad tree
  meta_data          jsonb DEFAULT '{}'            -- any extra Meta fields
);

CREATE INDEX idx_campaigns_client ON campaigns (client_id);
CREATE INDEX idx_campaigns_meta_id ON campaigns (meta_campaign_id);
CREATE INDEX idx_campaigns_status ON campaigns (status);

-- ─── daily_metrics ──────────────────────────────────────────────────────────
CREATE TABLE daily_metrics (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        uuid REFERENCES clients (id) ON DELETE CASCADE,
  campaign_id      text NOT NULL,
  adset_id         text,
  ad_id            text,
  date             date NOT NULL,
  spend            decimal(10, 2) DEFAULT 0,
  impressions      int DEFAULT 0,
  clicks           int DEFAULT 0,
  ctr              decimal(8, 6) DEFAULT 0,
  cpc              decimal(10, 2),
  cpm              decimal(10, 2),
  conversions      int DEFAULT 0,
  cpa              decimal(10, 2),
  roas             decimal(8, 4),
  frequency        decimal(6, 4) DEFAULT 0,
  reach            int DEFAULT 0,
  optimizer_action text,                           -- null / scaled / paused / flagged
  optimizer_reason text,
  raw_actions      jsonb DEFAULT '[]'              -- full actions array from Meta
);

CREATE UNIQUE INDEX idx_daily_metrics_unique ON daily_metrics (ad_id, date) WHERE ad_id IS NOT NULL;
CREATE UNIQUE INDEX idx_daily_metrics_adset_unique ON daily_metrics (adset_id, date, ad_id) WHERE ad_id IS NULL;
CREATE INDEX idx_daily_metrics_client_date ON daily_metrics (client_id, date DESC);
CREATE INDEX idx_daily_metrics_campaign ON daily_metrics (campaign_id, date DESC);

-- ─── optimizer_log ──────────────────────────────────────────────────────────
CREATE TABLE optimizer_log (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     uuid REFERENCES clients (id) ON DELETE CASCADE,
  run_date      date NOT NULL,
  actions_taken jsonb DEFAULT '[]',   -- [{type, entity_id, reason, before, after}]
  flags_raised  jsonb DEFAULT '[]',   -- items needing human review
  digest_sent   boolean DEFAULT false,
  digest_url    text,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_optimizer_log_client ON optimizer_log (client_id);
CREATE INDEX idx_optimizer_log_date ON optimizer_log (run_date DESC);

-- ─── reports ────────────────────────────────────────────────────────────────
CREATE TYPE report_type AS ENUM ('weekly', 'monthly', 'before_after', 'audit');

CREATE TABLE reports (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     uuid REFERENCES clients (id) ON DELETE CASCADE,
  report_type   report_type NOT NULL,
  period_start  date,
  period_end    date,
  generated_at  timestamptz DEFAULT now(),
  generated_by  text,                  -- agent or skill name
  report_url    text,                  -- Drive URL
  slack_sent    boolean DEFAULT false,
  email_sent    boolean DEFAULT false,
  key_metrics   jsonb DEFAULT '{}'     -- summary KPIs for quick lookup
);

CREATE INDEX idx_reports_client ON reports (client_id);
CREATE INDEX idx_reports_type ON reports (report_type);
CREATE INDEX idx_reports_generated ON reports (generated_at DESC);

-- ─── strategy_briefs ────────────────────────────────────────────────────────
CREATE TABLE strategy_briefs (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        uuid REFERENCES clients (id) ON DELETE CASCADE,
  created_at       timestamptz DEFAULT now(),
  approved_at      timestamptz,
  approved_by      text,
  status           text DEFAULT 'pending',   -- pending / approved / rejected
  brief            jsonb NOT NULL,           -- full strategy brief JSON
  campaign_ids     text[] DEFAULT '{}'       -- Meta campaign IDs launched from this brief
);

CREATE INDEX idx_strategy_client ON strategy_briefs (client_id);
CREATE INDEX idx_strategy_status ON strategy_briefs (status);

-- ─── ad_copy ────────────────────────────────────────────────────────────────
CREATE TABLE ad_copy (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       uuid REFERENCES clients (id) ON DELETE CASCADE,
  brief_id        uuid REFERENCES strategy_briefs (id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  angle           text,
  variants        jsonb NOT NULL,    -- [{hook, primary_text, headline, cta, score}]
  selected_index  int,
  meta_creative_id text              -- set after create_ad_creative
);

CREATE INDEX idx_ad_copy_client ON ad_copy (client_id);
CREATE INDEX idx_ad_copy_brief ON ad_copy (brief_id);

-- ─── competitor_snapshots (Meta Ad Library) ─────────────────────────────────
CREATE TABLE competitor_snapshots (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id           uuid REFERENCES clients (id) ON DELETE CASCADE,
  slug                text NOT NULL,
  generated_at        timestamptz DEFAULT now(),
  country             text,
  lookback_days       int,
  competitor_count    int DEFAULT 0,
  total_ads_observed  int DEFAULT 0,
  summary             jsonb DEFAULT '{}',   -- {top_spender, most_active, ranked: [...]}
  payload             jsonb NOT NULL        -- full analyzed JSON
);

CREATE INDEX idx_competitor_snapshots_client ON competitor_snapshots (client_id, generated_at DESC);
CREATE INDEX idx_competitor_snapshots_slug ON competitor_snapshots (slug, generated_at DESC);

-- ─── market_snapshots (niche-level sweep) ───────────────────────────────────
CREATE TABLE market_snapshots (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  niche           text NOT NULL,
  business_name   text,
  generated_at    timestamptz DEFAULT now(),
  category_count  int DEFAULT 0,
  payload         jsonb NOT NULL
);

CREATE INDEX idx_market_snapshots_niche ON market_snapshots (niche, generated_at DESC);

-- ─── prospect_audits (pre-onboarding /pre-audit) ────────────────────────────
CREATE TABLE prospect_audits (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  prospect_slug   text NOT NULL,
  business_name   text NOT NULL,
  generated_at    timestamptz DEFAULT now(),
  health_score    int,
  report_path     text,
  summary         jsonb DEFAULT '{}',   -- {wins:[], gaps:[], opportunities:[], competitors_outspending:[]}
  converted       boolean DEFAULT false, -- set true if /intake is later run for this slug
  converted_at    timestamptz
);

CREATE INDEX idx_prospect_audits_slug ON prospect_audits (prospect_slug, generated_at DESC);

-- ─── Row Level Security ─────────────────────────────────────────────────────
-- Enable RLS on all tables (service role key bypasses these)
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE baseline_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE optimizer_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_copy ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_audits ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by smOS agents/skills)
-- Add user-facing policies here when you add auth

-- ─── Useful views ───────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW active_campaigns AS
  SELECT c.*, cl.name AS client_name, cl.slug AS client_slug
  FROM campaigns c
  JOIN clients cl ON cl.id = c.client_id
  WHERE c.status = 'ACTIVE';

CREATE OR REPLACE VIEW client_performance_summary AS
  SELECT
    dm.client_id,
    cl.name AS client_name,
    dm.date,
    SUM(dm.spend)       AS total_spend,
    SUM(dm.impressions) AS total_impressions,
    SUM(dm.clicks)      AS total_clicks,
    SUM(dm.conversions) AS total_conversions,
    ROUND(SUM(dm.spend) / NULLIF(SUM(dm.conversions), 0), 2) AS blended_cpa,
    ROUND(SUM(dm.roas * dm.spend) / NULLIF(SUM(dm.spend), 0), 4) AS weighted_roas
  FROM daily_metrics dm
  JOIN clients cl ON cl.id = dm.client_id
  WHERE dm.ad_id IS NULL AND dm.adset_id IS NULL   -- campaign-level rows only
  GROUP BY dm.client_id, cl.name, dm.date;
