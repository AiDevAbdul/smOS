import { test } from "node:test";
import assert from "node:assert/strict";
import { createGraph } from "../scripts/lib/meta-graph.js";

// A fake axios instance driven by a page-builder: page N returns `perPage` rows
// and a paging.next until `pages` are exhausted.
function pagedHttp({ pages, perPage, cursorPrefix = "c" }) {
  let n = 0;
  const calls = [];
  const fn = async (config) => {
    calls.push(config);
    n++;
    const data = Array.from({ length: perPage }, (_, i) => ({ id: `p${n}-${i}` }));
    const hasNext = n < pages;
    return {
      data: {
        data,
        paging: hasNext
          ? { cursors: { after: `${cursorPrefix}${n}` }, next: `https://graph.facebook.com/v25.0/act_1/ads?after=${cursorPrefix}${n}&limit=${perPage}` }
          : {},
      },
    };
  };
  fn.calls = calls;
  return fn;
}

const opts = (http) => ({ http, baseDelayMs: 0, sleep: async () => {} });

test("paginate: a complete result is not marked truncated", async () => {
  const http = pagedHttp({ pages: 2, perPage: 10 });
  const g = createGraph("t", opts(http));
  const rows = await g.paginate("/act_1/ads", {}, 500);
  assert.equal(rows.length, 20);
  assert.equal(rows.truncated, false);
  assert.equal(rows.pageCount, 2);
  assert.equal(rows.nextCursor, null);
});

test("paginate: hitting max surfaces truncation + the cursor to continue from", async () => {
  const http = pagedHttp({ pages: 50, perPage: 100 });
  const g = createGraph("t", opts(http));
  const warned = [];
  const rows = await g.paginate("/act_1/ads", {}, 500, { onTruncate: (t) => warned.push(t) });
  assert.equal(rows.length, 500);
  assert.equal(rows.truncated, true);
  assert.equal(rows.pageCount, 5);
  assert.equal(rows.nextCursor, "c5");
  assert.equal(warned.length, 1);
  assert.match(warned[0].message, /TRUNCATED/);
});

test("paginate: an overshooting last page counts as truncated (rows are dropped)", async () => {
  const http = pagedHttp({ pages: 1, perPage: 30 });
  const g = createGraph("t", opts(http));
  const rows = await g.paginate("/act_1/ads", {}, 25, { onTruncate: () => {} });
  assert.equal(rows.length, 25);
  assert.equal(rows.truncated, true);
});

test("paginate: pagination facts are non-enumerable (JSON/spread stay pure arrays)", async () => {
  const http = pagedHttp({ pages: 1, perPage: 3 });
  const g = createGraph("t", opts(http));
  const rows = await g.paginate("/act_1/ads", {}, 500);
  assert.equal(JSON.parse(JSON.stringify(rows)).length, 3);
  assert.deepEqual(Object.keys(rows), ["0", "1", "2"]);
  assert.equal([...rows].length, 3);
});

test("correlation id: a failed request carries one, and withCorrelationId shares it", async () => {
  const err = { response: { status: 400, headers: {}, data: { error: { code: 100, type: "GraphMethodException", message: "bad", fbtrace_id: "tr" } } } };
  const http = async () => { throw err; };
  const g = createGraph("t", opts(http));
  const e = await g.get("/x").then(() => null, (x) => x);
  assert.ok(e);
  assert.match(String(e.correlationId), /^[0-9a-f]{8}$/);
  assert.equal(e.attempts, 1);

  // A multi-step flow stamps every call with ONE id.
  const flow = g.withCorrelationId("abc12345");
  const e1 = await flow.get("/a").then(() => null, (x) => x);
  const e2 = await flow.get("/b").then(() => null, (x) => x);
  assert.equal(e1.correlationId, "abc12345");
  assert.equal(e2.correlationId, "abc12345");
});

test("correlation id: a guard block is correlated too", async () => {
  const http = async () => { throw new Error("HTTP should not be reached"); };
  const g = createGraph("t", { ...opts(http), correlationId: "deadbeef" });
  const e = await g.delete("/999").then(() => null, (x) => x);
  assert.match(e.message, /destructive-guard BLOCKED/);
  assert.equal(e.correlationId, "deadbeef");
});
