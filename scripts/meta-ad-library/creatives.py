#!/usr/bin/env python3
"""Download ad creative assets (images, video posters) from raw Ad Library data.

Saves to <out_dir>/<competitor>/<ad_id>.{jpg,mp4,html} so /audit-creative has real files
to reference instead of dead snapshot URLs.
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

IMG_PAT = re.compile(r'"(https://[^"]+?\.(?:jpg|jpeg|png|webp))"')
VIDEO_PAT = re.compile(r'"(https://[^"]+?\.mp4[^"]*)"')


def _safe(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", name)[:80] or "competitor"


def download_for_ad(ad: dict, dest: Path, save_html: bool = False) -> dict:
    """Fetch snapshot URL, extract first image + first video. Return manifest entry."""
    ad_id = ad.get("id") or "unknown"
    snapshot = ad.get("ad_snapshot_url")
    if not snapshot:
        return {"ad_id": ad_id, "status": "no_snapshot_url"}

    try:
        resp = requests.get(snapshot, headers={"User-Agent": UA}, timeout=20)
    except requests.RequestException as e:
        return {"ad_id": ad_id, "status": "fetch_failed", "error": str(e)}

    if resp.status_code != 200:
        return {"ad_id": ad_id, "status": f"http_{resp.status_code}"}

    html = resp.text
    entry: dict = {"ad_id": ad_id, "status": "ok", "files": []}

    if save_html:
        html_path = dest / f"{ad_id}.html"
        html_path.write_text(html)
        entry["files"].append(str(html_path))

    img_m = IMG_PAT.search(html)
    vid_m = VIDEO_PAT.search(html)

    for tag, match, ext in (("image", img_m, "jpg"), ("video", vid_m, "mp4")):
        if not match:
            continue
        url = match.group(1).replace("\\/", "/")
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=30, stream=True)
            if r.status_code != 200:
                continue
            path = dest / f"{ad_id}.{ext}"
            with open(path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)
            entry["files"].append(str(path))
            entry[tag] = str(path)
        except requests.RequestException:
            continue

    if not entry["files"]:
        entry["status"] = "no_assets_found"
    return entry


def download_all(raw_path: str, out_dir: str, limit_per_competitor: int = 20, save_html: bool = False) -> dict:
    raw = json.loads(Path(raw_path).read_text())
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    manifest: dict = {"raw_source": raw_path, "competitors": {}}

    for competitor, ads in raw.get("data", {}).items():
        slug = _safe(competitor)
        comp_dir = out / slug
        comp_dir.mkdir(exist_ok=True)
        print(f"\nDownloading {min(len(ads), limit_per_competitor)} creatives for: {competitor}")
        entries = []
        for ad in ads[:limit_per_competitor]:
            entry = download_for_ad(ad, comp_dir, save_html=save_html)
            entries.append(entry)
            status = entry["status"]
            files = len(entry.get("files", []))
            print(f"  · {entry['ad_id'][:20]:20} {status:20} {files} file(s)")
            time.sleep(0.3)
        manifest["competitors"][competitor] = entries

    manifest_path = out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"\nManifest: {manifest_path}")
    return manifest


def main():
    parser = argparse.ArgumentParser(description="Download Meta Ad Library creatives")
    parser.add_argument("--input", required=True, help="raw_*.json from client.py")
    parser.add_argument("--out", required=True, help="Output directory (e.g. clients/foo/swipe/)")
    parser.add_argument("--limit", type=int, default=20, help="Max ads per competitor (default 20)")
    parser.add_argument("--save-html", action="store_true", help="Also save snapshot HTML for archival")
    args = parser.parse_args()
    download_all(args.input, args.out, args.limit, args.save_html)


if __name__ == "__main__":
    main()
