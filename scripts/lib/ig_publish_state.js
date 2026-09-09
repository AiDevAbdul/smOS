/**
 * Idempotency + container bookkeeping for the Instagram publish flow (E6).
 *
 * The problem this fixes: IG publishing is multi-step and NOT idempotent.
 *   POST /{ig}/media          → container id
 *   GET  /{container}         → poll until FINISHED
 *   POST /{ig}/media_publish  → media id
 * Any failure or timeout after step 1 leaves a real container on Meta's side.
 * Retrying the tool call (an MCP retry, an agent re-run, a scheduler re-fire)
 * created a SECOND container and could publish the same post twice to a live
 * client account — and for carousels, one failed child left 2–9 orphaned
 * containers with nothing recording that they existed.
 *
 * Meta offers no idempotency key on these endpoints, so we keep the ledger:
 * a deterministic key over (ig account, media type, media urls, caption) maps to
 * the container(s) already created and the media id already published.
 *   - A repeat of an already-PUBLISHED key returns the original media id and
 *     performs no writes (`replayed: true`) — the double-post is impossible.
 *   - A repeat of an IN-FLIGHT key reuses the existing container instead of
 *     making another one, so the retry finishes the original publish.
 *   - A failed flow marks its containers `orphaned` with the reason, which is
 *     what makes them auditable. IG containers cannot be DELETEd via the API;
 *     they expire on Meta's side after 24h. "Cleanup" here therefore means
 *     recording them and pruning expired ledger entries, not pretending to
 *     delete something the API won't delete.
 *
 * Storage is a single JSON file under the data root (paths.globalState), so
 * SMOS_DATA_ROOT isolates it in tests exactly like every other artifact.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { globalState } from "./paths.js";

/** Containers expire on Meta's side after 24h. */
export const CONTAINER_TTL_MS = 24 * 60 * 60 * 1000;
/** Keep published records long enough that a re-fire days later still dedupes. */
export const PUBLISHED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const LEDGER_FILE = "ig_publish.json";

export function ledgerPath() {
  return globalState(LEDGER_FILE);
}

/**
 * Deterministic key for one intended post. Same account + same media + same
 * caption = same key, so a retry of the identical call is recognized. A caller
 * that genuinely wants to post the same asset twice passes an explicit `nonce`.
 */
export function igIdempotencyKey({ ig_user_id, media_type, caption = "", urls = [], nonce = "" } = {}) {
  const payload = JSON.stringify({
    ig: String(ig_user_id || ""),
    type: String(media_type || ""),
    caption: String(caption || ""),
    urls: [...urls].filter(Boolean).map(String), // order is meaningful for carousels
    nonce: String(nonce || ""),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

export function loadLedger() {
  const p = ledgerPath();
  if (!existsSync(p)) return { version: 1, entries: {} };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return raw && typeof raw === "object" && raw.entries ? raw : { version: 1, entries: {} };
  } catch {
    // A corrupt ledger must not block publishing, but it must not silently
    // enable a double-post either — the caller sees an empty ledger and the
    // worst case is one duplicate, which is the pre-existing behavior.
    return { version: 1, entries: {} };
  }
}

export function saveLedger(ledger) {
  const p = ledgerPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(ledger, null, 2));
  return p;
}

function update(key, fn) {
  const ledger = loadLedger();
  const now = new Date().toISOString();
  const entry = ledger.entries[key] || { key, created_at: now, containers: [], status: "new" };
  const next = fn({ ...entry }) || entry;
  next.updated_at = now;
  ledger.entries[key] = next;
  saveLedger(ledger);
  return next;
}

export function getEntry(key) {
  return loadLedger().entries[key] || null;
}

/**
 * Claim a publish. Returns what the caller should do:
 *   { action: "replay",  media_id }               → already published, do nothing
 *   { action: "resume",  container_id }           → finish the existing container
 *   { action: "create",  entry }                  → fresh publish
 */
export function beginPublish(key, meta = {}) {
  const existing = getEntry(key);
  if (existing?.status === "published" && existing.media_id) {
    const age = Date.now() - Date.parse(existing.published_at || existing.updated_at || 0);
    if (Number.isFinite(age) && age < PUBLISHED_TTL_MS) {
      return { action: "replay", media_id: existing.media_id, container_id: existing.container_id ?? null, entry: existing };
    }
  }
  if (existing?.status === "in_flight" && existing.container_id) {
    const age = Date.now() - Date.parse(existing.container_started_at || existing.updated_at || 0);
    if (Number.isFinite(age) && age < CONTAINER_TTL_MS) {
      return { action: "resume", container_id: existing.container_id, entry: existing };
    }
    // The container has expired on Meta's side — record it and start over.
    markOrphaned(key, "container expired before publish");
  }
  const entry = update(key, (e) => ({ ...e, status: "claimed", meta, containers: e.containers || [] }));
  return { action: "create", entry };
}

export function recordContainer(key, containerId, { child = false } = {}) {
  return update(key, (e) => {
    const containers = e.containers || [];
    if (!containers.some((c) => c.id === containerId)) {
      containers.push({ id: containerId, child, created_at: new Date().toISOString(), status: "created" });
    }
    return child
      ? { ...e, containers, status: "in_flight" }
      : { ...e, containers, status: "in_flight", container_id: containerId, container_started_at: new Date().toISOString() };
  });
}

export function recordPublished(key, mediaId) {
  return update(key, (e) => ({
    ...e,
    status: "published",
    media_id: mediaId,
    published_at: new Date().toISOString(),
    containers: (e.containers || []).map((c) => ({ ...c, status: "consumed" })),
  }));
}

/**
 * Mark a flow failed. Containers created but never published are `orphaned` —
 * they cannot be deleted through the Graph API, so this is the record that they
 * exist and will expire; `pruneLedger` drops them once they have.
 */
export function markOrphaned(key, reason) {
  return update(key, (e) => ({
    ...e,
    status: "failed",
    failure_reason: String(reason || "unknown").slice(0, 500),
    containers: (e.containers || []).map((c) =>
      c.status === "consumed" ? c : { ...c, status: "orphaned" }
    ),
  }));
}

/** Every container recorded as created-but-never-published, newest first. */
export function listOrphans() {
  const { entries } = loadLedger();
  const out = [];
  for (const e of Object.values(entries)) {
    for (const c of e.containers || []) {
      if (c.status === "orphaned") {
        out.push({ key: e.key, container_id: c.id, child: !!c.child, created_at: c.created_at, reason: e.failure_reason || null });
      }
    }
  }
  return out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

/**
 * Drop entries Meta no longer has state for: failed/expired flows past the
 * 24h container TTL, and published records past the dedupe window.
 * @returns {{removed: number, kept: number}}
 */
export function pruneLedger(now = Date.now()) {
  const ledger = loadLedger();
  let removed = 0;
  for (const [key, e] of Object.entries(ledger.entries)) {
    const stamp = Date.parse(e.published_at || e.updated_at || e.created_at || 0);
    if (!Number.isFinite(stamp)) continue;
    const ttl = e.status === "published" ? PUBLISHED_TTL_MS : CONTAINER_TTL_MS;
    if (now - stamp > ttl) {
      delete ledger.entries[key];
      removed++;
    }
  }
  if (removed) saveLedger(ledger);
  return { removed, kept: Object.keys(ledger.entries).length };
}
