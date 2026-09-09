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
