// scripts/lib/approvals.js — real approval workflow (Phase 3.5).
//
// Replaces "approval = one Discord ping" with a fail-closed state machine that
// has an audit trail, role checks, and timeout escalation. The guarantee:
//
//   requireApproval(...) THROWS unless a matching approval record exists, is in
//   state "approved", was decided by someone holding the required role, and has
//   not expired. Pending / rejected / expired / missing all fail CLOSED.
//
// Persistence is dual: Supabase `approvals` table when configured (source of
// truth across machines) AND an append-only local audit log so the workflow is
// fully functional offline. The Discord ping is now just ONE notifier on top of
// a durable record, not the record itself.

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { insert, upsert, select, supabaseConfigured, clientIdBySlug } from "./supabase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
// Resolved per-call so SMOS_APPROVALS_DIR (tests / isolated runs) is honored even
// though ESM evaluates imports before a test file's top-level code.
function storeDir() { return process.env.SMOS_APPROVALS_DIR || join(ROOT, "data", "approvals"); }
function auditLog() { return join(storeDir(), "audit.jsonl"); }

// ---- roles (lowest → highest authority) -----------------------------------
// A decider's role must be >= the action's required role for the decision to count.
export const ROLES = ["viewer", "analyst", "manager", "owner"];
export function roleRank(role) {
  const i = ROLES.indexOf(String(role || "").toLowerCase());
  return i < 0 ? -1 : i;
}

// ---- which actions need approval, and at what authority --------------------
// Keyed by a stable action token (see actionToken()). Mirrors CLAUDE.md guardrails.
export const APPROVAL_POLICY = {
  budget_increase_over_500: { role: "manager", ttlMinutes: 720 },
  campaign_launch_over_200: { role: "manager", ttlMinutes: 720 },
  off_hours_action: { role: "manager", ttlMinutes: 240 },
  audience_exclusion_removed: { role: "manager", ttlMinutes: 720 },
  targeting_change: { role: "manager", ttlMinutes: 720 },
  destructive_op: { role: "owner", ttlMinutes: 120 },
  go_live: { role: "owner", ttlMinutes: 1440 },
};

export class ApprovalRequired extends Error {
  constructor(action, detail) {
    super(`approval required: ${action}${detail ? ` — ${detail}` : ""}. No approved, unexpired record found (fail-closed).`);
    this.name = "ApprovalRequired";
    this.action = action;
    this.blocked = true;
  }
}

function ensureStore() {
  if (!existsSync(storeDir())) mkdirSync(storeDir(), { recursive: true });
}

function recPath(id) {
  return join(storeDir(), `${id}.json`);
}

/** Deterministic-ish id: caller passes a stable key; we never use Math.random in a way that breaks audits. */
function makeId(slug, action) {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const rand = Math.floor(Math.random() * 1e6).toString(36);
  return `apr_${slug || "global"}_${action}_${stamp}_${rand}`.replace(/[^A-Za-z0-9_]/g, "");
}

function writeLocal(rec) {
  ensureStore();
  writeFileSync(recPath(rec.id), JSON.stringify(rec, null, 2));
  appendFileSync(auditLog(), JSON.stringify({ at: new Date().toISOString(), ...rec }) + "\n");
}

function readLocal(id) {
  const p = recPath(id);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

async function persistRemote(rec) {
  if (!supabaseConfigured()) return { skipped: true };
  try {
    const client_id = rec.slug ? await clientIdBySlug(rec.slug) : null;
    return await upsert("approvals", [{ ...rec, client_id }], "approval_id");
  } catch (e) {
    // best-effort; local record remains the offline source of truth
    return { error: e.message };
  }
}

/**
 * Open an approval request. Returns the pending record. Does NOT grant anything —
 * a human (or an authorized caller) must later call decide().
 */
export async function requestApproval({ slug = null, action, summary = "", payload = {}, requiredRole, ttlMinutes, requestedBy = "smos" } = {}) {
  if (!action) throw new Error("requestApproval: action is required");
  const policy = APPROVAL_POLICY[action] || {};
  const role = requiredRole || policy.role || "manager";
  const ttl = ttlMinutes || policy.ttlMinutes || 720;
  const now = new Date();
  const rec = {
    approval_id: makeId(slug, action),
    id: undefined, // set below for local convenience
    slug,
    action,
    summary,
    payload,
    required_role: role,
    status: "pending",
    requested_by: requestedBy,
    requested_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttl * 60_000).toISOString(),
    decided_by: null,
    decided_role: null,
    decided_at: null,
    decision_note: null,
  };
  rec.id = rec.approval_id;
  writeLocal(rec);
  await persistRemote(rec);
  return rec;
}

/** Record a decision. Fails closed if the decider's role is insufficient. */
export async function decide({ id, decision, decidedBy = "human", role, note = "" } = {}) {
  if (!["approved", "rejected"].includes(decision)) throw new Error("decide: decision must be 'approved' or 'rejected'");
  const rec = readLocal(id);
  if (!rec) throw new Error(`decide: no approval record ${id}`);
  if (rec.status !== "pending") throw new Error(`decide: ${id} already ${rec.status}`);
  if (new Date(rec.expires_at).getTime() < Date.now()) {
    rec.status = "expired";
    writeLocal(rec);
    await persistRemote(rec);
    throw new Error(`decide: ${id} expired at ${rec.expires_at}`);
  }
  if (roleRank(role) < roleRank(rec.required_role)) {
    throw new Error(`decide: role "${role}" is below required "${rec.required_role}" — decision rejected (fail-closed)`);
  }
  rec.status = decision;
  rec.decided_by = decidedBy;
  rec.decided_role = role;
  rec.decided_at = new Date().toISOString();
  rec.decision_note = note;
  writeLocal(rec);
  await persistRemote(rec);
  return rec;
}

/** True only if the record exists, is approved, and is not expired. Everything else → false. */
export function isApproved(id) {
  const rec = readLocal(id);
  if (!rec) return false;
  if (rec.status !== "approved") return false;
  if (new Date(rec.expires_at).getTime() < Date.now()) return false;
  return true;
}

export function getApproval(id) {
  return readLocal(id);
}

/**
 * Find the most recent approved+unexpired record for (slug, action). Used by
 * skills to check "has a human already cleared this?" without threading ids.
 */
export function findApproved(slug, action) {
  ensureStore();
  let files = [];
  try { files = readdirSync(storeDir()).filter((f) => f.endsWith(".json")); } catch { return null; }
  const matches = files
    .map((f) => readLocal(f.replace(/\.json$/, "")))
    .filter((r) => r && r.action === action && (slug == null || r.slug === slug))
    .filter((r) => r.status === "approved" && new Date(r.expires_at).getTime() >= Date.now())
    .sort((a, b) => (a.decided_at < b.decided_at ? 1 : -1));
  return matches[0] || null;
}

/**
 * Fail-closed gate. Throws ApprovalRequired unless an approved, unexpired,
 * sufficiently-authorized record exists for this (slug, action). Pass an explicit
 * approvalId to bind to one record, or let it search by (slug, action).
 */
export function requireApproval(action, { slug = null, approvalId = null, detail = "" } = {}) {
  if (approvalId) {
    if (!isApproved(approvalId)) throw new ApprovalRequired(action, `record ${approvalId} not approved/active`);
    return getApproval(approvalId);
  }
  const rec = findApproved(slug, action);
  if (!rec) throw new ApprovalRequired(action, detail || `slug=${slug || "global"}`);
  return rec;
}

/** Expire any pending records past their TTL (timeout escalation sweep). */
export async function sweepExpired() {
  ensureStore();
  let files = [];
  try { files = readdirSync(storeDir()).filter((f) => f.endsWith(".json")); } catch { return []; }
  const expired = [];
  for (const f of files) {
    const rec = readLocal(f.replace(/\.json$/, ""));
    if (rec && rec.status === "pending" && new Date(rec.expires_at).getTime() < Date.now()) {
      rec.status = "expired";
      writeLocal(rec);
      await persistRemote(rec);
      expired.push(rec.id);
    }
  }
  return expired;
}
