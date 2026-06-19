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

Design system mirrors scripts/meta-ad-library/report.py so every smOS report
shares the same Apple-style visual language.
"""

import argparse
import html as ihtml
import json
from datetime import datetime, timezone
from pathlib import Path


# ── Shared design tokens (kept in sync with report.py) ─────────────────────
BRAND_GRADIENT = "linear-gradient(135deg, #0071e3 0%, #30d158 100%)"
SCORE_GREEN, SCORE_AMBER, SCORE_RED = "#34c759", "#ff9f0a", "#ff375f"


def score_color(v: float) -> str:
    if v >= 70:
        return SCORE_GREEN
    if v >= 40:
        return SCORE_AMBER
    return SCORE_RED


def bar(value: int, weight_pct: int) -> str:
    color = score_color(value)
    return (
        f'<div class="score-bar-wrap">'
        f'<div class="score-bar" style="width:{value}%;background:{color};"></div>'
        f'<span class="score-label" style="color:{color}">{value}</span>'
        f'<span class="weight">{weight_pct}%</span>'
        f"</div>"
    )


def tracking_row(present: bool, label: str, _id: str | None = None) -> str:
    color = SCORE_GREEN if present else SCORE_RED
    icon = "✓" if present else "✗"
    extra = f' <span class="small">(ID: {ihtml.escape(_id)})</span>' if _id and present else ""
    return (
        f'<li><span class="tick" style="color:{color}">{icon}</span> '
        f"{ihtml.escape(label)}{extra}</li>"
    )


def fmt_int(n: float) -> str:
    try:
        return f"{int(n):,}"
    except (TypeError, ValueError):
        return "—"


# ── Renderer ───────────────────────────────────────────────────────────────
def build_html(
    business: str,
    slug: str,
    page: dict,
    comp: dict,
    syn: dict,
    niche_html_link: str | None,
) -> str:
    fb = page.get("facebook", {}) or {}
    ig = page.get("instagram", {}) or {}
    site = page.get("website", {}) or {}
    score = int(syn.get("score", 0))
    dims = syn.get("dimensions", {}) or {}
    ratio = int(syn.get("outspend_ratio", 0) or 0)
    headline = syn.get("headline", "")
    timestamp = datetime.now(timezone.utc).strftime("%B %d, %Y at %H:%M UTC")

    # ── Score gauge color ──
    sc = score_color(score)

    # ── Dimension rows ──
    dim_meta = [
        ("Page completeness", "page_completeness", 15),
        ("Posting consistency", "posting_consistency", 10),
        ("Ad maturity", "ad_maturity", 20),
        ("Outspend gap (inverse)", "outspend_gap_inverse", 15),
        ("Pixel + tracking", "pixel_tracking", 25),
        ("Niche alignment", "niche_alignment", 15),
    ]
    dim_rows = "".join(
        f'<tr><td class="page-name">{name}</td>'
        f"<td>{bar(int(dims.get(key, 0) or 0), weight)}</td></tr>"
        for name, key, weight in dim_meta
    )

    # ── Competitor table ──
    competitors = comp.get("competitors", {}) or {}
    competitor_rows = ""
    for cname, cdata in competitors.items():
        fmix = cdata.get("format_mix", {}) or {}
        fmix_str = ", ".join(f"{k}: {v}" for k, v in sorted(fmix.items(), key=lambda x: -x[1]))
        competitor_rows += (
            f"<tr>"
            f'<td class="page-name">{ihtml.escape(str(cname))}</td>'
            f"<td><strong>{fmt_int(cdata.get('active_ads_last_90d', 0))}</strong></td>"
            f"<td>{fmt_int(cdata.get('new_ads_last_14d', 0))}</td>"
            f"<td>{cdata.get('avg_creative_age_days', '—')}d</td>"
            f'<td class="small">{ihtml.escape(fmix_str) or "—"}</td>'
            f"</tr>"
        )

    # ── Tracking surface ──
    pixel = site.get("meta_pixel", {}) or {}
    gtm = site.get("gtm", {}) or {}
    ga4 = site.get("ga4", {}) or {}
    tracking_items = "".join([
        tracking_row(bool(pixel.get("installed")), "Meta Pixel", pixel.get("id")),
        tracking_row(bool(gtm.get("installed")), "Google Tag / GTM", gtm.get("id")),
        tracking_row(bool(ga4.get("installed")), "Google Analytics 4", ga4.get("id")),
        tracking_row(bool(site.get("conversion_events")), "Conversion event tracking"),
        tracking_row(bool(site.get("viewport_meta")), "Mobile-responsive viewport"),
    ])

    # ── Lists ──
    wins_html = "".join(f"<li>{ihtml.escape(w)}</li>" for w in syn.get("wins", []) or [])
    gaps_html = "".join(
        f"<li>{ihtml.escape(g.replace('**', ''))}</li>" for g in syn.get("gaps", []) or []
    )

    opps_html = ""
    for i, opp in enumerate(syn.get("opportunities", []) or []):
        opps_html += (
            f'<div class="opp-card">'
            f'<div class="opp-num">{i + 1}</div>'
            f'<div class="opp-body">'
            f'<div class="opp-title">{ihtml.escape(opp.get("title", ""))}</div>'
            f'<div class="opp-impact">{ihtml.escape(opp.get("impact", ""))}</div>'
            f'<div class="opp-effort">Effort: {ihtml.escape(opp.get("effort", "—"))}</div>'
            f"</div></div>"
        )

    # ── Page snapshot pills ──
    snapshot = []
    if fb.get("likes"):
        snapshot.append(f"FB · {fmt_int(fb['likes'])} likes")
    if ig.get("followers"):
        snapshot.append(f"IG · {fmt_int(ig['followers'])} followers")
    if ig.get("posts_per_week") is not None:
        snapshot.append(f"{ig['posts_per_week']}/wk posts")
    snapshot_pills = "".join(f'<span class="pill">{ihtml.escape(s)}</span>' for s in snapshot)

    niche_block = ""
    if niche_html_link:
        niche_block = (
            f'<div class="section-title">Niche Playbook</div>'
            f'<div class="info-card"><p>Category benchmark report attached: '
            f'<a href="{ihtml.escape(niche_html_link)}">{ihtml.escape(niche_html_link)}</a></p></div>'
        )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pre-Audit · {ihtml.escape(business)}</title>
<style>
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
    background: #f5f5f7; color: #1d1d1f; line-height: 1.5;
}}
.header {{
    background: {BRAND_GRADIENT};
    padding: 48px 40px 40px; color: #fff;
}}
.header h1 {{ font-size: 36px; font-weight: 700; letter-spacing: -0.5px; }}
.header .subtitle {{ font-size: 16px; opacity: 0.9; margin-top: 6px; }}
.header .headline {{
    font-size: 20px; font-weight: 500; margin-top: 18px;
    line-height: 1.4; max-width: 880px;
}}
.pills {{ margin-top: 18px; display: flex; flex-wrap: wrap; gap: 8px; }}
.pill {{
    background: rgba(255,255,255,0.2); border-radius: 20px;
    padding: 5px 14px; font-size: 13px; font-weight: 500;
}}
.container {{ max-width: 1100px; margin: 0 auto; padding: 40px 24px; }}
.section-title {{
    font-size: 22px; font-weight: 600; margin: 32px 0 16px; color: #1d1d1f;
}}
.section-title:first-child {{ margin-top: 0; }}

/* Score hero card */
.score-hero {{
    background: #fff; border-radius: 20px; padding: 36px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.07);
    display: grid; grid-template-columns: auto 1fr; gap: 36px; align-items: center;
    margin-bottom: 32px;
}}
.score-gauge {{
    width: 160px; height: 160px; border-radius: 50%;
    background: conic-gradient({sc} {score * 3.6}deg, #f2f2f7 0);
    display: flex; align-items: center; justify-content: center;
    position: relative;
}}
.score-gauge::after {{
    content: ""; position: absolute; inset: 12px;
    background: #fff; border-radius: 50%;
}}
.score-gauge .num {{
    position: relative; z-index: 1;
    font-size: 44px; font-weight: 700; color: {sc};
    letter-spacing: -1px;
}}
.score-gauge .num small {{ font-size: 18px; color: #8e8e93; font-weight: 500; }}
.outspend-box .label {{
    font-size: 12px; font-weight: 600; letter-spacing: 0.6px;
    text-transform: uppercase; color: #6e6e73;
}}
.outspend-box .ratio {{
    font-size: 56px; font-weight: 700; color: {SCORE_RED};
    letter-spacing: -1.5px; line-height: 1.05; margin-top: 4px;
}}
.outspend-box .ratio small {{ font-size: 22px; color: #1d1d1f; font-weight: 500; }}
.outspend-box .caption {{ color: #6e6e73; margin-top: 8px; }}

/* Generic card */
.info-card {{
    background: #fff; border-radius: 16px; padding: 24px 28px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.07);
}}
.info-card p {{ color: #1d1d1f; }}
.info-card + .info-card {{ margin-top: 16px; }}

/* Two-col grid */
.two-col {{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }}

/* Tables */
.table-wrap {{
    background: #fff; border-radius: 16px; overflow: hidden;
    box-shadow: 0 2px 12px rgba(0,0,0,0.07);
}}
table {{ width: 100%; border-collapse: collapse; font-size: 14px; }}
thead th {{
    background: #1d1d1f; color: #fff; padding: 14px 16px;
    text-align: left; font-size: 12px; font-weight: 600;
    letter-spacing: 0.4px; text-transform: uppercase; white-space: nowrap;
}}
tbody tr {{ border-bottom: 1px solid #f2f2f2; }}
tbody td {{ padding: 14px 16px; vertical-align: middle; }}
.page-name {{ font-weight: 600; }}
.sub, .small {{ font-size: 12px; color: #8e8e93; }}

/* Score bars */
.score-bar-wrap {{ display: flex; align-items: center; gap: 10px; }}
.score-bar {{ height: 8px; border-radius: 4px; min-width: 4px; background: #ff9f0a; flex: 0 0 auto; max-width: 220px; }}
.score-label {{ font-weight: 700; font-size: 14px; min-width: 36px; }}
.weight {{ font-size: 12px; color: #8e8e93; margin-left: auto; }}

/* Tracking list */
.tracking-list {{ list-style: none; padding: 0; }}
.tracking-list li {{
    padding: 12px 0; border-bottom: 1px solid #f2f2f2;
    display: flex; align-items: center; gap: 12px; font-size: 15px;
}}
.tracking-list li:last-child {{ border-bottom: none; }}
.tick {{ font-weight: 700; font-size: 18px; width: 20px; display: inline-block; }}

/* Wins / Gaps lists */
ul.bullet-list {{ list-style: none; padding: 0; }}
ul.bullet-list li {{
    padding: 12px 0 12px 28px; position: relative;
    border-bottom: 1px solid #f2f2f2; font-size: 15px;
}}
ul.bullet-list li:last-child {{ border-bottom: none; }}
ul.bullet-list.wins li::before {{
    content: "✓"; position: absolute; left: 0; color: {SCORE_GREEN}; font-weight: 700;
}}
ul.bullet-list.gaps li::before {{
    content: "✗"; position: absolute; left: 0; color: {SCORE_RED}; font-weight: 700;
}}

/* Opportunities */
.opp-card {{
    background: #fff; border-radius: 16px; padding: 20px 24px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.07);
    display: grid; grid-template-columns: 56px 1fr; gap: 20px;
    margin-bottom: 12px; border-left: 4px solid #0071e3;
}}
.opp-num {{
    font-size: 32px; font-weight: 700; color: #0071e3;
    line-height: 1; text-align: center;
}}
.opp-title {{ font-size: 17px; font-weight: 600; margin-bottom: 6px; }}
.opp-impact {{ color: #1d1d1f; margin-bottom: 6px; line-height: 1.45; }}
.opp-effort {{ font-size: 13px; color: #6e6e73; }}

.footer {{
    text-align: center; padding: 32px; font-size: 12px; color: #8e8e93;
    border-top: 1px solid #e5e5ea; margin-top: 40px;
}}

@media print {{
    body {{ background: #fff; }}
    .header {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
    .score-hero, .info-card, .table-wrap, .opp-card {{
        box-shadow: none; border: 1px solid #e5e5ea; break-inside: avoid;
    }}
    .section-title {{ break-after: avoid; }}
}}
@media (max-width: 768px) {{
    .score-hero {{ grid-template-columns: 1fr; text-align: center; }}
    .two-col {{ grid-template-columns: 1fr; }}
    .outspend-box .ratio {{ font-size: 40px; }}
}}
</style>
</head>
<body>
<div class="header">
    <h1>Pre-Audit · {ihtml.escape(business)}</h1>
    <div class="subtitle">Prepared by Ducker Creative · {timestamp}</div>
    {f'<div class="headline">{ihtml.escape(headline)}</div>' if headline else ''}
    <div class="pills">{snapshot_pills}</div>
</div>

<div class="container">

    <!-- Score Hero -->
    <div class="score-hero">
        <div class="score-gauge"><div class="num">{score}<small>/100</small></div></div>
        <div class="outspend-box">
            <div class="label">Competitor outspend ratio</div>
            <div class="ratio">{ratio:,}<small> : 1</small></div>
            <div class="caption">Top competitor monthly ad volume vs. yours over the last 90 days.</div>
        </div>
    </div>

    <!-- Dimensions -->
    <div class="section-title">Score Breakdown</div>
    <div class="table-wrap">
        <table>
            <thead><tr><th>Dimension</th><th>Score &amp; Weight</th></tr></thead>
            <tbody>{dim_rows}</tbody>
        </table>
    </div>

    <!-- Wins / Gaps -->
    <div class="section-title">Wins &amp; Gaps</div>
    <div class="two-col">
        <div class="info-card">
            <h3 style="font-size:15px;color:{SCORE_GREEN};margin-bottom:8px;">What you're doing right</h3>
            <ul class="bullet-list wins">{wins_html}</ul>
        </div>
        <div class="info-card">
            <h3 style="font-size:15px;color:{SCORE_RED};margin-bottom:8px;">Where you're losing</h3>
            <ul class="bullet-list gaps">{gaps_html}</ul>
        </div>
    </div>

    <!-- Competitor table -->
    <div class="section-title">Competitor Outspend (Last 90 Days)</div>
    <div class="table-wrap">
        <table>
            <thead><tr>
                <th>Competitor</th><th>Active Ads (90d)</th><th>New (14d)</th>
                <th>Avg Creative Age</th><th>Format Mix</th>
            </tr></thead>
            <tbody>{competitor_rows or '<tr><td colspan="5" class="small">No competitor data.</td></tr>'}</tbody>
        </table>
    </div>

    <!-- Tracking Surface -->
    <div class="section-title">Tracking Surface</div>
    <div class="info-card">
        <ul class="tracking-list">{tracking_items}</ul>
    </div>

    {niche_block}

    <!-- Opportunities -->
    <div class="section-title">Three Opportunities</div>
    {opps_html}

</div>

<div class="footer">
    {ihtml.escape(business)} · Pre-Audit · {timestamp} · Public-data analysis · Ducker Creative
</div>
</body>
</html>"""


def main():
    p = argparse.ArgumentParser(description="Render the standardized smOS pre-audit HTML report")
    p.add_argument("--page-audit", required=True)
    p.add_argument("--competitors", required=True)
    p.add_argument("--synthesis", required=True)
    p.add_argument("--business", required=True)
    p.add_argument("--slug", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--niche-html", default=None)
    args = p.parse_args()

    page = json.loads(Path(args.page_audit).read_text())
    comp = json.loads(Path(args.competitors).read_text())
    syn = json.loads(Path(args.synthesis).read_text())

    html_out = build_html(args.business, args.slug, page, comp, syn, args.niche_html)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(html_out, encoding="utf-8")
    print(f"Pre-audit HTML written to: {args.output}")


if __name__ == "__main__":
    main()
