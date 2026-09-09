// test/agency-ops.test.js — Group D5: agency metrics + signed share links.
//
// Two clusters of risk here.
//
// Metrics: this dashboard is what the operator makes pricing and hiring decisions
// from, so a plausible-looking number computed from insufficient data is worse
// than a blank. The tests pin that NRR, churn and win rate all REFUSE rather than
// report 100% / 0% off an empty denominator.
//
// Share tokens: this page carries whole-book MRR, margin and receivables. The
// tests pin that a token cannot be forged, edited (to bump expiry or swap the
// client scope), replayed after expiry, or minted at all without a real secret.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.SMOS_DATA_ROOT) process.env.SMOS_DATA_ROOT = resolve(ROOT, "test", ".tmp");

const {
  currentMrr, winRate, churn, pipelineVelocity, nrr, recordSnapshot,
  agencyDashboard, stageReachedAt,
} = await import("../scripts/lib/agency-metrics.js");
const {
  mintShareToken, verifyShareToken, shareConfigured, shareSecret, generateSecret,
} = await import("../scripts/lib/share-token.js");
const { agingReport } = await import("../scripts/lib/ar.js");

const NOW = "2026-09-09T00:00:00.000Z";
const deal = (over = {}) => ({
  slug: "acme", company_name: "Acme Co", stage: "won",
  links: { proposal: "p.pdf" }, deal: { monthly_retainer: 3000, currency: "USD" },
  created_at: "2026-05-01T00:00:00.000Z", won_at: "2026-06-01T00:00:00.000Z",
  activities: [], ...over,
});

describe("currentMrr", () => {
  test("sums per currency and never blends", () => {
    const m = currentMrr([
      deal({ slug: "a" }),
      deal({ slug: "b", deal: { monthly_retainer: 1500, currency: "EUR" } }),
      deal({ slug: "c", deal: { monthly_retainer: 15000, currency: "PKR" } }),
    ]);
    assert.deepEqual(m.by_currency, { USD: 3000, EUR: 1500, PKR: 15000 });
    assert.equal(m.clients, 3);
  });

  test("clients with no retainer are counted and named, not silently dropped", () => {
    const m = currentMrr([deal({ slug: "a" }), deal({ slug: "noterms", deal: { monthly_retainer: 0, currency: "USD" } })]);
    assert.equal(m.by_currency.USD, 3000);
    assert.equal(m.clients_without_retainer, 1);
    assert.deepEqual(m.clients_without_retainer_slugs, ["noterms"]);
  });

  test("only won deals count", () => {
    const m = currentMrr([deal({ slug: "a" }), deal({ slug: "p", stage: "proposed", links: {} })]);
    assert.equal(m.clients, 1);
  });
});

describe("win rate refuses to invent a denominator", () => {
  test("all wins, no losses → null with an explanation, NOT 100%", () => {
    const w = winRate([deal({ slug: "a" }), deal({ slug: "b" })], { until: NOW });
    assert.equal(w.rate_pct, null, "100% off zero recorded losses is a claim the data doesn't make");
    assert.equal(w.won, 2);
    assert.match(w.reason, /needs losses in the denominator/);
  });

  test("no decided deals at all → null", () => {
    assert.equal(winRate([deal({ stage: "lead", links: {} })], { until: NOW }).rate_pct, null);
  });

  test("with real losses it computes", () => {
    const w = winRate([
      deal({ slug: "a" }), deal({ slug: "b" }), deal({ slug: "c" }),
      deal({ slug: "x", stage: "lost", links: {}, lost_at: "2026-07-01T00:00:00Z" }),
    ], { until: NOW });
    assert.equal(w.rate_pct, 75);
    assert.equal(w.reason, null);
  });

  test("the window excludes decisions outside it", () => {
    const w = winRate([
      deal({ slug: "old", won_at: "2026-01-01T00:00:00Z" }),
      deal({ slug: "x", stage: "lost", links: {}, lost_at: "2026-08-01T00:00:00Z" }),
    ], { since: "2026-07-01T00:00:00Z", until: NOW });
    assert.equal(w.won, 0);
    assert.equal(w.lost, 1);
  });
});

describe("churn refuses to report 0% off no history", () => {
  test("no churned clients → null with an explanation", () => {
    const c = churn([deal({ slug: "a" }), deal({ slug: "b" })], { until: NOW });
    assert.equal(c.rate_pct, null, "0% would imply a measured denominator");
    assert.equal(c.active, 2);
    assert.match(c.reason, /no churn rate to report/);
  });

  test("with a churned client it computes and names them", () => {
    const c = churn([
      deal({ slug: "a" }), deal({ slug: "b" }), deal({ slug: "c" }),
      deal({ slug: "gone", stage: "churned", activities: [{ at: "2026-08-01T00:00:00Z", type: "stage", note: "moved to churned" }] }),
    ], { until: NOW });
    assert.equal(c.churned, 1);
    assert.equal(c.rate_pct, 25);
    assert.deepEqual(c.churned_slugs, ["gone"]);
  });
});

describe("pipeline velocity", () => {
  test("median is reported alongside the sample size and range", () => {
    const v = pipelineVelocity([
      deal({ slug: "a", created_at: "2026-05-01T00:00:00Z", won_at: "2026-05-11T00:00:00Z" }), // 10d
      deal({ slug: "b", created_at: "2026-05-01T00:00:00Z", won_at: "2026-05-21T00:00:00Z" }), // 20d
      deal({ slug: "c", created_at: "2026-05-01T00:00:00Z", won_at: "2026-08-01T00:00:00Z" }), // 92d
    ]);
    assert.equal(v.median_days, 20);
    assert.equal(v.sample, 3);
    assert.deepEqual(v.range_days, [10, 92]);
    // A single slow deal skews the mean at this sample size — hence median first.
    assert.ok(v.mean_days > v.median_days);
  });

  test("no measurable deals → null with a reason", () => {
    assert.equal(pipelineVelocity([]).median_days, null);
    assert.match(pipelineVelocity([]).reason, /No won deals/);
  });

  test("even-sized samples average the two middle values", () => {
    const v = pipelineVelocity([
      deal({ slug: "a", created_at: "2026-05-01T00:00:00Z", won_at: "2026-05-11T00:00:00Z" }),
      deal({ slug: "b", created_at: "2026-05-01T00:00:00Z", won_at: "2026-05-31T00:00:00Z" }),
    ]);
    assert.equal(v.median_days, 20);
  });

  test("stageReachedAt falls back to the activity log", () => {
    const d = deal({ won_at: null, activities: [{ at: "2026-07-04T00:00:00Z", type: "stage", note: "lead -> won" }] });
    assert.equal(stageReachedAt(d, "won"), "2026-07-04T00:00:00Z");
  });
});

describe("MRR snapshots and NRR", () => {
  test("NRR is null until two snapshots exist, and says why", () => {
    const n = nrr([], { currency: "USD" });
    assert.equal(n.nrr_pct, null);
    assert.match(n.reason, /at least two MRR snapshots/);
    // The reason must explain WHY current state can't substitute.
    assert.match(n.reason, /aren't versioned/);
  });

  test("a snapshot is idempotent per date — re-running doesn't stack duplicates", () => {
    let h = recordSnapshot([], [deal()], NOW);
    h = recordSnapshot(h, [deal({ deal: { monthly_retainer: 4000, currency: "USD" } })], NOW);
    assert.equal(h.length, 1);
    assert.equal(h[0].by_currency.USD, 4000, "the same day's entry is replaced, not appended");
  });

  test("snapshots stay sorted by date", () => {
    let h = recordSnapshot([], [deal()], "2026-09-09T00:00:00Z");
    h = recordSnapshot(h, [deal()], "2026-07-01T00:00:00Z");
    assert.deepEqual(h.map((x) => x.date), ["2026-07-01", "2026-09-09"]);
  });

  test("NRR decomposes expansion, contraction and churn, and excludes new logos", () => {
    const history = [
      { date: "2026-06-01", by_currency: { USD: 3800 }, per_client: [
        { slug: "keep", mrr: 3000, currency: "USD" },
        { slug: "shrink", mrr: 500, currency: "USD" },
        { slug: "gone", mrr: 300, currency: "USD" },
      ] },
      { date: "2026-09-09", by_currency: { USD: 3800 }, per_client: [
        { slug: "keep", mrr: 3500, currency: "USD" },   // +500 expansion
        { slug: "shrink", mrr: 300, currency: "USD" },  // -200 contraction
        { slug: "brand-new", mrr: 1000, currency: "USD" }, // new logo, excluded
      ] },
    ];
    const n = nrr(history, { currency: "USD" });
    assert.equal(n.start_mrr, 3800);
    assert.equal(n.expansion, 500);
    assert.equal(n.contraction, 200);
    assert.equal(n.churned_mrr, 300);
    assert.equal(n.new_logo_mrr, 1000);
    // (3800 + 500 - 200 - 300) / 3800 — new logos must NOT inflate NRR.
    assert.equal(n.nrr_pct, 100);
    // Gross retention drops expansion too.
    assert.equal(n.gross_retention_pct, 86.84);
  });

  test("NRR is per currency and ignores other currencies' clients", () => {
    const history = [
      { date: "2026-06-01", by_currency: { USD: 1000, EUR: 500 }, per_client: [
        { slug: "u", mrr: 1000, currency: "USD" }, { slug: "e", mrr: 500, currency: "EUR" }] },
      { date: "2026-09-01", by_currency: { USD: 1000, EUR: 0 }, per_client: [
        { slug: "u", mrr: 1000, currency: "USD" }] },
    ];
    assert.equal(nrr(history, { currency: "USD" }).nrr_pct, 100);
    assert.equal(nrr(history, { currency: "EUR" }).nrr_pct, 0, "the EUR client churned entirely");
  });

  test("no MRR in the earliest snapshot → null, not a divide-by-zero", () => {
    const n = nrr([
      { date: "2026-06-01", by_currency: {}, per_client: [] },
      { date: "2026-09-01", by_currency: { USD: 100 }, per_client: [{ slug: "a", mrr: 100, currency: "USD" }] },
    ], { currency: "USD" });
    assert.equal(n.nrr_pct, null);
    assert.match(n.reason, /No USD MRR in the earliest snapshot/);
  });
});

describe("AR aging is currency-aware for cross-client roll-ups", () => {
  const inv = (slug, currency, amount, dueDaysAgo) => {
    const due = new Date(NOW); due.setUTCDate(due.getUTCDate() - dueDaysAgo);
    return { id: `INV-${slug}`, slug, currency, line_items: [{ description: "R", amount }], period: "2026-08", status: "sent", issued_at: "2026-08-01T00:00:00Z", due_date: due.toISOString() };
  };

  test("mixed currencies are broken out and flagged", () => {
    const ar = agingReport([inv("a", "USD", 3000, 40), inv("b", "EUR", 1500, 5)], NOW);
    assert.equal(ar.mixed_currency, true);
    assert.deepEqual(ar.currencies.sort(), ["EUR", "USD"]);
    assert.equal(ar.by_currency.USD.overdue_total, 3000);
    assert.equal(ar.by_currency.EUR.overdue_total, 1500);
  });

  test("a single-currency ledger is not flagged as mixed", () => {
    assert.equal(agingReport([inv("a", "USD", 3000, 40)], NOW).mixed_currency, false);
  });

  test("the dashboard exposes AR per currency and no blended total", () => {
    const d = agencyDashboard({
      deals: [deal()], now: NOW,
      arByClient: { acme: [inv("acme", "USD", 3000, 40)], other: [inv("other", "EUR", 1500, 2)] },
    });
    assert.ok(d.ar.by_currency.USD);
    assert.equal(d.ar.mixed_currency, true);
    assert.equal(d.ar.outstanding, undefined, "a blended cross-client total must not be surfaced");
  });
});

describe("agencyDashboard assembly", () => {
  test("produces every section without throwing on a thin dataset", () => {
    const d = agencyDashboard({ deals: [deal()], now: NOW });
    for (const k of ["mrr", "nrr", "churn", "win_rate", "velocity", "pipeline", "ar"]) {
      assert.ok(k in d, `missing section ${k}`);
    }
    // With one won deal and no history, the rate metrics must all abstain.
    assert.equal(d.churn.rate_pct, null);
    assert.equal(d.win_rate.rate_pct, null);
  });

  test("survives empty input", () => {
    assert.doesNotThrow(() => agencyDashboard({ deals: [], now: NOW }));
    assert.doesNotThrow(() => agencyDashboard({ now: NOW }));
  });
});

describe("share tokens cannot be forged, edited, or replayed", () => {
  const SECRET = "a".repeat(40);
  const withSecret = (fn) => {
    const saved = process.env.SMOS_SHARE_SECRET;
    process.env.SMOS_SHARE_SECRET = SECRET;
    try { return fn(); } finally {
      if (saved === undefined) delete process.env.SMOS_SHARE_SECRET; else process.env.SMOS_SHARE_SECRET = saved;
    }
  };

  test("a placeholder or short secret is not a secret", () => {
    const saved = process.env.SMOS_SHARE_SECRET;
    for (const v of ["FILL_IN", "changeme", "secret", "short", "", "your_secret_here"]) {
      process.env.SMOS_SHARE_SECRET = v;
      assert.equal(shareConfigured(), false, `"${v}" must not count as a secret`);
    }
    delete process.env.SMOS_SHARE_SECRET;
    assert.equal(shareConfigured(), false);
    assert.equal(shareSecret(), null);
    if (saved !== undefined) process.env.SMOS_SHARE_SECRET = saved;
  });

  test("minting without a secret throws rather than producing an unsigned token", () => {
    const saved = process.env.SMOS_SHARE_SECRET;
    delete process.env.SMOS_SHARE_SECRET;
    assert.throws(() => mintShareToken({ resource: "agency-ops" }), /SMOS_SHARE_SECRET is not set/);
    if (saved !== undefined) process.env.SMOS_SHARE_SECRET = saved;
  });

  test("generateSecret produces something long enough to be accepted", () => {
    const s = generateSecret();
    assert.ok(s.length >= 32);
    const saved = process.env.SMOS_SHARE_SECRET;
    process.env.SMOS_SHARE_SECRET = s;
    assert.equal(shareConfigured(), true);
    if (saved === undefined) delete process.env.SMOS_SHARE_SECRET; else process.env.SMOS_SHARE_SECRET = saved;
  });

  test("a freshly minted token verifies for its own resource", () => withSecret(() => {
    const { token } = mintShareToken({ resource: "agency-ops" });
    assert.equal(verifyShareToken(token, { resource: "agency-ops" }).ok, true);
  }));

  test("a token for one resource does not open another", () => withSecret(() => {
    const { token } = mintShareToken({ resource: "portal", slug: "acme" });
    const v = verifyShareToken(token, { resource: "agency-ops" });
    assert.equal(v.ok, false);
    assert.match(v.reason, /is for resource/);
  }));

  test("a client-scoped token cannot be used for another client", () => withSecret(() => {
    const { token } = mintShareToken({ resource: "portal", slug: "acme" });
    assert.equal(verifyShareToken(token, { resource: "portal", slug: "acme" }).ok, true);
    const v = verifyShareToken(token, { resource: "portal", slug: "other-client" });
    assert.equal(v.ok, false);
    assert.match(v.reason, /scoped to/);
  }));

  test("an edited payload fails — you cannot bump your own expiry", () => withSecret(() => {
    const { token, payload } = mintShareToken({ resource: "agency-ops", ttlDays: 1 });
    const sig = token.slice(token.lastIndexOf(".") + 1);
    const forged = Buffer.from(JSON.stringify({ ...payload, exp: payload.exp + 86400 * 3650 })).toString("base64url");
    const v = verifyShareToken(`${forged}.${sig}`, { resource: "agency-ops" });
    assert.equal(v.ok, false);
    assert.match(v.reason, /signature mismatch/);
  }));

  test("a token signed with a different secret fails", () => {
    const saved = process.env.SMOS_SHARE_SECRET;
    process.env.SMOS_SHARE_SECRET = "b".repeat(40);
    const { token } = mintShareToken({ resource: "agency-ops" });
    process.env.SMOS_SHARE_SECRET = "c".repeat(40);
    assert.equal(verifyShareToken(token, { resource: "agency-ops" }).ok, false);
    if (saved === undefined) delete process.env.SMOS_SHARE_SECRET; else process.env.SMOS_SHARE_SECRET = saved;
  });

  test("an expired token is refused", () => withSecret(() => {
    const now = Date.now();
    const { token } = mintShareToken({ resource: "agency-ops", ttlDays: 1, now });
    const v = verifyShareToken(token, { resource: "agency-ops", now: now + 2 * 86400 * 1000 });
    assert.equal(v.ok, false);
    assert.match(v.reason, /expired/);
  }));

  test("malformed input is refused, never accepted", () => withSecret(() => {
    for (const bad of [null, undefined, "", "nodot", "a.b.c", 42, {}]) {
      assert.equal(verifyShareToken(bad, { resource: "agency-ops" }).ok, false);
    }
  }));

  test("verification without a secret refuses everything", () => withSecret(() => {
    const { token } = mintShareToken({ resource: "agency-ops" });
    delete process.env.SMOS_SHARE_SECRET;
    const v = verifyShareToken(token, { resource: "agency-ops" });
    assert.equal(v.ok, false);
    assert.match(v.reason, /not set/);
  }));

  test("two tokens for the same resource are distinct", () => withSecret(() => {
    const a = mintShareToken({ resource: "agency-ops" }).token;
    const b = mintShareToken({ resource: "agency-ops" }).token;
    assert.notEqual(a, b, "a nonce makes tokens individually distinguishable");
  }));
});
