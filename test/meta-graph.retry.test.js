import { test } from "node:test";
import assert from "node:assert/strict";
import { createGraph, TokenExpiredError, _internals } from "../scripts/lib/meta-graph.js";

// A fake axios instance: each call shifts the next scripted response off a queue.
// A scripted item is either {data} (resolve) or {error} (reject like axios does).
function mockHttp(script) {
  const calls = [];
  const queue = [...script];
  const fn = async (config) => {
    calls.push(config);
    const item = queue.shift();
    if (!item) throw new Error("mockHttp: ran out of scripted responses");
    if (item.error) throw item.error;
    return { data: item.data };
  };
  fn.calls = calls;
  return fn;
}

// Build an axios-style error with a Meta error payload.
function metaErr(code, { status, subcode, type = "OAuthException", headers } = {}) {
  return { response: { status: status ?? 400, headers: headers ?? {}, data: { error: { code, error_subcode: subcode, type, message: `err ${code}`, fbtrace_id: "trace" } } } };
}

const opts = (http) => ({ http, baseDelayMs: 0, sleep: async () => {} });

test("retries on a rate-limit code then succeeds", async () => {
  const http = mockHttp([
    { error: metaErr(17, { status: 400, type: "OAuthException" }) },
    { error: metaErr(4, { status: 400, type: "OAuthException" }) },
    { data: { id: "ok" } },
  ]);
  const g = createGraph("t", opts(http));
  const res = await g.get("/me");
  assert.deepEqual(res, { id: "ok" });
  assert.equal(http.calls.length, 3);
});

test("retries on HTTP 503 then succeeds", async () => {
  const http = mockHttp([
    { error: { response: { status: 503, headers: {}, data: {} } } },
    { data: { ok: true } },
  ]);
  const g = createGraph("t", opts(http));
  assert.deepEqual(await g.get("/x"), { ok: true });
  assert.equal(http.calls.length, 2);
});

test("retries on transient network error (ECONNRESET)", async () => {
  const http = mockHttp([
    { error: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) },
    { data: { ok: 1 } },
  ]);
  const g = createGraph("t", opts(http));
  assert.deepEqual(await g.get("/x"), { ok: 1 });
});

test("gives up after maxRetries and throws the last error", async () => {
  const http = mockHttp([
    { error: metaErr(4) }, { error: metaErr(4) }, { error: metaErr(4) },
  ]);
  const g = createGraph("t", { http, baseDelayMs: 0, sleep: async () => {}, maxRetries: 2 });
  await assert.rejects(g.get("/x"), /Meta API 4/);
  assert.equal(http.calls.length, 3); // initial + 2 retries
});

test("does NOT retry a non-retryable error (code 100)", async () => {
  const http = mockHttp([{ error: metaErr(100, { type: "GraphMethodException" }) }]);
  const g = createGraph("t", opts(http));
  await assert.rejects(g.get("/x"), /Meta API 100/);
  assert.equal(http.calls.length, 1);
});

test("token expiry (code 190) throws TokenExpiredError and is never retried", async () => {
  const http = mockHttp([{ error: metaErr(190, { type: "OAuthException", subcode: 463 }) }]);
  const g = createGraph("t", opts(http));
  await assert.rejects(g.get("/x"), (e) => {
    assert.ok(e instanceof TokenExpiredError);
    assert.equal(e.tokenExpired, true);
    return true;
  });
  assert.equal(http.calls.length, 1);
});

test("honors Retry-After header for the backoff delay", async () => {
  let slept = -1;
  const http = mockHttp([
    { error: metaErr(4, { status: 429, headers: { "retry-after": "2" } }) },
    { data: { ok: true } },
  ]);
  const g = createGraph("t", { http, sleep: async (ms) => { slept = ms; } });
  await g.get("/x");
  assert.equal(slept, 2000);
});

test("paginate follows paging.next across pages and respects max", async () => {
  const http = mockHttp([
    { data: { data: [{ id: 1 }, { id: 2 }], paging: { next: "https://graph.facebook.com/v25.0/act_1/campaigns?after=AAA&limit=2" } } },
    { data: { data: [{ id: 3 }, { id: 4 }], paging: { next: "https://graph.facebook.com/v25.0/act_1/campaigns?after=BBB&limit=2" } } },
    { data: { data: [{ id: 5 }] } },
  ]);
  const g = createGraph("t", opts(http));
  const all = await g.paginate("/act_1/campaigns", { limit: 2 });
  assert.deepEqual(all.map((x) => x.id), [1, 2, 3, 4, 5]);
  assert.equal(http.calls.length, 3);
  // strips access_token/appsecret_proof from the next-page params (re-added fresh)
  const secondCall = http.calls[1];
  assert.ok(secondCall.params.after === "AAA");
});

test("paginate stops at max even if more pages exist", async () => {
  const http = mockHttp([
    { data: { data: [{ id: 1 }, { id: 2 }, { id: 3 }], paging: { next: "https://graph.facebook.com/v25.0/x?after=Z" } } },
  ]);
  const g = createGraph("t", opts(http));
  const all = await g.paginate("/x", {}, 2);
  assert.equal(all.length, 2);
});

test("classification internals: rate-limit codes are retryable, 190 is not", () => {
  assert.ok(_internals.RETRYABLE_META_CODES.has(613));
  assert.ok(_internals.TOKEN_EXPIRED_CODES.has(190));
  assert.equal(_internals.isRetryable({ metaError: { code: 190, type: "OAuthException" } }), false);
});
