// test/agency-economics.test.js — Group D4: cost-to-serve, margin, capacity.
//
// The bug this module exists to kill: revenue read as profit. A $300/mo client
// taking 11.5 hours a month is a loss, and the pipeline showed it as $300 of MRR.
//
// So the tests bear down on the three ways a margin number can lie:
//   - unknown cost defaulting to zero, which makes the least-measured client look
//     like the most profitable one;
//   - a budgeted estimate presented as though it were a timesheet;
//   - a cross-currency margin computed with an invented exchange rate.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.SMOS_DATA_ROOT) process.env.SMOS_DATA_ROOT = resolve(ROOT, "test", ".tmp");

const { deal: dealSchema } = await import("../schemas/index.js");
const {
  clientProfitability, rosterLoad, portfolioMargin,
  normalizeRoster, hourlyCostFor, DEFAULT_HOURLY_COST,
} = await import("../scripts/lib/agency-economics.js");

const MONTH = "2026-09";
const roster = {
  currency: "USD", default_hourly_cost: 30,
  members: [
    { id: "abdul", name: "Abdul", role: "lead", hourly_cost: 30, max_clients: 2, max_hours_per_month: 40 },
    { id: "sam", name: "Sam", role: "specialist", hourly_cost: 20, max_clients: 3, max_hours_per_month: 60 },
  ],
};
const won = (over = {}) => ({
  slug: "acme", company_name: "Acme Co", stage: "won", owner: "abdul",
  links: { proposal: "p.pdf" },
  deal: { monthly_retainer: 3000, currency: "USD" },
  ...over,
});

describe("roster normalization tolerates a missing config", () => {
  test("no config degrades to defaults rather than crashing", () => {
    const r = normalizeRoster(null);
    assert.equal(r.currency, "USD");
    assert.equal(r.default_hourly_cost, DEFAULT_HOURLY_COST);
    assert.deepEqual(r.members, []);
  });

  test("members without an id are dropped — an unaddressable member is not a member", () => {
    const r = normalizeRoster({ members: [{ name: "Nobody" }, { id: "ok", name: "Ok" }] });
    assert.equal(r.members.length, 1);
    assert.equal(r.members[0].id, "ok");
  });

  test("the real config/roster.json parses and has a usable member", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const p = resolve(ROOT, "config", "roster.json");
    assert.ok(existsSync(p), "config/roster.json should ship with the repo");
    const r = normalizeRoster(JSON.parse(readFileSync(p, "utf8")));
    assert.ok(r.members.length >= 1);
    assert.ok(r.members.every((m) => m.id && m.max_clients > 0), "every member needs an id and a client limit");
  });
});

describe("hourly cost precedence", () => {
  test("per-client override beats the member rate", () => {
    assert.equal(hourlyCostFor(won({ cost_to_serve: { hourly_cost: 99 } }), roster), 99);
  });

  test("member rate beats the roster default", () => {
    assert.equal(hourlyCostFor(won({ owner: "sam" }), roster), 20);
  });

  test("roster default when the owner isn't on the roster", () => {
    assert.equal(hourlyCostFor(won({ owner: "ghost" }), roster), 30);
    assert.equal(hourlyCostFor(won({ owner: null }), roster), 30);
  });
});

describe("effort log", () => {
  test("hours sum per month, and other months don't leak in", () => {
    const d = won({
      effort_log: [
        { at: "2026-09-02T00:00:00Z", month: "2026-09", hours: 4 },
        { at: "2026-09-20T00:00:00Z", month: "2026-09", hours: 2.5 },
        { at: "2026-08-10T00:00:00Z", month: "2026-08", hours: 9 },
      ],
    });
    assert.equal(dealSchema.loggedHours(d, "2026-09"), 6.5);
    assert.equal(dealSchema.loggedHours(d, "2026-08"), 9);
    assert.equal(dealSchema.loggedHours(d, "2026-07"), 0);
  });

  test("month is derived from `at` when not given explicitly", () => {
    const e = dealSchema.normalizeEffort({ at: "2026-09-02T00:00:00Z", hours: 3 });
    assert.equal(e.month, "2026-09");
  });

  test("a malformed month is rejected by validate", () => {
    assert.equal(dealSchema.validate(won({ effort_log: [{ at: "x", month: "2026-9", hours: 1 }] })).ok, false);
    assert.equal(dealSchema.validate(won({ effort_log: [{ at: "x", month: "2026-09", hours: -1 }] })).ok, false);
    assert.equal(dealSchema.validate(won({ effort_log: [{ at: "x", month: "2026-09", hours: 1 }] })).ok, true);
  });

  test("a negative cost is rejected — it would silently inflate margin", () => {
    assert.equal(dealSchema.validate(won({ cost_to_serve: { tool_cost: -5 } })).ok, false);
    assert.equal(dealSchema.validate(won({ cost_to_serve: { hours_per_month: -1 } })).ok, false);
    assert.equal(dealSchema.validate(won({ cost_to_serve: { hourly_cost: -10 } })).ok, false);
  });

  test("existing deals with no cost block still validate", () => {
    assert.equal(dealSchema.validate({ slug: "old", company_name: "Old", stage: "won", links: { proposal: "p" } }).ok, true);
  });
});

describe("clientProfitability — the three ways a margin can lie", () => {
  test("unknown cost yields null margin, NOT 100%", () => {
    // This is the important one: defaulting unknown cost to zero would make every
    // unmeasured client look like the most profitable in the book.
    const p = clientProfitability(won(), roster, MONTH);
    assert.equal(p.margin, null);
    assert.equal(p.cost, null);
    assert.equal(p.margin_pct, null);
    assert.equal(p.unmeasured, true);
    assert.equal(p.hours_basis, "unknown");
    assert.match(p.reasons.join(" | "), /Unknown cost is NOT zero cost/);
  });

  test("a budgeted estimate is labelled as an estimate", () => {
    const p = clientProfitability(won({ cost_to_serve: { hours_per_month: 10 } }), roster, MONTH);
    assert.equal(p.hours_basis, "budgeted");
    assert.equal(p.hours, 10);
    assert.equal(p.margin, 3000 - 300);
    assert.match(p.reasons.join(" | "), /BUDGETED hours/);
  });

  test("logged hours win over the budget, and are labelled as logged", () => {
    const p = clientProfitability(won({
      cost_to_serve: { hours_per_month: 10 },
      effort_log: [{ at: "2026-09-02T00:00:00Z", month: MONTH, hours: 25 }],
    }), roster, MONTH);
    assert.equal(p.hours_basis, "logged");
    assert.equal(p.hours, 25);
    assert.equal(p.margin, 3000 - 750);
    assert.ok(!p.reasons.some((r) => /BUDGETED/.test(r)), "logged hours must not carry the estimate caveat");
  });

  test("a cross-currency margin is refused, not converted with a made-up rate", () => {
    const p = clientProfitability(
      won({ deal: { monthly_retainer: 1500, currency: "EUR" }, cost_to_serve: { hours_per_month: 5 } }),
      roster, MONTH,
    );
    assert.equal(p.margin, null);
    assert.equal(p.unmeasured, true);
    assert.match(p.reasons.join(" | "), /no FX rates/);
  });

  test("an unrecorded retainer means unknown revenue, so no margin", () => {
    const p = clientProfitability(
      won({ deal: { monthly_retainer: 0, currency: "USD" }, cost_to_serve: { hours_per_month: 5 } }),
      roster, MONTH,
    );
    assert.equal(p.revenue, null);
    assert.equal(p.margin, null);
    assert.match(p.reasons.join(" | "), /No retainer recorded/);
  });

  test("a loss-making client is flagged, not just negative", () => {
    // The healthncare case: $300/mo, 11.5 hours at $30 plus $25 of tools.
    const p = clientProfitability(
      won({ deal: { monthly_retainer: 300, currency: "USD" }, cost_to_serve: { tool_cost: 25 },
            effort_log: [{ at: "2026-09-02T00:00:00Z", month: MONTH, hours: 11.5 }] }),
      roster, MONTH,
    );
    assert.equal(p.cost, 370);
    assert.equal(p.margin, -70);
    assert.equal(p.loss_making, true);
    assert.ok(p.margin_pct < 0);
  });

  test("tools and contractors are included in cost and broken out", () => {
    const p = clientProfitability(
      won({ cost_to_serve: { hours_per_month: 10, tool_cost: 50, contractor_cost: 200 } }),
      roster, MONTH,
    );
    assert.equal(p.breakdown.labor, 300);
    assert.equal(p.breakdown.tools, 50);
    assert.equal(p.breakdown.contractors, 200);
    assert.equal(p.cost, 550);
    assert.equal(p.margin, 2450);
  });

  test("a healthy client is not flagged loss-making", () => {
    const p = clientProfitability(won({ cost_to_serve: { hours_per_month: 10 } }), roster, MONTH);
    assert.equal(p.loss_making, false);
    assert.equal(p.margin_pct, 90);
  });

  test("never throws on garbage", () => {
    for (const bad of [null, undefined, {}, { deal: null }]) {
      assert.doesNotThrow(() => clientProfitability(bad, roster, MONTH));
      assert.doesNotThrow(() => clientProfitability(bad, null, MONTH));
    }
  });
});

describe("rosterLoad — capacity", () => {
  const deals = [
    won({ slug: "a", owner: "abdul", cost_to_serve: { hours_per_month: 20 } }),
    won({ slug: "b", owner: "abdul", cost_to_serve: { hours_per_month: 25 } }),
    won({ slug: "c", owner: "abdul" }),                       // unknown hours
    won({ slug: "d", owner: "sam", cost_to_serve: { hours_per_month: 10 } }),
    won({ slug: "e", owner: "ghost" }),                       // not on the roster
    won({ slug: "f", owner: null }),                          // unowned
    { slug: "g", company_name: "G", stage: "proposed", owner: "abdul", links: {} }, // not won
  ];

  test("only won deals count toward load", () => {
    const l = rosterLoad(deals, roster, MONTH);
    assert.equal(l.capacity.total_clients, 6, "the proposed deal must not consume delivery capacity");
  });

  test("over-limit is detected on both clients and hours", () => {
    const l = rosterLoad(deals, roster, MONTH);
    const abdul = l.members.find((m) => m.id === "abdul");
    assert.equal(abdul.clients, 3);
    assert.equal(abdul.over_client_limit, true, "3 clients against a max of 2");
    assert.equal(abdul.hours, 45);
    assert.equal(abdul.over_hours_limit, true, "45h against a max of 40");
    assert.deepEqual(l.capacity.members_over_limit, ["abdul"]);
  });

  test("a member within limits is not flagged", () => {
    const sam = rosterLoad(deals, roster, MONTH).members.find((m) => m.id === "sam");
    assert.equal(sam.over_client_limit, false);
    assert.equal(sam.over_hours_limit, false);
    assert.equal(sam.hours_utilization_pct, Math.round((10 / 60) * 1000) / 10);
  });

  test("clients with unknown hours are named, so utilization reads as a floor", () => {
    const abdul = rosterLoad(deals, roster, MONTH).members.find((m) => m.id === "abdul");
    assert.deepEqual(abdul.clients_with_unknown_hours, ["c"]);
  });

  test("unowned and off-roster clients are reported, never dropped", () => {
    // An unowned client is a capacity risk, not a zero.
    const l = rosterLoad(deals, roster, MONTH);
    assert.deepEqual(l.unassigned.map((u) => u.slug).sort(), ["e", "f"]);
    assert.equal(l.capacity.assigned, 4);
  });

  test("with no roster configured, everyone is unassigned rather than invisible", () => {
    const l = rosterLoad(deals, null, MONTH);
    assert.equal(l.members.length, 0);
    assert.equal(l.unassigned.length, 6);
  });

  test("logged hours override the budget in load too", () => {
    const l = rosterLoad([won({ slug: "x", owner: "sam", cost_to_serve: { hours_per_month: 5 }, effort_log: [{ at: "2026-09-01T00:00:00Z", month: MONTH, hours: 30 }] })], roster, MONTH);
    const sam = l.members.find((m) => m.id === "sam");
    assert.equal(sam.hours, 30);
    assert.equal(sam.detail[0].basis, "logged");
  });
});

describe("portfolioMargin", () => {
  const p = (over) => clientProfitability(won(over), roster, MONTH);

  test("totals per currency and never blends them", () => {
    const out = portfolioMargin([
      p({ slug: "a", cost_to_serve: { hours_per_month: 10 } }),
      p({ slug: "b", deal: { monthly_retainer: 1000, currency: "USD" }, cost_to_serve: { hours_per_month: 5 } }),
    ]);
    assert.deepEqual(Object.keys(out.by_currency), ["USD"]);
    assert.equal(out.by_currency.USD.revenue, 4000);
    assert.equal(out.by_currency.USD.cost, 450);
    assert.equal(out.by_currency.USD.margin, 3550);
    assert.equal(out.measured, 2);
  });

  test("unmeasured clients are excluded from totals but counted and explained", () => {
    const out = portfolioMargin([
      p({ slug: "a", cost_to_serve: { hours_per_month: 10 } }),
      p({ slug: "b" }), // unknown cost
    ]);
    assert.equal(out.measured, 1);
    assert.equal(out.unmeasured_count, 1);
    assert.equal(out.unmeasured[0].slug, "b");
    assert.ok(out.unmeasured[0].reasons.length, "an excluded client must say why");
    assert.equal(out.by_currency.USD.clients, 1);
  });

  test("loss-making clients are surfaced by slug", () => {
    const out = portfolioMargin([
      p({ slug: "loser", deal: { monthly_retainer: 300, currency: "USD" }, cost_to_serve: { hours_per_month: 12 } }),
      p({ slug: "winner", cost_to_serve: { hours_per_month: 10 } }),
    ]);
    assert.deepEqual(out.loss_making, ["loser"]);
  });

  test("empty input is empty, not zero-filled", () => {
    const out = portfolioMargin([]);
    assert.deepEqual(out.by_currency, {});
    assert.equal(out.measured, 0);
    assert.deepEqual(portfolioMargin(null).by_currency, {});
  });
});
