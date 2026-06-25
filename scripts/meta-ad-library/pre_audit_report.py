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

Design: warm editorial palette (ink/ground/signal/resolve) with DM Serif Display +
DM Sans + JetBrains Mono. Canvas radial gauge, sticky left-rail nav, 9 sections.
Emotional arc: recognition → clarity → relief.
"""

import argparse
import html as ihtml
import json
import re
from datetime import datetime, timezone
from pathlib import Path


# ── Design tokens ───────────────────────────────────────────────────────────
INK     = "#1A1A24"
GROUND  = "#F7F6F2"
SIGNAL  = "#C8402A"
RESOLVE = "#2A6B5C"
RULE    = "#E2E0D8"
MUTED   = "#6B6860"
AMBER   = "#D4860A"


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
    timestamp = datetime.now(timezone.utc).strftime("%B %d, %Y")

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
    pills_html = "".join(f'<span class="pill">{e(s)}</span>' for s in snapshot)

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
        dim_rows += (
            f'<tr>'
            f'<td class="dim-label">{e(label)}</td>'
            f'<td><div class="bar-wrap">'
            f'<div class="bar-track"><div class="bar-fill" style="width:0%;background:{col}" data-pct="{val}"></div></div>'
            f'<span class="bar-num" style="color:{col}">{val}</span>'
            f'</div></td>'
            f'<td class="dim-weight">{weight}%</td>'
            f'</tr>'
        )

    # ── Organic content ──
    er       = ig.get("engagement_rate")
    fmt_mix  = ig.get("format_mix", {}) or {}
    ppw      = ig.get("posts_per_week") or 0
    BENCH_ER = 0.55

    fmt_mix_rows = "".join(
        f'<tr><td>{e(fmt)}</td><td class="mono">{fmt_int(cnt)}</td></tr>'
        for fmt, cnt in sorted(fmt_mix.items(), key=lambda x: -x[1])
    ) or '<tr><td colspan="2" class="muted small">No format breakdown available</td></tr>'

    ppw_color = RESOLVE if float(ppw or 0) >= 3 else SIGNAL
    er_color  = RESOLVE if er is not None and float(er) >= BENCH_ER else SIGNAL

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
            f'<td class="mono">{fmt_int(cdata.get("active_ads_last_90d", 0))}</td>'
            f'<td class="mono">{fmt_int(cdata.get("new_ads_last_14d",    0))}</td>'
            f'<td class="mono">{e(cdata.get("avg_creative_age_days","—"))}d</td>'
            f'<td class="small">{e(fmix_str)}</td>'
            f'<td class="mono" style="color:{avg_col};font-weight:700">{avg_s}</td>'
            f"</tr>"
        )
    if not comp_rows:
        comp_rows = '<tr><td colspan="6" class="muted small">No competitor data captured.</td></tr>'

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

    # ── Industry benchmarks table ──
    benchmarks = [
        ("Meta Avg CPA",      "$38.19", "Industry avg cost-per-acquisition across verticals (2025)"),
        ("Meta DTC ROAS",     "1.86×",  "Avg return on ad spend, direct-to-consumer"),
        ("Meta CPL",          "$27.66", "Cost per lead — 60% cheaper than Google Ads ($70.11)"),
        ("Carousel ER",       "0.55%",  "Best engagement-rate format on Instagram (Socialinsider 2025)"),
        ("Ad survival >60d",  "11.3%",  "Only 11.3% of ads run past 60 days — longevity signals quality"),
    ]
    bench_rows = "".join(
        f'<tr>'
        f'<td class="dim-label">{e(m)}</td>'
        f'<td class="mono" style="font-weight:700">{e(v)}</td>'
        f'<td class="muted small">{e(n)}</td>'
        f'</tr>'
        for m, v, n in benchmarks
    )

    # ── FB about + IG bio snippets ──
    fb_about = (fb.get("about", "") or "")[:120]
    ig_bio   = (ig.get("bio",   "") or "")[:120]

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pre-Audit · {e(business)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

:root {{
  --ink:     {INK};
  --ground:  {GROUND};
  --signal:  {SIGNAL};
  --resolve: {RESOLVE};
  --rule:    {RULE};
  --muted:   {MUTED};
  --amber:   {AMBER};
  --radius:  12px;
  --shadow:  0 2px 18px rgba(26,26,36,.08);
}}

html {{ scroll-behavior: smooth; }}
body {{
  font-family: "DM Sans", system-ui, sans-serif;
  background: var(--ground); color: var(--ink);
  line-height: 1.6; font-size: 15px;
}}

/* ── Hero ─────────────────────────────────────────────────────── */
.hero {{
  background: var(--ink); color: var(--ground);
  padding: 56px 40px 48px;
}}
.hero-inner {{
  max-width: 940px; margin: 0 auto;
  display: grid; grid-template-columns: 1fr auto; gap: 56px; align-items: center;
}}
.hero-eyebrow {{
  font-family: "JetBrains Mono", monospace;
  font-size: 10px; letter-spacing: 1.4px; text-transform: uppercase;
  color: var(--muted); margin-bottom: 10px;
}}
.hero h1 {{
  font-family: "DM Serif Display", serif;
  font-size: 40px; line-height: 1.1; font-weight: 400;
  margin-bottom: 8px;
}}
.hero-headline {{
  font-size: 15px; color: rgba(247,246,242,.7);
  line-height: 1.55; max-width: 540px; margin-bottom: 20px;
}}
.hero-date {{
  font-family: "JetBrains Mono", monospace;
  font-size: 10px; color: var(--muted); margin-bottom: 16px;
}}
.pills {{ display: flex; flex-wrap: wrap; gap: 8px; }}
.pill {{
  background: rgba(247,246,242,.1); border: 1px solid rgba(247,246,242,.14);
  border-radius: 20px; padding: 4px 12px;
  font-size: 12px; font-weight: 500;
}}

/* Score block */
.score-block {{ text-align: center; flex-shrink: 0; }}
.score-band-label {{
  font-family: "JetBrains Mono", monospace;
  font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase;
  color: var(--muted); margin-top: 8px;
}}
.outspend-block {{ margin-top: 20px; }}
.outspend-eyebrow {{
  font-family: "JetBrains Mono", monospace;
  font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase;
  color: var(--muted); margin-bottom: 4px;
}}
.outspend-ratio {{
  font-family: "JetBrains Mono", monospace;
  font-size: 32px; font-weight: 700; color: var(--signal); line-height: 1;
}}
.outspend-caption {{
  font-size: 11px; color: var(--muted);
  max-width: 180px; margin: 4px auto 0; line-height: 1.4;
}}

/* ── Layout ───────────────────────────────────────────────────── */
.layout {{
  max-width: 940px; margin: 0 auto;
  display: grid; grid-template-columns: 168px 1fr; gap: 40px;
  padding: 48px 24px 80px;
}}

/* ── Rail ─────────────────────────────────────────────────────── */
.rail {{ position: relative; }}
.rail-inner {{
  position: sticky; top: 28px;
  border-right: 1px solid var(--rule); padding-right: 20px;
}}
.rail-nav {{ list-style: none; }}
.rail-link {{
  display: block; padding: 7px 10px; border-radius: 6px;
  font-size: 12px; font-weight: 500; color: var(--muted);
  text-decoration: none; transition: color .15s, background .15s;
  line-height: 1.3;
}}
.rail-link:hover, .rail-link.active {{
  color: var(--ink); background: var(--rule);
}}
.rail-section-label {{
  font-family: "JetBrains Mono", monospace;
  font-size: 9px; letter-spacing: 1.4px; text-transform: uppercase;
  color: var(--rule); padding: 16px 10px 4px; list-style: none;
}}

/* ── Sections ─────────────────────────────────────────────────── */
.content {{ min-width: 0; }}
.section {{ margin-bottom: 52px; scroll-margin-top: 28px; }}
.section-heading {{
  font-family: "DM Serif Display", serif;
  font-size: 25px; font-weight: 400; color: var(--ink); margin-bottom: 4px;
}}
.section-sub {{
  font-size: 12px; color: var(--muted); margin-bottom: 18px; line-height: 1.5;
}}

/* ── Cards ────────────────────────────────────────────────────── */
.card {{
  background: #fff; border-radius: var(--radius); padding: 22px 26px;
  box-shadow: var(--shadow); border: 1px solid var(--rule);
}}
.card + .card {{ margin-top: 10px; }}
.card-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }}
.card-label {{
  font-family: "JetBrains Mono", monospace;
  font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase;
  color: var(--muted); margin-bottom: 4px;
}}
.card-value {{
  font-family: "JetBrains Mono", monospace;
  font-size: 26px; font-weight: 700; color: var(--ink); line-height: 1.1;
}}
.card-caption {{ font-size: 11px; color: var(--muted); margin-top: 4px; }}

/* ── Tables ───────────────────────────────────────────────────── */
.table-wrap {{
  background: #fff; border-radius: var(--radius); overflow: hidden;
  box-shadow: var(--shadow); border: 1px solid var(--rule);
}}
table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
thead th {{
  background: var(--ink); color: var(--ground);
  padding: 11px 14px; text-align: left;
  font-family: "JetBrains Mono", monospace;
  font-size: 9px; font-weight: 700; letter-spacing: .9px;
  text-transform: uppercase; white-space: nowrap;
}}
tbody tr {{ border-bottom: 1px solid var(--rule); }}
tbody tr:last-child {{ border-bottom: none; }}
tbody td {{ padding: 11px 14px; vertical-align: middle; }}
.page-name {{ font-weight: 600; }}
.mono {{ font-family: "JetBrains Mono", monospace; }}
.muted {{ color: var(--muted); }}
.small {{ font-size: 11px; }}
.dim-label {{ font-weight: 500; font-size: 13px; }}
.dim-weight {{
  font-family: "JetBrains Mono", monospace;
  font-size: 11px; color: var(--muted); text-align: right;
}}

/* Bars */
.bar-wrap {{ display: flex; align-items: center; gap: 10px; }}
.bar-track {{
  flex: 1; height: 5px; background: var(--rule); border-radius: 3px;
  overflow: hidden; max-width: 180px;
}}
.bar-fill {{
  height: 100%; border-radius: 3px; width: 0;
  transition: width .85s cubic-bezier(.4,0,.2,1);
}}
.bar-num {{
  font-family: "JetBrains Mono", monospace;
  font-size: 13px; font-weight: 700; min-width: 30px;
}}

/* ── Tracking ─────────────────────────────────────────────────── */
.tracking-list {{ list-style: none; }}
.tracking-list li {{
  display: flex; align-items: center; gap: 12px;
  padding: 10px 0; border-bottom: 1px solid var(--rule); font-size: 13px;
}}
.tracking-list li:last-child {{ border-bottom: none; }}
.tick {{ font-weight: 700; font-size: 15px; width: 16px; flex-shrink: 0; }}

/* ── Wins & Gaps ──────────────────────────────────────────────── */
.wins-gaps-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }}
.wins-card {{ border-top: 3px solid {RESOLVE}; }}
.gaps-card {{ border-top: 3px solid {SIGNAL}; }}
.card-type-label {{
  font-family: "JetBrains Mono", monospace;
  font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase;
  margin-bottom: 14px;
}}
.wins-card .card-type-label {{ color: {RESOLVE}; }}
.gaps-card .card-type-label {{ color: {SIGNAL}; }}
.tier-group {{ margin-bottom: 10px; }}
.tier-label {{
  font-family: "JetBrains Mono", monospace;
  font-size: 8px; letter-spacing: 1.4px; text-transform: uppercase;
  color: var(--muted); margin-bottom: 6px;
  padding-bottom: 4px; border-bottom: 1px solid var(--rule);
}}
.bullet-list {{ list-style: none; padding: 0; }}
.bullet-list li {{
  padding: 7px 0 7px 22px; position: relative;
  border-bottom: 1px solid var(--rule); font-size: 13px; line-height: 1.45;
}}
.bullet-list li:last-child {{ border-bottom: none; }}
.bullet-list.wins li::before {{
  content: "✓"; position: absolute; left: 0; color: {RESOLVE}; font-weight: 700;
}}
.bullet-list.gaps li::before {{
  content: "✗"; position: absolute; left: 0; color: {SIGNAL}; font-weight: 700;
}}

/* ── Recommendations ──────────────────────────────────────────── */
.rec-card {{
  background: #fff; border-radius: var(--radius); padding: 20px 24px;
  box-shadow: var(--shadow); border: 1px solid var(--rule);
  display: grid; grid-template-columns: 44px 1fr; gap: 18px;
  margin-bottom: 10px;
}}
.rec-num {{
  font-family: "DM Serif Display", serif;
  font-size: 36px; font-weight: 400; color: var(--rule);
  line-height: 1; text-align: center; padding-top: 2px;
}}
.rec-problem {{ font-size: 15px; font-weight: 600; margin-bottom: 5px; }}
.rec-evidence {{ font-size: 13px; color: var(--muted); margin-bottom: 5px; line-height: 1.5; }}
.rec-action   {{ font-size: 13px; margin-bottom: 4px; }}
.rec-outcome  {{
  font-size: 11px; color: {RESOLVE}; font-weight: 700;
  font-family: "JetBrains Mono", monospace; letter-spacing: .3px;
}}

/* ── CTA ──────────────────────────────────────────────────────── */
.cta-section {{
  background: var(--ink); color: var(--ground);
  padding: 72px 40px; text-align: center;
}}
.cta-inner {{ max-width: 520px; margin: 0 auto; }}
.cta-heading {{
  font-family: "DM Serif Display", serif;
  font-size: 32px; font-weight: 400; margin-bottom: 10px;
}}
.cta-sub {{
  font-size: 14px; color: rgba(247,246,242,.65);
  margin-bottom: 32px; line-height: 1.6;
}}
.timeline {{ margin-bottom: 36px; text-align: left; }}
.timeline-row {{
  display: flex; align-items: flex-start; gap: 16px;
  padding: 13px 0; border-top: 1px solid rgba(226,224,216,.12);
}}
.timeline-row:last-child {{ border-bottom: 1px solid rgba(226,224,216,.12); }}
.timeline-day {{
  font-family: "JetBrains Mono", monospace;
  font-size: 10px; color: {RESOLVE}; font-weight: 700;
  min-width: 50px; padding-top: 3px; letter-spacing: .5px;
}}
.timeline-desc {{ font-size: 13px; color: rgba(247,246,242,.75); line-height: 1.5; }}
.cta-btn {{
  display: inline-block;
  background: var(--signal); color: #fff;
  border-radius: 8px; padding: 13px 34px;
  font-size: 14px; font-weight: 600; text-decoration: none;
  letter-spacing: .2px;
}}
.cta-btn:hover {{ opacity: .88; }}
.cta-footnote {{
  font-size: 11px; color: rgba(247,246,242,.35); margin-top: 12px;
}}

/* ── Footer ───────────────────────────────────────────────────── */
.footer {{
  text-align: center; padding: 22px;
  font-family: "JetBrains Mono", monospace;
  font-size: 10px; color: var(--muted); letter-spacing: .5px;
  border-top: 1px solid var(--rule); background: var(--ground);
}}

/* ── Print ────────────────────────────────────────────────────── */
@media print {{
  .rail {{ display: none; }}
  .layout {{ grid-template-columns: 1fr; padding: 24px; }}
  .hero, .cta-section {{
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }}
  .card, .table-wrap, .rec-card {{
    box-shadow: none; break-inside: avoid;
  }}
  .section-heading {{ break-after: avoid; }}
}}

/* ── Responsive ───────────────────────────────────────────────── */
@media (max-width: 720px) {{
  .hero-inner {{ grid-template-columns: 1fr; }}
  .score-block {{ margin-top: 28px; text-align: left; }}
  .layout {{ grid-template-columns: 1fr; padding: 28px 16px 60px; }}
  .rail {{ display: none; }}
  .wins-gaps-grid, .card-grid {{ grid-template-columns: 1fr; }}
  .rec-card {{ grid-template-columns: 1fr; }}
  .hero h1 {{ font-size: 28px; }}
  .cta-heading {{ font-size: 24px; }}
}}
</style>
</head>
<body>

<!-- ═══ HERO ═══════════════════════════════════════════════════════ -->
<div class="hero">
  <div class="hero-inner">
    <div class="hero-meta">
      <div class="hero-eyebrow">Pre-Audit Report · Prepared by Ducker Creative</div>
      <h1>{e(business)}</h1>
      <div class="hero-date">{timestamp}</div>
      {f'<div class="hero-headline">{e(headline)}</div>' if headline else ''}
      <div class="pills">{pills_html}</div>
    </div>
    <div class="score-block">
      <canvas id="scoreGauge" width="160" height="160"></canvas>
      <div class="score-band-label">{band}</div>
      <div class="outspend-block">
        <div class="outspend-eyebrow">Competitor outspend</div>
        <div class="outspend-ratio">{e(ratio_display)}</div>
        <div class="outspend-caption">{e(ratio_caption)}</div>
      </div>
    </div>
  </div>
</div>

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
      <div class="card-grid" style="margin-bottom:10px">
        <div class="card">
          <div class="card-label">Posts / Week</div>
          <div class="card-value" style="color:{ppw_color}">{e(str(ppw)) if ppw else "—"}</div>
          <div class="card-caption">Target ≥ 3/week</div>
        </div>
        <div class="card">
          <div class="card-label">Engagement Rate</div>
          <div class="card-value" style="color:{er_color}">{fmt_pct(er) if er is not None else "—"}</div>
          <div class="card-caption">Benchmark: 0.55% (carousel avg)</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Format (last 90d)</th><th>Count</th></tr></thead>
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
          <div class="card-value">{fmt_int(active_ads)}</div>
        </div>
        <div class="card">
          <div class="card-label">New Ads (14d)</div>
          <div class="card-value">{fmt_int(new_ads_14d)}</div>
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
        <div class="card-label">Industry Benchmarks — Meta 2025</div>
        <div class="table-wrap" style="margin-top:12px;box-shadow:none;border:none">
          <table>
            <thead><tr><th>Metric</th><th>Value</th><th>Notes</th></tr></thead>
            <tbody>{bench_rows}</tbody>
          </table>
        </div>
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
    <a href="mailto:abdul@duckercreative.com?subject=Pre-Audit+%E2%80%94+{e(business)}" class="cta-btn">Book a Free Strategy Call</a>
    <div class="cta-footnote">30 minutes · no commitment · results framework in writing</div>
  </div>
</div>

<div class="footer">
  {e(business)} &nbsp;·&nbsp; Pre-Audit &nbsp;·&nbsp; {timestamp} &nbsp;·&nbsp; Public-data analysis &nbsp;·&nbsp; Ducker Creative
</div>

<script>
(function () {{
  var SCORE = {score};
  var SIGNAL  = '{SIGNAL}';
  var RESOLVE = '{RESOLVE}';
  var AMBER   = '{AMBER}';
  var RULE    = '{RULE}';
  var MUTED   = '{MUTED}';

  // ── Canvas gauge ──────────────────────────────────────────────
  function drawGauge(id, score) {{
    var canvas = document.getElementById(id);
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var cx = 80, cy = 80, r = 62, lw = 13;
    var start  = Math.PI * 0.75;
    var finish = Math.PI * 2.25;
    var color  = score >= 65 ? RESOLVE : score >= 40 ? AMBER : SIGNAL;
    var target = start + (finish - start) * (score / 100);
    var current = start;
    var step = (target - start) / 45;

    function frame() {{
      ctx.clearRect(0, 0, 160, 160);
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, finish);
      ctx.strokeStyle = RULE; ctx.lineWidth = lw; ctx.lineCap = 'round';
      ctx.stroke();

      if (current < target) {{
        ctx.beginPath();
        ctx.arc(cx, cy, r, start, current);
        ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
        ctx.stroke();
        current += step;
        requestAnimationFrame(frame);
      }} else {{
        ctx.beginPath();
        ctx.arc(cx, cy, r, start, target);
        ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
        ctx.stroke();
      }}

      ctx.fillStyle = color;
      ctx.font = 'bold 28px "JetBrains Mono", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(score, cx, cy - 6);
      ctx.fillStyle = MUTED;
      ctx.font = '11px "DM Sans", sans-serif';
      ctx.fillText('/100', cx, cy + 13);
    }}
    frame();
  }}

  drawGauge('scoreGauge', SCORE);

  // ── Bar animation on scroll ───────────────────────────────────
  function animateBars() {{
    document.querySelectorAll('.bar-fill').forEach(function (el) {{
      var pct = el.getAttribute('data-pct');
      if (pct) el.style.width = pct + '%';
    }});
  }}

  if ('IntersectionObserver' in window) {{
    var obs = new IntersectionObserver(function (entries) {{
      entries.forEach(function (e) {{ if (e.isIntersecting) animateBars(); }});
    }}, {{ threshold: 0.1 }});
    var tbl = document.getElementById('score');
    if (tbl) obs.observe(tbl);
  }} else {{
    animateBars();
  }}

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
