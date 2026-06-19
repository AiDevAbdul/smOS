#!/usr/bin/env node
import { readStdinJson, getToolInput, allow, block, resolveClientSlugFromAccount, loadClientProfile } from "./_lib.js";

const CONVERSION_OBJECTIVES = new Set(["OUTCOME_SALES", "OUTCOME_LEADS"]);

const payload = await readStdinJson();
const input = getToolInput(payload);

const objective = input?.objective;
if (!objective || !CONVERSION_OBJECTIVES.has(objective)) {
  allow(`pixel-check: objective ${objective || "n/a"} not conversion — skipping`);
}

const slug = resolveClientSlugFromAccount(input?.ad_account_id);
const profile = slug ? loadClientProfile(slug) : null;
const pixelId = profile?.accounts?.pixel_id;

if (!pixelId) {
  block(`pixel-check BLOCKED: conversion campaign requires a pixel_id in the client profile (slug=${slug || "?"}).`);
}

const token = process.env.META_ACCESS_TOKEN;
if (!token) {
  block(`pixel-check BLOCKED: META_ACCESS_TOKEN unavailable — cannot verify pixel ${pixelId} is firing.`);
}

const since = Math.floor(Date.now() / 1000) - 7 * 86400;
const url = `https://graph.facebook.com/v21.0/${pixelId}/stats?start_time=${since}&access_token=${encodeURIComponent(token)}`;

let firing = false;
let detail = "";
try {
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) {
    detail = `error ${json.error.code}/${json.error.type}: ${json.error.message} (fbtrace_id=${json.error.fbtrace_id})`;
  } else {
    const events = json?.data || [];
    firing = events.some((e) => Number(e?.count || 0) > 0);
    detail = `${events.length} event types, total count ${events.reduce((s, e) => s + Number(e?.count || 0), 0)}`;
  }
} catch (e) {
  detail = `fetch failed: ${e.message}`;
}

if (!firing) {
  block(`pixel-check BLOCKED: pixel ${pixelId} has no events in the last 7 days. ${detail}\nFix pixel installation before launching a conversion campaign.`);
}

allow(`pixel-check: pixel ${pixelId} firing (${detail})`);
