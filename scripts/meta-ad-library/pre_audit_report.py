#!/usr/bin/env python3
"""Generate the standardized pre-audit sales report (HTML).

Inputs (paths flag-driven, all required except --niche-html):
  --page-audit        prospects/{slug}/page_audit.json
  --competitors       prospects/{slug}/competitor_summary.json
  --synthesis         prospects/{slug}/synthesis.json
  --business          Business display name
  --slug              prospect slug
  --output            output HTML path
  --niche-html        optional embedded link to market_<ts>.html

Design: smOS Apple/Cupertino design system (design-system/smos-design-system.css)
— SF Pro system type, #f5f5f7 canvas, iOS semantic colors. Canvas radial gauge,
sticky left-rail nav, 9 sections. Emotional arc: recognition → clarity → relief.
"""

import argparse
import html as ihtml
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Shared smOS design system (Apple/Cupertino) — single source of truth.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from design_system import design_system_css, THEME_BOOTSTRAP_SCRIPT  # noqa: E402

import benchmarks as _bench  # noqa: E402 — sourced, dated industry benchmarks

# White-label-ready agency identity — overridable so the report isn't hardwired
# to one agency's email/byline. Defaults preserve today's behavior.
AGENCY_NAME  = os.environ.get("SMOS_AGENCY_NAME", "Abdul")
AGENCY_EMAIL = os.environ.get("SMOS_AGENCY_EMAIL", "abdul@duckercreative.com")


# ── Design tokens ───────────────────────────────────────────────────────────
# Aliased to the shared --ds-* custom properties (not literal hex) so this
# renderer follows dark mode like every other report. Canvas draw calls below
# can't use var() directly, so they re-resolve these off getComputedStyle at
# draw time instead.
INK     = "var(--ds-ink)"
GROUND  = "var(--ds-bg)"
SIGNAL  = "var(--ds-red)"
RESOLVE = "var(--ds-green)"
RULE    = "var(--ds-line)"
MUTED   = "var(--ds-muted)"
AMBER   = "var(--ds-amber)"


def score_color(v: float) -> str:
    if v >= 65:
        return RESOLVE
    if v >= 40:
        return AMBER
    return SIGNAL


def score_band(v: float) -> str:
    if v >= 85:
        return "Optimized"
    if v >= 65:
        return "Developing"
    if v >= 40:
        return "At Risk"
    return "Critical"


def fmt_int(n) -> str:
    try:
        return f"{int(n):,}"
    except (TypeError, ValueError):
        return "—"


def fmt_count(n) -> str:
    """Ad counts may arrive as ints (0, 7) or as qualified strings from manual
    Ad Library verification (e.g. '>=7 (partial sample)'). Numbers format with
    a thousands separator; non-empty strings pass through verbatim; empty/None
    become an em-dash."""
    if isinstance(n, str):
        s = n.strip()
        return e(s) if s else "—"
    return fmt_int(n)


def fmt_pct(n) -> str:
    try:
        return f"{float(n):.1f}%"
    except (TypeError, ValueError):
        return "—"


def e(s) -> str:
    return ihtml.escape(str(s)) if s is not None else ""


def track_row(present: bool, label: str, id_val=None) -> str:
    col  = RESOLVE if present else SIGNAL
    icon = "✓" if present else "✗"
    extra = f' <span class="mono muted">({e(id_val)})</span>' if id_val and present else ""
    return (
        f'<li><span class="tick" style="color:{col}">{icon}</span>'
        f" {e(label)}{extra}</li>"
    )


APERTURE_CSS = r"""
/* ============================================================================
   smOS Pre-Audit — "Aperture" visual language
   A precision growth-diagnostic instrument. Deep console-navy brackets open and
   close the report; a cool-paper body carries the analysis on white surfaces.
   Signature: the CSS signal-ring gauge (pure conic-gradient — renders in PDF,
   no JS). Signal-lime is the one bold accent, reserved for "opportunity".
   Colors are literal (PDF-safe, non-inverting); SF Pro type comes from --ds-*.
   ============================================================================ */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --console:  #0b1120;
  --console-2:#111a2e;
  --paper:    #eef1f5;
  --surface:  #ffffff;
  --surface-2:#f7f9fb;
  --ink:      #0c1524;
  --ink-2:    #34405a;
  --muted:    #6a7690;
  --faint:    #9aa4ba;
  --line:     #e2e7ef;
  --line-2:   #d3dae6;

  --petrol:   #0b5c48;
  --emerald:  #128a63;
  --emerald-d:#0c6a4c;
  --lime:     #8ce563;
  --emerald-t:#e7f5ef;
  --amber:    #d98a15;
  --amber-t:  #fbf1dd;
  --red:      #d6453f;
  --red-t:    #fbe8e7;

  --aurora:      linear-gradient(122deg,#053528 0%,#0b5c48 38%,#12a06f 72%,#8ce563 128%);
  --aurora-soft: linear-gradient(90deg,#0b5c48,#12a06f);
  --console-grad:linear-gradient(160deg,#0b1120 0%,#0e1a30 60%,#0b2a24 130%);

  --radius: 16px; --r-sm:10px; --r-pill:999px;
  --sh-sm: 0 1px 2px rgba(12,21,36,.05), 0 1px 3px rgba(12,21,36,.05);
  --sh:    0 2px 8px rgba(12,21,36,.05), 0 22px 48px rgba(12,21,36,.09);
  --ease:  cubic-bezier(.16,1,.3,1);
}

html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
body {
  font-family: var(--ds-font); background: var(--paper); color: var(--ink);
  line-height: 1.6; font-size: 15px; -webkit-font-smoothing: antialiased;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h1, h2, h3 { line-height: 1.1; letter-spacing: -.028em; font-weight: 700; }
a { color: var(--emerald-d); text-decoration: none; }
.mono { font-family: var(--ds-font-mono); font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); }
.small { font-size: 12px; }

/* ── HERO — console ─────────────────────────────────────────────── */
.hero-wrap { max-width: 1000px; margin: 0 auto; padding: 28px 22px 0; }
.hero {
  position: relative; overflow: hidden; border-radius: 26px;
  background: var(--console-grad); color: #fff; padding: 46px 46px 44px;
  box-shadow: 0 26px 70px rgba(6,20,15,.4);
}
.hero::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(60% 90% at 88% -10%, rgba(140,229,99,.22), transparent 60%),
    radial-gradient(70% 80% at 6% 110%, rgba(18,160,111,.28), transparent 62%);
}
.hero::after {
  content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .5;
  background-image: linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px);
  background-size: 100% 34px; -webkit-mask: linear-gradient(#000, transparent 55%);
          mask: linear-gradient(#000, transparent 55%);
}
.hero > * { position: relative; z-index: 1; }
.hero-top { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
.brandmark { font-family: var(--ds-font-mono); font-size: 11px; letter-spacing: 1.6px; text-transform: uppercase; color: rgba(255,255,255,.62); }
.status {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: var(--r-pill);
  font-family: var(--ds-font-mono); font-size: 10px; letter-spacing: 1.4px; text-transform: uppercase;
  background: rgba(140,229,99,.14); border: 1px solid rgba(140,229,99,.34); color: #c9f5aa;
}
.status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--lime); box-shadow: 0 0 10px var(--lime); }
.hero h1 { color: #fff; font-size: clamp(34px, 5vw, 54px); margin-top: 26px; letter-spacing: -.032em; }
.hero-meta { margin-top: 10px; font-size: 13.5px; color: rgba(255,255,255,.66); font-family: var(--ds-font-mono); letter-spacing: .3px; }

.readout { margin-top: 40px; display: grid; grid-template-columns: auto 1fr; gap: 52px; align-items: center; }

.ring {
  --deg: calc(var(--pct) * 2.7deg);
  position: relative; width: 210px; height: 210px; flex-shrink: 0;
}
.ring::before {
  content: ""; position: absolute; inset: 0; border-radius: 50%;
  background:
    conic-gradient(from 225deg,
      var(--lime) 0deg,
      #35d68a var(--deg),
      rgba(255,255,255,.12) var(--deg) 270deg,
      transparent 270deg);
  -webkit-mask: radial-gradient(circle at 50% 50%, transparent 68px, #000 69px);
          mask: radial-gradient(circle at 50% 50%, transparent 68px, #000 69px);
}
.ring-core {
  position: absolute; inset: 0; z-index: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center;
}
.ring-up { font-size: 64px; font-weight: 800; letter-spacing: -.05em; line-height: .9; color: #fff; font-variant-numeric: tabular-nums; }
.ring-up span { font-size: 22px; color: rgba(255,255,255,.5); font-weight: 600; }
.ring-cap { font-family: var(--ds-font-mono); font-size: 9.5px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--lime); margin-top: 8px; }
.ring-sub { font-family: var(--ds-font-mono); font-size: 10px; color: rgba(255,255,255,.5); margin-top: 3px; }

.verdict { max-width: 460px; }
.band {
  display: inline-flex; align-items: center; gap: 7px; margin-bottom: 16px;
  padding: 5px 13px; border-radius: var(--r-pill); font-family: var(--ds-font-mono);
  font-size: 10px; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase;
  background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.22); color: #fff;
}
.verdict .lead { font-size: 23px; font-weight: 700; line-height: 1.28; letter-spacing: -.018em; color: #fff; }
.hero-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
.hero-pill {
  background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.16);
  border-radius: var(--r-pill); padding: 6px 14px; font-size: 12.5px; font-family: var(--ds-font-mono);
  letter-spacing: .2px; color: rgba(255,255,255,.82);
}

/* ── LAYOUT ─────────────────────────────────────────────────────── */
.layout {
  max-width: 1000px; margin: 0 auto;
  display: grid; grid-template-columns: 186px 1fr; gap: 46px;
  padding: 56px 22px 44px;
}
.rail { position: relative; }
.rail-inner { position: sticky; top: 26px; }
.rail-nav { list-style: none; border-left: 1px solid var(--line-2); padding-left: 2px; }
.rail-section-label {
  font-family: var(--ds-font-mono); font-size: 9px; letter-spacing: 1.6px; text-transform: uppercase;
  color: var(--faint); padding: 18px 14px 6px; list-style: none;
}
.rail-link {
  display: block; padding: 8px 14px; margin-left: -1px; border-left: 2px solid transparent;
  font-size: 12.5px; font-weight: 500; color: var(--muted); text-decoration: none; transition: .15s;
}
.rail-link:hover { color: var(--ink); }
.rail-link.active { color: var(--emerald-d); border-left-color: var(--emerald); font-weight: 600; }

/* ── SECTIONS (auto-numbered instrument eyebrows via counter) ───── */
.content { min-width: 0; counter-reset: sec; }
.section { margin-bottom: 60px; scroll-margin-top: 24px; counter-increment: sec; }
.section-heading {
  font-family: var(--ds-font); font-size: 27px; font-weight: 700;
  color: var(--ink); margin-bottom: 6px; letter-spacing: -.026em;
}
.section-heading::before {
  content: "0" counter(sec); display: block;
  font-family: var(--ds-font-mono); font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
  color: var(--emerald-d); margin-bottom: 11px;
}
.section-sub { font-size: 13px; color: var(--muted); margin-bottom: 22px; max-width: 660px; line-height: 1.55; }

/* ── CARDS ──────────────────────────────────────────────────────── */
.card {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 22px 24px; box-shadow: var(--sh-sm);
}
.card + .card { margin-top: 10px; }
.card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.card-label { font-family: var(--ds-font-mono); font-size: 9px; letter-spacing: 1.3px; text-transform: uppercase; color: var(--muted); }
.card-value { font-family: var(--ds-font); font-size: 29px; font-weight: 800; color: var(--ink); line-height: 1.1; letter-spacing: -.03em; margin-top: 8px; font-variant-numeric: tabular-nums; }
.card-caption { font-size: 11.5px; color: var(--muted); margin-top: 4px; }

/* ── TABLES ─────────────────────────────────────────────────────── */
.table-wrap {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  overflow: hidden; box-shadow: var(--sh-sm);
}
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th {
  background: var(--console); color: rgba(255,255,255,.9); padding: 13px 15px; text-align: left;
  font-family: var(--ds-font-mono); font-size: 9px; font-weight: 700; letter-spacing: 1px;
  text-transform: uppercase; white-space: nowrap;
}
tbody tr { border-bottom: 1px solid var(--line); }
tbody tr:last-child { border-bottom: none; }
tbody td { padding: 12px 15px; vertical-align: middle; }
.page-name { font-weight: 600; }
.dim-label { font-weight: 500; font-size: 13px; }
.dim-weight { font-family: var(--ds-font-mono); font-size: 11px; color: var(--muted); text-align: right; }

/* Bars (score meters) */
.bar-wrap { display: flex; align-items: center; gap: 12px; }
.bar-track { flex: 1; height: 9px; background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-pill); overflow: hidden; max-width: 200px; }
.bar-fill { height: 100%; border-radius: var(--r-pill); transition: width .9s var(--ease); }
.bar-num { font-family: var(--ds-font-mono); font-size: 14px; font-weight: 800; min-width: 30px; }

/* ── TRACKING ───────────────────────────────────────────────────── */
.tracking-list { list-style: none; }
.tracking-list li {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 13px;
}
.tracking-list li:last-child { border-bottom: none; }
.tick { font-weight: 800; font-size: 15px; width: 16px; flex-shrink: 0; }

/* ── WINS & GAPS ────────────────────────────────────────────────── */
.wins-gaps-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.wins-card, .gaps-card { position: relative; overflow: hidden; }
.wins-card::before, .gaps-card::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px; }
.wins-card::before { background: var(--aurora-soft); }
.gaps-card::before { background: linear-gradient(90deg, var(--amber), #e8a94a); }
.card-type-label { font-family: var(--ds-font-mono); font-size: 9px; letter-spacing: 1.3px; text-transform: uppercase; margin-bottom: 16px; }
.wins-card .card-type-label { color: var(--emerald-d); }
.gaps-card .card-type-label { color: var(--amber); }
.tier-group { margin-bottom: 10px; }
.tier-label {
  font-family: var(--ds-font-mono); font-size: 8.5px; letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--faint); margin-bottom: 6px; padding-bottom: 5px; border-bottom: 1px solid var(--line);
}
.bullet-list { list-style: none; padding: 0; }
.bullet-list li { padding: 8px 0 8px 26px; position: relative; border-bottom: 1px solid var(--line); font-size: 13px; line-height: 1.5; }
.bullet-list li:last-child { border-bottom: none; }
.bullet-list.wins li::before { content: "✓"; position: absolute; left: 0; color: var(--emerald); font-weight: 800; }
.bullet-list.gaps li::before { content: "→"; position: absolute; left: 2px; color: var(--amber); font-weight: 800; }

/* ── RECOMMENDATIONS ────────────────────────────────────────────── */
.rec-card {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 22px 24px; box-shadow: var(--sh-sm);
  display: grid; grid-template-columns: 52px 1fr; gap: 22px; margin-bottom: 12px;
}
.rec-num { font-family: var(--ds-font-mono); font-size: 13px; font-weight: 800; color: var(--emerald-d); padding-top: 5px; letter-spacing: 1px; text-align: left; }
.rec-num::before { content: "P"; }
.rec-problem { font-size: 15.5px; font-weight: 700; margin-bottom: 7px; letter-spacing: -.01em; }
.rec-evidence { font-size: 13px; color: var(--muted); margin-bottom: 9px; line-height: 1.55; }
.rec-action { font-size: 13px; margin-bottom: 10px; }
.rec-outcome { font-size: 12px; color: var(--emerald-d); font-weight: 700; background: var(--emerald-t); display: inline-block; padding: 6px 13px; border-radius: var(--r-pill); }

/* ── CTA — closing console ──────────────────────────────────────── */
.cta-section { background: var(--console-grad); color: #fff; padding: 76px 40px; text-align: center; position: relative; overflow: hidden; }
.cta-section::before { content: ""; position: absolute; inset: 0; background: radial-gradient(50% 70% at 50% 0%, rgba(140,229,99,.14), transparent 60%); }
.cta-inner { max-width: 580px; margin: 0 auto; position: relative; z-index: 1; }
.cta-heading { font-family: var(--ds-font); color: #fff; font-size: 34px; font-weight: 800; margin-bottom: 12px; letter-spacing: -.028em; }
.cta-sub { font-size: 14px; color: rgba(255,255,255,.66); margin-bottom: 36px; line-height: 1.6; }
.timeline { margin-bottom: 38px; text-align: left; }
.timeline-row { display: flex; align-items: flex-start; gap: 20px; padding: 16px 0; border-top: 1px solid rgba(255,255,255,.11); }
.timeline-row:last-child { border-bottom: 1px solid rgba(255,255,255,.11); }
.timeline-day { font-family: var(--ds-font-mono); font-size: 10px; color: var(--lime); font-weight: 800; min-width: 56px; padding-top: 3px; letter-spacing: .6px; }
.timeline-desc { font-size: 13px; color: rgba(255,255,255,.8); line-height: 1.55; }
.cta-btn {
  display: inline-block; background: var(--lime); color: #0c2b10; border-radius: var(--r-pill);
  padding: 15px 42px; font-size: 14.5px; font-weight: 800; text-decoration: none; letter-spacing: .2px;
  transition: transform .15s var(--ease);
}
.cta-btn:hover { transform: translateY(-2px); }
.cta-footnote { font-size: 11.5px; color: rgba(255,255,255,.4); margin-top: 16px; font-family: var(--ds-font-mono); }

/* ── FOOTER ─────────────────────────────────────────────────────── */
.footer {
  text-align: center; padding: 26px; font-family: var(--ds-font-mono);
  font-size: 10px; color: var(--faint); letter-spacing: .6px;
  border-top: 1px solid var(--line); background: var(--paper);
}

/* ── PRINT ──────────────────────────────────────────────────────── */
@media print {
  .rail { display: none; }
  .layout { grid-template-columns: 1fr; padding: 24px; }
  .hero, .cta-section, .chart-card, thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .card, .table-wrap, .rec-card { box-shadow: none; break-inside: avoid; }
  .section-heading { break-after: avoid; }
}

/* ── RESPONSIVE ─────────────────────────────────────────────────── */
@media (max-width: 780px) {
  .layout { grid-template-columns: 1fr; padding: 34px 16px; gap: 0; }
  .rail { display: none; }
  .wins-gaps-grid, .card-grid { grid-template-columns: 1fr; }
  .rec-card { grid-template-columns: 1fr; }
  .readout { grid-template-columns: 1fr; gap: 32px; justify-items: center; text-align: center; }
  .verdict { text-align: left; }
  .cta-heading { font-size: 26px; }
  .hero { padding: 34px 26px; }
  .verdict .lead { font-size: 19px; }
  .table-wrap { overflow-x: auto; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
"""


# ── Main renderer ──────────────────────────────────────────────────────────
def build_html(business: str, slug: str, page: dict, comp: dict, syn: dict,
               niche_html_link: str | None) -> str:

    fb   = page.get("facebook", {}) or {}
    ig   = page.get("instagram", {}) or {}
    site = page.get("website",   {}) or {}

    score     = int(syn.get("score", 0))
    dims      = syn.get("dimensions", {}) or {}
    ratio     = int(syn.get("outspend_ratio", 0) or 0)
    band      = score_band(score)
    sc_color  = score_color(score)
    headline  = syn.get("headline", "")
    # Timestamp derives from the data (scored_at ← signals.csv fetched_at), so a
    # re-render never silently mis-dates the audit to wall-clock. Wall-clock is
    # only the last-resort fallback when no fetched_at was recorded.
    _stamp_iso = syn.get("scored_at") or page.get("fetched_at") or comp.get("fetched_at")
    try:
        timestamp = (datetime.fromisoformat(str(_stamp_iso).replace("Z", "+00:00"))
                     .strftime("%B %d, %Y")) if _stamp_iso else \
            datetime.now(timezone.utc).strftime("%B %d, %Y")
    except ValueError:
        timestamp = datetime.now(timezone.utc).strftime("%B %d, %Y")

    dq = syn.get("data_quality", {}) or {}
    low_confidence = bool(dq.get("low_confidence"))

    # ── Outspend hero ──
    _note = (comp.get("note") or "") + " " + (syn.get("outspend_ratio_source") or "")
    _is_category = bool(re.search(
        r"categor|benchmark|could not be resolved|unresolved|sweep", _note, re.I
    ))
    if ratio > 0:
        ratio_display = f"{ratio:,}×"
        ratio_caption = (
            "Category benchmark — named competitors could not be resolved."
            if _is_category else
            "Top competitor monthly ad volume vs. yours (last 90 days)."
        )
    else:
        ratio_display = "N/A"
        ratio_caption  = "Competitor ad-spend data unavailable."

    # ── Snapshot pills ──
    snapshot = []
    if fb.get("likes"):
        snapshot.append(f"FB · {fmt_int(fb['likes'])} likes")
    if ig.get("followers"):
        snapshot.append(f"IG · {fmt_int(ig['followers'])} followers")
    if ig.get("posts_per_week") is not None:
        snapshot.append(f"{ig['posts_per_week']}/wk posts")
    snapshot.append(f"Competitor outspend · {ratio_display}")
    verdict_sub = " &nbsp;·&nbsp; ".join(e(p) for p in snapshot)

    # ── Console hero ("Aperture"): the score is reframed as UPSIDE and drawn as
    # a pure-CSS conic signal-ring (no canvas → it renders in the PDF and needs
    # no JS). The one hero every pre-audit inherits — never fork it per prospect.
    upside = max(0, 100 - score)
    hero_pills = "".join(
        f'<span class="hero-pill">{e(p)}</span>' for p in snapshot
    )
    hero_html = (
        '<header class="hero">\n'
        '<div class="hero-top">\n'
        '<div class="brandmark">smOS · Growth Pre-Audit</div>\n'
        '<div class="status">Signal locked · public data</div>\n'
        "</div>\n"
        f"<h1>{e(business)}</h1>\n"
        f'<div class="hero-meta">{e(timestamp)} · Prepared by {e(AGENCY_NAME)}</div>\n'
        '<div class="readout">\n'
        f'<div class="ring" style="--pct:{score}" role="img" '
        f'aria-label="Growth readiness {score} of 100 — {upside} points of upside available">\n'
        '<div class="ring-core">\n'
        f'<div class="ring-up">{upside}<span>↑</span></div>\n'
        '<div class="ring-cap">upside</div>\n'
        f'<div class="ring-sub">readiness {score} / 100</div>\n'
        "</div>\n"
        "</div>\n"
        '<div class="verdict">\n'
        f'<span class="band">{e(band)}</span>\n'
        f'<div class="lead">{e(headline or "")}</div>\n'
        f'<div class="hero-pills">{hero_pills}</div>\n'
        "</div>\n"
        "</div>\n"
        "</header>\n"
    )

    # ── Low-confidence banner ──
    # Fires when ≥2 core public passes were blocked (data_quality gate in
    # build.py). The score still renders, but the prospect (and the operator)
    # is told plainly it rests on partial data — never a confident-looking PDF
    # from empty passes.
    low_conf_banner = ""
    if low_confidence:
        _blocked = ", ".join(e(p) for p in (dq.get("blocked_passes") or [])) or "multiple sources"
        low_conf_banner = (
            '<div class="card" style="border-left:4px solid var(--ds-orange);'
            'background:color-mix(in srgb,var(--ds-orange) 8%,transparent);margin:0 0 18px">'
            '<div class="card-label" style="color:var(--ds-orange)">⚠ Low-confidence audit</div>'
            f'<p class="muted small" style="margin:6px 0 0">Public data was unavailable for '
            f'{len(dq.get("blocked_passes") or [])} of {dq.get("core_passes", 4)} core sources '
            f'({_blocked}). Scores and sizing below are directional — a full audit with account '
            f'access will refine them.</p>'
            '</div>'
        )

    # ── Score dimension rows (5 equal weights) ──
    dim_meta = [
        ("Profile & Brand Presence", "page_completeness",    20),
        ("Organic Content Quality",  "posting_consistency",  20),
        ("Paid Ads Activity",        "ad_maturity",          20),
        ("Competitor Position",      "outspend_gap_inverse", 20),
        ("Technical Foundation",     "pixel_tracking",       20),
    ]
    dim_rows = ""
    for label, key, weight in dim_meta:
        val = int(dims.get(key, 0) or 0)
        col = score_color(val)
        # Green dimensions get the aurora fill; amber/red stay solid semantic.
        # Width is rendered server-side so the bar is correct in the PDF too.
        fill = "var(--aurora-soft)" if val >= 65 else col
        dim_rows += (
            f'<tr>'
            f'<td class="dim-label">{e(label)}</td>'
            f'<td><div class="bar-wrap">'
            f'<div class="bar-track"><div class="bar-fill" style="width:{val}%;background:{fill}"></div></div>'
            f'<span class="bar-num" style="color:{col}">{val}</span>'
            f'</div></td>'
            f'<td class="dim-weight">{weight}%</td>'
            f'</tr>'
        )

    # ── Organic content ──
    er       = ig.get("engagement_rate")
    fmt_mix  = ig.get("format_mix", {}) or {}
    ppw      = ig.get("posts_per_week") or 0
    BENCH_ER = _bench.value("carousel_er_pct", 0.55) or 0.55

    # Facebook organic fallback signals — used when Instagram data is
    # unavailable (soft-blocked handle, or Business Discovery not yet permitted).
    # The FB Page is often the confirmed active organic surface even when IG can't
    # be read, so the section should surface it rather than render blank.
    fb_likes    = fb.get("likes")
    fb_latest   = (fb.get("latest_content_type") or "")
    fb_is_video = "video" in fb_latest.lower()
    ig_status   = (ig.get("fetch_status") or "").lower()
    ig_ok       = ig_status in ("ok", "ok_public")

    # A real 90-day format breakdown only exists when Instagram Business
    # Discovery (or the public IG profile) returned per-post data. The
    # unauthenticated Facebook scrape exposes ONLY the single latest post's
    # og:type — never a count. Presenting that as "1" under a "Count (last 90d)"
    # column reads as "this page posted once in 90 days", which is false for an
    # active page. So render the FB signal qualitatively, never as a count.
    has_real_fmt_mix = bool(fmt_mix)
    fb_latest_label = None
    if fb_latest:
        fb_latest_label = "Video / Reel" if fb_is_video else "Image / Static"

    if has_real_fmt_mix:
        fmt_col1, fmt_col2 = "Format (last 90d)", "Count"
        fmt_mix_rows = "".join(
            f'<tr><td>{e(fmt)}</td><td class="mono">{fmt_int(cnt)}</td></tr>'
            for fmt, cnt in sorted(fmt_mix.items(), key=lambda x: -x[1])
        )
    elif fb_latest_label:
        # Single-signal fallback — qualitative, no fabricated count.
        fmt_col1, fmt_col2 = "Signal (public scrape)", "Detected format"
        fmt_mix_rows = (
            f'<tr><td>Facebook — most recent post</td>'
            f'<td class="mono">{e(fb_latest_label)}</td></tr>'
            f'<tr><td colspan="2" class="muted small">Public scraping can read only the '
            f'latest post’s format, not the full mix. The complete 90-day format '
            f'breakdown and posting cadence populate once the client grants account '
            f'access at onboarding (or agency App Review enables Instagram Business '
            f'Discovery).</td></tr>'
        )
    else:
        fmt_col1, fmt_col2 = "Format (last 90d)", "Count"
        fmt_mix_rows = ('<tr><td colspan="2" class="muted small">'
                        'No format breakdown available</td></tr>')

    ppw_color = RESOLVE if float(ppw or 0) >= 3 else SIGNAL
    er_color  = RESOLVE if er is not None and float(er) >= BENCH_ER else SIGNAL

    # Honest status line describing what organic data could / could not be read.
    if ig_ok:
        organic_status = ""
    else:
        _ig_note = e(ig.get("note", "") or "")
        _fb_line = (
            f'The Facebook Page is the confirmed active organic surface — '
            f'{fmt_int(fb_likes)} likes, latest post is '
            f'{"a video/Reel" if fb_is_video else "static content"}. '
        ) if fb_likes else ""
        organic_status = (
            '<div class="card" style="margin-bottom:10px">'
            '<div class="card-label">Instagram data status</div>'
            f'<p class="small" style="margin-top:8px;line-height:1.5">{_fb_line}'
            f'Instagram (@{e(ig.get("handle","") or "")}) metrics are '
            f'<strong>unverified</strong>: {_ig_note or "the public profile could not be read."} '
            'Granular per-post cadence and engagement rate populate automatically once '
            'the client grants account access at onboarding (or once agency App Review '
            'enables Instagram Business Discovery).</p></div>'
        )

    # ── Paid ads ──
    self_ads     = comp.get("self", {}) or {}
    active_ads   = self_ads.get("active_ads_last_90d", 0) or 0
    new_ads_14d  = self_ads.get("new_ads_last_14d",    0) or 0
    avg_age      = self_ads.get("avg_creative_age_days")
    survival_pct = self_ads.get("survival_past_60d_pct")
    surv_color   = RESOLVE if survival_pct is not None and float(survival_pct) >= 11.3 else SIGNAL

    # ── Tracking ──
    pixel = site.get("meta_pixel", {}) or {}
    gtm   = site.get("gtm",        {}) or {}
    ga4   = site.get("ga4",        {}) or {}
    tracking_html = "".join([
        track_row(bool(pixel.get("installed")), "Meta Pixel",              pixel.get("id")),
        track_row(bool(gtm.get("installed")),   "Google Tag Manager",      gtm.get("id")),
        track_row(bool(ga4.get("installed")),   "Google Analytics 4",      ga4.get("id")),
        track_row(bool(site.get("conversion_events")), "Conversion event tracking"),
        track_row(bool(site.get("viewport_meta")),     "Mobile-responsive viewport"),
    ])

    # ── Competitor table + creative matrix ──
    competitors = comp.get("competitors", {}) or {}
    comp_rows   = ""
    for cname, cdata in competitors.items():
        cm     = cdata.get("creative_matrix", {}) or {}
        scores = []
        for k in ("hook_strength", "visual_strategy", "cta_match",
                  "psychological_trigger", "run_duration_score"):
            try:
                scores.append(float(cm[k]))
            except (KeyError, TypeError, ValueError):
                pass
        if scores:
            avg     = sum(scores) / len(scores)
            avg_s   = f"{avg:.1f}"
            avg_col = score_color(avg * 10)
        else:
            avg_s   = "—"
            avg_col = MUTED

        fmix     = cdata.get("format_mix", {}) or {}
        fmix_str = ", ".join(sorted(fmix.keys())) or "—"

        comp_rows += (
            f"<tr>"
            f'<td class="page-name">{e(cname)}</td>'
            f'<td class="mono">{fmt_count(cdata.get("active_ads_last_90d", 0))}</td>'
            f'<td class="mono">{fmt_count(cdata.get("new_ads_last_14d",    0))}</td>'
            f'<td class="mono">{e(cdata.get("avg_creative_age_days","—"))}d</td>'
            f'<td class="small">{e(fmix_str)}</td>'
            f'<td class="mono" style="color:{avg_col};font-weight:700">{avg_s}</td>'
            f"</tr>"
        )
    if not comp_rows:
        comp_rows = '<tr><td colspan="6" class="muted small">No competitor data captured.</td></tr>'

    # ── Ad Library findings narrative ──
    # The Ad Library often can't be resolved via the automated API (app-permission
    # gaps, ID-space mismatches). When that happens the operator verifies counts
    # manually in the public Ad Library UI and records the evidence in the
    # `verification`/`note`/`*_note` fields. Surface that narrative here so the
    # qualitative Ad Library insight (who's actually running ads, when, how many)
    # reaches the reader instead of being buried in the JSON.
    findings = []
    _self_verif = self_ads.get("verification")
    if _self_verif:
        findings.append(("Your account", _self_verif))
    for cname, cdata in competitors.items():
        parts = [cdata.get("verification"), cdata.get("page_id_note")]
        note = " ".join(p for p in parts if p)
        if note.strip():
            findings.append((cname, note.strip()))
    _comp_note = comp.get("note")

    findings_html = ""
    if findings or _comp_note:
        items = "".join(
            f'<li><strong style="color:var(--ds-ink)">{e(src)}:</strong> {e(text)}</li>'
            for src, text in findings
        )
        method_html = (
            f'<p class="section-sub" style="margin-top:12px">'
            f'<strong>Method:</strong> {e(_comp_note)}</p>' if _comp_note else ""
        )
        findings_html = (
            '<div class="card" style="margin-top:14px">'
            '<div class="card-label">Ad Library Findings (manually verified)</div>'
            f'<ul class="bullet-list gaps" style="margin-top:10px">{items}</ul>'
            f'{method_html}'
            '</div>'
        )

    # ── Wins & Gaps (3-tier with flat fallback) ──
    wins_tiers = syn.get("wins_tiers", {}) or {}
    gaps_tiers = syn.get("gaps_tiers", {}) or {}
    flat_wins  = syn.get("wins",  []) or []
    flat_gaps  = syn.get("gaps",  []) or []

    def render_tiers(tiers_dict, flat_list, css_class):
        if tiers_dict:
            html = ""
            for key, label in [("quick", "Quick Wins"), ("strategic", "Retainer Scope"),
                                ("longterm", "Roadmap")]:
                items = tiers_dict.get(key, []) or []
                if items:
                    html += (
                        f'<div class="tier-group">'
                        f'<div class="tier-label">{e(label)}</div>'
                        f'<ul class="bullet-list {css_class}">'
                        + "".join(f"<li>{e(i)}</li>" for i in items)
                        + "</ul></div>"
                    )
            return html or '<p class="muted small">None captured.</p>'
        return (
            '<ul class="bullet-list ' + css_class + '">'
            + "".join(f"<li>{e(i)}</li>" for i in flat_list)
            + "</ul>"
        ) if flat_list else '<p class="muted small">None captured.</p>'

    wins_html = render_tiers(wins_tiers, flat_wins, "wins")
    gaps_html = render_tiers(gaps_tiers, flat_gaps, "gaps")

    # ── Opportunity sizing ──
    opp_sizing = syn.get("opportunity_sizing", {}) or {}
    bottom_up  = opp_sizing.get("bottom_up",  {}) or {}
    top_down   = opp_sizing.get("top_down",   {}) or {}

    def sizing_table(d, fallback_msg):
        if not d:
            return f'<p class="muted small" style="padding:8px 0">{fallback_msg}</p>'
        rows = "".join(
            f"<tr><td style='color:{MUTED};padding:5px 0;font-size:13px'>{e(k)}</td>"
            f"<td class='mono' style='text-align:right;font-size:13px'>{e(v)}</td></tr>"
            for k, v in d.items()
        )
        return f'<table style="width:100%;border-collapse:collapse">{rows}</table>'

    # ── Recommendations (max 3) ──
    recs_raw  = syn.get("recommendations", syn.get("opportunities", [])) or []
    recs_html = ""
    for i, rec in enumerate(recs_raw[:3]):
        problem  = rec.get("problem",  rec.get("title",  ""))
        evidence = rec.get("evidence", rec.get("impact", ""))
        action   = rec.get("action",   "")
        outcome  = rec.get("outcome",  rec.get("effort", ""))
        recs_html += (
            f'<div class="rec-card">'
            f'<div class="rec-num">{i + 1:02d}</div>'
            f'<div class="rec-body">'
            f'<div class="rec-problem">{e(problem)}</div>'
            + (f'<div class="rec-evidence">{e(evidence)}</div>' if evidence else "")
            + (f'<div class="rec-action"><strong>Action:</strong> {e(action)}</div>' if action else "")
            + (f'<div class="rec-outcome">{e(outcome)}</div>' if outcome else "")
            + "</div></div>"
        )
    if not recs_html:
        recs_html = '<p class="muted small">No recommendations captured.</p>'

    # ── 30/60/90 next steps ──
    ns  = syn.get("next_steps", {}) or {}
    d30 = ns.get("day_30", "Pixel install, account audit, launch first conversion test at $50/day")
    d60 = ns.get("day_60", "Creative iteration, scale winning adsets, organic calendar live")
    d90 = ns.get("day_90", "Full-funnel reporting, retainer review, Q3 growth plan")

    # ── Niche block ──
    niche_block = ""
    if niche_html_link:
        niche_block = (
            f'<div class="section" id="niche">'
            f'<h2 class="section-heading">Niche Playbook</h2>'
            f'<div class="card"><p>Category benchmark report: '
            f'<a href="{e(niche_html_link)}" style="color:{RESOLVE}">{e(niche_html_link)}</a>'
            f'</p></div></div>'
        )

    # ── Industry benchmarks table (sourced + dated, from benchmarks.json) ──
    _bench_data = _bench.load_benchmarks()
    bench_rows = "".join(
        f'<tr>'
        f'<td class="dim-label">{e(m.get("label", key))}</td>'
        f'<td class="mono" style="font-weight:700">{e(m.get("display", ""))}</td>'
        f'<td class="muted small">{e(m.get("note", ""))} '
        f'<span class="muted small">({e(m.get("source", ""))}, {e(str(m.get("source_date", "")))})</span>'
        f'</td>'
        f'</tr>'
        for key, m in _bench_data.get("metrics", {}).items()
    )
    bench_asof = e(str(_bench_data.get("as_of", "")))
    bench_refreshed = e(str(_bench_data.get("refreshed", "")))

    # ── FB about + IG bio snippets ──
    fb_about = (fb.get("about", "") or "")[:120]
    ig_bio   = (ig.get("bio",   "") or "")[:120]
    ds_css   = design_system_css()

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pre-Audit · {e(business)}</title>
{THEME_BOOTSTRAP_SCRIPT}
<style>
{ds_css}
{APERTURE_CSS}
</style>
</head>
<body>

<!-- ═══ HERO ═══════════════════════════════════════════════════════ -->
<div class="hero-wrap">{hero_html}</div>

<!-- ═══ LAYOUT ══════════════════════════════════════════════════════ -->
<div class="layout">

  <aside class="rail">
    <div class="rail-inner">
      <ul class="rail-nav">
        <li class="rail-section-label">Analysis</li>
        <li><a href="#score"       class="rail-link">Score</a></li>
        <li><a href="#profile"     class="rail-link">Profile</a></li>
        <li><a href="#organic"     class="rail-link">Organic</a></li>
        <li><a href="#paid"        class="rail-link">Paid Ads</a></li>
        <li><a href="#competitors" class="rail-link">Competitors</a></li>
        <li class="rail-section-label">Pitch</li>
        <li><a href="#wins-gaps"   class="rail-link">Wins &amp; Gaps</a></li>
        <li><a href="#opportunity" class="rail-link">Opportunity</a></li>
        <li><a href="#recs"        class="rail-link">Recommendations</a></li>
        <li><a href="#next-steps"  class="rail-link">Next Steps</a></li>
      </ul>
    </div>
  </aside>

  <main class="content">
    {low_conf_banner}

    <!-- 1. Score breakdown -->
    <div class="section" id="score">
      <h2 class="section-heading">Score Breakdown</h2>
      <p class="section-sub">Five equally-weighted dimensions · each scored 0–100 from public data only.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Dimension</th><th>Score</th><th>Weight</th></tr></thead>
          <tbody>{dim_rows}</tbody>
        </table>
      </div>
    </div>

    <!-- 2. Profile & Brand Presence -->
    <div class="section" id="profile">
      <h2 class="section-heading">Profile &amp; Brand Presence</h2>
      <p class="section-sub">What a prospect sees before they click an ad — trust signals that live or die on the page itself.</p>
      <div class="card-grid">
        <div class="card">
          <div class="card-label">Facebook Page</div>
          <div class="card-value">{fmt_int(fb.get("likes", 0)) if fb.get("likes") else "—"}</div>
          <div class="card-caption">Likes · {e(fb.get("category","")) or "Category unknown"}</div>
          {f'<div style="margin-top:10px;font-size:12px;color:{MUTED}">{e(fb_about)}</div>' if fb_about else ""}
        </div>
        <div class="card">
          <div class="card-label">Instagram</div>
          <div class="card-value">{fmt_int(ig.get("followers",0)) if ig.get("followers") else "—"}</div>
          <div class="card-caption">Followers · @{e(ig.get("username","")) or "unknown"}</div>
          {f'<div style="margin-top:10px;font-size:12px;color:{MUTED}">{e(ig_bio)}</div>' if ig_bio else ""}
        </div>
      </div>
    </div>

    <!-- 3. Organic Content -->
    <div class="section" id="organic">
      <h2 class="section-heading">Organic Content</h2>
      <p class="section-sub">Carousels average 0.55% ER (best format for engagement); Reels lead on reach and discovery. Industry target: ≥ 3 posts/week.</p>
      {organic_status}
      <div class="card-grid" style="margin-bottom:10px">
        <div class="card">
          <div class="card-label">Facebook Page Likes</div>
          <div class="card-value">{fmt_int(fb_likes) if fb_likes else "—"}</div>
          <div class="card-caption">Owned organic audience</div>
        </div>
        <div class="card">
          <div class="card-label">Posts / Week (IG)</div>
          <div class="card-value" style="color:{ppw_color}">{e(str(ppw)) if ppw else "—"}</div>
          <div class="card-caption">Target ≥ 3/week</div>
        </div>
        <div class="card">
          <div class="card-label">Engagement Rate (IG)</div>
          <div class="card-value" style="color:{er_color}">{fmt_pct(er) if er is not None else "—"}</div>
          <div class="card-caption">Benchmark: 0.55% (carousel avg)</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>{fmt_col1}</th><th>{fmt_col2}</th></tr></thead>
          <tbody>{fmt_mix_rows}</tbody>
        </table>
      </div>
    </div>

    <!-- 4. Paid Ads -->
    <div class="section" id="paid">
      <h2 class="section-heading">Paid Ads Activity</h2>
      <p class="section-sub">Source: Meta Ad Library (public). Only 11.3% of ads survive past 60 days — run duration is the strongest public performance proxy.</p>
      <div class="card-grid" style="margin-bottom:10px">
        <div class="card">
          <div class="card-label">Active Ads (90d)</div>
          <div class="card-value">{fmt_count(active_ads)}</div>
        </div>
        <div class="card">
          <div class="card-label">New Ads (14d)</div>
          <div class="card-value">{fmt_count(new_ads_14d)}</div>
          <div class="card-caption">Pace indicator</div>
        </div>
        <div class="card">
          <div class="card-label">Avg Creative Age</div>
          <div class="card-value">{fmt_int(avg_age) + "d" if avg_age is not None else "—"}</div>
          <div class="card-caption">&gt;60d = strong signal</div>
        </div>
        <div class="card">
          <div class="card-label">Surviving &gt;60d</div>
          <div class="card-value" style="color:{surv_color}">{fmt_pct(survival_pct) if survival_pct is not None else "—"}</div>
          <div class="card-caption">Industry avg: 11.3%</div>
        </div>
      </div>
      <div class="card">
        <div class="card-label">Tracking Surface</div>
        <ul class="tracking-list" style="margin-top:10px">{tracking_html}</ul>
      </div>
    </div>

    <!-- 5. Competitor Intelligence -->
    <div class="section" id="competitors">
      <h2 class="section-heading">Competitor Intelligence</h2>
      <p class="section-sub">Creative Score = avg of hook strength, visual strategy, CTA match, psychological trigger, run-duration proxy (each /10). Higher = stronger creative operation.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Competitor</th>
              <th>Active (90d)</th>
              <th>New (14d)</th>
              <th>Avg Age</th>
              <th>Formats</th>
              <th>Creative Score</th>
            </tr>
          </thead>
          <tbody>{comp_rows}</tbody>
        </table>
      </div>
      {findings_html}
    </div>

    <!-- 6. Wins & Gaps -->
    <div class="section" id="wins-gaps">
      <h2 class="section-heading">Wins &amp; Gaps</h2>
      <p class="section-sub">Every gap is reframed as an opportunity with a cost of inaction — never a criticism.</p>
      <div class="wins-gaps-grid">
        <div class="card wins-card">
          <div class="card-type-label">What you're doing right</div>
          {wins_html}
        </div>
        <div class="card gaps-card">
          <div class="card-type-label">Where you're losing ground</div>
          {gaps_html}
        </div>
      </div>
    </div>

    <!-- 7. Opportunity Sizing -->
    <div class="section" id="opportunity">
      <h2 class="section-heading">Opportunity Sizing</h2>
      <p class="section-sub">Industry benchmarks anchor the projection. Prospect-specific figures populated from stated budget and revenue goal.</p>
      <div class="card" style="margin-bottom:10px">
        <div class="card-label">Industry Benchmarks — Meta {bench_asof}</div>
        <div class="table-wrap" style="margin-top:12px;box-shadow:none;border:none">
          <table>
            <thead><tr><th>Metric</th><th>Value</th><th>Source &amp; notes</th></tr></thead>
            <tbody>{bench_rows}</tbody>
          </table>
        </div>
        <div class="cta-footnote" style="margin-top:8px">Benchmarks as of {bench_asof} · last refreshed {bench_refreshed}. Each figure is cited to its published source above.</div>
      </div>
      {f"""<div class="card-grid">
        <div class="card">
          <div class="card-label">Bottom-up (from budget)</div>
          {sizing_table(bottom_up, "Provide monthly budget to generate.")}
        </div>
        <div class="card">
          <div class="card-label">Top-down (from revenue goal)</div>
          {sizing_table(top_down, "Provide revenue goal to generate.")}
        </div>
      </div>"""}
    </div>

    {niche_block}

    <!-- 8. Recommendations -->
    <div class="section" id="recs">
      <h2 class="section-heading">Recommendations</h2>
      <p class="section-sub">Three actions maximum. Problem → evidence → proposed action → expected outcome.</p>
      {recs_html}
    </div>

  </main>
</div>

<!-- ═══ CTA ════════════════════════════════════════════════════════ -->
<div class="cta-section" id="next-steps">
  <div class="cta-inner">
    <h2 class="cta-heading">What the next 90 days look like</h2>
    <p class="cta-sub">A clear onboarding arc — no surprises, no jargon, measurable milestones at every stage.</p>
    <div class="timeline">
      <div class="timeline-row">
        <div class="timeline-day">Day 30</div>
        <div class="timeline-desc">{e(d30)}</div>
      </div>
      <div class="timeline-row">
        <div class="timeline-day">Day 60</div>
        <div class="timeline-desc">{e(d60)}</div>
      </div>
      <div class="timeline-row">
        <div class="timeline-day">Day 90</div>
        <div class="timeline-desc">{e(d90)}</div>
      </div>
    </div>
    <a href="mailto:{e(AGENCY_EMAIL)}?subject=Pre-Audit+%E2%80%94+{e(business)}" class="cta-btn">Book a Free Strategy Call</a>
    <div class="cta-footnote">30 minutes · no commitment · results framework in writing</div>
  </div>
</div>

<div class="footer">
  {e(business)} &nbsp;·&nbsp; Pre-Audit &nbsp;·&nbsp; {timestamp} &nbsp;·&nbsp; Public-data analysis &nbsp;·&nbsp; {e(AGENCY_NAME)}
</div>

<script>
(function () {{
  // The score ring and dimension bars are pure CSS with server-rendered
  // widths — they need no JS and render correctly in the PDF. This script
  // only drives the active-rail highlight on scroll.

  // ── Active rail on scroll ─────────────────────────────────────
  var sections = document.querySelectorAll('.section[id], .cta-section[id]');
  var links    = document.querySelectorAll('.rail-link');
  window.addEventListener('scroll', function () {{
    var y = window.scrollY + 80;
    var active = '';
    sections.forEach(function (s) {{ if (s.offsetTop <= y) active = s.id; }});
    links.forEach(function (l) {{
      var href = (l.getAttribute('href') || '').replace('#', '');
      l.classList.toggle('active', href === active);
    }});
  }}, {{ passive: true }});
}})();
</script>

</body>
</html>"""


def main():
    p = argparse.ArgumentParser(description="Render the standardized smOS pre-audit HTML report")
    p.add_argument("--page-audit",  required=True)
    p.add_argument("--competitors", required=True)
    p.add_argument("--synthesis",   required=True)
    p.add_argument("--business",    required=True)
    p.add_argument("--slug",        required=True)
    p.add_argument("--output",      required=True)
    p.add_argument("--niche-html",  default=None)
    args = p.parse_args()

    page = json.loads(Path(args.page_audit).read_text())
    comp = json.loads(Path(args.competitors).read_text())
    syn  = json.loads(Path(args.synthesis).read_text())

    html_out = build_html(args.business, args.slug, page, comp, syn, args.niche_html)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(html_out, encoding="utf-8")
    print(f"Pre-audit HTML written to: {args.output}")


if __name__ == "__main__":
    main()
