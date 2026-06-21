import { test } from "node:test";
import assert from "node:assert/strict";
import { supabaseConfigured, insert, upsert, clientIdBySlug } from "../scripts/lib/supabase.js";

// These assert the persistence layer is a safe no-op without env — scripts must
// run offline without throwing or hitting the network.

test("supabaseConfigured: false when env unset", () => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  try {
    assert.equal(supabaseConfigured(), false);
  } finally {
    if (url) process.env.SUPABASE_URL = url;
    if (key) process.env.SUPABASE_SERVICE_KEY = key;
  }
});

test("insert: no-op (skipped) when unconfigured, never throws", async () => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  try {
    const r = await insert("daily_metrics", [{ campaign_id: "c1", date: "2026-06-01" }]);
    assert.deepEqual(r, { skipped: true, reason: "SUPABASE_URL/SUPABASE_SERVICE_KEY not set" });
  } finally {
    if (url) process.env.SUPABASE_URL = url;
    if (key) process.env.SUPABASE_SERVICE_KEY = key;
  }
});

test("insert/upsert: empty rows return [] without a call", async () => {
  assert.deepEqual(await insert("any", []), []);
  assert.deepEqual(await upsert("any", []), []);
});

test("clientIdBySlug: returns null when unconfigured", async () => {
  const url = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  try {
    assert.equal(await clientIdBySlug("nope-" + "x"), null);
  } finally {
    if (url) process.env.SUPABASE_URL = url;
  }
});
