import { test } from "node:test";
import assert from "node:assert/strict";
import { createMetaClient } from "../mcp/meta-server/meta-client.js";
import { GuardError } from "../scripts/lib/guards.js";

// C1 regression guard: the MCP client must share the same fail-closed guard
// chokepoint as the skill client. Before unification it had its own axios
// instance and bypassed guards entirely. If anyone reintroduces a second
// client here, these throws disappear and this test fails.

test("MCP client: create_campaign with a bad name is blocked before request", async () => {
  const client = createMetaClient("dummy-token");
  await assert.rejects(
    client.post("/act_1/campaigns", { name: "not valid", daily_budget: 1000 }),
    GuardError
  );
});

test("MCP client: delete() is blocked at the chokepoint", async () => {
  delete process.env.SMOS_ALLOW_DELETE;
  const client = createMetaClient("dummy-token");
  await assert.rejects(client.delete("/123456"), GuardError);
});

test("MCP client exposes the unified surface (get/post/delete/act/paginate)", () => {
  const client = createMetaClient("dummy-token");
  for (const m of ["get", "post", "delete", "act", "paginate"]) {
    assert.equal(typeof client[m], "function", `missing ${m}`);
  }
  assert.equal(client.act("123"), "act_123");
});
