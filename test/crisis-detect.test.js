/**
 * E5 crisis detection — the rule-based spike/negative-sentiment detector.
 *
 * The invariants under test are the ones that stop it lying: it never fires off
 * a single datapoint (insufficient baseline ⇒ severity null), a signal with no
 * data is removed from the DENOMINATOR rather than scored zero, and a
 * low-confidence verdict is flagged provisional instead of presented as a
 * finding.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectCrisis, rollingBaseline, sentimentSkew,
  MIN_BASELINE_POINTS, MIN_CLASSIFIED_MENTIONS,
} from "../scripts/lib/listening_depth.js";

const points = (...vals) => vals.map((v, i) => ({ captured_at: `2026-09-0${i + 1}T00:00:00Z`, mentions: v }));
const mentions = (list) => list.map((s, i) => ({ mention_id: `m${i}`, text: "t", sentiment: s }));

// ───────────────────────────── baseline ─────────────────────────────

test("rollingBaseline refuses to produce a mean below the minimum point count", () => {
  const b = rollingBaseline(points(3, 4));
  assert.equal(b.mean, null);
  assert.equal(b.stddev, null);
  assert.equal(b.sufficient, false);
  assert.equal(b.required, MIN_BASELINE_POINTS);
});

test("rollingBaseline computes mean/sd over the trailing window", () => {
  const b = rollingBaseline(points(2, 2, 2, 2, 2), { window: 3 });
  assert.equal(b.mean, 2);
  assert.equal(b.stddev, 0);
  assert.equal(b.points, 3);
  assert.equal(b.sufficient, true);
});

// ───────────────────────── sentiment sufficiency ─────────────────────────

test("sentimentSkew is null (not 0) until enough mentions carry a verdict", () => {
  const s = sentimentSkew(mentions(["negative", null, null]));
  assert.equal(s.negative_share, null);
  assert.equal(s.sufficient, false);
  assert.equal(s.classified, 1);
  assert.equal(s.required, MIN_CLASSIFIED_MENTIONS);
  assert.equal(s.unclassified, 2);
});

test("sentimentSkew computes the negative share of CLASSIFIED mentions only", () => {
  const s = sentimentSkew(mentions(["negative", "negative", "negative", "positive", "neutral", null]));
  assert.equal(s.classified, 5);
  assert.equal(s.negative, 3);
  assert.equal(s.negative_share, 0.6);
  assert.equal(s.sufficient, true);
});

// ───────────────────────── the detector itself ─────────────────────────

test("crisis NEVER fires off one datapoint — insufficient baseline ⇒ severity null", () => {
  const c = detectCrisis({ current: 500, priorPoints: points(1), mentions: mentions(["negative", "negative"]) });
  assert.equal(c.severity, null);
  assert.equal(c.status, "insufficient_data");
  assert.equal(c.confidence, null);
  assert.match(c.reasons.join(" "), /prior listening point/);
  assert.deepEqual(c.evidence, []);
});

test("a quiet capture on a real baseline scores severity none", () => {
  const c = detectCrisis({ current: 5, priorPoints: points(4, 5, 6, 5, 4), mentions: mentions(["positive", "neutral", "positive", "neutral", "positive"]) });
  assert.equal(c.status, "computed");
  assert.equal(c.severity, "none");
  assert.equal(c.score, 0);
  assert.equal(c.requires_human, false);
});

test("a 5x volume spike with a majority-negative skew escalates to critical with evidence", () => {
  const c = detectCrisis({
    current: 25,
    priorPoints: points(4, 5, 6, 5, 5),
    mentions: mentions(["negative", "negative", "negative", "negative", "neutral", "positive"]),
  });
  assert.equal(c.severity, "critical");
  assert.equal(c.confidence, 1, "all three signals had data");
  assert.equal(c.severity_provisional, false);
  assert.equal(c.requires_human, true);
  assert.match(c.evidence.join(" | "), /5x/);
  assert.match(c.evidence.join(" | "), /negative/);
  const vol = c.signals.find((s) => s.name === "volume_spike");
  assert.equal(vol.detail.ratio, 5);
});

test("an unmeasured signal is removed from the denominator, not scored zero", () => {
  // Volume spike is a clean 4x; sentiment is entirely unclassified.
  const c = detectCrisis({ current: 20, priorPoints: points(5, 5, 5, 5, 5), mentions: mentions([null, null, null]) });
  const skew = c.signals.find((s) => s.name === "negative_skew");
  assert.equal(skew.score, null, "no verdicts ⇒ excluded");
  assert.match(skew.reason, /sentiment verdict/);
  // Scored on volume (3) + velocity (2) only — a zero for sentiment would have
  // diluted a genuine 4x spike down out of critical.
  assert.equal(c.confidence, 0.63);
  assert.equal(c.severity, "critical");
});

test("a verdict resting on under half the weighting is flagged provisional", () => {
  // volume_spike (3) + velocity (2) of 8 can score; sentiment cannot.
  const prior = [{ captured_at: "a", mentions: 5 }, { captured_at: "b", mentions: 5 }, { captured_at: "c", mentions: 5 }, { captured_at: "d", mentions: 5 }, { captured_at: "e", mentions: 5 }];
  const c = detectCrisis({ current: 20, priorPoints: prior, mentions: mentions([null]) });
  assert.equal(c.severity, "critical");
  assert.equal(c.confidence, 0.63);
  assert.equal(c.severity_provisional, false);

  // Now strip the velocity signal too by making current unknown-adjacent: a
  // baseline built from a field the points do not carry.
  const noVelocity = detectCrisis({ current: null, priorPoints: prior, mentions: mentions(["negative", "negative", "negative", "negative", "negative"]) });
  assert.equal(noVelocity.signals.find((s) => s.name === "volume_spike").score, null);
  assert.equal(noVelocity.confidence, 0.38);
  assert.equal(noVelocity.severity_provisional, true, "under 50% of the weighting had data");
});

test("a zero baseline yields no ratio — undefined, not infinite", () => {
  const c = detectCrisis({ current: 4, priorPoints: points(0, 0, 0, 0, 0), mentions: mentions([]) });
  const vol = c.signals.find((s) => s.name === "volume_spike");
  assert.equal(vol.detail.ratio, null);
  assert.equal(vol.score, 1);
  assert.match(c.evidence.join(" "), /ratio undefined/);
});

test("velocity uses the most recent comparable point", () => {
  const c = detectCrisis({ current: 12, priorPoints: points(6, 6, 6, 6, 6), mentions: mentions([]) });
  const vel = c.signals.find((s) => s.name === "velocity");
  assert.equal(vel.detail.previous, 6);
  assert.equal(vel.detail.delta, 6);
  assert.ok(vel.score > 0);
});

test("no signal with data at all ⇒ insufficient_data, never a severity", () => {
  const c = detectCrisis({ current: null, priorPoints: points(1, 1, 1, 1, 1), mentions: [] });
  assert.equal(c.severity, null);
  assert.equal(c.status, "insufficient_data");
  assert.equal(c.confidence, 0);
});
