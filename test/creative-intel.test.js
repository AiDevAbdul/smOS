import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchAdDaily,
  isThrottle,
  ThrottleError,
  THROTTLE_CODES,
} from "../skills/creative-intel/creative-intel.js";

// A normalized Meta error as the shared client throws it: an Error with .metaError.
function metaError(code, { type = "OAuthException" } = {}) {
  const e = new Error(`Meta API ${code}`);
  e.metaError = { code, type, message: `err ${code}`, fbtrace_id: "trace-xyz" };
  return e;
}

// Minimal graph stub: .get throws whatever it's scripted to throw.
function throwingGraph(err) {
  return {
    get: async () => {
      throw err;
    },
  };
}

test("THROTTLE_CODES covers app/user/custom rate limits (4/17/613) only", () => {
  assert.ok(THROTTLE_CODES.has(4));
  assert.ok(THROTTLE_CODES.has(17));
  assert.ok(THROTTLE_CODES.has(613));
  assert.ok(!THROTTLE_CODES.has(190)); // token expiry, not a throttle
});

test("isThrottle detects normalized .metaError and raw axios payloads", () => {
  assert.equal(isThrottle(metaError(17)), true);
  assert.equal(
    isThrottle({ response: { data: { error: { code: 613 } } } }),
    true
  );
  assert.equal(isThrottle(metaError(100)), false);
  assert.equal(isThrottle(new Error("network blip")), false);
});

test("fetchAdDaily HALTS on a code-17 throttle and surfaces code/fbtrace_id", async () => {
  const graph = throwingGraph(metaError(17));
  await assert.rejects(
    () => fetchAdDaily(graph, "ad_1", 30),
    (e) => {
      assert.ok(e instanceof ThrottleError);
      assert.equal(e.throttled, true);
      assert.equal(e.metaError.code, 17);
      assert.equal(e.metaError.fbtrace_id, "trace-xyz");
      assert.match(e.message, /fbtrace_id=trace-xyz/);
      return true;
    }
  );
});

test("fetchAdDaily HALTS on code 613 (custom rate limit)", async () => {
  const graph = throwingGraph(metaError(613));
  await assert.rejects(() => fetchAdDaily(graph, "ad_1", 30), ThrottleError);
});

test("fetchAdDaily swallows non-throttle errors as per-ad {error} (no halt)", async () => {
  const graph = throwingGraph(metaError(100, { type: "GraphMethodException" }));
  const res = await fetchAdDaily(graph, "ad_1", 30);
  assert.ok(res.error);
  assert.ok(!(res instanceof ThrottleError));
});
