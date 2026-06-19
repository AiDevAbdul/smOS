import "dotenv/config";
import { createMetaClient } from "./meta-client.js";

const client = createMetaClient();
const results = [];

async function test(label, fn) {
  process.stdout.write(`  Testing ${label}... `);
  try {
    const data = await fn();
    console.log("✓");
    results.push({ label, status: "pass", data });
    return data;
  } catch (err) {
    console.log(`✗  ${err.message}`);
    results.push({ label, status: "fail", error: err.message });
    return null;
  }
}

console.log("\n═══ smOS Meta API Test Suite ═══\n");

// 1. Token identity
console.log("[ 1 ] Token & Identity");
const me = await test("token identity (/me)", () =>
  client.get("/me", { fields: "id,name,email" })
);

// 2. Ad accounts accessible
console.log("\n[ 2 ] Ad Accounts");
const accounts = await test("list ad accounts", () =>
  client.get("/me/adaccounts", {
    fields: "id,name,account_status,currency,timezone_name,business",
    limit: 10,
  })
);
if (accounts?.data?.length) {
  console.log(`      Found ${accounts.data.length} ad account(s):`);
  accounts.data.forEach((a) => console.log(`      · ${a.name} (${a.id}) — status: ${a.account_status}`));
}

// 3. Pick first active account for deeper tests
const activeAccount = accounts?.data?.find((a) => a.account_status === 1) || accounts?.data?.[0];
if (activeAccount) {
  const accountId = activeAccount.id;
  console.log(`\n[ 3 ] Campaign & Pixel Tests on: ${activeAccount.name} (${accountId})`);

  await test("list campaigns (active/paused)", () =>
    client.get(`/${accountId}/campaigns`, {
      fields: "id,name,status,objective,daily_budget",
      filtering: JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED"] }]),
      limit: 5,
    })
  );

  await test("list custom audiences", () =>
    client.get(`/${accountId}/customaudiences`, {
      fields: "id,name,subtype,approximate_count",
      limit: 5,
    })
  );

  await test("list pixels", () =>
    client.get(`/${accountId}/adspixels`, {
      fields: "id,name,last_fired_time",
      limit: 5,
    })
  );

  await test("reach estimate (US, 25-45, broad)", () =>
    client.get(`/${accountId}/reachestimate`, {
      targeting_spec: JSON.stringify({
        geo_locations: { countries: ["US"] },
        age_min: 25,
        age_max: 45,
      }),
      fields: "users_lower_bound,users_upper_bound,estimate_ready",
    })
  );
} else {
  console.log("\n[ 3 ] No ad accounts found — skipping campaign tests");
}

// 4. Pages accessible
console.log("\n[ 4 ] Facebook Pages");
const pages = await test("list pages", () =>
  client.get("/me/accounts", {
    fields: "id,name,fan_count,verification_status,category",
    limit: 10,
  })
);
if (pages?.data?.length) {
  console.log(`      Found ${pages.data.length} page(s):`);
  pages.data.forEach((p) => console.log(`      · ${p.name} (${p.id}) — ${p.fan_count?.toLocaleString() || 0} fans`));
}

// 5. Ad Library (public — no account needed)
console.log("\n[ 5 ] Ad Library");
await test("ad library search (test query)", () =>
  client.get("/ads_archive", {
    ad_type: "ALL",
    ad_reached_countries: JSON.stringify(["US"]),
    search_terms: "shoes",
    ad_active_status: "ACTIVE",
    limit: 3,
    fields: "id,page_name,ad_creative_bodies,ad_delivery_start_time",
  })
);

// Summary
console.log("\n═══ Results ═══");
const passed = results.filter((r) => r.status === "pass").length;
const failed = results.filter((r) => r.status === "fail").length;
console.log(`  Passed: ${passed}/${results.length}`);
if (failed) {
  console.log(`  Failed:`);
  results.filter((r) => r.status === "fail").forEach((r) => console.log(`    ✗ ${r.label}: ${r.error}`));
}
console.log("");
