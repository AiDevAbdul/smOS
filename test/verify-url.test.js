import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl, probeUrl, describeProbe } from "../scripts/lib/verify_url.js";

function fakeRes(status, { location = null, body = "hello", contentType = "text/html" } = {}) {
  return {
    status,
    headers: { get: (k) => (k.toLowerCase() === "location" ? location : k.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => body,
  };
}

test("normalizeUrl: adds https, rejects junk", () => {
  assert.equal(normalizeUrl("example.com").url, "https://example.com/");
  assert.equal(normalizeUrl("http://x.dev/a").url, "http://x.dev/a");
  assert.equal(normalizeUrl("").ok, false);
  assert.equal(normalizeUrl("ftp://x.com").ok, false);
  assert.equal(normalizeUrl("localhost").ok, false); // no TLD → not a client site
});

test("probeUrl: 200 is reachable", async () => {
  const p = await probeUrl("https://example.com", { fetchImpl: async () => fakeRes(200) });
  assert.equal(p.ok, true);
  assert.equal(p.status, 200);
  assert.equal(p.https, true);
  assert.equal(p.bytes, 5);
  assert.equal(p.error, null);
});

test("probeUrl: follows redirects and reports the final URL", async () => {
  const seen = [];
  const p = await probeUrl("http://example.com", {
    fetchImpl: async (url) => {
      seen.push(url);
      if (url === "http://example.com/") return fakeRes(301, { location: "https://www.example.com/" });
      return fakeRes(200);
    },
  });
  assert.equal(p.ok, true);
  assert.equal(p.final_url, "https://www.example.com/");
  assert.equal(p.redirects.length, 1);
  assert.equal(p.https, true);
  assert.deepEqual(seen, ["http://example.com/", "https://www.example.com/"]);
});

test("probeUrl: 404 and 403 are both unreachable — auth-walled is not live", async () => {
  for (const status of [404, 403, 500]) {
    const p = await probeUrl("https://example.com", { fetchImpl: async () => fakeRes(status) });
    assert.equal(p.ok, false, `status ${status}`);
    assert.equal(p.error, `HTTP ${status}`);
  }
});

test("probeUrl: network failure returns ok:false, never throws", async () => {
  const p = await probeUrl("https://nope.example", {
    fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND"); },
  });
  assert.equal(p.ok, false);
  assert.match(p.error, /ENOTFOUND/);
});

test("probeUrl: redirect loop is bounded", async () => {
  const p = await probeUrl("https://loop.example", {
    fetchImpl: async () => fakeRes(302, { location: "https://loop.example/" }),
    maxRedirects: 3,
  });
  assert.equal(p.ok, false);
  assert.match(p.error, /too many redirects/);
  assert.equal(p.redirects.length, 4);
});

test("describeProbe: readable one-liners", async () => {
  const good = await probeUrl("https://example.com", { fetchImpl: async () => fakeRes(200) });
  assert.equal(describeProbe(good), "HTTP 200");
  const bad = await probeUrl("https://example.com", { fetchImpl: async () => fakeRes(404) });
  assert.match(describeProbe(bad), /^unreachable: HTTP 404/);
});
