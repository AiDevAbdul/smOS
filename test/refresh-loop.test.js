import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate both the approvals store and the client data root BEFORE importing —
// these libs resolve their dirs per-call from env, so setting it here is honored.
const APPROVALS_DIR = mkdtempSync(join(tmpdir(), "smos-approvals-"));
const DATA_ROOT = mkdtempSync(join(tmpdir(), "smos-data-"));
process.env.SMOS_APPROVALS_DIR = APPROVALS_DIR;
process.env.SMOS_DATA_ROOT = DATA_ROOT;

const { spawnRefreshQueue, collectApprovedRefreshes, buildRefreshBrief } = await import("../scripts/lib/refresh-loop.js");
const { decide } = await import("../scripts/lib/approvals.js");
const P = await import("../scripts/lib/paths.js");

test.after(() => {
  rmSync(APPROVALS_DIR, { recursive: true, force: true });
  rmSync(DATA_ROOT, { recursive: true, force: true });
});

const SLUG = "acme-refresh";

const FATIGUED_AD = {
  id: "ad_1", name: "VID_PAIN_v1", campaign_id: "camp_1", adset_id: "adset_1",
  flag: "FATIGUE_HIGH", refresh_priority_score: 42.5,
};

test("buildRefreshBrief maps fatigue flag to an angle and starts pending_approval", () => {
  const brief = buildRefreshBrief(SLUG, FATIGUED_AD);
  assert.equal(brief.ad_id, "ad_1");
  assert.equal(brief.angle, "new_hook_same_offer");
  assert.equal(brief.status, "pending_approval");
  assert.equal(brief.approval_id, null);
});

test("spawnRefreshQueue files one approval request per queued ad and persists refresh_briefs.json", async () => {
  const creativeIntel = { refresh_queue: [FATIGUED_AD] };
  const { spawned, path } = await spawnRefreshQueue(SLUG, creativeIntel);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].ad_id, "ad_1");
  assert.ok(spawned[0].approval_id);

  const onDisk = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(onDisk.briefs.length, 1);
  assert.equal(onDisk.briefs[0].status, "pending_approval");
});

test("spawnRefreshQueue is idempotent — re-running does not duplicate a pending brief", async () => {
  const creativeIntel = { refresh_queue: [FATIGUED_AD] };
  const first = await spawnRefreshQueue(SLUG, creativeIntel);
  const second = await spawnRefreshQueue(SLUG, creativeIntel);
  assert.equal(second.spawned.length, 1);
  assert.equal(second.spawned[0].approval_id, first.spawned[0].approval_id);
});

test("collectApprovedRefreshes stays empty until a human approves, then promotes it", async () => {
  const creativeIntel = { refresh_queue: [{ ...FATIGUED_AD, id: "ad_2", name: "IMG_PROOF_v1" }] };
  const { spawned } = await spawnRefreshQueue(SLUG, creativeIntel);
  const brief = spawned.find((b) => b.ad_id === "ad_2");

  assert.equal(collectApprovedRefreshes(SLUG).some((b) => b.ad_id === "ad_2"), false);

  await decide({ id: brief.approval_id, decision: "approved", decidedBy: "abdul", role: "manager" });

  const ready = collectApprovedRefreshes(SLUG);
  assert.ok(ready.some((b) => b.ad_id === "ad_2"));
});
