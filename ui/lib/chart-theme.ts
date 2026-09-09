"use client";

/**
 * Chart colors are resolved from the live --ds-* custom properties at draw
 * time, never baked in — the rule design-system/MASTER.md sets for every
 * chart in the system. A theme flip therefore repaints the plots instead of
 * leaving them stale, and adding a hue to the palette needs no TS change.
 *
 * Re-resolution is triggered by:
 *   - the "smos:theme-change" event (dispatched by ThemeToggle)
 *   - the OS color-scheme media query, for the default "auto" theme
 */

import { useEffect, useState } from "react";

export interface ChartTheme {
  /** The 7-hue categorical series palette, in assignment order. */
  series: string[];
  grid: string;
  axis: string;
  ink: string;
  muted: string;
  faint: string;
  surface: string;
  good: string;
  warn: string;
  bad: string;
  font: string;
  fontMono: string;
  /** Bumped on every re-resolve so charts can be keyed off it. */
  rev: number;
}

const SERIES_TOKENS = [
  "--ds-chart-1",
  "--ds-chart-2",
  "--ds-chart-3",
  "--ds-chart-4",
  "--ds-chart-5",
  "--ds-chart-6",
  "--ds-chart-7",
];

/** SSR-safe fallback. Values match the light :root block; the first client
 *  paint replaces them with whatever the live theme actually resolves to. */
const FALLBACK: ChartTheme = {
  series: ["#1d5dbf", "#1d8a4e", "#b57a0a", "#c0392f", "#22808d", "#6d4fa3", "#8695a5"],
  grid: "#dde4ea",
  axis: "#5a6b7c",
  ink: "#17222e",
  muted: "#5a6b7c",
  faint: "#8695a5",
  surface: "#ffffff",
  good: "#1d8a4e",
  warn: "#b57a0a",
  bad: "#c0392f",
  font: "Barlow, sans-serif",
  fontMono: "IBM Plex Mono, monospace",
  rev: 0,
};

function read(styles: CSSStyleDeclaration, token: string, fallback: string): string {
  const v = styles.getPropertyValue(token).trim();
  return v || fallback;
}

function resolve(rev: number): ChartTheme {
  if (typeof window === "undefined") return FALLBACK;
  const s = getComputedStyle(document.documentElement);
  return {
    series: SERIES_TOKENS.map((t, i) => read(s, t, FALLBACK.series[i])),
    grid: read(s, "--ds-chart-grid", FALLBACK.grid),
    axis: read(s, "--ds-chart-axis", FALLBACK.axis),
    ink: read(s, "--ds-ink", FALLBACK.ink),
    muted: read(s, "--ds-muted", FALLBACK.muted),
    faint: read(s, "--ds-faint", FALLBACK.faint),
    surface: read(s, "--ds-surface", FALLBACK.surface),
    good: read(s, "--ds-green", FALLBACK.good),
    warn: read(s, "--ds-amber", FALLBACK.warn),
    bad: read(s, "--ds-red", FALLBACK.bad),
    font: read(s, "--ds-font", FALLBACK.font),
    fontMono: read(s, "--ds-font-mono", FALLBACK.fontMono),
    rev,
  };
}

export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(FALLBACK);

  useEffect(() => {
    let rev = 0;
    const refresh = () => setTheme(resolve(++rev));
    refresh();

    window.addEventListener("smos:theme-change", refresh);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", refresh);
    return () => {
      window.removeEventListener("smos:theme-change", refresh);
      mq.removeEventListener("change", refresh);
    };
  }, []);

  return theme;
}

/** True when the viewer asked for less motion — charts skip entrance animation. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
