// test/client-health.test.js — Group D3: retention layer (health + renewals).
//
// The failure this whole module exists to prevent is a retention system that
// reports "healthy" because it has no bad news. So the tests lean hardest on the
// missing-data paths: a client with no artifacts must score `null` and report low
// confidence, never 100 and never 50.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.SMOS_DATA_ROOT) process.env.SMOS_DATA_ROOT = resolve(ROOT, "test", ".tmp");

const { deal: dealSchema } = await import("../schemas/index.js");
const {
  clientHealth, retentionQueue, bandFor, WEIGHTS,
  scorePerformance, scorePayment, scoreDelivery, scoreEngagement, scoreTenure,
} = await import("../scripts/lib/client-health.js");

const TODAY = "2026-09-09";
const wonDeal = (over = {}) => ({
  slug: "acme", company_name: "Acme Co", stage: "won",
  links: { proposal: "proposals/acme.pdf" },
  deal: { monthly_retainer: 3000, currency: "USD" },
  engagement_start: "2026-03-09", term_months: 12,
  activities: [{ at: "2026-09-01T00:00:00Z", type: "note", note: "check-in" }],
  ...over,
});

describe("renewal dates are derived, and unknown is not 'not due'", () => {
  test("explicit renewal_date wins", () => {
    assert.equal(dealSchema.renewalDate(wonDeal({ renewal_date: "2027-01-15" })), "2027-01-15");
  });

  test("derived from engagement_start + term_months", () => {
    assert.equal(dealSchema.renewalDate(wonDeal()), "2027-03-09");
  });

  test("unknown when neither is set — never a silent 'no renewal due'", () => {
    assert.equal(dealSchema.renewalDate(wonDeal({ engagement_start: null, term_months: null })), null);
    const h = clientHealth({ deal: wonDeal({ engagement_start: null, term_months: null }), today: TODAY });
    assert.equal(h.renewal.status, "unknown");
    assert.notEqual(h.renewal.status, "scheduled");
  });

  test("month arithmetic clamps instead of rolling over", () => {
    // Jan 31 + 1 month is Feb 28, not Mar 3.
    assert.equal(dealSchema.addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(dealSchema.addMonths("2024-01-31", 1), "2024-02-29"); // leap year
    assert.equal(dealSchema.addMonths("2026-06-18", 6), "2026-12-18");
    assert.equal(dealSchema.addMonths("2026-12-15", 1), "2027-01-15"); // year boundary
  });

  test("renewal status bands", () => {
    const at = (date) => clientHealth({ deal: wonDeal({ renewal_date: date, term_months: null }), today: TODAY }).renewal.status;
    assert.equal(at("2026-09-01"), "overdue");
    assert.equal(at("2026-09-20"), "due_soon");     // ≤30d
    assert.equal(at("2026-10-20"), "approaching");  // ≤60d
    assert.equal(at("2027-06-01"), "scheduled");
  });

  test("days to renewal is null, not 0, when unknown", () => {
    assert.equal(dealSchema.daysToRenewal(wonDeal({ engagement_start: null, term_months: null }), TODAY), null);
  });
});

describe("tenure and revenue-to-date", () => {
  test("tenure counts whole elapsed months", () => {
    assert.equal(dealSchema.tenureMonths(wonDeal(), TODAY), 6);
    assert.equal(dealSchema.tenureMonths(wonDeal({ engagement_start: "2026-09-01" }), TODAY), 0);
    // The day-of-month hasn't come round yet, so it's not a full month.
    assert.equal(dealSchema.tenureMonths(wonDeal({ engagement_start: "2026-08-20" }), TODAY), 0);
  });

  test("falls back to won_at when engagement_start is unset", () => {
    const d = wonDeal({ engagement_start: null, won_at: "2026-06-09T00:00:00Z" });
    assert.equal(dealSchema.tenureMonths(d, TODAY), 3);
  });

  test("unknown start means unknown tenure, not zero", () => {
    assert.equal(dealSchema.tenureMonths(wonDeal({ engagement_start: null, won_at: null }), TODAY), null);
  });

  test("an unrecorded retainer gives null revenue, not 0", () => {
    // blue-rose-auto is exactly this case — onboarded outside the /proposal flow,
    // so monthly_retainer is 0 meaning "nobody entered it", not "earns nothing".
    const d = wonDeal({ deal: { monthly_retainer: 0, currency: "USD" } });
    assert.equal(dealSchema.revenueToDate(d, TODAY), null);
    const h = clientHealth({ deal: d, today: TODAY });
    assert.equal(h.retainer_recorded, false);
    assert.match(h.reasons.join(" | "), /No retainer recorded/);
  });

  test("a recorded retainer multiplies out", () => {
    assert.equal(dealSchema.revenueToDate(wonDeal(), TODAY), 18000); // 6 months × 3000
  });
});

describe("individual signals return null when there is nothing to judge", () => {
  test("performance", () => {
    assert.equal(scorePerformance(null), null);
    assert.equal(scorePerformance({}), null);
    // A metric that never moved off zero is noise, not a trend.
    assert.equal(scorePerformance({ roas: { mean: 0, direction: "up" } }), null);
  });

  test("payment with no invoice history at all", () => {
    assert.equal(scorePayment([]), null);
    // Issued-but-never-settled drafts are also not a judgement.
    assert.equal(scorePayment([{ id: "i", slug: "a", period: "2026-08", status: "draft", line_items: [{ description: "x", amount: 100 }] }]), null);
  });

  test("delivery and engagement", () => {
    assert.equal(scoreDelivery(null), null);
    assert.equal(scoreEngagement([]), null);
    assert.equal(scoreEngagement([{ type: "note" }]), null); // no timestamps
  });

  test("tenure", () => {
    assert.equal(scoreTenure(null), null);
  });
});

describe("performance polarity", () => {
  test("rising ROAS is good, rising CPA is bad", () => {
    assert.ok(scorePerformance({ roas: { mean: 2.4, direction: "up" } }) > 70);
    assert.ok(scorePerformance({ cpa: { mean: 40, direction: "up" } }) < 40);
    assert.ok(scorePerformance({ cpa: { mean: 40, direction: "down" } }) > 70);
    assert.ok(scorePerformance({ frequency: { mean: 3.2, direction: "up" } }) < 40);
  });

  test("flat is acceptable, not a win", () => {
    const s = scorePerformance({ roas: { mean: 2.4, direction: "flat" } });
    assert.ok(s > 50 && s < 75, `flat should be middling, got ${s}`);
  });

  test("multiple metrics average", () => {
    const s = scorePerformance({ roas: { mean: 2.4, direction: "up" }, cpa: { mean: 40, direction: "up" } });
    assert.ok(s > 40 && s < 70, `mixed signals should land mid-range, got ${s}`);
  });
});

describe("payment score tracks the dunning ladder", () => {
  const inv = (days, status = "sent") => {
    const due = new Date(`${TODAY}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() - days);
    return {
      id: `INV-${days}`, slug: "acme", period: "2026-08", currency: "USD",
      line_items: [{ description: "Retainer", amount: 3000 }],
      status, issued_at: "2026-08-01T00:00:00.000Z", due_date: due.toISOString(),
      ...(status === "paid" ? { paid_at: `${TODAY}T00:00:00.000Z` } : {}),
    };
  };

  test("all settled scores high", () => {
    assert.ok(scorePayment([inv(30, "paid")], `${TODAY}T00:00:00Z`) >= 90);
  });

  test("outstanding but current is fine", () => {
    assert.ok(scorePayment([inv(-5)], `${TODAY}T00:00:00Z`) >= 85);
  });

  test("the later the money, the worse the score", () => {
    const s = (d) => scorePayment([inv(d)], `${TODAY}T00:00:00Z`);
    assert.ok(s(5) > s(20));
    assert.ok(s(20) > s(45));
    assert.ok(s(45) > s(75));
    assert.ok(s(75) > s(120));
    assert.ok(s(120) < 20, "3 months late is close to the floor");
  });
});

describe("clientHealth — weighting and honesty", () => {
  test("a client with NO artifacts scores null, never a default", () => {
    const h = clientHealth({
      deal: { slug: "ghost", company_name: "Ghost", stage: "won", links: { proposal: "p" }, activities: [] },
      today: TODAY,
    });
    assert.equal(h.score, null, "no evidence must not become a number");
    assert.equal(h.band, null);
    assert.equal(h.confidence, 0);
    assert.equal(h.missing.length, Object.keys(WEIGHTS).length);
  });

  test("confidence reflects the share of weighting that had data", () => {
    // tenure only: 10 of 100.
    const h = clientHealth({ deal: wonDeal({ activities: [] }), today: TODAY });
    assert.equal(h.confidence, WEIGHTS.tenure);
    assert.equal(h.band_provisional, true, "a band from 10% of the weighting is a hint, not a finding");
  });

  test("full data reaches 100% confidence and is not provisional", () => {
    const h = clientHealth({
      deal: wonDeal(),
      trends: { roas: { mean: 2.4, direction: "up" } },
      invoices: [{ id: "i", slug: "acme", period: "2026-08", currency: "USD", line_items: [{ description: "R", amount: 3000 }], status: "paid", paid_at: `${TODAY}T00:00:00Z`, due_date: "2026-08-08T00:00:00Z" }],
      lastReport: "2026-09-05",
      today: TODAY,
    });
    assert.equal(h.confidence, 100);
    assert.equal(h.band_provisional, false);
    assert.equal(h.band, "healthy");
  });

  test("a missing signal is excluded from the denominator, not scored zero", () => {
    // Perfect payment only. If missing signals were zeros this would be ~24, not ~95.
    const paid = [{ id: "i", slug: "acme", period: "2026-08", currency: "USD", line_items: [{ description: "R", amount: 3000 }], status: "paid", paid_at: `${TODAY}T00:00:00Z`, due_date: "2026-08-08T00:00:00Z" }];
    const h = clientHealth({
      deal: { slug: "a", company_name: "A", stage: "won", links: { proposal: "p" }, activities: [], deal: { monthly_retainer: 1 } },
      invoices: paid, today: TODAY,
    });
    assert.ok(h.score >= 90, `expected ~95 from a single perfect signal, got ${h.score}`);
    assert.equal(h.confidence, WEIGHTS.payment);
  });

  test("badly overdue money drags a client into a low band with a stated reason", () => {
    const h = clientHealth({
      deal: wonDeal(),
      invoices: [{ id: "i", slug: "acme", period: "2026-04", currency: "USD", line_items: [{ description: "R", amount: 3000 }], status: "sent", issued_at: "2026-04-01T00:00:00Z", due_date: "2026-04-08T00:00:00Z" }],
      lastReport: "2026-09-05",
      trends: { roas: { mean: 1.1, direction: "down" } },
      today: TODAY,
    });
    assert.ok(["at_risk", "critical"].includes(h.band), `expected a low band, got ${h.band}`);
    assert.match(h.reasons.join(" | "), /overdue invoice/);
    assert.match(h.reasons.join(" | "), /Performance trending the wrong way/);
  });

  test("reasons always explain which signals were unavailable", () => {
    const h = clientHealth({ deal: wonDeal(), today: TODAY });
    assert.match(h.reasons.join(" | "), /Signals unavailable:/);
  });

  test("bandFor boundaries", () => {
    assert.equal(bandFor(75), "healthy");
    assert.equal(bandFor(74), "watch");
    assert.equal(bandFor(55), "watch");
    assert.equal(bandFor(54), "at_risk");
    assert.equal(bandFor(35), "at_risk");
    assert.equal(bandFor(34), "critical");
    assert.equal(bandFor(null), null);
  });

  test("never throws on a garbage deal", () => {
    for (const bad of [null, undefined, {}, { deal: null }]) {
      assert.doesNotThrow(() => clientHealth({ deal: bad, today: TODAY }));
    }
  });
});

describe("retentionQueue prioritization", () => {
  const h = (over) => ({ slug: "x", score: 80, band: "healthy", renewal: { status: "scheduled" }, ...over });

  test("healthy and far from renewal is not in the queue", () => {
    assert.equal(retentionQueue([h({})]).length, 0);
  });

  test("an overdue renewal outranks a merely at-risk client", () => {
    const q = retentionQueue([
      h({ slug: "atrisk", band: "at_risk" }),
      h({ slug: "overdue", renewal: { status: "overdue" } }),
    ]);
    assert.equal(q[0].slug, "overdue");
  });

  test("critical health plus a due renewal tops the list", () => {
    const q = retentionQueue([
      h({ slug: "overdue-only", renewal: { status: "overdue" } }),
      h({ slug: "both", band: "critical", renewal: { status: "due_soon" } }),
      h({ slug: "watch", band: "watch" }),
    ]);
    assert.equal(q[0].slug, "both");
    assert.equal(q.length, 3);
  });

  test("an unscoreable client with an unknown renewal isn't invented into the queue", () => {
    assert.equal(retentionQueue([h({ score: null, band: null, renewal: { status: "unknown" } })]).length, 0);
  });

  test("handles empty / missing input", () => {
    assert.deepEqual(retentionQueue([]), []);
    assert.deepEqual(retentionQueue(null), []);
  });
});

describe("deal schema — retention fields validate without breaking existing deals", () => {
  test("existing deals with no retention fields still validate", () => {
    const legacy = { slug: "old", company_name: "Old Co", stage: "won", links: { proposal: "p.pdf" } };
    assert.equal(dealSchema.validate(legacy).ok, true);
  });

  test("a malformed date is rejected", () => {
    assert.equal(dealSchema.validate(wonDeal({ engagement_start: "June 18" })).ok, false);
    assert.equal(dealSchema.validate(wonDeal({ renewal_date: "2026/12/18" })).ok, false);
  });

  test("a non-positive term is rejected", () => {
    assert.equal(dealSchema.validate(wonDeal({ term_months: 0 })).ok, false);
    assert.equal(dealSchema.validate(wonDeal({ term_months: -3 })).ok, false);
    assert.equal(dealSchema.validate(wonDeal({ term_months: 6 })).ok, true);
  });
});
