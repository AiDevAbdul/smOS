import { test } from "node:test";
import assert from "node:assert/strict";
import { renderActiveClients } from "../scripts/generate-active-clients.js";

test("renderActiveClients includes won deals", () => {
  const block = renderActiveClients([
    { slug: "acme", company_name: "Acme Co", stage: "won", won_at: "2026-01-05T00:00:00.000Z", links: {} },
  ]);
  assert.match(block, /## Active Clients/);
  assert.match(block, /Acme Co/);
  assert.match(block, /2026-01-05/);
  assert.match(block, /Active(?! \()/); // "Active" not "Active (pre-onboarding)" style variants
});

test("renderActiveClients includes onboarded-but-not-won deals via client_profile link", () => {
  const block = renderActiveClients([
    { slug: "blue-rose-auto", company_name: "Blue Rose Auto", stage: "negotiating", won_at: null, links: { client_profile: "clients/blue-rose-auto/profile.json" } },
  ]);
  assert.match(block, /Blue Rose Auto/);
  assert.match(block, /Planning mode/);
});

test("renderActiveClients excludes leads/prospects with no client footprint", () => {
  const block = renderActiveClients([
    { slug: "lead-co", company_name: "Lead Co", stage: "audited", won_at: null, links: {} },
  ]);
  assert.doesNotMatch(block, /Lead Co/);
  assert.match(block, /None yet/);
});

test("renderActiveClients sorts by slug", () => {
  const block = renderActiveClients([
    { slug: "zeta", company_name: "Zeta Inc", stage: "won", won_at: "2026-01-01", links: {} },
    { slug: "alpha", company_name: "Alpha Inc", stage: "won", won_at: "2026-01-01", links: {} },
  ]);
  assert.ok(block.indexOf("Alpha Inc") < block.indexOf("Zeta Inc"));
});
