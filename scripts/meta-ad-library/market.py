#!/usr/bin/env python3
"""
Market research analyzer — reads category Ad Library JSONs,
filters to automotive pages only, extracts copy themes, CTAs,
formats, and generates a strategic HTML report for Blue Rose Auto.
"""

import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


# ── Automotive page filter ──────────────────────────────────────────────────

AUTO_KEYWORDS = re.compile(
    r"auto|car|vehicle|truck|mechanic|repair|collision|body shop|detailing|"
    r"tint|ceramic|coating|wrap|ppf|protection film|paint|lube|tire|wheel|"
    r"motor|engine|transmission|brake|exhaust|suspension|oil change|"
    r"windshield|glass|fleet|dent|buff|polish|wax|mobile detail",
    re.IGNORECASE,
)

EXCLUDE_KEYWORDS = re.compile(
    r"drama|romance|novel|story|fiction|book|read|fashion|clothing|beauty|"
    r"skin|hair|food|restaurant|travel|hotel|crypto|forex|software|app|game",
    re.IGNORECASE,
)

COMMON_CTAS = [
    "Book Now", "Book Today", "Schedule Now", "Schedule Today",
    "Get a Quote", "Free Quote", "Free Estimate",
    "Call Now", "Call Today", "Contact Us",
    "Shop Now", "Learn More", "Get Started",
    "Limited Time", "Special Offer", "Discount",
    "Protect Your Car", "Protect Your Vehicle",
    "Free Consultation", "No Appointment Needed",
    "Same Day", "Drop Off", "Pick Up",
]

OFFER_PATTERNS = re.compile(
    r"\$[\d,]+(?:\s*off)?|\d+%\s*off|free\s+\w+|complimentary|no\s+charge|"
    r"special\s+(?:offer|deal|price|discount)|coupon|promo|limited\s+time|"
    r"save\s+\$|\d+\s+for\s+\$|\bfirst\s+\w+\s+free",
    re.IGNORECASE,
)

HOOK_PATTERNS = re.compile(
    r"^(did you know|tired of|want a|looking for|protect your|is your|"
    r"don't let|stop|imagine|introducing|announcing|transform|upgrade|"
    r"the best|top-rated|award.winning|#\d+|why choose|trusted|local|"
    r"we come to you|mobile|same day|no appointment)",
    re.IGNORECASE,
)

DISABLED_AD_PATTERN = re.compile(
    r"we later disabled|not following our advertising standards",
    re.IGNORECASE,
)

CTA_TYPE_LABELS = {
    "SHOP_NOW": "Shop Now", "LEARN_MORE": "Learn More", "SIGN_UP": "Sign Up",
    "BOOK_NOW": "Book Now", "CONTACT_US": "Contact Us", "DOWNLOAD": "Download",
    "GET_OFFER": "Get Offer", "SUBSCRIBE": "Subscribe", "WATCH_MORE": "Watch More",
    "APPLY_NOW": "Apply Now", "GET_QUOTE": "Get a Quote", "ORDER_NOW": "Order Now",
    "CALL_NOW": "Call Now", "MESSAGE_PAGE": "Message Us", "WHATSAPP_MESSAGE": "WhatsApp",
    "GET_DIRECTIONS": "Get Directions", "DONATE_NOW": "Donate Now",
    "NO_BUTTON": None,
}


# ── Category definitions ─────────────────────────────────────────────────────

CATEGORIES = {
    "mechanic": {
        "label": "Mechanic / Auto Repair",
        "file": "cat_auto_repair_mechanic_shop.json",
        "icon": "🔧",
        "color": "#0071e3",
    },
    "collision": {
        "label": "Collision / Auto Body",
        "file": "cat_auto_body_collision_repair.json",
        "icon": "🚗",
        "color": "#ff375f",
    },
    "detailing": {
        "label": "Auto Detailing",
        "file": "cat_auto_detailing_car_detailing.json",
        "icon": "✨",
        "color": "#34c759",
    },
    "wrap": {
        "label": "Vehicle Wrap",
        "file": "cat_vehicle_wrap_commercial_wrap.json",
        "icon": "🎨",
        "color": "#ff9f0a",
    },
    "tinting": {
        "label": "Window Tinting",
        "file": "cat_window_tinting_car_tint.json",
        "icon": "🪟",
        "color": "#af52de",
    },
    "ceramic": {
        "label": "Ceramic Coating",
        "file": "cat_ceramic_coating_paint_coating.json",
        "icon": "💎",
        "color": "#5ac8fa",
    },
    "ppf": {
        "label": "Paint Protection Film (PPF)",
        "file": "cat_paint_protection_film_PPF.json",
        "icon": "🛡️",
        "color": "#30d158",
    },
}


# ── Helpers ──────────────────────────────────────────────────────────────────

def is_auto_page(page_name: str) -> bool:
    if EXCLUDE_KEYWORDS.search(page_name):
        return False
    return bool(AUTO_KEYWORDS.search(page_name))


def get_all_text(ad: dict) -> str:
    parts = (
        (ad.get("ad_creative_bodies") or []) +
        (ad.get("ad_creative_link_titles") or []) +
        (ad.get("ad_creative_link_captions") or []) +
        (ad.get("ad_creative_link_descriptions") or [])
    )
    return " ".join(str(p) for p in parts if p)


def infer_format(ad: dict) -> str:
    snapshot = ad.get("ad_snapshot_url", "")
    bodies = ad.get("ad_creative_bodies") or []
    if "video" in snapshot.lower():
        return "Video"
    if len(bodies) > 1:
        return "Carousel"
    return "Image/Static"


def extract_ctas(text: str) -> list[str]:
    found = []
    tl = text.lower()
    for cta in COMMON_CTAS:
        if cta.lower() in tl:
            found.append(cta)
    return found


def extract_offers(text: str) -> list[str]:
    return OFFER_PATTERNS.findall(text)


def get_hook(text: str) -> str | None:
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    for line in lines[:2]:
        if HOOK_PATTERNS.match(line):
            return line[:120]
    return None


def estimate_spend_mid(ad: dict) -> float:
    spend = ad.get("spend") or {}
    lo = float(spend.get("lower_bound") or 0)
    hi = float(spend.get("upper_bound") or 0)
    return (lo + hi) / 2 if hi else 0


def platform_labels(ad: dict) -> list[str]:
    return ad.get("publisher_platforms") or []


# ── Core analysis ────────────────────────────────────────────────────────────

def analyze_category(cat_key: str, cat_info: dict, reports_dir: Path) -> dict:
    filepath = reports_dir / cat_info["file"]
    if not filepath.exists():
        return {"error": f"File not found: {cat_info['file']}"}

    with open(filepath, encoding="utf-8") as f:
        raw = json.load(f)

    # Flatten all ads (may be keyed by search term or competitor)
    all_ads = []
    data = raw.get("data", {})
    if isinstance(data, dict):
        for ads in data.values():
            all_ads.extend(ads if isinstance(ads, list) else [])
    elif isinstance(data, list):
        all_ads = data

    # Filter to automotive pages only
    auto_ads = [a for a in all_ads if is_auto_page(a.get("page_name", ""))]

    if not auto_ads:
        # Fallback: use all ads if filtering leaves nothing
        auto_ads = all_ads

    # Remove disabled-account ads — they contain no useful copy or signals
    auto_ads = [a for a in auto_ads if not DISABLED_AD_PATTERN.search(get_all_text(a))]

    # Per-page aggregation
    pages: dict[str, dict] = defaultdict(lambda: {
        "ads": [], "spend": 0, "formats": Counter(), "ctas": Counter(),
        "hooks": [], "offers": [], "platforms": Counter(), "ad_copy_samples": [],
        "_seen_snippets": set(),
    })

    for ad in auto_ads:
        pname = ad.get("page_name", "Unknown")
        p = pages[pname]
        p["ads"].append(ad)
        p["spend"] += estimate_spend_mid(ad)
        p["formats"][infer_format(ad)] += 1
        text = get_all_text(ad)
        for cta in extract_ctas(text):
            p["ctas"][cta] += 1
        # Also pick up the explicit CTA button type from the API field
        cta_type = ad.get("call_to_action_type")
        if cta_type:
            label = CTA_TYPE_LABELS.get(cta_type, cta_type.replace("_", " ").title())
            if label:
                p["ctas"][label] += 1
        hook = get_hook(text)
        if hook and len(p["hooks"]) < 5:
            p["hooks"].append(hook)
        offers = extract_offers(text)
        p["offers"].extend(offers[:2])
        for pl in platform_labels(ad):
            p["platforms"][pl] += 1
        if text and len(p["ad_copy_samples"]) < 3:
            snippet = text[:200].replace("\n", " ").strip()
            if snippet and snippet not in p["_seen_snippets"]:
                p["_seen_snippets"].add(snippet)
                p["ad_copy_samples"].append(snippet)

    # Sort pages by ad count
    sorted_pages = sorted(pages.items(), key=lambda x: len(x[1]["ads"]), reverse=True)
    top_pages = sorted_pages[:10]

    # Category-level aggregation
    all_ctas: Counter = Counter()
    all_formats: Counter = Counter()
    all_platforms: Counter = Counter()
    all_hooks: list = []
    all_offers: list = []
    all_copy_samples: list = []
    total_spend = 0

    seen_copy: set = set()
    for _, p in sorted_pages:
        all_ctas.update(p["ctas"])
        all_formats.update(p["formats"])
        all_platforms.update(p["platforms"])
        all_hooks.extend(p["hooks"])
        all_offers.extend(p["offers"])
        for snippet in p["ad_copy_samples"]:
            if snippet not in seen_copy:
                seen_copy.add(snippet)
                all_copy_samples.append(snippet)
        total_spend += p["spend"]

    return {
        "key": cat_key,
        "label": cat_info["label"],
        "icon": cat_info["icon"],
        "color": cat_info["color"],
        "total_ads": len(auto_ads),
        "total_pages": len(pages),
        "top_pages": [
            {
                "name": name,
                "ad_count": len(p["ads"]),
                "spend_est": round(p["spend"], 0),
                "formats": dict(p["formats"].most_common(3)),
                "top_ctas": [c for c, _ in p["ctas"].most_common(3)],
                "hooks": p["hooks"][:3],
                "offers": list(set(p["offers"]))[:3],
                "platforms": dict(p["platforms"].most_common()),
                "copy_samples": p["ad_copy_samples"][:2],
            }
            for name, p in top_pages
        ],
        "top_ctas": all_ctas.most_common(6),
        "top_formats": all_formats.most_common(),
        "top_platforms": all_platforms.most_common(),
        "sample_hooks": list(dict.fromkeys(all_hooks))[:8],
        "sample_offers": list(set(all_offers))[:8],
        "sample_copy": all_copy_samples[:6],
        "total_spend_est": round(total_spend, 0),
    }


# ── HTML report ──────────────────────────────────────────────────────────────

def build_html(categories: list[dict], generated: str) -> str:

    def pct_bar(val, max_val, color):
        pct = round(val / max_val * 100) if max_val else 0
        return f'<div class="bar-wrap"><div class="bar" style="width:{pct}%;background:{color}"></div><span>{val}</span></div>'

    # Nav pills
    nav = "".join(
        f'<a href="#cat-{c["key"]}" class="nav-pill" style="border-color:{c["color"]}">'
        f'{c["icon"]} {c["label"]}</a>'
        for c in categories if "error" not in c
    )

    # Category sections
    sections = ""
    for cat in categories:
        if "error" in cat:
            sections += f'<div class="cat-section"><p class="warn">⚠ {cat["error"]}</p></div>'
            continue

        color = cat["color"]
        spend_display = (
            f"~${cat['total_spend_est']:,.0f} est. spend"
            if cat["total_spend_est"] > 0
            else "spend not reported by API"
        )
        max_fmt_val = max((cnt for _, cnt in cat["top_formats"]), default=1)
        max_plat_val = max((cnt for _, cnt in cat["top_platforms"][:4]), default=1)

        # Top advertisers table
        adv_rows = ""
        for p in cat["top_pages"][:6]:
            fmt_str = ", ".join(f"{k}: {v}" for k, v in p["formats"].items())
            cta_str = " · ".join(p["top_ctas"][:2]) or "—"
            raw_offer = p["offers"][0] if p["offers"] else None
            offer_str = raw_offer if isinstance(raw_offer, str) and raw_offer.strip() else "—"
            hook_str = (p["hooks"][0][:80] + "…") if p["hooks"] else "—"
            adv_rows += f"""<tr>
              <td class="page-name">{p['name']}</td>
              <td style="text-align:center"><strong>{p['ad_count']}</strong></td>
              <td class="small">{fmt_str or '—'}</td>
              <td class="small">{cta_str}</td>
              <td class="small offer">{offer_str}</td>
              <td class="small hook-cell">{hook_str}</td>
            </tr>"""

        # Format bars (max-relative so the leading format is always 100% wide)
        fmt_bars = "".join(
            f'<div class="metric-row"><span class="metric-label">{fmt}</span>'
            f'{pct_bar(cnt, max_fmt_val, color)}</div>'
            for fmt, cnt in cat["top_formats"]
        )

        # Platform bars (max-relative)
        plat_bars = "".join(
            f'<div class="metric-row"><span class="metric-label">{plat.capitalize()}</span>'
            f'{pct_bar(cnt, max_plat_val, color)}</div>'
            for plat, cnt in cat["top_platforms"][:4]
        )

        # CTA pills
        cta_pills = "".join(
            f'<span class="cta-pill" style="background:{color}22;color:{color};border:1px solid {color}55">'
            f'{cta} <small>({cnt})</small></span>'
            for cta, cnt in cat["top_ctas"][:6]
        )

        # Hook samples
        hook_items = "".join(
            f'<li>"{h}"</li>' for h in cat["sample_hooks"][:5]
        ) or "<li>No hooks extracted</li>"

        # Offer samples
        offer_items = "".join(
            f'<span class="offer-tag">{o}</span>' for o in cat["sample_offers"][:6]
        ) or "<span class='na'>No offers found</span>"

        # Ad copy samples
        copy_blocks = "".join(
            f'<blockquote class="copy-sample">"{s}"</blockquote>'
            for s in cat["sample_copy"][:3]
        ) or "<p class='na'>No copy samples</p>"

        sections += f"""
<div class="cat-section" id="cat-{cat['key']}">
  <div class="cat-header" style="border-left:5px solid {color}">
    <span class="cat-icon">{cat['icon']}</span>
    <div>
      <h2 class="cat-title">{cat['label']}</h2>
      <p class="cat-meta">{cat['total_ads']} ads · {cat['total_pages']} advertisers · {spend_display} in 90 days</p>
    </div>
  </div>

  <div class="grid-3">
    <!-- Formats -->
    <div class="card">
      <div class="card-title">Creative Formats</div>
      {fmt_bars}
    </div>
    <!-- Platforms -->
    <div class="card">
      <div class="card-title">Platforms</div>
      {plat_bars}
    </div>
    <!-- CTAs -->
    <div class="card">
      <div class="card-title">Top CTAs</div>
      <div class="cta-pills">{cta_pills if cta_pills else '<span class="na">Not detected</span>'}</div>
    </div>
  </div>

  <!-- Top Advertisers -->
  <div class="card full-width">
    <div class="card-title">Top Active Advertisers</div>
    <div class="table-scroll">
    <table>
      <thead><tr>
        <th>Page / Brand</th><th>Ads</th><th>Formats</th><th>CTAs</th><th>Offer</th><th>Opening Hook</th>
      </tr></thead>
      <tbody>{adv_rows}</tbody>
    </table>
    </div>
  </div>

  <div class="grid-2">
    <!-- Hooks -->
    <div class="card">
      <div class="card-title">💬 Opening Hooks Spotted</div>
      <ul class="hook-list">{hook_items}</ul>
    </div>
    <!-- Offers -->
    <div class="card">
      <div class="card-title">🏷️ Promotions & Offers</div>
      <div class="offer-tags">{offer_items}</div>
      <div class="card-title" style="margin-top:20px">📋 Ad Copy Samples</div>
      {copy_blocks}
    </div>
  </div>
</div>
"""

    # Strategy summary cards
    strategy_cards = """
<div class="strategy-section">
  <h2 class="section-title">🎯 Blue Rose Auto — Meta Ad Strategy Playbook</h2>
  <div class="grid-2">

    <div class="strategy-card">
      <div class="s-icon">🔧</div>
      <h3>Mechanic / Repair</h3>
      <ul>
        <li><strong>Hook:</strong> Lead with a pain point — "Is your check engine light on?" or "Tired of overpriced dealership repairs?"</li>
        <li><strong>Format:</strong> Short video (before/after inspection) performs best</li>
        <li><strong>CTA:</strong> "Book Now" or "Get a Free Estimate"</li>
        <li><strong>Offer:</strong> Free multi-point inspection or $X off first service drives clicks</li>
        <li><strong>Angle:</strong> Local trust — show your team, shop, real reviews</li>
      </ul>
    </div>

    <div class="strategy-card">
      <div class="s-icon">🚗</div>
      <h3>Collision / Body Shop</h3>
      <ul>
        <li><strong>Hook:</strong> "We work directly with all insurance companies"</li>
        <li><strong>Format:</strong> Before/after carousel — dramatic transformations win</li>
        <li><strong>CTA:</strong> "Free Estimate" is the #1 CTA in this category</li>
        <li><strong>Offer:</strong> Free rental car / free tow partnership adds perceived value</li>
        <li><strong>Angle:</strong> Insurance claim expertise removes customer fear</li>
      </ul>
    </div>

    <div class="strategy-card">
      <div class="s-icon">✨</div>
      <h3>Auto Detailing</h3>
      <ul>
        <li><strong>Hook:</strong> Transformation content — dirty vs. clean is highly shareable</li>
        <li><strong>Format:</strong> Video reels get the most organic boost; use for ads too</li>
        <li><strong>CTA:</strong> "Book Today" + urgency ("Only 3 slots left this week")</li>
        <li><strong>Offer:</strong> Package bundles (interior + exterior) with a discount perform well</li>
        <li><strong>Angle:</strong> Mobile detailing angle ("We come to you") is a strong differentiator</li>
      </ul>
    </div>

    <div class="strategy-card">
      <div class="s-icon">🎨</div>
      <h3>Vehicle Wraps</h3>
      <ul>
        <li><strong>Hook:</strong> "Turn your vehicle into a moving billboard"</li>
        <li><strong>Format:</strong> Portfolio carousel — show your best work</li>
        <li><strong>CTA:</strong> "Get a Free Quote" — high-consideration purchase</li>
        <li><strong>Offer:</strong> Lead with portfolio + social proof, not discounts</li>
        <li><strong>Angle:</strong> Target local business owners for commercial wraps (fleet)</li>
      </ul>
    </div>

    <div class="strategy-card">
      <div class="s-icon">🪟</div>
      <h3>Window Tinting</h3>
      <ul>
        <li><strong>Hook:</strong> "Beat the heat. Protect your interior."</li>
        <li><strong>Format:</strong> Static image — clear before/after with shade comparison</li>
        <li><strong>CTA:</strong> "Book Now" with same-day availability</li>
        <li><strong>Offer:</strong> Seasonal promotions (summer heat) drive urgency</li>
        <li><strong>Angle:</strong> UV protection + privacy + energy savings (multiple pain points)</li>
      </ul>
    </div>

    <div class="strategy-card">
      <div class="s-icon">💎</div>
      <h3>Ceramic Coating</h3>
      <ul>
        <li><strong>Hook:</strong> "Your car's paint deserves better than wax"</li>
        <li><strong>Format:</strong> High-quality video showing water beading / gloss</li>
        <li><strong>CTA:</strong> "Get a Free Consultation" — high-ticket, educate first</li>
        <li><strong>Offer:</strong> Limited-time pricing or bundle with PPF</li>
        <li><strong>Angle:</strong> Long-term value ("Protects for 5+ years") justifies price</li>
      </ul>
    </div>

    <div class="strategy-card">
      <div class="s-icon">🛡️</div>
      <h3>Paint Protection Film (PPF)</h3>
      <ul>
        <li><strong>Hook:</strong> "Protect your investment from day one"</li>
        <li><strong>Format:</strong> Side-by-side comparison video or scratch demo</li>
        <li><strong>CTA:</strong> "Get a Free Quote" — PPF is a premium, researched purchase</li>
        <li><strong>Offer:</strong> Bundle PPF + ceramic coating for package pricing</li>
        <li><strong>Angle:</strong> New car owners are the #1 target — catch them early</li>
      </ul>
    </div>

    <div class="strategy-card highlight">
      <div class="s-icon">🚀</div>
      <h3>Blue Rose Auto — Where to Start</h3>
      <ul>
        <li><strong>Step 1:</strong> Launch with detailing + mechanic ads — highest ad volume, most tested playbooks</li>
        <li><strong>Step 2:</strong> Before/after video content is the #1 winning format across all categories</li>
        <li><strong>Step 3:</strong> Run a lead-gen ad with "Free Estimate / Free Inspection" offer</li>
        <li><strong>Step 4:</strong> Target: Springfield/Eugene OR, 25–55, vehicle owners, homeowners</li>
        <li><strong>Step 5:</strong> Bundle services (e.g. tint + ceramic + PPF) for higher-ticket packages</li>
        <li><strong>Budget:</strong> Start at $15–25/day per service category, scale what converts</li>
      </ul>
    </div>

  </div>
</div>
"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blue Rose Auto — Meta Ads Market Research Report</title>
<style>
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;background:#f5f5f7;color:#1d1d1f;line-height:1.6}}
a{{color:inherit;text-decoration:none}}

.header{{background:linear-gradient(135deg,#1d1d1f 0%,#2d2d2f 100%);padding:48px 40px 36px;color:#fff}}
.header h1{{font-size:32px;font-weight:700;letter-spacing:-0.5px}}
.header .sub{{color:rgba(255,255,255,.6);font-size:15px;margin-top:8px}}
.badge-row{{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}}
.badge{{background:rgba(255,255,255,.12);border-radius:20px;padding:5px 14px;font-size:12px;font-weight:500}}

.nav-bar{{background:#fff;padding:16px 40px;display:flex;flex-wrap:wrap;gap:10px;border-bottom:1px solid #e5e5ea;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.06)}}
.nav-pill{{border:1.5px solid #ccc;border-radius:20px;padding:5px 14px;font-size:12px;font-weight:600;transition:all .2s;white-space:nowrap}}
.nav-pill:hover{{background:#f0f0f5}}

.container{{max-width:1280px;margin:0 auto;padding:40px 24px}}

.cat-section{{margin-bottom:56px;padding-bottom:48px;border-bottom:1px solid #e5e5ea}}
.cat-header{{display:flex;align-items:center;gap:16px;padding:20px 24px;background:#fff;border-radius:16px;margin-bottom:24px;box-shadow:0 2px 12px rgba(0,0,0,.06)}}
.cat-icon{{font-size:36px}}
.cat-title{{font-size:22px;font-weight:700}}
.cat-meta{{font-size:13px;color:#6e6e73;margin-top:4px}}

.grid-3{{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:16px}}
.grid-2{{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-bottom:16px}}
.card{{background:#fff;border-radius:14px;padding:20px 20px 16px;box-shadow:0 2px 10px rgba(0,0,0,.06)}}
.card.full-width{{grid-column:1/-1}}
.card-title{{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#6e6e73;margin-bottom:14px}}

.metric-row{{display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:13px}}
.metric-label{{min-width:90px;color:#1d1d1f;font-size:12px}}
.bar-wrap{{flex:1;display:flex;align-items:center;gap:8px}}
.bar{{height:8px;border-radius:4px;min-width:4px;transition:width .3s}}
.bar-wrap span{{font-size:12px;color:#6e6e73;white-space:nowrap}}

.cta-pills{{display:flex;flex-wrap:wrap;gap:6px}}
.cta-pill{{border-radius:20px;padding:4px 12px;font-size:12px;font-weight:600}}

table{{width:100%;border-collapse:collapse;font-size:13px}}
thead th{{background:#1d1d1f;color:#fff;padding:10px 12px;text-align:left;font-size:11px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;white-space:nowrap}}
tbody tr{{border-bottom:1px solid #f2f2f2}}
tbody tr:hover{{background:#fafafa}}
tbody td{{padding:10px 12px;vertical-align:top}}
.page-name{{font-weight:600;color:#1d1d1f}}
.small{{font-size:12px;color:#6e6e73}}
.offer{{color:#ff9f0a;font-weight:500}}
.hook-cell{{max-width:220px;font-style:italic}}
.table-scroll{{overflow-x:auto}}

.hook-list{{list-style:none;padding:0}}
.hook-list li{{font-size:13px;color:#3a3a3c;padding:6px 0;border-bottom:1px solid #f5f5f7;font-style:italic}}
.hook-list li::before{{content:'"';color:#8e8e93;margin-right:4px}}

.offer-tags{{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}}
.offer-tag{{background:#ff9f0a22;color:#c0750a;border:1px solid #ff9f0a55;border-radius:6px;padding:3px 10px;font-size:12px;font-weight:600}}

blockquote.copy-sample{{background:#f5f5f7;border-left:3px solid #ccc;padding:10px 14px;border-radius:0 8px 8px 0;font-size:12px;color:#3a3a3c;margin-bottom:8px;font-style:italic}}
.na{{color:#8e8e93;font-size:13px;font-style:italic}}
.warn{{color:#ff375f;padding:12px;background:#fff0f2;border-radius:8px;font-size:13px}}

/* Strategy section */
.strategy-section{{margin-bottom:48px}}
.section-title{{font-size:24px;font-weight:700;margin-bottom:24px;color:#1d1d1f}}
.strategy-card{{background:#fff;border-radius:14px;padding:24px;box-shadow:0 2px 10px rgba(0,0,0,.06)}}
.strategy-card.highlight{{background:linear-gradient(135deg,#1d1d1f,#2d3a4a);color:#fff}}
.strategy-card.highlight h3{{color:#fff}}
.strategy-card.highlight ul li{{color:rgba(255,255,255,.85)}}
.strategy-card.highlight strong{{color:#34c759}}
.s-icon{{font-size:28px;margin-bottom:10px}}
.strategy-card h3{{font-size:16px;font-weight:700;margin-bottom:12px;color:#1d1d1f}}
.strategy-card ul{{list-style:none;padding:0}}
.strategy-card ul li{{font-size:13px;color:#3a3a3c;padding:5px 0;border-bottom:1px solid #f2f2f2}}
.strategy-card ul li:last-child{{border-bottom:none}}
.strategy-card ul li strong{{color:#1d1d1f}}

.footer{{text-align:center;padding:32px;font-size:12px;color:#8e8e93;border-top:1px solid #e5e5ea}}

@media(max-width:900px){{
  .grid-3{{grid-template-columns:1fr 1fr}}
  .grid-2{{grid-template-columns:1fr}}
  .nav-bar{{padding:12px 16px}}
  .header{{padding:32px 20px 24px}}
  .container{{padding:24px 12px}}
}}
@media(max-width:600px){{
  .grid-3{{grid-template-columns:1fr}}
  .header h1{{font-size:22px}}
}}
</style>
</head>
<body>

<div class="header">
  <h1>Blue Rose Auto — Meta Ads Market Research</h1>
  <div class="sub">Competitive intelligence across 7 service categories · US Market · Last 90 days</div>
  <div class="badge-row">
    <span class="badge">🔧 Mechanic</span>
    <span class="badge">🚗 Collision</span>
    <span class="badge">✨ Detailing</span>
    <span class="badge">🎨 Vehicle Wrap</span>
    <span class="badge">🪟 Window Tint</span>
    <span class="badge">💎 Ceramic Coating</span>
    <span class="badge">🛡️ PPF</span>
    <span class="badge">Generated {generated}</span>
  </div>
</div>

<div class="nav-bar">{nav}</div>

<div class="container">
  {sections}
  {strategy_cards}
</div>

<div class="footer">
  Data source: Meta Ad Library API · Generated {generated} · For strategic planning purposes only
</div>

</body>
</html>"""


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    reports_dir = Path("reports")
    if not reports_dir.exists():
        print("[ERROR] reports/ directory not found. Run meta_client.py first.")
        sys.exit(1)

    print("Analyzing categories...")
    results = []
    for cat_key, cat_info in CATEGORIES.items():
        print(f"  → {cat_info['label']}")
        result = analyze_category(cat_key, cat_info, reports_dir)
        results.append(result)

    generated = datetime.now(timezone.utc).strftime("%B %d, %Y")
    html = build_html(results, generated)

    out_path = reports_dir / "blue_rose_auto_market_research.html"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"\nReport saved to: {out_path}")

    import subprocess
    subprocess.run(["open", str(out_path)])


if __name__ == "__main__":
    main()
