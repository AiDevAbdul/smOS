#!/usr/bin/env node
/**
 * baseline-snapshot.js
 *
 * Writes a single, immutable row to the Supabase `baseline_snapshots` table.
 * Called by the /audit skill after Pass 5. All future /before-after and
 * /report skills compare current metrics against this row.
 *
 * Usage (programmatic):
 *   import { saveBaselineSnapshot } from "./baseline-snapshot.js";
 *   await saveBaselineSnapshot(supabaseClient, { client_id, audit_data });
 *
 * Usage (CLI for manual reruns):
 *   node baseline-snapshot.js <client_slug> <audit_report.json>
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

export function buildSnapshotRow(clientId, auditData, auditReportUrl) {
  const fb = auditData.organic?.facebook || {};
  const ig = auditData.organic?.instagram || {};
  const paid = auditData.paid || {};
  const creative = auditData.creative || {};

  return {
    client_id: clientId,
    snapshot_date: new Date().toISOString().slice(0, 10),
    followers_fb: fb.followers ?? null,
    followers_ig: ig.followers ?? null,
    avg_engagement_rate: fb.avg_engagement_rate ?? null,
    posts_per_week: fb.posts_per_week ?? null,
    content_quality_score: creative.overall_score ?? null,
    page_completeness_score: fb.page_completeness ?? null,
    pixel_health: paid.pixel_health ?? "none",
    custom_audience_count: paid.custom_audience_count ?? 0,
    total_historical_spend: paid.total_spend ?? 0,
    historical_best_cpa: paid.best_cpa ?? null,
    historical_best_roas: paid.best_roas ?? null,
    audit_report_url: auditReportUrl ?? null,
    raw_audit: auditData,
  };
}

export async function saveBaselineSnapshot(supabase, { clientId, auditData, auditReportUrl }) {
  const row = buildSnapshotRow(clientId, auditData, auditReportUrl);

  const { data: existing, error: lookupErr } = await supabase
    .from("baseline_snapshots")
    .select("id")
    .eq("client_id", clientId)
    .limit(1)
    .maybeSingle();

  if (lookupErr) throw new Error(`Supabase lookup failed: ${lookupErr.message}`);

  if (existing) {
    throw new Error(
      `Baseline snapshot already exists for client ${clientId} (id=${existing.id}). ` +
      `Baselines are immutable — refusing to overwrite. ` +
      `If you genuinely need a new baseline, archive the old one first.`
    );
  }

  const { data, error } = await supabase
    .from("baseline_snapshots")
    .insert(row)
    .select()
    .single();

  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  return data;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , slug, auditFile] = process.argv;
  if (!slug || !auditFile) {
    console.error("Usage: node baseline-snapshot.js <client_slug> <audit_data.json>");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const auditData = JSON.parse(readFileSync(auditFile, "utf8"));

  const { data: client, error } = await supabase
    .from("clients")
    .select("id")
    .eq("slug", slug)
    .single();

  if (error || !client) {
    console.error(`Client with slug "${slug}" not found`);
    process.exit(1);
  }

  const snapshot = await saveBaselineSnapshot(supabase, {
    clientId: client.id,
    auditData,
    auditReportUrl: auditData.report_url,
  });

  console.log(`Baseline snapshot saved: id=${snapshot.id} date=${snapshot.snapshot_date}`);
}
