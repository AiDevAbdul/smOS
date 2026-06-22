import { test } from "node:test";
import assert from "node:assert/strict";
import { syncProducts } from "../skills/catalog/catalog.js";

function product(id) {
  return {
    id, title: `Item ${id}`, description: "A fine product",
    availability: "in stock", condition: "new", price: "19.99 USD",
    link: "https://shop.example.com/p", image_link: "https://cdn.example.com/i.jpg",
    brand: "Acme",
  };
}

// Mock graph: records batch posts, returns a configurable product_count on GET.
function mockGraph(liveCount, { failGet = false } = {}) {
  const calls = { posts: [], gets: [] };
  return {
    calls,
    post: async (path, data) => { calls.posts.push({ path, data }); return { handles: ["h"] }; },
    get: async (path, params) => {
      calls.gets.push({ path, params });
      if (failGet) throw new Error("permission denied");
      return liveCount === undefined ? {} : { product_count: liveCount };
    },
  };
}

test("matching count → verification matched, success", async () => {
  const products = [product("a"), product("b"), product("c")];
  const graph = mockGraph(3);
  const res = await syncProducts(graph, "cat_1", products);
  assert.equal(res.accepted, 3);
  assert.equal(res.rejected, 0);
  assert.equal(res.verification.status, "matched");
  assert.equal(res.verification.live_product_count, 3);
  // It actually read the count back.
  assert.equal(graph.calls.gets.length, 1);
  assert.equal(graph.calls.gets[0].path, "/cat_1");
});

test("mismatched count → discrepancy surfaced with numbers", async () => {
  const products = [product("a"), product("b"), product("c")];
  const graph = mockGraph(1); // only 1 of 3 landed
  const res = await syncProducts(graph, "cat_1", products);
  assert.equal(res.verification.status, "discrepancy");
  assert.equal(res.verification.expected, 3);
  assert.equal(res.verification.live_product_count, 1);
  assert.equal(res.verification.missing, 2);
});

test("count GET failure → degrades honestly to count_unverified", async () => {
  const graph = mockGraph(3, { failGet: true });
  const res = await syncProducts(graph, "cat_1", [product("a")]);
  assert.equal(res.verification.status, "count_unverified");
  assert.match(res.verification.reason, /permission denied/);
});

test("no items accepted → no upload, no verification", async () => {
  const bad = [{ id: "x" }]; // missing required fields
  const graph = mockGraph(0);
  const res = await syncProducts(graph, "cat_1", bad);
  assert.equal(res.accepted, 0);
  assert.equal(res.rejected, 1);
  assert.equal(res.upload, null);
  assert.equal(graph.calls.gets.length, 0); // never verified — nothing uploaded
});
