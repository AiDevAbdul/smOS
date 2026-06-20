#!/usr/bin/env node
/**
 * /creative companion script — score, lint, and persist ad-copy drafts.
 *
 * Copy *generation* requires Claude (the model writes the hooks). This script:
 *   - skeleton: emits clients/<slug>/ad_copy_draft.json scaffolded from strategy_brief.json
 *               Claude fills the hook/primary_text/headline/cta arrays.
 *   - lint:     reads the filled draft, runs deterministic length + restricted-word checks,
 *               applies a heuristic 0-10 scorer per variant, picks tops, writes ad_copy.json.
 *
 * Usage:
 *   node skills/creative/creative.js <slug> skeleton
 *   node skills/creative/creative.js <slug> lint
 *   node skills/creative/creative.js <slug> lint --draft path/to/draft.json
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const VALID_CTAS = new Set([
  "SHOP_NOW","LEARN_MORE","SIGN_UP","GET_OFFER","BOOK_TRAVEL","BOOK_NOW","BUY_NOW",
  "CONTACT_US","DOWNLOAD","GET_QUOTE","SUBSCRIBE","WATCH_MORE","APPLY_NOW","BUY_TICKETS",
  "ORDER_NOW","GET_SHOWTIMES","SEE_MENU","CALL_NOW","MESSAGE_PAGE","DONATE_NOW",
  "GET_DIRECTIONS","WHATSAPP_MESSAGE","SEND_MESSAGE","NO_BUTTON","REQUEST_TIME",
  "INSTALL_MOBILE_APP","USE_APP","INSTALL_APP","PLAY_GAME","LISTEN_MUSIC","OPEN_LINK",
]);

const LIMITS = {
  hook: 60,
  primary_text: 500,
  primary_text_truncate: 125,
  headline: 40,
  description: 30,
};

const ENGAGEMENT_BAIT = [
  /tag a friend/i, /comment below/i, /share this/i, /like if/i, /share if/i,
  /double tap/i, /smash that/i,
];

function argVal(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function loadProfile(slug) {
  const p = resolve(ROOT, "clients", slug, "client_profile.json");
  if (!existsSync(p)) throw new Error(`Profile not found: ${p}`);
  return JSON.parse(readFileSync(p, "utf8"));
}

function loadBrief(slug) {
  const p = resolve(ROOT, "clients", slug, "strategy_brief.json");
  if (!existsSync(p)) throw new Error(`Strategy brief not found: ${p}`);
  const brief = JSON.parse(readFileSync(p, "utf8"));
  return brief;
}

function getRestrictedWords(profile) {
  const v = profile.voice || {};
  return [...(v.restricted_words || []), ...(v.avoid || [])].map((w) => String(w).toLowerCase());
}

function getAngles(brief) {
  return brief.creative_angles || brief.angles || [];
}

function angleName(a) {
  return a.archetype || a.name || a.angle || a.label || "ANGLE";
}

function angleFormat(a, brief) {
  return a.format || brief.default_format || "reels_15_30s";
}

function buildSkeleton(profile, brief) {
  const angles = getAngles(brief);
  return {
    client_slug: profile.slug,
    generated_at: new Date().toISOString(),
    brief_ref: "strategy_brief.json",
    instructions: "Fill each hook with 5 hook strings. For each hook, fill 3 primary_text / 3 headlines / 3 ctas (use Meta CTA enum). Then run: node skills/creative/creative.js <slug> lint",
    voice: { tone: profile.voice?.tone, restricted_words: getRestrictedWords(profile) },
    audience: profile.audience,
    angles: angles.map((a) => ({
      name: angleName(a),
      hook_archetype: a.hook || a.archetype || "",
      format: angleFormat(a, brief),
      direction: a.direction || a.description || "",
      hooks: Array.from({ length: 5 }, () => ({
        text: "",
        primary_text: ["", "", ""],
        headlines: ["", "", ""],
        ctas: ["", "", ""],
      })),
    })),
  };
}

// Heuristic 0-10 scorer. Not as good as Claude, but deterministic and consistent.
function scoreVariant(text, kind, profile) {
  const t = String(text || "");
  if (!t.trim()) return { clarity: 0, specificity: 0, emotional_trigger: 0, cta_strength: 0, overall: 0 };

  const len = t.length;
  const limit = LIMITS[kind] || 500;
  const truncate = LIMITS[`${kind}_truncate`] || limit;

  // Clarity: fits comfortably under the truncate point, simple language
  let clarity = 5;
  if (len <= truncate * 0.7) clarity += 2;
  else if (len <= truncate) clarity += 1;
  else if (len > limit) clarity -= 4;
  if ((t.match(/[,;]/g) || []).length > 3) clarity -= 1;
  const longWords = t.split(/\s+/).filter((w) => w.length > 12).length;
  if (longWords > 2) clarity -= 1;
  clarity = Math.max(0, Math.min(10, clarity));

  // Specificity: numbers, proper nouns (Capitalized non-start words), $-signs, %
  let specificity = 3;
  if (/\d/.test(t)) specificity += 2;
  if (/[\$£€]\d/.test(t)) specificity += 1;
  if (/%/.test(t)) specificity += 1;
  const properNouns = (t.match(/(?<=\s)[A-Z][a-z]{2,}/g) || []).length;
  specificity += Math.min(3, properNouns);
  // Vague-claim penalty
  if (/\b(amazing|incredible|best ever|unbelievable|game.?changer)\b/i.test(t)) specificity -= 2;
  specificity = Math.max(0, Math.min(10, specificity));

  // Emotional trigger: pain-point match, sensory verbs, second-person
  let emotional = 4;
  const pains = (profile.audience?.pain_points || []).map((p) => String(p).toLowerCase());
  for (const p of pains) {
    const keyword = p.split(/\s+/)[0];
    if (keyword && t.toLowerCase().includes(keyword)) { emotional += 2; break; }
  }
  if (/\byou(r|'re)?\b/i.test(t)) emotional += 1;
  if (/[?!]/.test(t)) emotional += 1;
  // Engagement bait penalty
  for (const re of ENGAGEMENT_BAIT) if (re.test(t)) { emotional -= 3; break; }
  emotional = Math.max(0, Math.min(10, emotional));

  // CTA strength only applies to CTA kind — for text variants, judge by closing verb
  let cta_strength = 5;
  if (kind === "cta") {
    cta_strength = VALID_CTAS.has(t.toUpperCase()) ? 9 : 0;
  } else {
    if (/\b(book|start|get|claim|grab|see|try|join|shop|learn|read|watch|order)\b/i.test(t)) cta_strength += 2;
    if (/\b(now|today|this week)\b/i.test(t)) cta_strength += 1;
    cta_strength = Math.max(0, Math.min(10, cta_strength));
  }

  const overall = Math.round(((clarity + specificity + emotional + cta_strength) / 4) * 10) / 10;
  return { clarity, specificity, emotional_trigger: emotional, cta_strength, overall };
}

function checkCompliance(text, restricted) {
  const t = String(text || "").toLowerCase();
  const hits = [];
  for (const w of restricted) {
    if (!w) continue;
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(t)) hits.push(w);
  }
  return { compliant: !hits.length, restricted_hits: hits };
}

function checkLength(text, kind) {
  const len = String(text || "").length;
  const limit = LIMITS[kind];
  return { length: len, limit, over_limit: len > limit };
}

function lintDraft(draft, profile) {
  const restricted = getRestrictedWords(profile);
  const angles = (draft.angles || []).map((angle) => {
    const hooks = (angle.hooks || []).map((h) => {
      const hookCheck = {
        text: h.text,
        ...checkLength(h.text, "hook"),
        ...checkCompliance(h.text, restricted),
        scores: scoreVariant(h.text, "hook", profile),
      };
      const primaries = (h.primary_text || []).map((p) => ({
        text: p,
        ...checkLength(p, "primary_text"),
        ...checkCompliance(p, restricted),
        scores: scoreVariant(p, "primary_text", profile),
      }));
      const headlines = (h.headlines || []).map((p) => ({
        text: p,
        ...checkLength(p, "headline"),
        ...checkCompliance(p, restricted),
        scores: scoreVariant(p, "headline", profile),
      }));
      const ctas = (h.ctas || []).map((c) => {
        const upper = String(c || "").toUpperCase();
        return {
          type: upper,
          valid: VALID_CTAS.has(upper),
          scores: scoreVariant(upper, "cta", profile),
        };
      });

      const bestPrimary = primaries.reduce((a, b) => (b.scores.overall > (a?.scores.overall ?? -1) ? b : a), null);
      const bestHeadline = headlines.reduce((a, b) => (b.scores.overall > (a?.scores.overall ?? -1) ? b : a), null);
      const bestCta = ctas.reduce((a, b) => (b.scores.overall > (a?.scores.overall ?? -1) ? b : a), null);

      const combinedOverall =
        (hookCheck.scores.overall +
          (bestPrimary?.scores.overall || 0) +
          (bestHeadline?.scores.overall || 0) +
          (bestCta?.scores.overall || 0)) / 4;

      return {
        hook: hookCheck,
        primary_text: primaries,
        headlines,
        ctas,
        best_combo: {
          primary: bestPrimary?.text,
          headline: bestHeadline?.text,
          cta: bestCta?.type,
          overall: Math.round(combinedOverall * 10) / 10,
        },
        top_pick: false,
      };
    });

    // Mark top pick by best_combo.overall
    if (hooks.length) {
      const best = hooks.reduce((a, b) => (b.best_combo.overall > a.best_combo.overall ? b : a));
      best.top_pick = true;
    }

    return {
      name: angle.name,
      hook_archetype: angle.hook_archetype,
      format: angle.format,
      direction: angle.direction,
      hooks,
      design_brief: {
        sizes: ["1080x1080", "1080x1920", "1200x628"],
        copy_zones: "Center-safe for 1:1; bottom-third for 9:16; left-third for 1.91:1 (CTA bug area).",
        visual_direction: `Lead with the ${angle.hook_archetype || "angle"}. ${angle.direction || ""}`.trim(),
      },
    };
  });

  // Aggregate compliance & length issues
  const issues = [];
  let totalVariants = 0;
  let nonCompliant = 0;
  let overLimit = 0;
  for (const a of angles) {
    for (const h of a.hooks) {
      const all = [h.hook, ...h.primary_text, ...h.headlines];
      for (const v of all) {
        totalVariants++;
        if (v.compliant === false) {
          nonCompliant++;
          issues.push(`${a.name}: restricted-word hit in "${v.text}" → ${v.restricted_hits.join(", ")}`);
        }
        if (v.over_limit) {
          overLimit++;
          issues.push(`${a.name}: over limit (${v.length}/${v.limit}) → "${String(v.text).slice(0, 40)}…"`);
        }
      }
      for (const c of h.ctas) {
        if (!c.valid && c.type) issues.push(`${a.name}: invalid CTA "${c.type}" — not in Meta enum`);
      }
    }
  }

  return {
    angles,
    summary: { total_variants: totalVariants, non_compliant: nonCompliant, over_limit: overLimit, issues },
  };
}

function main() {
  const [slug, mode, ...rest] = process.argv.slice(2);
  if (!slug || !mode) {
    console.error("Usage: node skills/creative/creative.js <slug> <skeleton|lint> [--draft PATH]");
    process.exit(1);
  }

  const profile = loadProfile(slug);

  if (mode === "skeleton") {
    const brief = loadBrief(slug);
    const skel = buildSkeleton(profile, brief);
    const outPath = resolve(ROOT, "clients", slug, "ad_copy_draft.json");
    if (existsSync(outPath)) {
      console.error(`[creative] draft already exists: ${outPath} — refusing to overwrite`);
      process.exit(2);
    }
    writeFileSync(outPath, JSON.stringify(skel, null, 2));
    console.log(JSON.stringify({
      slug, mode,
      draft_path: outPath,
      angles: skel.angles.length,
      next: "have Claude fill the empty arrays, then run: node skills/creative/creative.js " + slug + " lint",
    }, null, 2));
    return;
  }

  if (mode !== "lint") throw new Error(`Unknown mode: ${mode}. Use skeleton or lint.`);

  const brief = loadBrief(slug);
  const approval = brief.approval?.status || brief.status;
  if (approval && approval !== "approved") {
    console.error(`[creative] WARN: strategy brief status="${approval}" — linting anyway, but block /launch until approved`);
  }

  const draftPath = argVal(rest, "--draft") || resolve(ROOT, "clients", slug, "ad_copy_draft.json");
  if (!existsSync(draftPath)) throw new Error(`Draft not found: ${draftPath} — run skeleton mode first`);
  const draft = JSON.parse(readFileSync(draftPath, "utf8"));

  const linted = lintDraft(draft, profile);
  const out = {
    client_slug: slug,
    generated_at: new Date().toISOString(),
    brief_ref: "strategy_brief.json",
    voice_check: {
      restricted_words_screened: getRestrictedWords(profile),
    },
    scoring_rubric: "clarity / specificity / emotional_trigger / cta_strength on 0-10 each; composite is the average",
    limits: LIMITS,
    valid_ctas: Array.from(VALID_CTAS),
    angles: linted.angles,
    summary: linted.summary,
  };

  const outPath = resolve(ROOT, "clients", slug, "ad_copy.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log(JSON.stringify({
    slug, mode,
    output: outPath,
    angles: linted.angles.length,
    total_variants: linted.summary.total_variants,
    non_compliant: linted.summary.non_compliant,
    over_limit: linted.summary.over_limit,
    top_picks: linted.angles.map((a) => ({
      angle: a.name,
      hook: a.hooks.find((h) => h.top_pick)?.hook.text,
      overall: a.hooks.find((h) => h.top_pick)?.best_combo.overall,
    })),
    issues_first_5: linted.summary.issues.slice(0, 5),
    next: linted.summary.non_compliant ? "fix restricted-word hits, then re-lint" : "review ad_copy.json, then /launch",
  }, null, 2));
}

try { main(); } catch (e) {
  console.error("[creative] FATAL:", e.message);
  process.exit(1);
}
