"use client";

/**
 * Theme + density controls. The pre-paint bootstrap in app/layout.tsx already
 * reads localStorage["smos-theme"] / ["smos-density"]; this is the UI that
 * writes them — until now the Console had no way to flip either.
 *
 * Every change dispatches "smos:theme-change" so useChartTheme re-resolves the
 * chart palette from the new computed styles (design-system/MASTER.md requires
 * charts to follow the theme rather than keep baked-in colours).
 */

import { useCallback, useEffect, useState } from "react";

type Theme = "light" | "dark" | "auto";
type Density = "compact" | "comfortable";

function announce() {
  window.dispatchEvent(new Event("smos:theme-change"));
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("auto");
  const [density, setDensity] = useState<Density>("compact");

  useEffect(() => {
    try {
      const t = localStorage.getItem("smos-theme");
      setTheme(t === "light" || t === "dark" ? t : "auto");
      setDensity(localStorage.getItem("smos-density") === "comfortable" ? "comfortable" : "compact");
    } catch {
      /* private mode / blocked storage — defaults stand. */
    }
  }, []);

  const applyTheme = useCallback((next: Theme) => {
    setTheme(next);
    const root = document.documentElement;
    if (next === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    try {
      if (next === "auto") localStorage.removeItem("smos-theme");
      else localStorage.setItem("smos-theme", next);
    } catch {
      /* ignore */
    }
    announce();
  }, []);

  const applyDensity = useCallback((next: Density) => {
    setDensity(next);
    document.documentElement.setAttribute("data-density", next);
    try {
      localStorage.setItem("smos-density", next);
    } catch {
      /* ignore */
    }
    announce();
  }, []);

  // One button cycling light → dark → auto keeps the topbar uncluttered; the
  // title and aria-label always name the CURRENT state plus what's next.
  const nextTheme: Theme = theme === "light" ? "dark" : theme === "dark" ? "auto" : "light";
  const icon = theme === "dark" ? "i-moon" : theme === "light" ? "i-sun" : "i-settings";
  const themeName = theme === "auto" ? "system" : theme;

  return (
    <>
      <button
        type="button"
        className="ds-btn ds-btn--ghost ds-btn--icon ds-btn--on-shell"
        onClick={() => applyTheme(nextTheme)}
        title={`Theme: ${themeName} — switch to ${nextTheme === "auto" ? "system" : nextTheme}`}
        aria-label={`Theme: ${themeName}. Switch to ${nextTheme === "auto" ? "system" : nextTheme}.`}
      >
        <svg aria-hidden="true">
          <use href={`/icons.svg#${icon}`} />
        </svg>
      </button>
      <button
        type="button"
        className="ds-btn ds-btn--ghost ds-btn--sm ds-btn--on-shell"
        onClick={() => applyDensity(density === "compact" ? "comfortable" : "compact")}
        title={`Density: ${density} — switch to ${density === "compact" ? "comfortable" : "compact"}`}
        aria-label={`Density: ${density}. Switch to ${density === "compact" ? "comfortable" : "compact"}.`}
      >
        {density === "compact" ? "Compact" : "Comfy"}
      </button>
    </>
  );
}
