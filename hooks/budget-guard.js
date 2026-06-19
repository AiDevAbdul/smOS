#!/usr/bin/env node
import { readStdinJson, getToolInput, getToolName, allow, block, resolveClientSlugFromAccount, loadClientProfile } from "./_lib.js";

const GLOBAL_DAILY_CAP_USD = 200;
const SINGLE_INCREASE_CAP_USD = 500;

const payload = await readStdinJson();
const toolName = getToolName(payload);
const input = getToolInput(payload);

const proposedCents = Number(input?.daily_budget ?? 0);
if (!proposedCents) allow("budget-guard: no daily_budget in input");

const proposedUSD = proposedCents / 100;

const slug = resolveClientSlugFromAccount(input?.ad_account_id);
const profile = slug ? loadClientProfile(slug) : null;
const monthlyHigh = profile?.kpis?.monthly_budget_high;
const clientDailyCap = monthlyHigh ? monthlyHigh / 30 : GLOBAL_DAILY_CAP_USD;

if (toolName.includes("create_campaign")) {
  if (proposedUSD > clientDailyCap) {
    block(`budget-guard BLOCKED: daily $${proposedUSD.toFixed(2)} exceeds client cap $${clientDailyCap.toFixed(2)} (monthly_budget_high/30). Send Slack approval request before retrying.`);
  }
  allow(`budget-guard: $${proposedUSD.toFixed(2)} ≤ cap $${clientDailyCap.toFixed(2)}`);
}

if (toolName.includes("update_campaign")) {
  if (proposedUSD > clientDailyCap * 2) {
    block(`budget-guard BLOCKED: proposed $${proposedUSD.toFixed(2)} is >2× client daily cap. Requires explicit Slack approval.`);
  }
  if (proposedUSD > SINGLE_INCREASE_CAP_USD) {
    block(`budget-guard BLOCKED: single increase to $${proposedUSD.toFixed(2)}/day exceeds $${SINGLE_INCREASE_CAP_USD} global threshold. Slack approval required.`);
  }
  allow(`budget-guard: update $${proposedUSD.toFixed(2)} within thresholds`);
}

allow("budget-guard: tool not matched");
