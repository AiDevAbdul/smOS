/**
 * E3 — "verify, don't assume": the IG↔Page read-verification and the deepened
 * /brand-name screen (multi-TLD, handle consistency, sound-alike knockout).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPage, verifyIgPageLink } from "../scripts/lib/meta_verify.js";
import { screen, checkDomains, handleConsistency, trademarkKnockout, DEFAULT_TLDS } from "../skills/brand-name/brand-name.js";

const graphOf = (impl) => ({ get: impl });

test("verifyPage: reads the page, reports a failure instead of assuming", async () => {
  const ok = await verifyPage(graphOf(async () => ({ id: "111", name: "Acme" })), "111");
  assert.deepEqual(ok, { ok: true, page_id: "111", name: "Acme", reason: null });

  const missing = await verifyPage(graphOf(async () => ({})), "TBD");
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /no facebook_page_id/);

  const boom = await verifyPage(graphOf(async () => { throw new Error("(#190) invalid token"); }), "111");
  assert.equal(boom.ok, false);
  assert.match(boom.reason, /invalid token/);
});

test("verifyIgPageLink: unlinked Page cannot stamp the gate", async () => {
  const r = await verifyIgPageLink(graphOf(async () => ({ id: "111", name: "Acme" })), { pageId: "111" });
  assert.equal(r.ok, false);
  assert.equal(r.instagram_business_id, null);
  assert.match(r.reason, /no linked instagram_business_account/);
});

test("verifyIgPageLink: linked Page verifies and returns the live IG id", async () => {
  const r = await verifyIgPageLink(
    graphOf(async () => ({ id: "111", instagram_business_account: { id: "222", username: "acme" } })),
    { pageId: "111", igId: "222" },
  );
  assert.equal(r.ok, true);
  assert.equal(r.instagram_business_id, "222");
  assert.equal(r.username, "acme");
  assert.equal(r.mismatch, false);
});

test("verifyIgPageLink: a DIFFERENT IG on the Page is a mismatch, not a pass", async () => {
  const r = await verifyIgPageLink(
    graphOf(async () => ({ id: "111", instagram_business_account: { id: "999", username: "someoneelse" } })),
    { pageId: "111", igId: "222" },
  );
  assert.equal(r.ok, false);
  assert.equal(r.mismatch, true);
  assert.equal(r.instagram_business_id, "999");
  assert.equal(r.recorded_instagram_business_id, "222");
});

test("verifyIgPageLink: missing page id halts with a next step, no API call", async () => {
  let called = false;
  const r = await verifyIgPageLink(graphOf(async () => { called = true; return {}; }), { pageId: null, igId: "222" });
  assert.equal(called, false);
  assert.equal(r.ok, false);
  assert.match(r.reason, /record the Page gate first/);
});

// --- /brand-name deepened screen -------------------------------------------

// DNS fake: only these zones have nameservers (i.e. are registered).
function resolverWith(registered) {
  const has = (d) => registered.includes(d);
  return {
    resolveNs: async (d) => { if (!has(d)) throw new Error("NXDOMAIN"); return ["ns1"]; },
    resolve: async (d) => { if (!has(d)) throw new Error("NXDOMAIN"); return ["1.2.3.4"]; },
  };
}

test("checkDomains: screens every TLD, taken vs unknown (never 'available')", async () => {
  const dom = await checkDomains("Acme", { resolver: resolverWith(["acme.com", "acme.net"]) });
  assert.deepEqual(Object.keys(dom.domains), DEFAULT_TLDS);
  assert.equal(dom.com_available, false);
  assert.deepEqual(dom.taken_tlds, ["com", "net"]);
  assert.deepEqual(dom.unknown_tlds, ["co", "io"]);
  assert.equal(dom.domain, "acme.com");

  const custom = await checkDomains("Acme", { tlds: ["dev"], resolver: resolverWith([]) });
  assert.deepEqual(custom.domains, { dev: null });
  assert.equal(custom.com_available, null); // .com wasn't screened → unknown, not free
});

test("handleConsistency: consistent only when every platform is definitely free", () => {
  const all = handleConsistency("acme", { instagram: true, facebook: true, x: true });
  assert.equal(all.consistent, true);
  assert.deepEqual(all.unknown, []);

  const partial = handleConsistency("acme", { instagram: true, facebook: null, tiktok: null });
  assert.equal(partial.consistent, null); // unknown is never "consistent"
  assert.deepEqual(partial.definitely_free, ["instagram"]);
  assert.deepEqual(partial.unknown, ["facebook", "tiktok"]);
  assert.match(partial.note, /facebook, tiktok/);
});

test("trademarkKnockout: no API key = NOT run, and it hands over the search set", async () => {
  const tm = await trademarkKnockout("Clarity", { apiKey: "" });
  assert.equal(tm.knockout_clear, null);
  assert.ok(tm.queried.includes("clarity"));
  assert.ok(tm.queried.includes("klarity"));
  assert.match(tm.note, /knockout NOT run/);
  assert.equal(tm.phonetics.soundex, "C463");
});

test("trademarkKnockout: a sound-alike live mark knocks the name out", async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => (url.includes("klarity")
      ? { count: 1, results: [{ markText: "CLARITY" }] }
      : { count: 0, results: [] }),
  });
  const tm = await trademarkKnockout("Klarity", { apiKey: "k", fetchImpl });
  assert.equal(tm.knockout_clear, false);
  assert.equal(tm.similar_marks.length, 1);
  assert.equal(tm.similar_marks[0].mark, "CLARITY");
  assert.ok(tm.similar_marks[0].reasons.length > 0);
  assert.match(tm.note, /sound-alike/);
});

test("trademarkKnockout: clean across every respelling clears the knockout only", async () => {
  const tm = await trademarkKnockout("Zyxxo", {
    apiKey: "k",
    fetchImpl: async () => ({ ok: true, json: async () => ({ count: 0, results: [] }) }),
  });
  assert.equal(tm.knockout_clear, true);
  assert.equal(tm.hits, 0);
  assert.match(tm.note, /NOT clearance/);
});

test("trademarkKnockout: one failed query means the screen is incomplete, not clear", async () => {
  let n = 0;
  const tm = await trademarkKnockout("Clarity", {
    apiKey: "k",
    fetchImpl: async () => {
      n += 1;
      if (n === 2) return { ok: false, status: 429 };
      return { ok: true, json: async () => ({ count: 0, results: [] }) };
    },
  });
  assert.equal(tm.knockout_clear, null);
  assert.match(tm.note, /incomplete/);
});

test("screen: one row per candidate, carrying all three gates + depth", async () => {
  const rows = await screen(["Klarity", "  ", "Zyxxo"], {
    resolver: resolverWith(["klarity.com"]),
    apiKey: "k",
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => (url.includes("klarity") ? { count: 1, results: [{ markText: "CLARITY" }] } : { count: 0, results: [] }),
    }),
    checkHandlesImpl: async () => ({ instagram: null, facebook: true }),
  });
  assert.equal(rows.length, 2); // blank candidate skipped
  const [klarity, zyxxo] = rows;
  assert.equal(klarity.domain_com_available, false);
  assert.equal(klarity.trademark_knockout_clear, false);
  assert.equal(klarity.trademark_similar_marks[0].mark, "CLARITY");
  assert.equal(klarity.handle_consistency.consistent, null);
  assert.equal(klarity.attorney_clearance_flagged, true);
  assert.equal(zyxxo.trademark_knockout_clear, true);
  assert.equal(zyxxo.attorney_clearance_flagged, true); // ALWAYS, even on a clean screen
});
