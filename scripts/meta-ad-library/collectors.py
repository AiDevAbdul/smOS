#!/usr/bin/env python3
"""Deterministic public-surface scrapers for /pre-audit.

Three unauthenticated passes — Facebook Page, Instagram profile, and website
tracking surface — each returning a plain dict with an explicit ``status`` so a
blocked/absent fetch is data, never fabricated. Recipes (headers, endpoints,
regexes) are the canonical ones documented in
``skills/pre-audit/references/api-reference.md``.

These are pure functions (network in, dict out). ``collect.py`` orchestrates
them across the four passes; ``normalize.py`` flattens their output into the
long-format ``signals.csv``. Kept import-safe (no side effects at import) so the
suite can exercise the parsers on canned HTML/JSON.
"""
from __future__ import annotations

import re
from typing import Any

import requests

import tavily

FB_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
)
DESKTOP_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)
IG_APP_ID = "936619743392459"  # Instagram's stable public web app id
TIMEOUT = 20


def _status_from_code(code: int) -> str:
    return "ok" if code == 200 else f"blocked_{code}"


def _denum(raw: str | None) -> int | None:
    """Parse a follower/like count that may carry commas or K/M/B suffixes.

    ``"1,234"`` → 1234, ``"1.2M"`` → 1200000, ``"10.5k"`` → 10500.
    """
    if not raw:
        return None
    s = raw.strip().replace(",", "")
    mult = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}.get(s[-1:].lower())
    try:
        return int(round(float(s[:-1]) * mult)) if mult else int(round(float(s)))
    except ValueError:
        return None


# ── Pass 1a — Facebook Page ────────────────────────────────────────────────
def parse_facebook(html: str) -> dict[str, Any]:
    """Extract public signals from an ``m.facebook.com`` page's HTML."""
    def meta(prop: str) -> str | None:
        m = re.search(
            rf'<meta[^>]+property=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']*)["\']',
            html, re.I,
        )
        return m.group(1) if m else None

    og_desc = meta("og:description") or ""
    og_type = meta("og:type") or ""
    og_image = meta("og:image")

    def _grab(label: str) -> int | None:
        m = re.search(r"([\d,]+)\s+" + label, og_desc, re.I)
        return int(m.group(1).replace(",", "")) if m else None

    pid = re.search(r"fb://profile/(\d+)", html)
    return {
        "likes": _grab("likes?"),
        "talking_about": _grab("talking about"),
        "were_here": _grab("were here"),
        "has_profile_pic": bool(og_image),
        "latest_content_type": og_type or None,
        "verified": bool(re.search(r'"is_verified"\s*:\s*true|blue[_-]?verified', html, re.I)),
        "about": (og_desc.split(".", 2)[-1].strip() or None) if og_desc else None,
        "page_id": pid.group(1) if pid else None,
    }


def parse_facebook_text(text: str) -> dict[str, Any]:
    """Recover FB Page signals from Tavily-extracted text/markdown.

    Facebook's public description renders as ``… 1,234 likes · 56 talking about
    this · 7 were here …``. Unauthenticated markup (og: meta tags) is gone here,
    so only the counts + a coarse verified flag survive — everything else stays
    ``None`` rather than being invented.
    """
    def grab(label: str) -> int | None:
        m = re.search(r"([\d,]+)\s+" + label, text, re.I)
        return _denum(m.group(1)) if m else None

    return {
        "likes": grab("likes?"),
        "talking_about": grab("talking about"),
        "were_here": grab("were here"),
        "has_profile_pic": None,
        "latest_content_type": None,
        "verified": bool(re.search(r"verified account|blue[_-]?verified", text, re.I)),
        "about": None,
        "page_id": None,
    }


def _tavily_facebook(url: str, primary_status: str) -> dict[str, Any] | None:
    """Fallback FB pass via Tavily. Returns a parsed dict only if it recovers a
    real signal; otherwise ``None`` so the caller keeps the honest block."""
    if not tavily.available():
        return None
    text = tavily.extract_text(url) or tavily.search_text(
        f"{url} Facebook page likes", include_domains=["facebook.com"])
    if not text:
        return None
    parsed = parse_facebook_text(text)
    if parsed.get("likes") is None and parsed.get("talking_about") is None:
        return None  # nothing usable — don't mask the block
    return {"status": "ok", "url": url, "collected_via": "tavily",
            "primary_status": primary_status, **parsed}


def collect_facebook(handle_or_url: str) -> dict[str, Any]:
    handle = re.sub(r"^https?://[^/]*facebook\.com/", "", handle_or_url).strip("/").split("?")[0]
    url = f"https://m.facebook.com/{handle}?locale=en_US"
    try:
        r = requests.get(
            url,
            headers={"User-Agent": FB_UA, "Accept-Language": "en-US,en;q=0.9"},
            cookies={"locale": "en_US"}, timeout=TIMEOUT,
        )
        status = _status_from_code(r.status_code)
        text = r.text if r.status_code == 200 else None
    except requests.RequestException:
        status, text = "timeout", None
    if status == "ok" and text is not None:
        return {"status": "ok", "url": url, **parse_facebook(text)}
    return _tavily_facebook(url, status) or {"status": status, "url": url}


# ── Pass 1b — Instagram ────────────────────────────────────────────────────
def parse_instagram(payload: dict, *, now_ts: int) -> dict[str, Any]:
    """Reduce ``web_profile_info`` JSON to the signals the report needs.

    ``now_ts`` is the audit epoch (never wall-clock inside the parser) so
    posts/week + recency are reproducible.
    """
    user = (payload.get("data") or {}).get("user") or {}
    media = user.get("edge_owner_to_timeline_media") or {}
    edges = media.get("edges") or []
    stamps = sorted(
        (e.get("node", {}).get("taken_at_timestamp") for e in edges if e.get("node")),
        reverse=True,
    )
    stamps = [s for s in stamps if s]
    posts_per_week = recency_days = None
    if len(stamps) >= 2:
        span_days = max(1, (stamps[0] - stamps[-1]) / 86400)
        posts_per_week = round(len(stamps) / (span_days / 7), 1)
    if stamps:
        recency_days = max(0, round((now_ts - stamps[0]) / 86400))
    return {
        "handle": user.get("username"),
        "bio": user.get("biography") or None,
        "external_url": user.get("external_url") or None,
        "category_name": user.get("category_name") or None,
        "is_business_account": bool(user.get("is_business_account")),
        "is_verified": bool(user.get("is_verified")),
        "followers": (user.get("edge_followed_by") or {}).get("count"),
        "following": (user.get("edge_follow") or {}).get("count"),
        "posts_total": media.get("count"),
        "posts_per_week": posts_per_week,
        "recency_days": recency_days,
    }


def parse_instagram_text(text: str, handle: str | None = None) -> dict[str, Any]:
    """Recover IG profile signals from Tavily-extracted content.

    Instagram's public description renders as ``1.2M Followers, 340 Following,
    1,234 Posts - <name> (@handle) on Instagram: "<bio>"``. Per-post timestamps
    are unavailable through this path, so ``posts_per_week``/``recency_days``
    stay ``None`` — never fabricated.
    """
    def near(label: str) -> int | None:
        m = re.search(r"([\d.,]+\s*[KMB]?)\s+" + label, text, re.I)
        return _denum(m.group(1).replace(" ", "")) if m else None

    bio = None
    m = re.search(r'on Instagram:\s*["“](.+?)["”]', text)
    if m:
        bio = m.group(1).strip() or None

    return {
        "handle": handle,
        "bio": bio,
        "external_url": None,
        "category_name": None,
        "is_business_account": None,
        "is_verified": bool(re.search(r"verified", text, re.I)),
        "followers": near("Followers"),
        "following": near("Following"),
        "posts_total": near("Posts"),
        "posts_per_week": None,
        "recency_days": None,
    }


def _tavily_instagram(handle: str, primary_status: str) -> dict[str, Any] | None:
    if not tavily.available():
        return None
    profile_url = f"https://www.instagram.com/{handle}/"
    text = tavily.extract_text(profile_url) or tavily.search_text(
        f"instagram.com/{handle} followers", include_domains=["instagram.com"])
    if not text:
        return None
    parsed = parse_instagram_text(text, handle)
    if parsed.get("followers") is None and parsed.get("posts_total") is None:
        return None
    return {"status": "ok", "url": profile_url, "collected_via": "tavily",
            "primary_status": primary_status, **parsed}


def collect_instagram(handle: str, *, now_ts: int) -> dict[str, Any]:
    handle = re.sub(r"^https?://[^/]*instagram\.com/", "", handle or "").strip("/").split("?")[0]
    if not handle:
        return {"status": "not_found"}
    url = f"https://www.instagram.com/api/v1/users/web_profile_info/?username={handle}"
    try:
        r = requests.get(
            url, headers={"User-Agent": DESKTOP_UA, "X-IG-App-ID": IG_APP_ID}, timeout=TIMEOUT,
        )
        status = _status_from_code(r.status_code)
        payload = None
        if r.status_code == 200:
            try:
                payload = r.json()
            except ValueError:
                status = "blocked_200"  # 200 with non-JSON body = soft block
    except requests.RequestException:
        status, payload = "timeout", None
    if status == "ok" and payload is not None:
        return {"status": "ok", "url": url, **parse_instagram(payload, now_ts=now_ts)}
    return _tavily_instagram(handle, status) or {"status": status, "url": url}


# ── Pass 5 — Website tracking surface ──────────────────────────────────────
_PIXEL_ID = re.compile(r"fbq\(['\"]init['\"],\s*['\"](\d+)['\"]")
_GTM_ID = re.compile(r"googletagmanager\.com/gtm\.js|GTM-[A-Z0-9]{4,}|googletagmanager\.com/ns\.html")
_GTAG_ID = re.compile(r"googletagmanager\.com/gtag/js\?id=(GT-[A-Z0-9]+)")
_GA4_ID = re.compile(r"gtag/js\?id=(G-[A-Z0-9]+)")


def parse_website(html: str) -> dict[str, Any]:
    body = html[:120_000]
    pixel_installed = bool(re.search(r"fbq\(|fbevents\.js", body))
    pid = _PIXEL_ID.search(body)
    gtm_installed = bool(_GTM_ID.search(body))
    gtag = _GTAG_ID.search(body)
    ga4 = _GA4_ID.search(body)
    return {
        "meta_pixel": {"installed": pixel_installed, "id": pid.group(1) if pid else None},
        "gtm": {
            "installed": gtm_installed or bool(gtag),
            "id": gtag.group(1) if gtag else None,
        },
        "ga4": {"installed": bool(ga4), "id": ga4.group(1) if ga4 else None},
        "conversion_events": bool(
            re.search(r"gtag\(\s*['\"]event['\"]\s*,\s*['\"]purchase|ttq\.track|"
                      r"fbq\(\s*['\"]track['\"]\s*,\s*['\"]Purchase", body)
        ),
        "viewport_meta": bool(re.search(r'<meta[^>]+name=["\']viewport["\']', body, re.I)),
        "response_bytes": len(html.encode("utf-8", "ignore")),
        "external_scripts": len(re.findall(r"<script[^>]+src=", body, re.I)),
    }


def collect_website(url: str) -> dict[str, Any]:
    if not url:
        return {"status": "not_found"}
    if not re.match(r"^https?://", url):
        url = "https://" + url
    try:
        r = requests.get(
            url, headers={"User-Agent": DESKTOP_UA}, timeout=TIMEOUT, allow_redirects=True,
        )
    except requests.RequestException:
        return {"status": "timeout", "url": url}
    out: dict[str, Any] = {"status": _status_from_code(r.status_code), "url": r.url}
    if r.status_code == 200:
        out.update(parse_website(r.text))
    return out
