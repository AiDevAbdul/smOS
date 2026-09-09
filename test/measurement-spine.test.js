import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { makeClient, cleanup } from "./helpers/pipeline.js";
import * as P from "../scripts/lib/paths.js";
import {
  parseDatasetQuality,
  buildEmqSnapshot,
  recordEmqSnapshot,
  emqTrend,
  summarizeEmqTrends,
  emqGaps,
  matchKeyGaps,
  emqBand,
  reconcileConversions,
  recordReconciliation,
  loadSpine,
  spinePath,
  spineSummary,
  measurementSpineMarkdown,
  asCount,
  EMQ_ACTION_THRESHOLD,
} from "../scripts/lib/measurement_spine.js";

// E4 — the measurement spine shared by /capi-setup and /attribution.

// ─────────────────────── Dataset Quality parsing ───────────────────────

const dqNested = {
  data: [
    {
      web: [
        {
          event_name: "Purchase",
          event_match_quality: {
            composite_score: 7.4,
            match_key_feedback: [
              { identifier: "email", coverage: { percentage: 92 }, potential_aly_acr_increase: 1.2 },
              { identifier: "phone_number", coverage: { percentage: 18 } },
            ],
          },
        },
        { event_name: "Lead", event_match_quality: { composite_score: 3.1, match_key_feedback: [] } },
      ],
    },
  ],
};

test("parseDatasetQuality reads the nested data[].web[] shape with match-key coverage", () => {
  const q = parseDatasetQuality(dqNested);
  assert.equal(q.ok, true);
  assert.equal(q.events.length, 2);
  const purchase = q.events.find((e) => e.event_name === "Purchase");
  assert.equal(purchase.composite_score, 7.4);
  assert.equal(purchase.band, "good");
  assert.equal(purchase.match_keys_available, true);
  assert.deepEqual(purchase.match_keys[0], { identifier: "email", coverage_pct: 92, potential_increase: 1.2 });
  assert.equal(purchase.match_keys[1].potential_increase, null); // not returned ⇒ null
});

test("parseDatasetQuality also reads a flat data[] shape and a bare web[]", () => {
  const flat = parseDatasetQuality({ data: [{ event_name: "Purchase", event_match_quality: { composite_score: 8.2 } }] });
  assert.equal(flat.ok, true);
  assert.equal(flat.events[0].band, "great");
  const bare = parseDatasetQuality({ web: [{ event_name: "Lead", event_match_quality: { composite_score: 5 } }] });
  assert.equal(bare.ok, true);
  assert.equal(bare.events[0].band, "ok");
});

test("a missing / errored EMQ response is unavailable with a reason — never a score", () => {
  assert.deepEqual(parseDatasetQuality(null), { ok: false, reason: "no_response", events: [] });
  const err = parseDatasetQuality({ error: { message: "(#100) unsupported" } });
  assert.equal(err.ok, false);
  assert.match(err.reason, /api_error/);
  assert.equal(err.events.length, 0);
  const empty = parseDatasetQuality({ data: [] });
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, "no_event_match_quality_in_response");
});

test("an event Meta returns with no composite_score scores null, not 0", () => {
  const q = parseDatasetQuality({ data: [{ event_name: "Purchase", event_match_quality: { match_key_feedback: [] } }] });
  assert.equal(q.events[0].composite_score, null);
  assert.equal(q.events[0].band, null); // unknown has no band
  assert.equal(emqBand(null), null);
  assert.equal(emqBand(0), "poor"); // a REAL zero is still poor
});

test("dataset_avg_score averages only scored events; unknowns are counted, not zeroed", () => {
  const snap = buildEmqSnapshot({
    pixel_id: "111",
    events: [
      { event_name: "Purchase", composite_score: 8 },
      { event_name: "Lead", composite_score: 6 },
      { event_name: "AddToCart", composite_score: null },
    ],
  });
  assert.equal(snap.dataset_avg_score, 7); // (8+6)/2, NOT (8+6+0)/3
  assert.equal(snap.scored_events, 2);
  assert.equal(snap.unknown_events, 1);
});

test("a snapshot with no scores at all has a null dataset average", () => {
  const snap = buildEmqSnapshot({ pixel_id: "1", events: [], source: "offline", unavailable_reason: "SMOS_OFFLINE=1" });
  assert.equal(snap.dataset_avg_score, null);
  assert.equal(snap.source, "offline");
  assert.equal(snap.unavailable_reason, "SMOS_OFFLINE=1");
});

// ─────────────────────────── trends ───────────────────────────

const seriesOf = (...scoreSets) =>
  scoreSets.map((scores, i) =>
    buildEmqSnapshot({
      pixel_id: "111",
      captured_at: `2026-09-0${i + 1}T00:00:00.000Z`,
      events: Object.entries(scores).map(([event_name, composite_score]) => ({ event_name, composite_score })),
    }),
  );

test("one sample yields no direction and no delta", () => {
  const t = emqTrend(seriesOf({ Purchase: 5.5 }), "Purchase");
  assert.equal(t.samples, 1);
  assert.equal(t.current, 5.5);
  assert.equal(t.previous, null);
  assert.equal(t.delta, null);
  assert.equal(t.direction, null);
  assert.match(t.note, /single sample/);
});

test("two samples give delta + direction, and best/worst/mean over the series", () => {
  const s = seriesOf({ Purchase: 5.0 }, { Purchase: 6.4 }, { Purchase: 6.1 });
  const t = emqTrend(s, "Purchase");
  assert.equal(t.samples, 3);
  assert.equal(t.current, 6.1);
  assert.equal(t.previous, 6.4);
  assert.equal(t.delta, -0.3);
  assert.equal(t.direction, "declining");
  assert.equal(t.best, 6.4);
  assert.equal(t.worst, 5);
  assert.equal(t.mean, 5.83);
});

test("a move inside the noise floor is flat, not a direction", () => {
  const t = emqTrend(seriesOf({ Purchase: 7.0 }, { Purchase: 7.05 }), "Purchase");
  assert.equal(t.direction, "flat");
});

test("a run where EMQ was unavailable is not a sample and cannot fake a trend", () => {
  const withGap = [
    ...seriesOf({ Purchase: 7.2 }),
    buildEmqSnapshot({ pixel_id: "111", captured_at: "2026-09-05T00:00:00.000Z", events: [{ event_name: "Purchase", composite_score: null }], source: "unavailable", unavailable_reason: "api_error" }),
  ];
  const t = emqTrend(withGap, "Purchase");
  assert.equal(t.samples, 1);
  assert.equal(t.direction, null);
  assert.equal(t.current, 7.2); // the last KNOWN score, not null-overwritten
});

test("an event that never had a score reports unknown, not zero", () => {
  const t = emqTrend(seriesOf({ Purchase: 7 }), "Lead");
  assert.equal(t.samples, 0);
  assert.equal(t.current, null);
  assert.equal(t.direction, null);
  assert.match(t.note, /unknown, not zero/);
  assert.equal(summarizeEmqTrends(seriesOf({ Purchase: 7 })).length, 1); // only events seen
});

// ─────────────────────────── gaps ───────────────────────────

test("emqGaps flags a low score and a decline, and never gaps on an unknown", () => {
  const s = seriesOf({ Purchase: 7.0, Lead: 4.2 }, { Purchase: 6.0, Lead: 4.2 });
  const trends = summarizeEmqTrends(s);
  const gaps = emqGaps(trends, s[s.length - 1]);
  assert.ok(gaps.some((g) => g.includes("'Lead'") && g.includes(String(EMQ_ACTION_THRESHOLD))));
  assert.ok(gaps.some((g) => g.includes("'Purchase'") && g.includes("fell")));
  const unknownOnly = emqGaps(summarizeEmqTrends([buildEmqSnapshot({ events: [{ event_name: "Purchase", composite_score: null }] })]), buildEmqSnapshot({ events: [] }));
  assert.deepEqual(unknownOnly, []);
});

test("emqGaps says EMQ is unknown (one line, no per-event claims) when the capture failed", () => {
  const snap = buildEmqSnapshot({ events: [], source: "offline", unavailable_reason: "SMOS_OFFLINE=1" });
  const gaps = emqGaps([{ event_name: "Purchase", current: 3, current_band: "poor", direction: "declining", delta: -1 }], snap);
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /Event Match Quality is unknown/);
});

test("matchKeyGaps only names keys whose coverage the API actually returned", () => {
  const snap = buildEmqSnapshot({
    events: [{
      event_name: "Purchase",
      composite_score: 7,
      match_keys: [
        { identifier: "phone_number", coverage_pct: 12, potential_increase: null },
        { identifier: "email", coverage_pct: 98, potential_increase: null },
        { identifier: "external_id", coverage_pct: null, potential_increase: null },
      ],
      match_keys_available: true,
    }],
  });
  const gaps = matchKeyGaps(snap);
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /phone_number covers only 12%/);
});

// ──────────────── modeled vs observed reconciliation ────────────────

test("reconcile computes gap, gap_pct, coverage ratio and labels both sides", () => {
  const r = reconcileConversions({
    platform_reported: 100, observed: 80,
    platform_source: "performance_analysis.json", observed_source: "crm",
    observed_audited: true, event: "Lead", window: "last_7d",
  });
  assert.equal(r.gap, -20);
  assert.equal(r.gap_pct, -20);
  assert.equal(r.coverage_ratio, 0.8);
  assert.equal(r.verdict, "platform_over_reported");
  assert.equal(r.platform_reported.basis, "platform_reported");
  assert.equal(r.platform_reported.audited, false);
  assert.equal(r.observed.basis, "audited");
  assert.equal(r.observed.audited, true);
});

test("observed above platform is platform_under_reported (the CAPI signal-loss case)", () => {
  const r = reconcileConversions({ platform_reported: 50, observed: 70, observed_audited: true });
  assert.equal(r.coverage_ratio, 1.4);
  assert.equal(r.verdict, "platform_under_reported");
});

test("within tolerance is aligned", () => {
  const r = reconcileConversions({ platform_reported: 100, observed: 103, observed_audited: true });
  assert.equal(r.verdict, "aligned");
});

test("a zero platform denominator yields a null ratio WITH the reason, not Infinity", () => {
  const r = reconcileConversions({ platform_reported: 0, observed: 12, observed_audited: true });
  assert.equal(r.coverage_ratio, null);
  assert.equal(r.gap_pct, null);
  assert.equal(r.gap, 12);
  assert.equal(r.verdict, "unknown");
  assert.ok(r.notes.some((n) => n.includes("no denominator")));
});

test("either side unknown ⇒ nulls and a stated reason, never 0", () => {
  const noObserved = reconcileConversions({ platform_reported: 40, platform_source: "performance_analysis.json" });
  assert.equal(noObserved.observed.value, null);
  assert.equal(noObserved.gap, null);
  assert.equal(noObserved.coverage_ratio, null);
  assert.equal(noObserved.verdict, "unknown");
  assert.ok(noObserved.notes.some((n) => n.includes("observed conversions unknown")));

  const noPlatform = reconcileConversions({ observed: 40, observed_source: "crm", observed_audited: true });
  assert.equal(noPlatform.platform_reported.value, null);
  assert.ok(noPlatform.notes.some((n) => n.includes("platform-reported conversions unknown")));
});

test("an undeclared observed side is labeled observed_unverified and says so", () => {
  const r = reconcileConversions({ platform_reported: 10, observed: 10, observed_source: "spreadsheet" });
  assert.equal(r.observed.basis, "observed_unverified");
  assert.ok(r.notes.some((n) => n.includes("NOT declared audited")));
});

test("asCount rejects junk instead of coercing it to 0", () => {
  assert.equal(asCount("12"), 12);
  assert.equal(asCount(0), 0);
  assert.equal(asCount(-1), null);
  assert.equal(asCount("abc"), null);
  assert.equal(asCount(null), null);
  assert.equal(asCount(undefined), null);
  assert.equal(asCount(""), null);
});

// ─────────────────── ledger persistence + handoff ───────────────────

const SLUG = "__it_spine";

test("spine round-trips to clients/<slug>/data/measurement_spine.json", () => {
  try {
    makeClient(SLUG, {});
    assert.equal(loadSpine(SLUG).emq_series.length, 0);

    const snap = buildEmqSnapshot({ pixel_id: "999", captured_at: "2026-09-01T00:00:00.000Z", events: [{ event_name: "Purchase", composite_score: 6.5 }] });
    const first = recordEmqSnapshot(SLUG, snap);
    assert.equal(first.appended, true);

    // Canonical bucket, per paths.js — data/, not the client root.
    const p = spinePath(SLUG);
    assert.equal(p, P.clientData(SLUG, "measurement_spine.json"));
    assert.ok(existsSync(p));
    assert.equal(JSON.parse(readFileSync(p, "utf8")).emq_series.length, 1);

    // Identical re-run on the same day does NOT create a second point.
    const dupe = recordEmqSnapshot(SLUG, snap);
    assert.equal(dupe.appended, false);
    assert.equal(dupe.reason, "duplicate_snapshot");
    assert.equal(loadSpine(SLUG).emq_series.length, 1);

    // A changed score on the same day IS a new point.
    const moved = recordEmqSnapshot(SLUG, { ...snap, events: [{ event_name: "Purchase", composite_score: 7.1, band: "good", match_keys: [] }] });
    assert.equal(moved.appended, true);
    const trend = moved.trends.find((t) => t.event_name === "Purchase");
    assert.equal(trend.samples, 2);
    assert.equal(trend.direction, "improving");
  } finally {
    cleanup(SLUG);
  }
});

test("spineSummary is the handoff /attribution reads; it is honest when empty", () => {
  try {
    makeClient(SLUG, {});
    const empty = spineSummary(SLUG);
    assert.equal(empty.available, false);
    assert.equal(empty.emq.dataset_avg_score, null);
    assert.match(empty.emq.unavailable_reason, /no EMQ snapshot recorded yet/);
    assert.equal(empty.reconciliation, null);
    assert.match(measurementSpineMarkdown(empty), /reported as unknown/);

    recordEmqSnapshot(SLUG, buildEmqSnapshot({ pixel_id: "999", events: [{ event_name: "Purchase", composite_score: 8.1 }] }));
    recordReconciliation(SLUG, reconcileConversions({ platform_reported: 100, observed: 90, observed_source: "crm", observed_audited: true, window: "last_7d" }));

    const s = spineSummary(SLUG);
    assert.equal(s.available, true);
    assert.equal(s.emq.dataset_avg_score, 8.1);
    assert.equal(s.samples.emq_snapshots, 1);
    assert.equal(s.samples.reconciliations, 1);
    assert.equal(s.reconciliation.coverage_ratio, 0.9);

    const md = measurementSpineMarkdown(s);
    assert.match(md, /Platform-reported \(modeled\)/);
    assert.match(md, /audited/);
    assert.match(md, /Coverage ratio/);
  } finally {
    cleanup(SLUG);
  }
});

test("a corrupt spine reports corrupt rather than pretending there is no history", () => {
  try {
    makeClient(SLUG, {});
    const p = spinePath(SLUG, { forWrite: true });
    writeFileSync(p, "{ not json");
    const s = loadSpine(SLUG);
    assert.equal(s.corrupt, true);
    assert.equal(spineSummary(SLUG).corrupt, true);
  } finally {
    cleanup(SLUG);
  }
});
