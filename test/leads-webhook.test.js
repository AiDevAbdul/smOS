import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLeadgenIds, enrichLead } from "../skills/leads/leads.js";

// B4 — webhook-first leads.

test("extractLeadgenIds pulls lead refs from a Meta page webhook payload", () => {
  const payload = {
    object: "page",
    entry: [
      {
        id: "PAGE1", time: 1700000000,
        changes: [
          { field: "leadgen", value: { leadgen_id: "L1", page_id: "PAGE1", form_id: "F1", ad_id: "A1", created_time: 1700000000 } },
          { field: "feed", value: { item: "status" } }, // ignored
        ],
      },
      {
        id: "PAGE1", time: 1700000100,
        changes: [{ field: "leadgen", value: { leadgen_id: "L2", form_id: "F2" } }],
      },
    ],
  };
  const refs = extractLeadgenIds(payload);
  assert.equal(refs.length, 2, "should ignore non-leadgen changes");
  assert.equal(refs[0].lead_id, "L1");
  assert.equal(refs[0].form_id, "F1");
  assert.equal(refs[1].lead_id, "L2");
});

test("extractLeadgenIds is robust to empty/malformed payloads", () => {
  assert.deepEqual(extractLeadgenIds(null), []);
  assert.deepEqual(extractLeadgenIds({}), []);
  assert.deepEqual(extractLeadgenIds({ entry: [{ changes: [] }] }), []);
});

test("webhook and poll score an identical lead identically (paths converge)", () => {
  const raw = {
    id: "L1", created_time: "2026-06-30T00:00:00Z", form_id: "F1",
    field_data: [
      { name: "email", values: ["jane@realmail.com"] },
      { name: "full_name", values: ["Jane Doe"] },
      { name: "phone_number", values: ["+1 415 555 1212"] },
    ],
  };
  const enriched = enrichLead(raw);
  assert.equal(enriched.normalized.email, "jane@realmail.com");
  assert.ok(enriched.score >= 70 && enriched.tier === "qualified", `expected qualified, got ${enriched.score}/${enriched.tier}`);
});

test("disposable-email lead is downgraded the same way via the webhook path", () => {
  const enriched = enrichLead({
    id: "L2", form_id: "F1",
    field_data: [{ name: "email", values: ["x@mailinator.com"] }],
  });
  assert.ok(enriched.score_reasons.includes("disposable_email"));
  assert.notEqual(enriched.tier, "qualified");
});
