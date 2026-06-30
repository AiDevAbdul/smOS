// Locks in the canonical file-layout contract (scripts/lib/paths.js). If someone
// changes the layout, these fail — the structure can't silently drift again.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../scripts/lib/paths.js";

const tail = (p, n = 4) => p.split("/").slice(-n).join("/");

test("client buckets resolve to the four canonical locations", () => {
  assert.equal(tail(P.clientProfile("acme"), 2), "acme/profile.json");
  assert.equal(tail(P.clientData("acme", "ad_copy.json"), 3), "acme/data/ad_copy.json");
  assert.equal(tail(P.clientState("acme", "sent.json"), 3), "acme/state/sent.json");
});

test("deliverables are grouped BY ARTIFACT (md/html/pdf together)", () => {
  assert.equal(tail(P.clientDeliverable("acme", "strategy-brief", "pdf"), 3),
    "deliverables/strategy-brief/strategy-brief.pdf");
  assert.equal(tail(P.clientDeliverable("acme", "ad-copy", "html"), 3),
    "deliverables/ad-copy/ad-copy.html");
});

test("reports are one dated folder per run, raw data alongside", () => {
  assert.equal(tail(P.clientReport("acme", "2026-06-19", "weekly", "pdf"), 2),
    "2026-06-19/weekly.pdf");
  assert.equal(tail(P.clientReport("acme", "2026-06-19", "weekly", "raw.json"), 2),
    "2026-06-19/weekly.raw.json");
});

test("prospect + global helpers resolve correctly", () => {
  assert.equal(tail(P.prospectDeliverable("foo", "pre-audit", "pdf"), 3),
    "deliverables/pre-audit/pre-audit.pdf");
  assert.equal(tail(P.prospectRaw("foo", "raw_self_2026-06-21.json"), 3),
    "data/raw/raw_self_2026-06-21.json");
  assert.equal(tail(P.researchCache("cat_auto.json"), 2), "research-cache/cat_auto.json");
});

test("artifact maps are coherent (legacy basenames map to kebab folders)", () => {
  assert.equal(P.DELIVERABLE_ARTIFACTS.strategy_brief, "strategy-brief");
  assert.ok(P.DATA_FILES.includes("strategy_brief.json"));
  assert.ok(P.STATE_FILES.includes("sent.json"));
});

test("resolveExisting prefers the canonical path, falls back to legacy", () => {
  // Neither exists → returns the preferred (canonical) for writers.
  const pref = P.clientData("nonexistent-xyz", "x.json");
  const leg = P.legacy.clientFlat("nonexistent-xyz", "x.json");
  assert.equal(P.resolveExisting(pref, leg), pref);
});
