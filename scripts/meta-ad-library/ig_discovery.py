#!/usr/bin/env python3
"""Pull a public Instagram business/creator account's organic metrics via the
Instagram Graph API **Business Discovery** endpoint — the correct, ToS-compliant
way to read a prospect's IG we do not manage.

Why not scrape web_profile_info? Instagram soft-blocks anonymous
`/api/v1/users/web_profile_info/` (HTTP 404 for many handles regardless of
existence), so it is unreliable for a sales artifact. Business Discovery reads
followers_count, media_count and recent media (per-post like/comment counts,
media_product_type) for any *public business/creator* account, using one of our
own IG business accounts as the caller.

Requires the app to hold `instagram_basic` with Advanced Access (App Review). If
it does not yet, this returns fetch_status="blocked_app_permission" (code 10) so
the pipeline degrades honestly instead of fabricating organic numbers.

Output: the `instagram` sub-object for page_audit.json, printed as JSON.

Usage:
  python ig_discovery.py --handle baworksofficial [--audit-date 2026-07-15]
  python ig_discovery.py --handle baworksofficial --ig-user-id 17841...
"""
import argparse, json, os, sys
from datetime import datetime, timezone
from pathlib import Path
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from load_env import load_env  # noqa: E402
load_env()

GRAPH = "https://graph.facebook.com/v25.0"


def find_ig_user_id(token: str) -> str | None:
    """Return the first IG business account id linked to a Page on this token."""
    try:
        r = requests.get(f"{GRAPH}/me/accounts", params={
            "access_token": token,
            "fields": "instagram_business_account{id,username}",
            "limit": 100,
        }, timeout=30).json()
    except requests.RequestException:
        return None
    for p in r.get("data", []):
        iba = p.get("instagram_business_account")
        if iba and iba.get("id"):
            return iba["id"]
    return None


def public_web_profile(handle: str, audit_dt: datetime) -> dict:
    """Fallback: public web_profile_info (no token). Works for many public
    accounts even without App Review; Instagram soft-blocks some handles with a
    404 regardless of existence, so this is best-effort, not authoritative.
    Primes a guest session first (csrftoken cookie) to reduce soft-blocking.
    """
    handle = handle.lstrip("@")
    out = {"fetch_status": "blocked", "handle": handle, "engagement_rate": None,
           "format_mix": {}, "posts_per_week": None, "followers": None, "bio": ""}
    ua = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36")
    s = requests.Session()
    s.headers.update({"User-Agent": ua})
    try:
        s.get("https://www.instagram.com/", timeout=15)  # prime csrftoken/mid
        csrf = s.cookies.get("csrftoken", "")
        r = s.get("https://www.instagram.com/api/v1/users/web_profile_info/",
                  params={"username": handle},
                  headers={"X-IG-App-ID": "936619743392459", "X-CSRFToken": csrf,
                           "X-Requested-With": "XMLHttpRequest",
                           "Referer": f"https://www.instagram.com/{handle}/"},
                  timeout=20)
    except requests.RequestException as e:
        out["note"] = f"web_profile_info request failed: {e}"; return out

    if r.status_code != 200:
        out["fetch_status"] = f"blocked_{r.status_code}"
        out["note"] = (f"Public web_profile_info returned HTTP {r.status_code} for "
                       f"@{handle} (Instagram soft-blocks anonymous lookups; the "
                       "handle may also be wrong or nonexistent).")
        return out
    try:
        u = (r.json().get("data") or {}).get("user")
    except ValueError:
        out["note"] = "web_profile_info returned non-JSON body."; return out
    if not u:
        out["fetch_status"] = "not_found"; out["note"] = "No user object."; return out

    out["fetch_status"] = "ok_public"
    out["followers"] = u.get("edge_followed_by", {}).get("count")
    out["following"] = u.get("edge_follow", {}).get("count")
    out["posts_total"] = u.get("edge_owner_to_timeline_media", {}).get("count")
    out["is_business_account"] = u.get("is_business_account")
    out["is_verified"] = u.get("is_verified")
    out["category_name"] = u.get("category_name")
    out["bio"] = (u.get("biography") or "")[:200]
    out["external_url"] = u.get("external_url")
    edges = u.get("edge_owner_to_timeline_media", {}).get("edges", [])
    ts, eng, fmt = [], [], {}
    for e in edges:
        n = e.get("node", {})
        t = n.get("taken_at_timestamp")
        if t:
            ts.append(datetime.fromtimestamp(t, tz=timezone.utc))
        eng.append((n.get("edge_liked_by", {}).get("count") or 0)
                   + (n.get("edge_media_to_comment", {}).get("count") or 0))
        tn = n.get("__typename", "")
        prod = n.get("product_type", "")
        if prod == "clips":
            key = "Reels"
        elif tn == "GraphSidecar":
            key = "Carousel"
        elif tn == "GraphVideo":
            key = "Video"
        elif tn == "GraphImage":
            key = "Image"
        else:
            key = "Other"
        fmt[key] = fmt.get(key, 0) + 1
    followers = out["followers"]
    if edges:
        weeks = _weeks_span(ts, audit_dt) if ts else 1.0
        out["posts_per_week"] = round(len(edges) / weeks, 1)
        out["format_mix"] = fmt
        if ts:
            out["recency_days"] = (audit_dt - max(ts)).days
        if followers and followers > 0:
            out["engagement_rate"] = round(100.0 * (sum(eng) / len(eng)) / followers, 2)
    return out


def _weeks_span(timestamps: list[datetime], audit_dt: datetime) -> float:
    if not timestamps:
        return 0.0
    span_days = (audit_dt - min(timestamps)).days
    return max(span_days / 7.0, 1.0)


def discover(handle: str, ig_user_id: str, token: str, audit_dt: datetime) -> dict:
    handle = handle.lstrip("@")
    fields = (
        f"business_discovery.username({handle}){{"
        "username,name,followers_count,follows_count,media_count,biography,website,"
        "media.limit(30){media_product_type,media_type,like_count,comments_count,timestamp}}"
    )
    out = {"fetch_status": "ok", "handle": handle, "engagement_rate": None,
           "format_mix": {}, "posts_per_week": None, "followers": None, "bio": ""}
    try:
        r = requests.get(f"{GRAPH}/{ig_user_id}",
                         params={"access_token": token, "fields": fields}, timeout=30)
        d = r.json()
    except requests.RequestException as e:
        out["fetch_status"] = "timeout"; out["note"] = str(e); return out

    if "error" in d:
        err = d["error"]; code = err.get("code")
        if code == 10:
            out["fetch_status"] = "blocked_app_permission"
            out["note"] = ("Instagram Business Discovery requires the app to hold "
                           "instagram_basic with Advanced Access (App Review). "
                           "Grant it once at the agency level, then organic metrics "
                           "populate automatically. Meta error: " + err.get("message", ""))
        elif code == 100:
            out["fetch_status"] = "not_found"
            out["note"] = (f"Instagram Business Discovery could not resolve @{handle} "
                           "— the account is not a public business/creator account, "
                           "the handle is wrong, or it does not exist. Meta error: "
                           + err.get("message", ""))
        else:
            out["fetch_status"] = f"error_{code}"
            out["note"] = err.get("message", "")
        return out

    bd = d.get("business_discovery", {})
    if not bd:
        out["fetch_status"] = "not_found"
        out["note"] = "No business_discovery payload returned."
        return out

    followers = bd.get("followers_count")
    out["followers"] = followers
    out["following"] = bd.get("follows_count")
    out["posts_total"] = bd.get("media_count")
    out["bio"] = (bd.get("biography") or "")[:200]
    out["external_url"] = bd.get("website")

    media = bd.get("media", {}).get("data", [])
    ts, eng, fmt = [], [], {}
    for m in media:
        t = m.get("timestamp")
        if t:
            try:
                ts.append(datetime.fromisoformat(t.replace("+0000", "+00:00")))
            except ValueError:
                pass
        likes = m.get("like_count") or 0
        comments = m.get("comments_count") or 0
        eng.append(likes + comments)
        # media_product_type: FEED / REELS / STORY / IGTV; media_type: IMAGE/VIDEO/CAROUSEL_ALBUM
        mpt = m.get("media_product_type") or ""
        mt = m.get("media_type") or ""
        if mpt == "REELS":
            key = "Reels"
        elif mt == "CAROUSEL_ALBUM":
            key = "Carousel"
        elif mt == "VIDEO":
            key = "Video"
        elif mt == "IMAGE":
            key = "Image"
        else:
            key = mpt or mt or "Other"
        fmt[key] = fmt.get(key, 0) + 1

    if media:
        weeks = _weeks_span(ts, audit_dt) if ts else 1.0
        out["posts_per_week"] = round(len(media) / weeks, 1)
        out["format_mix"] = fmt
        if ts:
            out["recency_days"] = (audit_dt - max(ts)).days
        if followers and followers > 0:
            avg_eng = sum(eng) / len(eng)
            out["engagement_rate"] = round(100.0 * avg_eng / followers, 2)
    out["is_business_account"] = True
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--handle", required=True)
    ap.add_argument("--ig-user-id", default=None,
                    help="Caller IG business account id (auto-discovered if omitted)")
    ap.add_argument("--audit-date", default=None, help="YYYY-MM-DD (default: today UTC)")
    ap.add_argument("--output", default=None, help="Write JSON here (else stdout)")
    a = ap.parse_args()

    token = os.environ.get("META_ACCESS_TOKEN")
    if not token:
        sys.exit("META_ACCESS_TOKEN not set")
    audit_dt = (datetime.strptime(a.audit_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                if a.audit_date else datetime.now(timezone.utc))

    # Prefer Business Discovery (authoritative, ToS-compliant). If the app lacks
    # the permission (code 10) or has no caller IG account, fall back to the
    # public web_profile_info endpoint so organic data is still collected today.
    ig_user_id = a.ig_user_id or find_ig_user_id(token)
    if ig_user_id:
        result = discover(a.handle, ig_user_id, token, audit_dt)
    else:
        result = {"fetch_status": "no_caller_ig", "handle": a.handle.lstrip("@"),
                  "note": "No IG business account linked to any Page on this token."}

    if result.get("fetch_status") not in ("ok",):
        primary = result
        fallback = public_web_profile(a.handle, audit_dt)
        if fallback.get("fetch_status") in ("ok_public",):
            fallback["note"] = ("Business Discovery unavailable (%s); metrics from "
                                "public web_profile_info instead." % primary.get("fetch_status"))
            result = fallback
        else:
            # keep the more informative of the two notes
            result["fallback_status"] = fallback.get("fetch_status")
            if fallback.get("note"):
                result["note"] = (result.get("note", "") + " | Public fallback: "
                                  + fallback["note"]).strip(" |")

    text = json.dumps(result, ensure_ascii=False, indent=2)
    if a.output:
        Path(a.output).parent.mkdir(parents=True, exist_ok=True)
        Path(a.output).write_text(text, encoding="utf-8")
        print(f"IG discovery ({result['fetch_status']}) -> {a.output}")
    else:
        print(text)


if __name__ == "__main__":
    main()
