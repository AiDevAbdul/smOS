import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import * as competitorSchema from "../schemas/competitor_intel.js";
import { makeClient, cleanup, runSkill, profileFixture } from "./helpers/pipeline.js";
import * as P from "../scripts/lib/paths.js";

// A5 — Layout drift-guard.
//
// Locks the canonical four-bucket layout (scripts/lib/paths.js): a
// deliverable-producing skill must write ONLY inside data/ | deliverables/ |
// reports/ | state/ under the client root — never a new flat file. If a future
// skill regresses to `resolve(clientDir, "x.json")` and dumps at the root, this
// fails loudly instead of silently re-flattening the tree.

const SLUG = "__it_layout_guard";

// The only NEW entries a skill may add at the client root are the four buckets.
const BUCKETS = new Set(["data", "deliverables", "reports", "state"]);

function profileWithInterests() {
  return profileFixture(SLUG, {
    kpis: { target_cpa: 50, target_roas: 2.0, monthly_budget_low: 3000 },
    extra: {
      audience: { interests: ["fitness", "yoga", "wellness"] },
      location: { primary: "Austin, TX" },
      products: [{ name: "Personal Training" }],
    },
  });
}

function competitorIntelFixture() {
  return competitorSchema.normalize({
    client_slug: SLUG,
    generated_at: new Date().toISOString(),
    country: "US",
    competitors: [{ name: "RivalFit", angles: [{ angle: "Transformation results", frequency: 5 }] }],
    angles: [{ angle: "Transformation results", frequency: 5 }],
    gaps: ["No video testimonials"],
  });
}

function rootEntries() {
  const root = P.clientRoot(SLUG);
  return existsSync(root) ? readdirSync(root) : [];
}

test("layout: audience-map + strategy-brief write ONLY into the four buckets", () => {
  try {
    makeClient(SLUG, {
      "client_profile.json": profileWithInterests(),
      "competitor_intel.json": competitorIntelFixture(),
    });
    // Baseline: the flat inputs the harness wrote. Skills must not ADD to this
    // set except by creating bucket dirs.
    const before = new Set(rootEntries());

    const am = runSkill("skills/audience-map/audience-map.js", SLUG, "--offline");
    assert.equal(am.status, 0, `audience-map failed:\n${am.stderr}`);
    const sb = runSkill("skills/strategy-brief/strategy-brief.js", SLUG);
    assert.equal(sb.status, 0, `strategy-brief failed:\n${sb.stderr}`);

    const added = rootEntries().filter((e) => !before.has(e));
    const strayFlat = added.filter((e) => !BUCKETS.has(e));
    assert.deepEqual(
      strayFlat, [],
      `layout drift: these flat entries appeared at the client root instead of a ` +
        `data/|deliverables/|reports/|state/ bucket: ${strayFlat.join(", ")}`,
    );

    // Positive control: the deliverable actually landed in its bucket.
    assert.ok(
      existsSync(P.clientDeliverable(SLUG, "strategy-brief", "md")),
      "strategy_brief.md should be in deliverables/strategy-brief/",
    );
    assert.ok(
      existsSync(P.clientData(SLUG, "strategy_brief.json")),
      "strategy_brief.json should be in data/",
    );
  } finally {
    cleanup(SLUG);
  }
});
