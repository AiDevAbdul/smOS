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


def hero_header(title: str, subtitle: str = "", eyebrow: str = "") -> str:
    """Standard blue-gradient hero."""
    eb = f'<div class="ds-eyebrow">{_esc(eyebrow)}</div>\n' if eyebrow else ""
    sub = f'<div class="ds-meta">{_esc(subtitle)}</div>\n' if subtitle else ""
    return (
        '<header class="ds-hero">\n'
        f"{eb}<h1>{_esc(title)}</h1>\n{sub}"
        "</header>"
    )


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
