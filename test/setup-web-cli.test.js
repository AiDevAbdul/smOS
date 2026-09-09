/**
 * E3 CLI behaviour: /setup-web refuses to record a landing URL that does not
 * answer, and records the URL the browser actually lands on when it does.
 *
 * The redirect/2xx logic itself is unit-tested with an injected fetch in
 * verify-url.test.js; here we exercise the CLI (exit codes + what lands in
 * client_profile.json) against a real loopback listener, because the thing under
 * test is precisely "did we make the request".
 *
 * Note: the live-server cases must NOT use spawnSync — it blocks this process's
 * event loop, so the test server never accepts the child's connection and the
 * probe times out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SCRIPT = resolve(ROOT, "skills/setup-web/setup-web.js");

if (!process.env.SMOS_DATA_ROOT) process.env.SMOS_DATA_ROOT = resolve(ROOT, "test", ".tmp");
const P = await import("../scripts/lib/paths.js");

// Keep the unreachable-URL cases fast: a refused connection is instant, but a
// sandbox that black-holes egress would otherwise burn the full default timeout.
const CHILD_ENV = { ...process.env, SMOS_PROBE_TIMEOUT_MS: "1500" };

function makeClient(slug) {
  const dir = P.clientRoot(slug);
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, "client_profile.json");
  writeFileSync(file, JSON.stringify({ client_slug: slug, name: "Acme", accounts: {} }, null, 2));
  return file;
}

function run(slug, args) {
  const res = spawnSync(process.execPath, [SCRIPT, slug, ...args], { encoding: "utf8", env: CHILD_ENV });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

/** Async run — required while a test server in this process must stay responsive. */
function runAsync(slug, args) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [SCRIPT, slug, ...args], { env: CHILD_ENV });
    let out = ""; let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => res({ code, out, err }));
  });
}

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try { return await fn(port); } finally { server.close(); }
}

test("setup-web --set-website refuses an unreachable URL and writes nothing", () => {
  const slug = "e3-web-refuse";
  const file = makeClient(slug);
  // Port 1 on loopback: nothing listens there.
  const { code, err } = run(slug, ["--set-website", "http://127.0.0.1:1/"]);
  assert.equal(code, 5);
  assert.match(err, /refused/);
  const profile = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(profile.accounts.website_url ?? null, null);
  assert.equal(profile.setup?.landing_verified_at ?? null, null);
});

test("setup-web --force records an unreachable URL but marks it unverified", () => {
  const slug = "e3-web-force";
  const file = makeClient(slug);
  const { code, out } = run(slug, ["--set-website", "http://127.0.0.1:1/", "--force"]);
  assert.equal(code, 0);
  const parsed = JSON.parse(out);
  assert.equal(parsed.verified, false);
  assert.match(parsed.warning, /UNVERIFIED/);
  const profile = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(profile.accounts.website_url, "http://127.0.0.1:1/");
  assert.equal(profile.setup.landing_verified_at, null);
  assert.equal(profile.setup.landing_probe.forced, true);
});

test("setup-web --probe reports without touching the profile", () => {
  const slug = "e3-web-probe";
  const file = makeClient(slug);
  const before = readFileSync(file, "utf8");
  const { code, out } = run(slug, ["--probe", "http://127.0.0.1:1/"]);
  assert.equal(code, 5);
  assert.match(JSON.parse(out).summary, /unreachable/);
  assert.equal(readFileSync(file, "utf8"), before);
});

test("setup-web --set-website records a live URL as verified", async () => {
  const slug = "e3-web-ok";
  const file = makeClient(slug);
  await withServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<h1>Acme</h1>"); }, async (port) => {
    const { code, out } = await runAsync(slug, ["--set-website", `http://127.0.0.1:${port}/`]);
    assert.equal(code, 0);
    assert.equal(JSON.parse(out).verified, true);
    const profile = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(profile.accounts.website_url, `http://127.0.0.1:${port}/`);
    assert.ok(profile.setup.landing_verified_at);
    assert.equal(profile.setup.landing_probe.status, 200);
  });
});

test("setup-web --set-website follows a redirect and records the final URL", async () => {
  const slug = "e3-web-redirect";
  const file = makeClient(slug);
  await withServer((req, res) => {
    if (req.url === "/") { res.writeHead(301, { location: "/live" }); res.end(); return; }
    res.writeHead(200, { "content-type": "text/html" }); res.end("<h1>Acme</h1>");
  }, async (port) => {
    const { code } = await runAsync(slug, ["--set-website", `http://127.0.0.1:${port}/`]);
    assert.equal(code, 0);
    const profile = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(profile.accounts.website_url, `http://127.0.0.1:${port}/live`);
    assert.equal(profile.setup.landing_probe.redirects, 1);
  });
});
