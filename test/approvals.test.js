import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the approvals store to a temp dir BEFORE importing the module. The lib
// resolves the dir per-call (storeDir()), so setting env here is honored.
const DIR = mkdtempSync(join(tmpdir(), "smos-approvals-"));
process.env.SMOS_APPROVALS_DIR = DIR;

const {
  requestApproval, decide, isApproved, requireApproval, findApproved,
  ApprovalRequired, sweepExpired,
} = await import("../scripts/lib/approvals.js");

test.after(() => rmSync(DIR, { recursive: true, force: true }));

test("requireApproval fails CLOSED when no record exists", () => {
  assert.throws(() => requireApproval("budget_increase_over_500", { slug: "acme" }), ApprovalRequired);
});

test("pending request does not grant approval", async () => {
  const rec = await requestApproval({ slug: "acme", action: "campaign_launch_over_200" });
  assert.equal(rec.status, "pending");
  assert.equal(isApproved(rec.id), false);
  assert.throws(() => requireApproval("campaign_launch_over_200", { slug: "acme", approvalId: rec.id }), ApprovalRequired);
});

test("approved by sufficient role grants, then requireApproval passes", async () => {
  const rec = await requestApproval({ slug: "beta", action: "campaign_launch_over_200" }); // requires manager
  const decided = await decide({ id: rec.id, decision: "approved", decidedBy: "abdul", role: "manager" });
  assert.equal(decided.status, "approved");
  assert.equal(isApproved(rec.id), true);
  const found = requireApproval("campaign_launch_over_200", { slug: "beta" });
  assert.equal(found.id, rec.id);
});

test("decision by INSUFFICIENT role is rejected (fail-closed)", async () => {
  const rec = await requestApproval({ slug: "gamma", action: "destructive_op" }); // requires owner
  await assert.rejects(
    () => decide({ id: rec.id, decision: "approved", decidedBy: "junior", role: "analyst" }),
    /below required/
  );
  assert.equal(isApproved(rec.id), false);
});

test("rejected stays blocked", async () => {
  const rec = await requestApproval({ slug: "delta", action: "targeting_change" });
  await decide({ id: rec.id, decision: "rejected", role: "manager" });
  assert.equal(isApproved(rec.id), false);
});

test("deciding an already-expired record fails closed", async () => {
  const rec = await requestApproval({ slug: "eps", action: "off_hours_action", ttlMinutes: -1 });
  await assert.rejects(() => decide({ id: rec.id, decision: "approved", role: "manager" }), /expired/);
  assert.equal(isApproved(rec.id), false);
});

test("sweepExpired flips a stale pending→expired", async () => {
  const rec = await requestApproval({ slug: "eps2", action: "off_hours_action", ttlMinutes: -1 });
  const swept = await sweepExpired(); // no decide() first, so it's still pending
  assert.ok(swept.includes(rec.id));
  assert.equal(isApproved(rec.id), false);
});

test("findApproved scopes by slug + action", async () => {
  const rec = await requestApproval({ slug: "zeta", action: "go_live" });
  await decide({ id: rec.id, decision: "approved", role: "owner" });
  assert.equal(findApproved("zeta", "go_live").id, rec.id);
  assert.equal(findApproved("other", "go_live"), null);
});
