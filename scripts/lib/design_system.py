"""smOS design system loader (Python renderers).

The one Apple ("Cupertino") visual language for every client report. Reads
design-system/smos-design-system.css at render time — a SINGLE source of truth
shared with the Node loader (scripts/lib/design_system.js). Edit the .css once;
the pre-audit and competitor renderers both inherit it.

    from design_system import design_system_css, report_head, hero_header, CHART_THEME
"""

from functools import lru_cache
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_CSS_PATH = _ROOT / "design-system" / "smos-design-system.css"


@lru_cache(maxsize=1)
def design_system_css() -> str:
    """Canonical design-system CSS as a string."""
    return _CSS_PATH.read_text(encoding="utf-8")


def _esc(s: str) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


# Sets documentElement.dataset.theme from localStorage (fallback: OS preference)
# BEFORE first paint — avoids flash-of-wrong-theme. Self-contained, no requests.
THEME_BOOTSTRAP_SCRIPT = (
    '<script>(function(){try{var t=localStorage.getItem("smos-theme");'
    'if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);'
    "}catch(e){}})();</script>"
)

# Toggles data-theme and persists to localStorage; also re-applies CHART_THEME's
# color pull so any live Chart.js instances re-theme without a reload.
THEME_TOGGLE_SCRIPT = (
    "<script>(function(){function apply(){"
    'var b=document.querySelector(".ds-theme-toggle");if(!b)return;'
    'b.addEventListener("click",function(){'
    "var root=document.documentElement;"
    'var current=root.getAttribute("data-theme")||(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");'
    'var next=current==="dark"?"light":"dark";'
    'root.setAttribute("data-theme",next);'
    'try{localStorage.setItem("smos-theme",next);}catch(e){}'
    'b.setAttribute("aria-pressed",String(next==="dark"));'
    "});}"
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",apply);else apply();'
    "})();</script>"
)


def theme_toggle_button() -> str:
    """Sun/moon icon toggle button — drop into the hero's top-right corner."""
    return (
        '<button type="button" class="ds-theme-toggle" aria-label="Toggle dark mode" aria-pressed="false">\n'
        '<svg class="ds-theme-toggle__sun" viewBox="0 0 24 24" aria-hidden="true">'
        '<path d="M12 4.5a1 1 0 0 1-1-1V2a1 1 0 1 1 2 0v1.5a1 1 0 0 1-1 1Zm0 15a1 1 0 0 1 1 1V22a1 1 0 1 1-2 0v-1.5a1 1 0 0 1 1-1ZM4.5 12a1 1 0 0 1-1 1H2a1 1 0 1 1 0-2h1.5a1 1 0 0 1 1 1Zm18 0a1 1 0 0 1-1 1H20a1 1 0 1 1 0-2h1.5a1 1 0 0 1 1 1ZM6.3 6.3a1 1 0 0 1-1.4 0L3.8 5.2a1 1 0 1 1 1.4-1.4L6.3 4.9a1 1 0 0 1 0 1.4Zm12.9 12.9a1 1 0 0 1-1.4 0l-1.1-1.1a1 1 0 1 1 1.4-1.4l1.1 1.1a1 1 0 0 1 0 1.4ZM6.3 17.7l-1.1 1.1a1 1 0 1 1-1.4-1.4l1.1-1.1a1 1 0 1 1 1.4 1.4ZM19.2 6.3a1 1 0 0 1-1.4 0 1 1 0 0 1 0-1.4l1.1-1.1a1 1 0 1 1 1.4 1.4l-1.1 1.1ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/></svg>\n'
        '<svg class="ds-theme-toggle__moon" viewBox="0 0 24 24" aria-hidden="true">'
        '<path d="M20.7 14.6a8.6 8.6 0 0 1-10.3-10A8.6 8.6 0 1 0 20.7 14.6Z"/></svg>\n'
        "</button>"
    )


def report_head(title: str = "smOS Report", extra_head: str = "") -> str:
    """Full <head> with the design system inlined, plus any extra tags (fonts/Chart.js).
    Includes the theme bootstrap script (pre-paint) so there's no flash-of-wrong-theme."""
    return (
        "<head>\n"
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{_esc(title)}</title>\n"
        f"{THEME_BOOTSTRAP_SCRIPT}\n"
        f"{extra_head}\n"
        f"<style>{design_system_css()}</style>\n"
        "</head>"
    )


def hero_header(
    title: str,
    subtitle: str = "",
    eyebrow: str = "",
    headline: str = "",
    pills=None,
    aside: str = "",
    subtitle_html: str = "",
    theme_toggle: bool = True,
) -> str:
    """The ONE canonical report hero — never fork it.

    title    : required headline
    subtitle : `·`-separated meta line
    eyebrow  : badge pill text (agency name / report type)
    headline : optional one-line summary under the title
    pills    : optional list of short snapshot strings
    aside    : optional pre-rendered HTML for the right executive column
               (e.g. a score ring + hero stat); build it with hero_aside().
    theme_toggle : set False to suppress the light/dark toggle button.
    """
    eb = f'<div class="ds-hero__badge">{_esc(eyebrow)}</div>\n' if eyebrow else ""
    meta_inner = subtitle_html or (_esc(subtitle) if subtitle else "")
    sub = f'<div class="ds-meta">{meta_inner}</div>\n' if meta_inner else ""
    hl = f'<div class="ds-hero__headline">{_esc(headline)}</div>\n' if headline else ""
    pills_html = ""
    if pills:
        items = "".join(f'<span class="ds-hero__pill">{_esc(p)}</span>' for p in pills)
        pills_html = f'<div class="ds-hero__pills">{items}</div>\n'
    has_aside = " has-aside" if aside else ""
    aside_html = f'<div class="ds-hero__aside">{aside}</div>\n' if aside else ""
    toggle_html = theme_toggle_button() + "\n" if theme_toggle else ""
    toggle_script = f"\n{THEME_TOGGLE_SCRIPT}" if theme_toggle else ""
    return (
        '<header class="ds-hero">\n'
        f"{toggle_html}"
        f'<div class="ds-hero__inner{has_aside}">\n'
        '<div class="ds-hero__main">\n'
        f"{eb}<h1>{_esc(title)}</h1>\n{sub}{hl}{pills_html}"
        "</div>\n"
        f"{aside_html}"
        "</div>\n"
        "</header>"
        f"{toggle_script}"
    )


def hero_aside(
    body: str = "",
    stat_label: str = "",
    stat_value: str = "",
    stat_caption: str = "",
) -> str:
    """Build the optional right-hand hero column: an HTML body (e.g. a score
    ring) plus an optional single hero stat (label / value / caption)."""
    stat = ""
    if stat_value:
        lbl = f'<div class="ds-hero__stat-label">{_esc(stat_label)}</div>\n' if stat_label else ""
        cap = f'<div class="ds-hero__stat-caption">{_esc(stat_caption)}</div>\n' if stat_caption else ""
        stat = (
            '<div class="ds-hero__stat">\n'
            f'{lbl}<div class="ds-hero__stat-value">{_esc(stat_value)}</div>\n{cap}'
            "</div>"
        )
    return f"{body}{stat}"


# Apple system-color palette for Chart.js datasets (use in order).
CHART_PALETTE = [
    "#0071e3",  # blue
    "#34c759",  # green
    "#ff9f0a",  # orange
    "#af52de",  # purple
    "#5ac8fa",  # teal
    "#ff375f",  # pink
    "#5e5ce6",  # indigo
]

# Shared Chart.js global theming (fonts, grid, ticks) to match the design system.
# Reads --ds-muted / --ds-line off :root at call time so grid/tick colors follow
# the active theme (auto or manual); re-applied on toggle click + charts redrawn.
CHART_THEME = """
if (window.Chart) {
  var dsColor = function(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  };
  var applyChartTheme = function() {
    Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = dsColor('--ds-muted', '#6e6e73');
    Chart.defaults.borderColor = dsColor('--ds-line', '#e2e2e7');
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.elements.line.tension = 0.35;
    Chart.defaults.elements.point.radius = 3;
  };
  applyChartTheme();
  document.addEventListener('DOMContentLoaded', function() {
    var toggle = document.querySelector('.ds-theme-toggle');
    if (toggle) toggle.addEventListener('click', function() {
      applyChartTheme();
      Object.values(Chart.instances || {}).forEach(function(c) { c.update(); });
    });
  });
}
"""
