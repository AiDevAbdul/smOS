#!/usr/bin/env node
// WCAG contrast guard for the MCP path (E2). Rule logic lives in
// scripts/lib/contrast.js + guards.checkBrandContrast — shared with the
// /brand-visual persist gate, so both paths enforce the same palette.
//
// Two things can be checked on a creative write:
//   1. a brand kit DECLARED on the creative (creative.brand_kit.colors) — the
//      palette this specific ad is claiming to use;
//   2. otherwise the client's approved brand_profile palette, resolved from the
//      ad account id.
// Nothing to check (no kit, no brand profile) → allow. This never guesses a
// color: an unparseable declared hex blocks, an absent one doesn't.
import { readStdinJson, getToolInput, getToolName, allow, block } from "./_lib.js";
import { checkBrandContrast, loadBrandProfile, resolveClientSlugFromAccount } from "../scripts/lib/guards.js";

const payload = await readStdinJson();
const toolName = getToolName(payload);
const input = getToolInput(payload);

if (!/create_ad|create_ad_creative/.test(toolName)) allow("contrast-check: not a creative write");

const creative = input?.creative || input?.object_story_spec || input || {};
const declared = creative?.brand_kit || input?.brand_kit;

let brand = null;
if (declared?.colors) {
  const colors = Array.isArray(declared.colors)
    ? { primary: declared.colors[0], secondary: declared.colors[1], accent: declared.colors[2], neutrals: declared.colors.slice(3) }
    : declared.colors;
  brand = { visual: { colors } };
} else {
  const slug = resolveClientSlugFromAccount(input?.ad_account_id);
  if (slug) brand = loadBrandProfile(slug);
}

if (!brand?.visual?.colors?.primary) allow("contrast-check: no palette to check");

const r = checkBrandContrast(brand);
if (!r.ok) block(r.reason);
allow(`contrast-check: OK (${r.report?.pairs?.length || 0} pairs measured)`);
