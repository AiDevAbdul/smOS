import { test } from "node:test";
import assert from "node:assert/strict";
import { publishFacebook, publishFacebookReel } from "../skills/publish/publish.js";

// Minimal mock of the guarded graph client — records calls, returns scripted
// per-call responses so the three-phase (start/transfer/finish) reel flow and
// its status poll can be verified without any network access.
function mockGraph({ postResponses = [], getResponses = [] } = {}) {
  const calls = { post: [], get: [] };
  let postI = 0, getI = 0;
  return {
    calls,
    post: async (path, body) => {
      calls.post.push({ path, body });
      const r = postResponses[postI++];
      if (r instanceof Error) throw r;
      return r ?? {};
    },
    get: async (path, params) => {
      calls.get.push({ path, params });
      const r = getResponses[getI++];
      if (r instanceof Error) throw r;
      return r ?? {};
    },
  };
}

test("publishFacebookReel runs start -> transfer -> poll -> finish and returns the video id", async () => {
  const graph = mockGraph({
    postResponses: [
      { video_id: "vid_123" },       // start
      {},                              // transfer
      { success: true },               // finish
    ],
    getResponses: [
      { status: { video_status: "ready" } }, // poll
    ],
  });

  const result = await publishFacebookReel(graph, { video_url: "https://cdn.example/clip.mp4", message: "hi" }, "page_1", "tok");

  assert.equal(result.id, "vid_123");
  assert.equal(graph.calls.post.length, 3);
  assert.equal(graph.calls.post[0].body.upload_phase, "start");
  assert.equal(graph.calls.post[1].body.upload_phase, "transfer");
  assert.equal(graph.calls.post[1].body.file_url, "https://cdn.example/clip.mp4");
  assert.equal(graph.calls.post[1].body.video_id, "vid_123");
  assert.equal(graph.calls.post[2].body.upload_phase, "finish");
  assert.equal(graph.calls.post[2].body.video_state, "PUBLISHED");
});

test("publishFacebookReel throws without video_url", async () => {
  const graph = mockGraph();
  await assert.rejects(
    () => publishFacebookReel(graph, { message: "no video" }, "page_1", "tok"),
    /requires video_url/
  );
});

test("publishFacebookReel surfaces processing errors instead of hanging", async () => {
  const graph = mockGraph({
    postResponses: [{ video_id: "vid_err" }],
    getResponses: [{ status: { video_status: "error" } }],
  });
  await assert.rejects(
    () => publishFacebookReel(graph, { video_url: "https://cdn.example/bad.mp4" }, "page_1", "tok"),
    /failed to process/
  );
});

test("publishFacebook routes format=reels to the reel flow", async () => {
  const graph = mockGraph({
    postResponses: [{ video_id: "vid_999" }, {}, {}],
    getResponses: [{ status: { video_status: "ready" } }],
  });
  const result = await publishFacebook(graph, { format: "reels", video_url: "https://cdn.example/r.mp4" }, "page_1", "tok");
  assert.equal(result.id, "vid_999");
  assert.equal(graph.calls.post[0].path, "/page_1/video_reels");
});

test("publishFacebook still posts plain feed items (no video_url) to /feed", async () => {
  const graph = mockGraph({ postResponses: [{ id: "post_1" }] });
  const result = await publishFacebook(graph, { message: "hello" }, "page_1", "tok");
  assert.equal(result.id, "post_1");
  assert.equal(graph.calls.post[0].path, "/page_1/feed");
});

test("publishFacebook throws without a page token", async () => {
  const graph = mockGraph();
  await assert.rejects(() => publishFacebook(graph, { message: "x" }, "page_1", null), /page access token/);
});
