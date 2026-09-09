// scripts/lib/ar.js — accounts receivable: aging, and the dunning schedule (Group D2).
//
// Everything here is PURE. Aging and dunning decisions are pure functions of
// (invoice, today), which matters for two reasons:
//   - they are exhaustively testable without a clock, a filesystem, or Stripe;
//   - "overdue" is never STORED. A stored overdue flag is stale the moment it is
//     written and has to be un-written when the client pays. Deriving it means the
//     ledger and the calendar can never disagree.
//
// Money is in MAJOR units throughout, matching schemas/invoice.js.

import { invoice as invoiceSchema } from "../../schemas/index.js";

// Standard AR aging buckets. `current` means issued and not yet due.
export const BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"];

/** Whole days between two ISO timestamps, floor'd. Negative = a is before b. */
export function daysBetween(a, b) {
  const ms = new Date(a).getTime() - new Date(b).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86400000);
}

/**
 * Is this invoice money we are still waiting on? Drafts are not: they haven't been
 * given to the client, so they are not receivable. Paid and void are settled.
 */
export function isOutstanding(inv) {
  const i = invoiceSchema.normalize(inv);
  return i.status === "sent";
}

/**
 * Days past due — positive when late, negative when not yet due, null when the
 * invoice has no due date or isn't outstanding.
 */
export function daysOverdue(inv, now = new Date().toISOString()) {
  const i = invoiceSchema.normalize(inv);
  if (!isOutstanding(i) || !i.due_date) return null;
  return daysBetween(now, i.due_date);
}

/** The aging bucket for one invoice, or null if it isn't outstanding. */
export function agingBucket(inv, now = new Date().toISOString()) {
  const d = daysOverdue(inv, now);
  if (d === null) return null;
  if (d <= 0) return "current";
  if (d <= 30) return "1-30";
  if (d <= 60) return "31-60";
  if (d <= 90) return "61-90";
  return "90+";
}

/**
 * AR aging summary across a set of invoices: total outstanding, per-bucket totals
 * and counts, and the individual overdue invoices worst-first — the shape a
 * collections conversation actually needs.
 */
export function agingReport(invoices, now = new Date().toISOString()) {
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b, { total: 0, count: 0 }]));
  const items = [];
  for (const raw of invoices || []) {
    const inv = invoiceSchema.normalize(raw);
    const bucket = agingBucket(inv, now);
    if (!bucket) continue;
    const days = daysOverdue(inv, now);
    buckets[bucket].total = Math.round((buckets[bucket].total + inv.total) * 100) / 100;
    buckets[bucket].count += 1;
    items.push({
      id: inv.id, slug: inv.slug, company: inv.company, period: inv.period,
      currency: inv.currency, total: inv.total, due_date: inv.due_date,
      days_overdue: days, bucket,
      reminders_sent: inv.reminders.length,
      hosted_url: inv.stripe?.hosted_url || null,
    });
  }
  items.sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0));
  const outstanding = Math.round(items.reduce((s, i) => s + i.total, 0) * 100) / 100;
  const overdue = items.filter((i) => i.bucket !== "current");

  // Per-currency breakdown. A single client's ledger is one currency in practice,
  // so the flat `outstanding` above is right for `/billing <slug> aging`. But the
  // agency-wide roll-up (D5) sums many clients' ledgers, and this book holds USD,
  // EUR and PKR — a blended total there is arithmetic on incommensurable units.
  // Callers spanning clients MUST read `by_currency`, not `outstanding`.
  const byCurrency = {};
  for (const i of items) {
    const c = i.currency || "USD";
    byCurrency[c] = byCurrency[c] || { outstanding: 0, overdue_total: 0, overdue_count: 0, count: 0 };
    byCurrency[c].outstanding = Math.round((byCurrency[c].outstanding + i.total) * 100) / 100;
    byCurrency[c].count += 1;
    if (i.bucket !== "current") {
      byCurrency[c].overdue_total = Math.round((byCurrency[c].overdue_total + i.total) * 100) / 100;
      byCurrency[c].overdue_count += 1;
    }
  }
  const currencies = Object.keys(byCurrency);

  return {
    as_of: now,
    outstanding,
    overdue_total: Math.round(overdue.reduce((s, i) => s + i.total, 0) * 100) / 100,
    overdue_count: overdue.length,
    buckets,
    by_currency: byCurrency,
    // True when the flat totals above blend currencies and must not be quoted.
    mixed_currency: currencies.length > 1,
    currencies,
    items,
  };
}

// ─────────────────────────────── dunning ───────────────────────────────
//
// A fixed escalation ladder rather than ad-hoc chasing. Levels are cumulative:
// an invoice 45 days late is at level 3, and levels 1 and 2 are considered already
// due (the schedule reports the HIGHEST level reached, and `dunningPlan` refuses to
// re-send a level already recorded on the invoice).
export const DUNNING_SCHEDULE = [
  { level: 1, day: 1, tone: "reminder", summary: "Friendly reminder — invoice is past due." },
  { level: 2, day: 7, tone: "reminder", summary: "Second reminder — one week past due." },
  { level: 3, day: 30, tone: "firm", summary: "Firm notice — 30 days past due; request payment date." },
  { level: 4, day: 60, tone: "escalation", summary: "Escalation — 60 days past due; flag service pause for human decision." },
];

/** The highest dunning level an invoice's lateness has reached (0 = none due). */
export function dunningLevel(inv, now = new Date().toISOString()) {
  const d = daysOverdue(inv, now);
  if (d === null || d < 1) return 0;
  let level = 0;
  for (const step of DUNNING_SCHEDULE) if (d >= step.day) level = step.level;
  return level;
}

/**
 * What to do about one invoice right now.
 *
 * Returns { id, action, level, ... } where action is:
 *   none      — not outstanding, or not yet due
 *   wait      — overdue but the level already reached has been sent
 *   send      — a new dunning level is due
 *   escalate  — level 4: needs a HUMAN decision (service pause), never automatic
 *
 * The escalate/send split is the point: reminders are safe to generate, but
 * pausing a paying client's service is a business decision, not a cron's.
 */
export function dunningPlan(inv, now = new Date().toISOString()) {
  const i = invoiceSchema.normalize(inv);
  const level = dunningLevel(i, now);
  const days = daysOverdue(i, now);
  if (level === 0) {
    return { id: i.id, slug: i.slug, action: "none", level: 0, days_overdue: days };
  }
  const alreadySent = Math.max(0, ...i.reminders.map((r) => r.level), 0);
  const step = DUNNING_SCHEDULE.find((s) => s.level === level);
  if (alreadySent >= level) {
    return {
      id: i.id, slug: i.slug, action: "wait", level, days_overdue: days,
      reason: `Level ${alreadySent} reminder already sent; next escalation at day ${DUNNING_SCHEDULE.find((s) => s.level === level + 1)?.day ?? "—"}.`,
    };
  }
  return {
    id: i.id, slug: i.slug, company: i.company, action: level >= 4 ? "escalate" : "send",
    level, days_overdue: days, tone: step.tone, summary: step.summary,
    currency: i.currency, total: i.total, due_date: i.due_date,
    hosted_url: i.stripe?.hosted_url || null,
    ...(level >= 4 ? { requires_human: "Service pause is a business decision — smOS will not pause delivery automatically." } : {}),
  };
}

/** Dunning plans for a whole ledger, most overdue first, actionable ones only. */
export function dunningQueue(invoices, now = new Date().toISOString()) {
  return (invoices || [])
    .map((i) => dunningPlan(i, now))
    .filter((p) => p.action === "send" || p.action === "escalate")
    .sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0));
}
