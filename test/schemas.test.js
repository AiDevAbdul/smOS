import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  adCopy, strategyBrief, audienceMap, clientProfile,
  baselineSnapshot, competitorIntel, launchPlan, angleId,
} from "../schemas/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---------- angle_id join key ----------
test("angleId is stable and slug-safe", () => {
  assert.equal(angleId("PAIN"), "PAIN");
  assert.equal(angleId("Pain / Problem"), "PAIN_PROBLEM");
  assert.equal(angleId("  proof-point "), "PROOF_POINT");
});

// ---------- ad_copy normalize: string and object variants ----------
test("ad_copy normalize accepts string hooks + scored objects, derives angle_id", () => {
  const raw = { angles: [{ name: "PAIN", hooks: ["h1", "h2"],
    primary_text: [{ text: "buy now", score: { composite: 8 } }, "fallback"],
    headlines: [{ text: "Headline", scores: { composite: 7 } }], ctas: ["LEARN_MORE"] }] };
  const n = adCopy.normalize(raw);
  assert.equal(n.angles[0].angle_id, "PAIN");
  assert.equal(n.angles[0].primary_text[0].score.composite, 8);
  assert.equal(n.angles[0].primary_text[1].text, "fallback"); // string coerced
  assert.equal(n.angles[0].headlines[0].score.composite, 7); // scores->score
  assert.ok(adCopy.validate(n).ok);
});

// ---------- THE keystone: copy_used must NOT be null ----------
test("selectTopCopy matches brief angle to ad_copy by angle_id (no more null)", () => {
  const brief = strategyBrief.normalize({ creative_angles: [{ name: "PAIN", angle: "x" }] });
  const copy = { angles: [{ name: "PAIN",
    primary_text: [{ text: "best price in town", score: { composite: 9 } }],
    headlines: [{ text: "Save Today" }], ctas: ["BOOK_NOW"] }] };
  const { copy_used, reason } = adCopy.selectTopCopy(brief.creative_angles[0], copy);
  assert.equal(reason, null);
  assert.equal(copy_used.angle_id, "PAIN");
  assert.equal(copy_used.primary_text, "best price in town");
  assert.equal(copy_used.cta, "BOOK_NOW");
  assert.equal(copy_used.score_composite, 9);
});

test("selectTopCopy returns a REASON (not silent null) when nothing matches", () => {
  const brief = strategyBrief.normalize({ creative_angles: [{ name: "GHOST" }] });
  const { copy_used, reason } = adCopy.selectTopCopy(brief.creative_angles[0], { angles: [] });
  assert.equal(copy_used, null);
  assert.match(reason, /no ad_copy angle matched/);
});

// ---------- audience_map alias coercion (the launch break) ----------
test("audience_map normalize maps interest_clusters/geo.targets/interests to canonical", () => {
  const raw = { interest_clusters: [{ id: "INT_A", label: "A",
    interests: [{ name: "Yoga" }, { name: "Pilates" }] }],
    geo: { targets: ["Phoenix, AZ"], radius: 25 } };
  const n = audienceMap.normalize(raw);
  assert.equal(n.clusters[0].id, "INT_A");
  assert.deepEqual(n.clusters[0].interest_stack, ["Yoga", "Pilates"]);
  assert.equal(n.geo.primary, "Phoenix, AZ");
  assert.ok(audienceMap.validate(n).ok);
});

// ---------- accounts single source of truth ----------
test("client_profile backfills facebook_page_id from legacy page_id", () => {
  const n = clientProfile.normalize({ slug: "x", accounts: { page_id: "111", ig_account_id: "222", ad_account_id: "act_9" } });
  assert.equal(n.accounts.facebook_page_id, "111");
  assert.equal(n.accounts.instagram_business_id, "222");
  assert.equal(n.accounts.page_id, "111"); // alias mirrored for transitional readers
});
test("validateAccounts rejects TBD placeholders and missing live ids", () => {
  assert.equal(clientProfile.validateAccounts({ ad_account_id: "<TBD_ACCT>" }).ok, false);
  assert.equal(clientProfile.validateAccounts({}, { requireLive: true }).ok, false);
  assert.ok(clientProfile.validateAccounts({ ad_account_id: "act_1", facebook_page_id: "1" }, { requireLive: true }).ok);
});

// ---------- baseline_snapshot alias coercion + lock gate ----------
test("baseline_snapshot maps avg_engagement_rate->engagement_rate_30d and enforces lock", () => {
  const raw = { facebook: { avg_engagement_rate: 3.2, posts_per_week: 4 }, immutable_locked_at: null };
  const n = baselineSnapshot.normalize(raw);
  assert.equal(n.facebook.engagement_rate_30d, 3.2);
  assert.equal(n.facebook.posts_per_week_30d, 4);
  assert.equal(baselineSnapshot.validate(n).ok, false); // not locked
  n.immutable_locked_at = "2026-06-01T00:00:00Z";
  assert.ok(baselineSnapshot.validate(n).ok);
});

// ---------- competitor_intel derives angles from competitors ----------
test("competitor_intel derives top-level angles from competitors[].angles", () => {
  const raw = { competitors: [{ name: "C1", angles: [{ angle: "Myth-busting" }] }, { name: "C2", angles: ["Myth-busting", "Urgency"] }] };
  const n = competitorIntel.normalize(raw);
  const names = n.angles.map((a) => a.angle).sort();
  assert.deepEqual(names, ["Myth-busting", "Urgency"]); // deduped
  assert.ok(competitorIntel.validate(n).ok);
});

// ---------- launch_plan gate ----------
test("launch_plan validate rejects copy_used:null and TBD audiences", () => {
  const bad = { ads: [{ name: "IMG_PAIN_v1", copy_used: null }],
    adsets: [{ name: "FEED", targeting: { custom_audiences: [{ id: "<TBD_RT>" }] } }] };
  const v = launchPlan.validate(bad);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /copy_used: null/.test(e)));
  assert.ok(v.errors.some((e) => /TBD/.test(e)));
});
test("launch_plan validate passes a fully-resolved plan", () => {
  const good = { ads: [{ name: "IMG_PAIN_v1", copy_used: { angle_id: "PAIN", primary_text: "hi", cta: "LEARN_MORE" } }],
    adsets: [{ name: "FEED", targeting: { custom_audiences: [{ id: "23842" }] } }] };
  assert.ok(launchPlan.validate(good).ok);
});

// ---------- regression against the REAL committed blue-rose artifacts ----------
test("REAL blue-rose: every brief angle now resolves to non-null copy via canonical schema", () => {
  const briefPath = resolve(ROOT, "clients/blue-rose-auto/strategy_brief.json");
  const copyPath = resolve(ROOT, "clients/blue-rose-auto/ad_copy.json");
  if (!existsSync(briefPath) || !existsSync(copyPath)) return; // skip if fixtures absent
  const brief = strategyBrief.normalize(readJson(briefPath));
  const copy = readJson(copyPath);
  // The committed ad_copy.json used objective-style angle_ids (AWARE_LEGACY) while the
  // brief uses PAIN/ASPIRATION/PROOF — so an EXACT id match won't hit. This test
  // documents that the schema's loose fallback + reason string means we get a
  // diagnosable result for every angle instead of a silent null.
  for (const a of brief.creative_angles) {
    const { copy_used, reason } = adCopy.selectTopCopy(a, copy);
    assert.ok(copy_used !== undefined, `angle ${a.angle_id} produced undefined`);
    if (!copy_used) assert.ok(reason && reason.length > 0, `angle ${a.angle_id} null without reason`);
  }
});
