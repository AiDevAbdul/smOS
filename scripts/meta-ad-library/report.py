#!/usr/bin/env python3
"""Generate Apple-style HTML competitor analysis report."""

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# Shared smOS design system (Apple/Cupertino) — single source of truth.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from design_system import design_system_css, CHART_THEME  # noqa: E402


def score_color(score: float) -> str:
    if score >= 80:
        return "#34c759"
    if score >= 50:
        return "#ff9f0a"
    return "#ff375f"


def tier_color(tier: str) -> str:
    colors = {
        "Enterprise": "#ff375f",
        "Large": "#ff9f0a",
        "Medium": "#0071e3",
        "Small": "#34c759",
        "Micro": "#8e8e93",
        "Unknown": "#8e8e93",
    }
    return colors.get(tier, "#8e8e93")


def format_number(n: float) -> str:
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.1f}K"
    return str(int(n))


def build_html(data: dict) -> str:
    meta = data["meta"]
    competitors = data["competitors"]
    top = competitors[0] if competitors else {}
    names = [c["page_name"] for c in competitors]
    timestamp = datetime.utcnow().strftime("%B %d, %Y at %H:%M UTC")

    # KPI values
    top_spender = max(competitors, key=lambda x: x["estimated_monthly_spend_usd"], default={})
    most_ads = max(competitors, key=lambda x: x["total_ads"], default={})
    all_formats: dict = {}
    for c in competitors:
        for fmt, cnt in c.get("formats", {}).items():
            all_formats[fmt] = all_formats.get(fmt, 0) + cnt
    dominant_format = max(all_formats, key=all_formats.get) if all_formats else "N/A"

    all_ctas: list = []
    for c in competitors:
        all_ctas.extend(c.get("top_ctas", []))
    top_cta = max(set(all_ctas), key=all_ctas.count) if all_ctas else "N/A"

    # Chart data
    labels_json = json.dumps(names)
    ad_counts_json = json.dumps([c["total_ads"] for c in competitors])
    active_counts_json = json.dumps([c["active_ads"] for c in competitors])
    scores_json = json.dumps([c["score"] for c in competitors])

    image_counts = json.dumps([c["formats"].get("image", 0) for c in competitors])
    video_counts = json.dumps([c["formats"].get("video", 0) for c in competitors])
    carousel_counts = json.dumps([c["formats"].get("carousel", 0) for c in competitors])

    # Radar data (normalized 0-1)
    max_ads = max(c["total_ads"] for c in competitors) or 1
    max_imp = max(c["avg_impressions_upper"] for c in competitors) or 1
    radar_datasets = []
    chart_colors = ["#0071e3", "#34c759", "#ff375f", "#ff9f0a", "#af52de", "#5ac8fa"]
    for i, c in enumerate(competitors):
        color = chart_colors[i % len(chart_colors)]
        radar_datasets.append({
            "label": c["page_name"],
            "data": [
                round(c["total_ads"] / max_ads * 100, 1),
                round(c["score"], 1),
                round(c["avg_impressions_upper"] / max_imp * 100, 1),
                round(min(100, c["cadence_ads_per_week"] * 10), 1),
                round(len(c["formats"]) / 3 * 100, 1),
            ],
            "borderColor": color,
            "backgroundColor": color + "33",
            "pointBackgroundColor": color,
        })
    radar_datasets_json = json.dumps(radar_datasets)

    # Weekly cadence data
    all_weeks: set = set()
    for c in competitors:
        all_weeks.update(c.get("weekly_cadence", {}).keys())
    weeks_sorted = sorted(all_weeks)[-12:]  # last 12 weeks
    cadence_datasets = []
    for i, c in enumerate(competitors):
        color = chart_colors[i % len(chart_colors)]
        weekly = c.get("weekly_cadence", {})
        cadence_datasets.append({
            "label": c["page_name"],
            "data": [weekly.get(w, 0) for w in weeks_sorted],
            "borderColor": color,
            "backgroundColor": color + "22",
            "tension": 0.4,
            "fill": True,
        })
    cadence_datasets_json = json.dumps(cadence_datasets)
    weeks_json = json.dumps(weeks_sorted)

    # Table rows
    table_rows = ""
    for c in competitors:
        sc = c["score"]
        color = score_color(sc)
        tier_c = tier_color(c["spend_tier"])
        formats_str = ", ".join(
            f"{fmt}: {cnt}" for fmt, cnt in sorted(c["formats"].items(), key=lambda x: -x[1])
        )
        ctas_str = ", ".join(c.get("top_ctas", [])[:3]) or "—"
        table_rows += f"""
        <tr>
            <td class="rank">#{c['rank']}</td>
            <td class="page-name">{c['page_name']}</td>
            <td>{c['total_ads']}<span class="sub"> ({c['active_ads']} active)</span></td>
            <td><span class="tier-badge" style="background:{tier_c}22;color:{tier_c}">{c['spend_tier']}</span></td>
            <td>{format_number(c['estimated_monthly_spend_usd'])}</td>
            <td class="small">{formats_str}</td>
            <td>{c['cadence_ads_per_week']}/wk</td>
            <td class="small">{ctas_str}</td>
            <td>
                <div class="score-bar-wrap">
                    <div class="score-bar" style="width:{sc}%;background:{color}"></div>
                    <span class="score-label" style="color:{color}">{sc}</span>
                </div>
            </td>
        </tr>"""

    pill_badges = "".join(f'<span class="pill">{n}</span>' for n in names)
    ds_css = design_system_css()

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Meta Ads Competitor Analysis</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
{ds_css}
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{
    font-family: var(--ds-font);
    background: var(--ds-bg); color: var(--ds-ink); line-height: 1.5;
}}
.header {{
    background: var(--ds-grad-blue);
    padding: 48px 40px 40px; color: #fff;
}}
.header h1 {{ font-size: 36px; font-weight: 700; letter-spacing: -0.5px; }}
.header .subtitle {{ font-size: 16px; opacity: 0.85; margin-top: 6px; }}
.pills {{ margin-top: 18px; display: flex; flex-wrap: wrap; gap: 8px; }}
.pill {{
    background: rgba(255,255,255,0.2); border-radius: 20px;
    padding: 5px 14px; font-size: 13px; font-weight: 500;
}}
.container {{ max-width: 1200px; margin: 0 auto; padding: 40px 24px; }}
.section-title {{
    font-size: 22px; font-weight: 600; margin-bottom: 20px; color: #1d1d1f;
}}
.kpi-row {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 40px; }}
.kpi-card {{
    background: #fff; border-radius: 16px; padding: 24px 20px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.07); border-top: 3px solid;
}}
.kpi-card:nth-child(1) {{ border-color: #ff375f; }}
.kpi-card:nth-child(2) {{ border-color: #0071e3; }}
.kpi-card:nth-child(3) {{ border-color: #34c759; }}
.kpi-card:nth-child(4) {{ border-color: #ff9f0a; }}
.kpi-label {{ font-size: 11px; font-weight: 600; letter-spacing: 0.6px; text-transform: uppercase; color: #6e6e73; }}
.kpi-value {{ font-size: 28px; font-weight: 700; margin-top: 8px; color: #1d1d1f; }}
.kpi-sub {{ font-size: 13px; color: #6e6e73; margin-top: 4px; }}
.charts-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 40px; }}
.chart-card {{
    background: #fff; border-radius: 16px; padding: 28px 24px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.07);
}}
.chart-card.full {{ grid-column: 1 / -1; }}
.chart-title {{ font-size: 15px; font-weight: 600; margin-bottom: 20px; color: #1d1d1f; }}
canvas {{ max-height: 280px; }}
.table-wrap {{
    background: #fff; border-radius: 16px; overflow: hidden;
    box-shadow: 0 2px 12px rgba(0,0,0,0.07); margin-bottom: 40px;
}}
table {{ width: 100%; border-collapse: collapse; font-size: 14px; }}
thead th {{
    background: #1d1d1f; color: #fff; padding: 14px 16px;
    text-align: left; font-size: 12px; font-weight: 600;
    letter-spacing: 0.4px; text-transform: uppercase; white-space: nowrap;
}}
tbody tr {{ border-bottom: 1px solid #f2f2f2; }}
tbody tr:hover {{ background: #fafafa; }}
tbody td {{ padding: 14px 16px; vertical-align: middle; }}
.rank {{ font-weight: 700; font-size: 16px; color: #0071e3; }}
.page-name {{ font-weight: 600; }}
.sub {{ font-size: 12px; color: #8e8e93; }}
.small {{ font-size: 12px; color: #6e6e73; }}
.tier-badge {{
    display: inline-block; border-radius: 6px; padding: 3px 10px;
    font-size: 12px; font-weight: 600;
}}
.score-bar-wrap {{ display: flex; align-items: center; gap: 10px; }}
.score-bar {{ height: 8px; border-radius: 4px; min-width: 4px; }}
.score-label {{ font-weight: 700; font-size: 14px; min-width: 36px; }}
.footer {{
    text-align: center; padding: 32px; font-size: 12px; color: #8e8e93;
    border-top: 1px solid #e5e5ea;
}}
@media (max-width: 768px) {{
    .kpi-row {{ grid-template-columns: 1fr 1fr; }}
    .charts-grid {{ grid-template-columns: 1fr; }}
    .charts-grid .chart-card.full {{ grid-column: 1; }}
    table {{ font-size: 12px; }}
}}
</style>
</head>
<body>
<div class="header">
    <h1>Meta Ads Competitor Analysis</h1>
    <div class="subtitle">
        {meta.get('country', 'US')} · Last {meta.get('days', 90)} days · {len(competitors)} competitors
    </div>
    <div class="pills">{pill_badges}</div>
</div>

<div class="container">

    <!-- KPI Cards -->
    <div class="section-title">Overview</div>
    <div class="kpi-row">
        <div class="kpi-card">
            <div class="kpi-label">Top Spender</div>
            <div class="kpi-value">{top_spender.get('page_name', '—')}</div>
            <div class="kpi-sub">{top_spender.get('spend_tier', '—')} tier</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Most Active</div>
            <div class="kpi-value">{most_ads.get('page_name', '—')}</div>
            <div class="kpi-sub">{most_ads.get('total_ads', 0)} ads total</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Dominant Format</div>
            <div class="kpi-value">{dominant_format.capitalize()}</div>
            <div class="kpi-sub">{all_formats.get(dominant_format, 0)} ads</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-label">Top CTA</div>
            <div class="kpi-value">{top_cta}</div>
            <div class="kpi-sub">Most used across all ads</div>
        </div>
    </div>

    <!-- Charts -->
    <div class="section-title">Competitive Charts</div>
    <div class="charts-grid">
        <div class="chart-card">
            <div class="chart-title">Ad Volume Comparison</div>
            <canvas id="adVolumeChart"></canvas>
        </div>
        <div class="chart-card">
            <div class="chart-title">Creative Format Mix</div>
            <canvas id="formatChart"></canvas>
        </div>
        <div class="chart-card full">
            <div class="chart-title">Weekly Ad Cadence</div>
            <canvas id="cadenceChart"></canvas>
        </div>
        <div class="chart-card full">
            <div class="chart-title">Multi-Dimension Score Radar</div>
            <canvas id="radarChart"></canvas>
        </div>
    </div>

    <!-- Ranked Table -->
    <div class="section-title">Ranked Competitor Table</div>
    <div class="table-wrap">
        <table>
            <thead>
                <tr>
                    <th>Rank</th><th>Competitor</th><th>Total Ads</th>
                    <th>Spend Tier</th><th>Est. Monthly</th>
                    <th>Formats</th><th>Cadence</th><th>Top CTAs</th><th>Score</th>
                </tr>
            </thead>
            <tbody>{table_rows}</tbody>
        </table>
    </div>

</div>

<div class="footer">
    Generated {timestamp} · Data source: Meta Ad Library API · For research purposes only
</div>

<script>
{CHART_THEME}
const labels = {labels_json};
const chartColors = ['#0071e3','#34c759','#ff9f0a','#af52de','#5ac8fa','#ff375f','#5e5ce6'];

// Ad Volume
new Chart(document.getElementById('adVolumeChart'), {{
    type: 'bar',
    data: {{
        labels,
        datasets: [
            {{ label: 'Total Ads', data: {ad_counts_json}, backgroundColor: chartColors }},
            {{ label: 'Active Ads', data: {active_counts_json}, backgroundColor: chartColors.map(c => c + '55') }},
        ]
    }},
    options: {{ responsive: true, plugins: {{ legend: {{ position: 'top' }} }}, scales: {{ y: {{ beginAtZero: true }} }} }}
}});

// Format Mix
new Chart(document.getElementById('formatChart'), {{
    type: 'bar',
    data: {{
        labels,
        datasets: [
            {{ label: 'Image', data: {image_counts}, backgroundColor: '#0071e3' }},
            {{ label: 'Video', data: {video_counts}, backgroundColor: '#34c759' }},
            {{ label: 'Carousel', data: {carousel_counts}, backgroundColor: '#ff9f0a' }},
        ]
    }},
    options: {{ responsive: true, plugins: {{ legend: {{ position: 'top' }} }}, scales: {{ x: {{ stacked: true }}, y: {{ stacked: true, beginAtZero: true }} }} }}
}});

// Cadence
new Chart(document.getElementById('cadenceChart'), {{
    type: 'line',
    data: {{ labels: {weeks_json}, datasets: {cadence_datasets_json} }},
    options: {{ responsive: true, plugins: {{ legend: {{ position: 'top' }} }}, scales: {{ y: {{ beginAtZero: true }} }} }}
}});

// Radar
new Chart(document.getElementById('radarChart'), {{
    type: 'radar',
    data: {{
        labels: ['Ad Volume', 'Overall Score', 'Impressions', 'Cadence', 'Format Diversity'],
        datasets: {radar_datasets_json}
    }},
    options: {{
        responsive: true,
        plugins: {{ legend: {{ position: 'top' }} }},
        scales: {{ r: {{ beginAtZero: true, max: 100 }} }}
    }}
}});
</script>
</body>
</html>"""


def build_synthesis_html(data: dict) -> str:
    """Render the `generic_keyword_synthesis` intel shape.

    When the client opts out of a live, named-competitor Ad Library pull, /research
    produces a synthesized *category* intel (angles, hooks, CTAs, offers, visual
    patterns, whitespace gaps) instead of a ranked competitor table. This branch
    renders that shape into the same design system so the deliverable still lands in
    the client hub. Any future synthesis-mode client inherits this automatically.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
    from design_system import report_head, hero_header, _esc  # noqa: E402

    slug = data.get("client_slug", "")
    client = slug.replace("-", " ").title() if slug else "Client"
    gen = data.get("generated_at", "")
    # Agency eyebrow — keep every report heading consistent with the rest of the hub.
    agency = "smOS"
    try:
        import json as _json
        cfg = _json.loads((Path(__file__).resolve().parents[2] / "config" / "services.json").read_text())
        agency = (cfg.get("agency") or {}).get("name") or agency
    except Exception:
        pass
    note = data.get("note", "")
    timestamp = datetime.utcnow().strftime("%B %d, %Y at %H:%M UTC")

    landscape = data.get("category_landscape", {})
    fmt = data.get("format_mix", {})
    angles = data.get("angles", [])
    hooks = data.get("hooks_seen", [])
    ctas = data.get("ctas_seen", [])
    offers = data.get("offers_seen", [])
    visuals = data.get("visual_patterns", {})
    gaps = data.get("gaps_for_blue_rose_to_exploit") or data.get("gaps") or []
    recipe = data.get("winning_recipe_recommendation", {})
    refresh = data.get("refresh_recommended_after", "")

    e = _esc

    # ── KPI overview ──────────────────────────────────────────────────────────
    fmt_pairs = [(k, v) for k, v in fmt.items() if isinstance(v, (int, float))]
    dominant_fmt = max(fmt_pairs, key=lambda x: x[1])[0] if fmt_pairs else "—"
    high_fit = sum(1 for a in angles if a.get("fit_for_client") in ("high", "very_high"))
    kpis = [
        ("Category Saturation", str(landscape.get("saturation", "—")).title(), "Local-service competition"),
        ("Typical Shop Spend", landscape.get("typical_local_shop_spend", "—"), "Estimated monthly"),
        ("Dominant Format", dominant_fmt.replace("_", " ").title(), f"{int(dominant_fmt and fmt.get(dominant_fmt, 0)*100)}% of category ads" if fmt_pairs else ""),
        ("High-Fit Angles", str(high_fit), f"of {len(angles)} angles screened"),
    ]
    kpi_html = "\n".join(
        f'<div class="ds-kpi"><div class="ds-caption">{e(lbl)}</div>'
        f'<div class="ds-num">{e(val)}</div>'
        f'<div class="ds-caption">{e(sub)}</div></div>'
        for lbl, val, sub in kpis
    )

    # ── Format mix bars ───────────────────────────────────────────────────────
    fmt_rows = "\n".join(
        f'<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;'
        f'font-size:13px;margin-bottom:4px"><span>{e(k.replace("_"," ").title())}</span>'
        f'<span style="font-variant-numeric:tabular-nums;color:var(--ds-muted)">{int(v*100)}%</span></div>'
        f'<div style="height:8px;border-radius:4px;background:var(--ds-grad-brand);width:{int(v*100)}%"></div></div>'
        for k, v in sorted(fmt_pairs, key=lambda x: -x[1])
    )
    fmt_signal = fmt.get("winning_format_signal", "")

    # ── Angles table ──────────────────────────────────────────────────────────
    fit_badge = {"very_high": "ds-badge--good", "high": "ds-badge--good",
                 "medium": "ds-badge--warn", "low": "ds-badge--bad"}
    angle_rows = ""
    for a in angles:
        fit = a.get("fit_for_client", "")
        badge = fit_badge.get(fit, "ds-badge--neutral")
        use = ", ".join(a.get("use_for", [])) or "—"
        angle_rows += f"""
        <tr>
            <td style="font-weight:600">{e(a.get('angle',''))}</td>
            <td><span class="ds-badge ds-badge--neutral">{e(str(a.get('frequency','')).replace('_',' '))}</span></td>
            <td><span class="ds-badge {badge}">{e(str(fit).replace('_',' '))}</span></td>
            <td class="ds-caption">{e(use)}</td>
            <td class="ds-caption">{e(a.get('notes',''))}</td>
        </tr>"""

    def chip_list(items):
        return "".join(f'<span class="ds-badge ds-badge--info" style="margin:0 6px 8px 0;display:inline-block">{e(s)}</span>' for s in items)

    gaps_html = "\n".join(f"<li>{e(g)}</li>" for g in gaps)
    visual_html = "\n".join(
        f'<div style="margin-bottom:14px"><div class="ds-caption" style="text-transform:uppercase;'
        f'letter-spacing:.5px">{e(k.replace("_"," "))}</div><div style="margin-top:2px">{e(v)}</div></div>'
        for k, v in visuals.items()
    )
    recipe_html = "\n".join(
        f'<div class="ds-callout ds-callout--good" style="margin-bottom:12px">'
        f'<strong>{e(k.replace("_"," ").replace("for ","").title())}</strong><br>{e(v)}</div>'
        for k, v in recipe.items()
    )

    implication = landscape.get("implication", "")

    return f"""<!DOCTYPE html>
<html lang="en">
{report_head(f"Market Research — {client}")}
<body>
{hero_header(f"Market Research — {client}", subtitle=f"{client} · Category intelligence · {gen}", eyebrow=agency)}
<main class="ds-wrap ds-wrap--wide">

  <div class="ds-callout ds-callout--warn">
    <strong>Synthesized category intel</strong> — {e(note)}
  </div>

  <section class="ds-section">
    <h2>Category Overview</h2>
    <div class="ds-kpi-grid">
      {kpi_html}
    </div>
    {f'<div class="ds-callout ds-callout--good" style="margin-top:16px"><strong>Strategic implication:</strong> {e(implication)}</div>' if implication else ''}
  </section>

  <section class="ds-section">
    <h2>Creative Format Mix</h2>
    <div class="ds-card">
      {fmt_rows}
      {f'<div class="ds-callout ds-callout--info" style="margin-top:8px"><strong>Winning signal:</strong> {e(fmt_signal)}</div>' if fmt_signal else ''}
    </div>
  </section>

  <section class="ds-section">
    <h2>Messaging Angles — Fit Screen</h2>
    <div class="ds-table-wrap">
      <table class="ds-table">
        <thead><tr><th>Angle</th><th>Frequency</th><th>Fit</th><th>Use For</th><th>Notes</th></tr></thead>
        <tbody>{angle_rows}</tbody>
      </table>
    </div>
  </section>

  <section class="ds-section">
    <h2>Whitespace — Gaps to Exploit</h2>
    <div class="ds-card">
      <ul style="margin:0;padding-left:20px;line-height:1.9">{gaps_html}</ul>
    </div>
  </section>

  <section class="ds-section">
    <h2>Swipe File</h2>
    <div class="ds-card">
      <div class="ds-caption" style="text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Hooks Seen</div>
      <div style="margin-bottom:18px">{chip_list(hooks)}</div>
      <div class="ds-caption" style="text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">CTAs Seen</div>
      <div style="margin-bottom:18px">{chip_list(ctas)}</div>
      <div class="ds-caption" style="text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Offers Seen</div>
      <div>{chip_list(offers)}</div>
    </div>
  </section>

  <section class="ds-section">
    <h2>Visual Patterns</h2>
    <div class="ds-card">{visual_html}</div>
  </section>

  <section class="ds-section">
    <h2>Winning Recipe Recommendations</h2>
    {recipe_html}
  </section>

  {f'<div class="ds-callout ds-callout--neutral"><strong>Refresh recommended:</strong> {e(refresh)}</div>' if refresh else ''}

</main>
<footer class="ds-footer">Generated {timestamp} · smOS Market Research · Synthesized category intel — re-run with named competitors for a live benchmark</footer>
</body>
</html>"""


def main():
    parser = argparse.ArgumentParser(description="Generate HTML competitor analysis report")
    parser.add_argument("--input", required=True, help="Analyzed JSON from analyzer.py")
    parser.add_argument("--output", default=None, help="Output HTML file path")
    parser.add_argument("--open", action="store_true", help="Open report in browser after generation")
    args = parser.parse_args()

    with open(args.input, encoding="utf-8") as f:
        data = json.load(f)

    output_path = args.output or args.input.replace("analyzed_", "report_").replace(".json", ".html")
    # Synthesis mode (no live named-competitor pull) has a different shape — render it
    # with the category-intel layout rather than the ranked-benchmark table.
    if data.get("mode") == "generic_keyword_synthesis" or "category_landscape" in data:
        html = build_synthesis_html(data)
    else:
        html = build_html(data)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"\nReport saved to: {output_path}")

    if args.open:
        import subprocess, sys
        opener = "open" if sys.platform == "darwin" else "xdg-open"
        subprocess.run([opener, output_path])

    # Terminal summary
    competitors = data.get("competitors", [])
    if competitors:
        top = competitors[0]
        top_spender = max(competitors, key=lambda x: x["estimated_monthly_spend_usd"])
        all_fmts: dict = {}
        for c in competitors:
            for fmt, cnt in c.get("formats", {}).items():
                all_fmts[fmt] = all_fmts.get(fmt, 0) + cnt
        dominant = max(all_fmts, key=all_fmts.get) if all_fmts else "N/A"
        all_ctas = [cta for c in competitors for cta in c.get("top_ctas", [])]
        top_cta = max(set(all_ctas), key=all_ctas.count) if all_ctas else "N/A"

        print("\n── Terminal Summary ──────────────────────────────")
        print(f"  #1 Ranked:        {top['page_name']} (score {top['score']})")
        print(f"  Top Spender:      {top_spender['page_name']} ({top_spender['spend_tier']} tier)")
        print(f"  Most Active:      {max(competitors, key=lambda x: x['total_ads'])['page_name']} ({max(c['total_ads'] for c in competitors)} ads)")
        print(f"  Dominant Format:  {dominant.capitalize()}")
        print(f"  Top CTA:          {top_cta}")
        print("─────────────────────────────────────────────────\n")

    return output_path


if __name__ == "__main__":
    main()
