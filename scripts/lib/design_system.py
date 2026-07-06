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


def report_head(title: str = "smOS Report", extra_head: str = "") -> str:
    """Full <head> with the design system inlined, plus any extra tags (fonts/Chart.js)."""
    return (
        "<head>\n"
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{_esc(title)}</title>\n"
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
) -> str:
    """The ONE canonical report hero — never fork it.

    title    : required headline
    subtitle : `·`-separated meta line
    eyebrow  : badge pill text (agency name / report type)
    headline : optional one-line summary under the title
    pills    : optional list of short snapshot strings
    aside    : optional pre-rendered HTML for the right executive column
               (e.g. a score ring + hero stat); build it with hero_aside().
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
    return (
        '<header class="ds-hero">\n'
        f'<div class="ds-hero__inner{has_aside}">\n'
        '<div class="ds-hero__main">\n'
        f"{eb}<h1>{_esc(title)}</h1>\n{sub}{hl}{pills_html}"
        "</div>\n"
        f"{aside_html}"
        "</div>\n"
        "</header>"
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
CHART_THEME = """
if (window.Chart) {
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#6e6e73';
  Chart.defaults.borderColor = '#e2e2e7';
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.elements.line.tension = 0.35;
  Chart.defaults.elements.point.radius = 3;
}
"""
