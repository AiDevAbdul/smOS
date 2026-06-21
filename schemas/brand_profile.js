// schemas/brand_profile.js — canonical shape for the Phase 0 brand-identity artifact.
//
// smOS could OPTIMIZE an established brand but had nothing to BUILD one from zero.
// This is the contract for the brand track:
//   /brand-strategy → /brand-name → /brand-visual → /brand-book → /brand-social
// each writing into clients/<slug>/brand_profile.json. Downstream /creative,
// /content-plan, /setup-web and /brand-social all read this ONE file.
//
// The five layers mirror standard agency practice (strategy → verbal → visual →
// guidelines → social) and the dependency chain is enforced by THREE human gates,
// the load-bearing checkpoints that AI must never auto-clear:
//   1. positioning_approved_at  — strategy locks before any name/visual work
//   2. name_approved_at         — name must clear 3 screens (domain/trademark/handles)
//   3. logo_approved_at         — logo locks before color/type finalize & guidelines
//
// normalize(raw): LENIENT, never throws. validate(obj, {stage}): FAIL-CLOSED,
// names every missing field — and at a given stage, asserts the prior gate is set.

import { pick, asArray, isNonEmptyString, result } from "./_shared.js";

export const ARCHETYPES = [
  "innocent", "everyman", "hero", "outlaw", "explorer", "creator",
  "ruler", "magician", "lover", "caregiver", "jester", "sage",
];

// The pipeline stages, in dependency order. Each later stage requires the prior
// gate to be stamped — see validate().
export const STAGES = ["strategy", "verbal", "visual", "guidelines", "social"];

export function normalizeStrategy(raw) {
  const r = raw || {};
  return {
    purpose: pick(r, "purpose") ?? null,
    mission: pick(r, "mission") ?? null,
    vision: pick(r, "vision") ?? null,
    values: asArray(pick(r, "values")),
    persona: pick(r, "persona", "target_persona") ?? null,
    archetype: {
      primary: (pick(r, "archetype_primary") ?? r.archetype?.primary ?? null),
      secondary: (pick(r, "archetype_secondary") ?? r.archetype?.secondary ?? null),
    },
    value_proposition: pick(r, "value_proposition", "value_prop") ?? null,
    differentiation: pick(r, "differentiation", "competitive_differentiation") ?? null,
    positioning_statement: pick(r, "positioning_statement", "positioning") ?? null,
    messaging_pillars: asArray(pick(r, "messaging_pillars", "pillars")),
    essence: pick(r, "essence", "brand_essence") ?? null,
    promise: pick(r, "promise", "brand_promise") ?? null,
    positioning_approved_at: pick(r, "positioning_approved_at") ?? null, // GATE 1
  };
}

export function normalizeVerbal(raw) {
  const r = raw || {};
  const screening = r.name_screening || {};
  return {
    name: pick(r, "name", "brand_name") ?? null,
    name_candidates: asArray(pick(r, "name_candidates", "candidates")),
    name_screening: {
      // each candidate screen: { domain_com_available, trademark_knockout_clear,
      // handles_available:{instagram,facebook,...}, attorney_clearance_flagged }
      domain_com_available: screening.domain_com_available ?? null,
      trademark_knockout_clear: screening.trademark_knockout_clear ?? null,
      handles_available: screening.handles_available ?? null,
      attorney_clearance_flagged: screening.attorney_clearance_flagged ?? null,
    },
    name_approved_at: pick(r, "name_approved_at") ?? null, // GATE 2
    tagline: pick(r, "tagline") ?? null,
    voice: {
      traits: asArray(pick(r, "voice_traits") ?? r.voice?.traits),
      spectrums: (pick(r, "voice_spectrums") ?? r.voice?.spectrums) ?? null,
      do: asArray(r.voice?.do ?? pick(r, "voice_do")),
      dont: asArray(r.voice?.dont ?? pick(r, "voice_dont")),
    },
    messaging_house: {
      roof: r.messaging_house?.roof ?? null,
      walls: asArray(r.messaging_house?.walls),
      foundation: asArray(r.messaging_house?.foundation),
    },
    elevator_pitch: pick(r, "elevator_pitch") ?? null,
    boilerplate: pick(r, "boilerplate") ?? null,
  };
}

export function normalizeVisual(raw) {
  const r = raw || {};
  const logo = r.logo || {};
  const colors = r.colors || {};
  const type = r.typography || {};
  return {
    moodboard_url: pick(r, "moodboard_url") ?? null,
    logo: {
      primary_url: pick(logo, "primary_url", "primary") ?? null,
      mark_url: pick(logo, "mark_url", "mark", "icon_url") ?? null,
      wordmark_url: pick(logo, "wordmark_url", "wordmark") ?? null,
      mono_url: pick(logo, "mono_url", "monochrome_url") ?? null,
      reverse_url: pick(logo, "reverse_url", "white_url") ?? null,
      svg_url: pick(logo, "svg_url") ?? null,
      clear_space: pick(logo, "clear_space") ?? null,
      min_size: pick(logo, "min_size") ?? null,
    },
    logo_approved_at: pick(r, "logo_approved_at") ?? null, // GATE 3
    colors: {
      primary: pick(colors, "primary") ?? null,
      secondary: pick(colors, "secondary") ?? null,
      accent: pick(colors, "accent") ?? null,
      neutrals: asArray(colors.neutrals),
    },
    typography: {
      heading: pick(type, "heading", "heading_font") ?? null,
      body: pick(type, "body", "body_font") ?? null,
      scale: pick(type, "scale") ?? null,
    },
    imagery_style: pick(r, "imagery_style") ?? null,
    iconography: pick(r, "iconography") ?? null,
    // Phase 3.2: any AI-generated visual must be declared so /launch's ai-disclosure
    // guard can carry it through to ai_disclosed on the ad.
    ai_generated: r.ai_generated === true,
  };
}

export function normalizeSocial(raw) {
  const r = raw || {};
  const bios = r.bios || {};
  return {
    profile_picture_url: pick(r, "profile_picture_url") ?? null,
    fb_cover_url: pick(r, "fb_cover_url") ?? null,
    ig_highlight_covers: asArray(pick(r, "ig_highlight_covers")),
    templates: asArray(pick(r, "templates")),
    link_in_bio: pick(r, "link_in_bio") ?? null,
    bios: {
      instagram: bios.instagram ?? null,
      facebook: bios.facebook ?? null,
    },
    branded_hashtag: pick(r, "branded_hashtag") ?? null,
  };
}

export function normalize(raw) {
  const r = raw || {};
  return {
    ...r,
    client_slug: pick(r, "client_slug", "slug") ?? null,
    status: pick(r, "status") ?? "draft", // draft|positioning_approved|named|visual_approved|complete
    strategy: normalizeStrategy(r.strategy),
    verbal: normalizeVerbal(r.verbal),
    visual: normalizeVisual(r.visual),
    guidelines: {
      doc_url: r.guidelines?.doc_url ?? null,
      pdf_url: r.guidelines?.pdf_url ?? null,
      version: r.guidelines?.version ?? null,
      generated_at: r.guidelines?.generated_at ?? null,
    },
    social: normalizeSocial(r.social),
  };
}

/**
 * FAIL-CLOSED stage validator. validate(obj, {stage}) checks the fields a stage
 * must PRODUCE *and* asserts the prior human gate is stamped — so /brand-visual
 * cannot run before positioning is approved, etc. With no stage it validates the
 * whole artifact for completeness (used by /brand-book and /brand-social).
 */
export function validate(obj, { stage = "complete" } = {}) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["brand_profile is not an object"]);
  const b = normalize(obj);

  const needGate = (path, value, who) => {
    if (!isNonEmptyString(value)) errors.push(`${who} requires ${path} to be set first (prior human gate not cleared)`);
  };

  if (stage === "strategy" || stage === "complete") {
    if (!isNonEmptyString(b.strategy.positioning_statement)) errors.push("strategy.positioning_statement is missing");
    if (!b.strategy.values.length) errors.push("strategy.values is empty");
    if (b.strategy.archetype.primary && !ARCHETYPES.includes(String(b.strategy.archetype.primary).toLowerCase()))
      errors.push(`strategy.archetype.primary "${b.strategy.archetype.primary}" is not one of the 12 archetypes`);
  }

  if (stage === "verbal") needGate("strategy.positioning_approved_at", b.strategy.positioning_approved_at, "/brand-name");
  if (stage === "verbal" || stage === "complete") {
    if (!isNonEmptyString(b.verbal.name)) errors.push("verbal.name is missing");
  }

  if (stage === "visual") needGate("verbal.name_approved_at", b.verbal.name_approved_at, "/brand-visual");
  if (stage === "visual" || stage === "complete") {
    if (!isNonEmptyString(b.visual.logo.primary_url)) errors.push("visual.logo.primary_url is missing");
    if (!isNonEmptyString(b.visual.colors.primary)) errors.push("visual.colors.primary is missing");
    if (!isNonEmptyString(b.visual.typography.heading)) errors.push("visual.typography.heading is missing");
  }

  if (stage === "guidelines" || stage === "social") {
    needGate("visual.logo_approved_at", b.visual.logo_approved_at, stage === "social" ? "/brand-social" : "/brand-book");
  }

  if (stage === "social" || stage === "complete") {
    if (!isNonEmptyString(b.social.profile_picture_url)) errors.push("social.profile_picture_url is missing");
    if (!isNonEmptyString(b.social.bios.instagram)) errors.push("social.bios.instagram is missing");
  }

  return result(errors);
}
