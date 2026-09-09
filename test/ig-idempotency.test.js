import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
// Keep the publish ledger out of the real state dir (see A3).
if (!process.env.SMOS_DATA_ROOT) process.env.SMOS_DATA_ROOT = resolve(ROOT, "test", ".tmp");

const state = await import("../scripts/lib/ig_publish_state.js");
const publishing = await import("../mcp/meta-server/tools/publishing.js");

function freshLedger() {
  const p = state.ledgerPath();
  if (existsSync(p)) rmSync(p);
}

/** Mock Graph client: records posts, returns sequential container/media ids. */
function mockClient({ failOn = null } = {}) {
  let n = 0;
  const posts = [];
  return {
    posts,
    post: async (path, body) => {
      posts.push({ path, body });
      if (failOn && path.includes(failOn)) throw new Error(`boom on ${path}`);
      n++;
      return { id: path.endsWith("/media_publish") ? `media_${n}` : `cont_${n}` };
    },
    get: async () => ({ status_code: "FINISHED" }),
  };
}

test("key: identical intent → identical key; any change → a different key", () => {
  const base = { ig_user_id: "17841", media_type: "IMAGE", caption: "hi", urls: ["https://x/a.jpg"] };
  assert.equal(state.igIdempotencyKey(base), state.igIdempotencyKey({ ...base }));
  assert.notEqual(state.igIdempotencyKey(base), state.igIdempotencyKey({ ...base, caption: "hi!" }));
  assert.notEqual(state.igIdempotencyKey(base), state.igIdempotencyKey({ ...base, ig_user_id: "9" }));
  // Slide order is meaningful for a carousel.
  assert.notEqual(
    state.igIdempotencyKey({ ...base, urls: ["a", "b"] }),
    state.igIdempotencyKey({ ...base, urls: ["b", "a"] })
  );
  // A nonce is the deliberate way to post the same thing twice.
  assert.notEqual(state.igIdempotencyKey(base), state.igIdempotencyKey({ ...base, nonce: "2" }));
});

test("ledger: claim → container → published, then a repeat replays", () => {
  freshLedger();
  const key = "k_replay";
  assert.equal(state.beginPublish(key).action, "create");
  state.recordContainer(key, "cont_1");
  assert.equal(state.beginPublish(key).action, "resume"); // mid-flight retry resumes
  state.recordPublished(key, "media_1");
  const again = state.beginPublish(key);
  assert.equal(again.action, "replay");
  assert.equal(again.media_id, "media_1");
});

test("ledger: a failed flow records its containers as orphans", () => {
  freshLedger();
  const key = "k_orphan";
  state.beginPublish(key);
  state.recordContainer(key, "child_a", { child: true });
  state.recordContainer(key, "child_b", { child: true });
  state.markOrphaned(key, "encoding failed");
  const orphans = state.listOrphans();
  assert.equal(orphans.length, 2);
  assert.equal(orphans[0].reason, "encoding failed");
  assert.equal(state.getEntry(key).status, "failed");
});

test("ledger: prune drops expired entries, keeps fresh ones", () => {
  freshLedger();
  state.beginPublish("k_old");
  state.recordPublished("k_old", "m1");
  state.beginPublish("k_new");
  const future = Date.now() + state.PUBLISHED_TTL_MS + 60_000;
  const { removed, kept } = state.pruneLedger(future);
  assert.equal(removed, 2); // both are past their TTL at that clock
  assert.equal(kept, 0);
});

test("create_ig_media: a repeated identical call publishes ONCE", async () => {
  freshLedger();
  const client = mockClient();
  const args = { ig_user_id: "17841", media_type: "IMAGE", image_url: "https://x/a.jpg", caption: "same" };

  const first = await publishing.handle("create_ig_media", args, client);
  assert.equal(first.media_id, "media_2");
  assert.equal(client.posts.length, 2); // /media + /media_publish

  const second = await publishing.handle("create_ig_media", args, client);
  assert.equal(second.replayed, true);
  assert.equal(second.media_id, first.media_id);
  assert.equal(client.posts.length, 2); // no new HTTP writes at all
});

test("create_ig_media: an explicit nonce deliberately posts again", async () => {
  freshLedger();
  const client = mockClient();
  const args = { ig_user_id: "17841", media_type: "IMAGE", image_url: "https://x/a.jpg", caption: "same" };
  await publishing.handle("create_ig_media", args, client);
  const second = await publishing.handle("create_ig_media", { ...args, idempotency_nonce: "repost" }, client);
  assert.equal(second.replayed, undefined);
  assert.equal(client.posts.length, 4);
});

test("create_ig_media: a failed publish orphans the container instead of losing it", async () => {
  freshLedger();
  const client = mockClient({ failOn: "media_publish" });
  const args = { ig_user_id: "17841", media_type: "IMAGE", image_url: "https://x/a.jpg", caption: "doomed" };
  await assert.rejects(() => publishing.handle("create_ig_media", args, client), /boom/);
  const orphans = state.listOrphans();
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].container_id, "cont_1");
});

test("create_ig_carousel: children are recorded, and a repeat replays without re-posting", async () => {
  freshLedger();
  const client = mockClient();
  const args = {
    ig_user_id: "17841",
    items: [{ media_type: "IMAGE", image_url: "https://x/1.jpg" }, { media_type: "IMAGE", image_url: "https://x/2.jpg" }],
    caption: "carousel",
  };
  const first = await publishing.handle("create_ig_carousel", args, client);
  assert.equal(first.child_ids.length, 2);
  assert.equal(first.media_type, "CAROUSEL");
  const posts = client.posts.length;

  const second = await publishing.handle("create_ig_carousel", args, client);
  assert.equal(second.replayed, true);
  assert.equal(second.media_id, first.media_id);
  assert.deepEqual(second.child_ids, first.child_ids);
  assert.equal(client.posts.length, posts);
});
