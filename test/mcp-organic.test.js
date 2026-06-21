import { test } from "node:test";
import assert from "node:assert/strict";
import * as inbox from "../mcp/meta-server/tools/inbox.js";
import * as threads from "../mcp/meta-server/tools/threads.js";

const NEVER = { post: () => { throw new Error("HTTP should not be reached"); }, get: () => { throw new Error("HTTP should not be reached"); } };

test("inbox tools are registered with required names", () => {
  const names = inbox.tools.map((t) => t.name);
  for (const n of ["get_conversations", "get_messages", "send_message", "get_mentions"]) assert.ok(names.includes(n), n);
});

test("inbox.send_message requires a page token (no global leak by default)", async () => {
  const saved = process.env.META_PAGE_TOKEN; delete process.env.META_PAGE_TOKEN;
  await assert.rejects(
    () => inbox.handle("send_message", { page_id: "p", recipient_id: "u", message: "hi" }, NEVER),
    /requires a page access token/
  );
  if (saved !== undefined) process.env.META_PAGE_TOKEN = saved;
});

test("inbox.send_message REFUSES RESPONSE outside the 24h window (fail-closed, no HTTP)", async () => {
  await assert.rejects(
    () => inbox.handle("send_message", { page_id: "p", recipient_id: "u", message: "hi", page_access_token: "tok", within_window: false }, NEVER),
    /REFUSED/
  );
});

test("inbox.send_message MESSAGE_TAG without a tag is refused", async () => {
  await assert.rejects(
    () => inbox.handle("send_message", { page_id: "p", recipient_id: "u", message: "hi", page_access_token: "tok", messaging_type: "MESSAGE_TAG" }, NEVER),
    /requires a tag/
  );
});

test("threads tools require a Threads-specific token", async () => {
  const saved = process.env.META_THREADS_TOKEN; delete process.env.META_THREADS_TOKEN;
  await assert.rejects(
    () => threads.handle("create_threads_post", { threads_user_id: "t", text: "hello" }),
    /requires a Threads access token/
  );
  if (saved !== undefined) process.env.META_THREADS_TOKEN = saved;
});

test("threads text over 500 chars is rejected before any network call", async () => {
  await assert.rejects(
    () => threads.handle("create_threads_post", { threads_user_id: "t", text: "x".repeat(501), threads_access_token: "tok" }),
    /500-char limit/
  );
});
