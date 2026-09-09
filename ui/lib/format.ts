// ui/lib/format.ts — locale-aware formatters shared by server and client
// components.
//
// Deliberately NOT in chart-theme.ts: that file is "use client" (it reads
// getComputedStyle), which turns every one of its exports into a client
// reference — calling one from a Server Component throws "Attempted to call
// fmtCurrency() from the server". These are pure functions with no browser
// dependency, so they belong in a module both sides can import.
//
// LOCALE is pinned rather than passed as `undefined`. With `undefined`,
// Intl resolves the Node process locale on the server and the browser locale
// on the client — which produced a real hydration mismatch here ("$19,800"
// server-side vs "US$19,800" in the browser). Server and client must format
// identically, so the locale is one explicit constant.

const LOCALE = "en-US";

export function fmtCurrency(n: number | null | undefined, currency = "USD"): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
  }).format(n);
}

export function fmtNumber(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(LOCALE, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function fmtPercent(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function fmtRatio(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}×`;
}

export function fmtDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric" }).format(d);
}

/**
 * Run cost. Kept separate from fmtCurrency because a single run costs cents:
 * fmtCurrency's 2-digit cap renders $0.0034 as "$0", which reads as free.
 */
export function fmtCost(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency: "USD" }).format(n);
}

/** Elapsed time from milliseconds — "840ms", "9.4s", "3m 12s", "1h 04m". */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m < 60) return `${m}m ${String(rem).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/**
 * Short relative age — "just now", "8m ago", "3h ago", "2d ago".
 *
 * Reads the clock, so it is only safe where the output is produced once:
 * a Server Component's render, or a client render after mount. Calling it in
 * the initial render of a Client Component makes the server HTML and the
 * hydration pass disagree whenever a minute ticks between them. For a
 * timestamp that hydrates, use fmtDateTime.
 */
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return String(iso);
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 45) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

const ISO_IN_TEXT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;

/**
 * Replace machine timestamps embedded in a human sentence with a short date.
 * `skills/smos-status/status.js` builds details like
 * "deal won 2026-08-09T07:32:32.350Z — no /contract artifact on file", and the
 * full ISO string swamps the sentence it sits in.
 */
export function prettifyDetail(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.replace(ISO_IN_TEXT, (m) => {
    const d = new Date(m);
    return Number.isNaN(d.getTime())
      ? m
      : new Intl.DateTimeFormat(LOCALE, { year: "numeric", month: "short", day: "numeric" }).format(d);
  });
}

/** Direction of a delta, as a class suffix. Never color alone — the CSS pairs
 *  each with an arrow glyph. */
export function deltaDir(n: number | null | undefined): "up" | "down" | "flat" {
  if (n == null || !Number.isFinite(n) || Math.abs(n) < 0.05) return "flat";
  return n > 0 ? "up" : "down";
}

/** Absolute timestamp, pinned locale — see the LOCALE note above. */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALE, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
