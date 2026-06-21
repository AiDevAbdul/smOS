#!/usr/bin/env node
/**
 * /inbox companion script (Phase 2.1/2.3) — Unified Social Inbox puller.
 *
 * Pulls FB+IG comments / DMs / mentions into one normalized, deduped queue with
 * reply-SLA tracking, and writes clients/<slug>/inbox.json. Replies are drafted,
 * never auto-sent (see SKILL.md / validateReply).
 *
 * Usage: node skills/inbox/inbox.js <slug> [--sla-minutes 60]
 *
 * Offline-safe: with SMOS_OFFLINE=1 or no token, it normalizes whatever is in an
 * existing inbox.json (or an empty queue) so the contract + SLA logic run without
 * network. Live pulls require a per-client page token.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { inboxItem as schema } from "../../schemas/index.js";
import { resolveToken } from "../../scripts/lib/tokens.js";
import { createGraph } from "../../scripts/lib/meta-graph.js";
import { upsert, clientIdBySlug, supabaseConfigured } from "../../scripts/lib/supabase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv({ silent: true });

const slug = process.argv[2];
if (!slug) { console.error("usage: inbox.js <slug> [--sla-minutes N]"); process.exit(2); }
const slaMinutes = Number((process.argv.find((a) => a.startsWith("--sla-minutes="))?.split("=")[1]) || 60);
const OFFLINE = process.env.SMOS_OFFLINE === "1";

const dir = resolve(ROOT, "clients", slug);
const profilePath = resolve(dir, "client_profile.json");
if (!existsSync(profilePath)) { console.error(`HALT: ${profilePath} not found — run /intake first.`); process.exit(3); }
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const pageId = profile?.accounts?.facebook_page_id;
const igId = profile?.accounts?.instagram_business_id;

const tok = resolveToken("page", slug, { profile });
const inboxPath = resolve(dir, "inbox.json");

async function pullLive(token) {
  const graph = createGraph(process.env.META_ACCESS_TOKEN);
  const raw = [];
  // DMs
  if (pageId) {
    try {
      const convos = await graph.get(`/${pageId}/conversations`, {
        access_token: token, platform: "messenger",
        fields: "id,snippet,unread_count,updated_time,participants{id,name}", limit: 25,
      });
      for (const c of convos.data || []) {
        raw.push({ platform: "facebook", type: "dm", external_id: c.id, conversation_id: c.id,
          text: c.snippet, received_at: c.updated_time, author: { name: c.participants?.data?.[0]?.name } });
      }
    } catch (e) { console.error("DM pull failed:", e.message); }
  }
  // Mentions
  if (igId) {
    try {
      const tags = await graph.get(`/${igId}/tags`, { access_token: token, fields: "id,caption,permalink,timestamp,username", limit: 25 });
      for (const t of tags.data || []) {
        raw.push({ platform: "instagram", type: "mention", external_id: t.id, text: t.caption,
          received_at: t.timestamp, object_ref: t.permalink, author: { name: t.username } });
      }
    } catch (e) { console.error("mention pull failed:", e.message); }
  }
  return raw;
}

(async () => {
  let rawItems = [];
  if (OFFLINE || !tok.token) {
    if (!tok.token && !OFFLINE) console.error(`note: no page token for ${slug} (${tok.tried?.join(", ")}) — normalizing existing inbox only.`);
    if (existsSync(inboxPath)) rawItems = JSON.parse(readFileSync(inboxPath, "utf8")).items || [];
  } else {
    rawItems = await pullLive(tok.token);
  }

  const now = Date.now();
  const normalized = schema.normalize({ client_slug: slug, items: rawItems });
  for (const it of normalized.items) {
    const received = it.received_at ? Date.parse(it.received_at) : now;
    if (!it.first_reply_due_at && Number.isFinite(received)) {
      it.first_reply_due_at = new Date(received + slaMinutes * 60_000).toISOString();
    }
    if (it.replied_at && Number.isFinite(received)) {
      it.reply_latency_seconds = Math.max(0, Math.round((Date.parse(it.replied_at) - received) / 1000));
    }
  }

  const v = schema.validate(normalized);
  if (!v.ok) console.error("inbox validation warnings:\n  - " + v.errors.join("\n  - "));

  writeFileSync(inboxPath, JSON.stringify(normalized, null, 2));

  const breaches = normalized.items.filter(
    (i) => i.state !== "replied" && i.state !== "closed" && i.first_reply_due_at && Date.parse(i.first_reply_due_at) < now
  ).length;

  if (supabaseConfigured() && normalized.items.length) {
    try {
      const client_id = await clientIdBySlug(slug);
      await upsert("inbox_items", normalized.items.map((i) => ({ ...i, client_id, slug })), "inbox_id");
    } catch (e) { console.error("supabase persist skipped:", e.message); }
  }

  console.log(`inbox: ${normalized.items.length} items · ${breaches} SLA breach(es) · token=${tok.source}${tok.global_fallback ? " (GLOBAL FALLBACK!)" : ""} → inbox.json`);
})();
