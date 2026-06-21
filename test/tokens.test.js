import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveToken, pageTokenFor } from "../scripts/lib/tokens.js";

const ENV_KEYS = ["META_PAGE_TOKEN_ACME", "META_PAGE_TOKEN", "META_THREADS_TOKEN_ACME"];
function clearEnv() { for (const k of ENV_KEYS) delete process.env[k]; }

test("per-client env beats global fallback", () => {
  clearEnv();
  process.env.META_PAGE_TOKEN_ACME = "per-client";
  process.env.META_PAGE_TOKEN = "global";
  const r = resolveToken("page", "acme");
  assert.equal(r.token, "per-client");
  assert.equal(r.source, "META_PAGE_TOKEN_ACME");
  assert.ok(!r.global_fallback);
  clearEnv();
});

test("global fallback is flagged as a foot-gun", () => {
  clearEnv();
  process.env.META_PAGE_TOKEN = "global";
  const r = resolveToken("page", "acme");
  assert.equal(r.token, "global");
  assert.equal(r.global_fallback, true);
  clearEnv();
});

test("profile token used when no env", () => {
  clearEnv();
  const r = resolveToken("page", "acme", { profile: { accounts: { page_token: "from-profile" } } });
  assert.equal(r.token, "from-profile");
  assert.match(r.source, /profile\.accounts\.page_token/);
});

test("explicit override wins over everything", () => {
  clearEnv();
  process.env.META_PAGE_TOKEN_ACME = "per-client";
  const r = resolveToken("page", "acme", { override: "explicit" });
  assert.equal(r.token, "explicit");
  assert.equal(r.source, "override");
  clearEnv();
});

test("require:true throws fail-closed when nothing resolves", () => {
  clearEnv();
  assert.throws(() => resolveToken("page", "nobody", { require: true, profile: {} }), /No page token/);
});

test("returns null token (not throw) when not required", () => {
  clearEnv();
  const r = resolveToken("threads", "acme", { profile: {} });
  assert.equal(r.token, null);
  assert.equal(r.source, "none");
  assert.ok(Array.isArray(r.tried));
});

test("pageTokenFor convenience", () => {
  clearEnv();
  process.env.META_PAGE_TOKEN_ACME = "x";
  assert.equal(pageTokenFor("acme"), "x");
  clearEnv();
});
