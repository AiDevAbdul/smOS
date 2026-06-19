#!/usr/bin/env python3
"""Generate Apple-style HTML competitor analysis report."""

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path


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

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Meta Ads Competitor Analysis</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
    background: #f5f5f7; color: #1d1d1f; line-height: 1.5;
}}
.header {{
    background: linear-gradient(135deg, #0071e3 0%, #30d158 100%);
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
const labels = {labels_json};
const chartColors = ['#0071e3','#34c759','#ff375f','#ff9f0a','#af52de','#5ac8fa'];

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


def main():
    parser = argparse.ArgumentParser(description="Generate HTML competitor analysis report")
    parser.add_argument("--input", required=True, help="Analyzed JSON from analyzer.py")
    parser.add_argument("--output", default=None, help="Output HTML file path")
    parser.add_argument("--open", action="store_true", help="Open report in browser after generation")
    args = parser.parse_args()

    with open(args.input, encoding="utf-8") as f:
        data = json.load(f)

    output_path = args.output or args.input.replace("analyzed_", "report_").replace(".json", ".html")
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
