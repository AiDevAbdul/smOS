import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { appsecretProof } from "../scripts/lib/meta-graph.js";

test("appsecretProof: returns null when no app secret is configured", () => {
  assert.equal(appsecretProof("tok", undefined), null);
  assert.equal(appsecretProof("tok", ""), null);
});
test("appsecretProof: returns null when no token", () => {
  assert.equal(appsecretProof("", "secret"), null);
});
test("appsecretProof: is HMAC-SHA256(token) keyed by app secret", () => {
  const expected = createHmac("sha256", "my-secret").update("my-token").digest("hex");
  assert.equal(appsecretProof("my-token", "my-secret"), expected);
});
test("appsecretProof: is deterministic", () => {
  assert.equal(appsecretProof("t", "s"), appsecretProof("t", "s"));
});
