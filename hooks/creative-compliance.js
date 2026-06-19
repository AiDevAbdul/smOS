#!/usr/bin/env node
import { readStdinJson, getToolInput, allow, block, resolveClientSlugFromAccount, loadClientProfile } from "./_lib.js";

const PRIMARY_MAX = 500;
const HEADLINE_MAX = 40;
const DESCRIPTION_MAX = 30;

const POLICY_FLAGS = [
  "guarantee", "guaranteed", "100% effective", "miracle", "cure",
  "lose weight fast", "before and after", "click here", "free money",
];

const payload = await readStdinJson();
const input = getToolInput(payload);

const creative = input?.creative || input?.object_story_spec || input || {};
const primary = pickText(creative, ["primary_text", "message", "body"]);
const headline = pickText(creative, ["headline", "title", "name"]);
const description = pickText(creative, ["description", "link_description"]);

const violations = [];

if (primary && primary.length > PRIMARY_MAX) violations.push(`primary_text ${primary.length}/${PRIMARY_MAX}`);
if (headline && headline.length > HEADLINE_MAX) violations.push(`headline ${headline.length}/${HEADLINE_MAX}`);
if (description && description.length > DESCRIPTION_MAX) violations.push(`description ${description.length}/${DESCRIPTION_MAX}`);

const slug = resolveClientSlugFromAccount(input?.ad_account_id);
const profile = slug ? loadClientProfile(slug) : null;
const restricted = (profile?.voice?.restricted_words || []).map((w) => w.toLowerCase());

const allText = [primary, headline, description].filter(Boolean).join(" ").toLowerCase();

const restrictedHits = restricted.filter((w) => new RegExp(`\\b${escapeRegex(w)}\\b`).test(allText));
if (restrictedHits.length) violations.push(`restricted words: ${restrictedHits.join(", ")}`);

const policyHits = POLICY_FLAGS.filter((p) => allText.includes(p));
if (policyHits.length) violations.push(`Meta policy flags: ${policyHits.join(", ")}`);

if (violations.length) {
  block(`creative-compliance BLOCKED:\n  - ${violations.join("\n  - ")}`);
}

allow("creative-compliance: OK");

function pickText(obj, keys) {
  for (const k of keys) {
    if (typeof obj?.[k] === "string") return obj[k];
  }
  const spec = obj?.link_data || obj?.video_data;
  if (spec) {
    for (const k of keys) if (typeof spec[k] === "string") return spec[k];
  }
  return null;
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
