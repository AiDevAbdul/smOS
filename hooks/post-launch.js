#!/usr/bin/env node
import { readStdinJson, getToolInput, allow, resolveClientSlugFromAccount, loadClientProfile } from "./_lib.js";

const payload = await readStdinJson();
const input = getToolInput(payload);
const result = payload?.tool_result || payload?.result || {};

const campaignId = result?.id || result?.campaign_id;
if (!campaignId) allow("post-launch: no campaign id in tool_result — skipping");

const slug = resolveClientSlugFromAccount(input?.ad_account_id);
const profile = slug ? loadClientProfile(slug) : null;

const row = {
  client_slug: slug,
  campaign_id: campaignId,
  name: input?.name,
  objective: input?.objective,
  daily_budget_cents: input?.daily_budget ?? null,
  lifetime_budget_cents: input?.lifetime_budget ?? null,
  status: input?.status || "PAUSED",
  ad_account_id: input?.ad_account_id,
  created_at: new Date().toISOString(),
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (supabaseUrl && supabaseKey) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/campaigns`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
  } catch (e) {
    process.stderr.write(`[post-launch] supabase insert failed: ${e.message}\n`);
  }
}

const slackToken = process.env.SLACK_BOT_TOKEN;
const channel = profile?.approvals?.channel || process.env.SLACK_DEFAULT_CHANNEL;
if (slackToken && channel) {
  const budget = row.daily_budget_cents ? `$${(row.daily_budget_cents / 100).toFixed(2)}/day` : "lifetime budget";
  const text = `🚀 Campaign created (PAUSED) — *${row.name}* · ${row.objective} · ${budget} · client \`${slug || "unknown"}\``;
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, text }),
    });
  } catch (e) {
    process.stderr.write(`[post-launch] slack post failed: ${e.message}\n`);
  }
}

allow(`post-launch: logged campaign ${campaignId}`);
