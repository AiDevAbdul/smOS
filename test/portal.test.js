import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SCRIPT = resolve(ROOT, "skills/portal/portal.js");

// Build a throwaway client: profile + invoice ledger (+ optional content plan).
function setup(slug, { invoices = [], content = null } = {}) {
  const dir = resolve(ROOT, "clients", slug);
  const billingDir = resolve(ROOT, "billing", slug);
  mkdirSync(dir, { recursive: true });
  mkdirSync(billingDir, { recursive: true });
  writeFileSync(resolve(dir, "client_profile.json"),
    JSON.stringify({ business: { name: "Test Co" } }, null, 2));
  writeFileSync(resolve(billingDir, "ledger.json"), JSON.stringify(invoices, null, 2));
  if (content) writeFileSync(resolve(dir, "content_plan.json"), JSON.stringify(content, null, 2));
  return { dir, billingDir };
}

function run(slug) {
  return spawnSync("node", [SCRIPT, slug], { cwd: ROOT, encoding: "utf8" });
}

function cleanup(dir, billingDir) {
  for (const d of [dir, billingDir]) if (existsSync(d)) rmSync(d, { recursive: true, force: true });
}

test("Billing: Outstanding is summed PER CURRENCY (never added across currencies)", () => {
  const slug = "__portal_test_multicur";
  const { dir, billingDir } = setup(slug, {
    invoices: [
      { id: "INV-1", slug, period: "2026-05", currency: "USD", total: 1000, status: "sent" },
      { id: "INV-2", slug, period: "2026-06", currency: "EUR", total: 500, status: "paid" },
    ],
  });
  try {
    const r = run(slug);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
    const html = readFileSync(resolve(dir, "portal.html"), "utf8");
    // USD invoice is unpaid -> USD 1,000 outstanding; EUR invoice is paid -> EUR 0.
    assert.match(html, /Outstanding:/);
    assert.match(html, /USD 1,000/, "USD balance must be shown");
    assert.match(html, /EUR 0/, "EUR balance must be a separate line, not merged");
    // The old bug summed totals under a single currency label (e.g. "USD 1,500"); guard against it.
    assert.doesNotMatch(html, /USD 1,500/, "must not add across currencies");
  } finally {
    cleanup(dir, billingDir);
  }
});

test("Approvals: pending items are capped at the default of 8", () => {
  const slug = "__portal_test_cap";
  const items = Array.from({ length: 10 }, (_, i) => ({
    id: `P${i}`, status: "pending", platform: "ig", format: "reel",
    publish_at: "2026-07-01T00:00:00Z", message: `Post ${i}`,
  }));
  const { dir, billingDir } = setup(slug, { content: { items } });
  try {
    const r = run(slug);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.sections.approvals, 8, "approval cap must default to 8");
    const html = readFileSync(resolve(dir, "portal.html"), "utf8");
    const approveLinks = (html.match(/>Approve</g) || []).length;
    assert.equal(approveLinks, 8, "only 8 approve links should render");
  } finally {
    cleanup(dir, billingDir);
  }
});
