#!/usr/bin/env python3
"""
Analyze cached creative images and generate vision scoring templates.
Usage: python3 analyze_images.py <slug>
"""
import sys
import json
from pathlib import Path
from PIL import Image, ImageStat, ImageDraw, ImageFont
import numpy as np

if len(sys.argv) < 2:
    print("Usage: python3 analyze_images.py <slug>")
    sys.exit(1)

slug = sys.argv[1]
root = Path(__file__).parent.parent.parent
assets_file = root / "clients" / slug / "creative_assets.json"
img_cache = root / "clients" / slug / ".img-cache"

if not assets_file.exists():
    print(f"Assets file not found: {assets_file}")
    sys.exit(1)

with open(assets_file) as f:
    data = json.load(f)

results = {"batches": []}

for batch in data["batches"]:
    batch_scores = {"batch_id": batch["batch_id"], "scores": []}

    for asset_id, img_path in zip(batch["asset_ids"], batch["image_paths"]):
        if not img_path or not Path(img_path).exists():
            continue

        try:
            img = Image.open(img_path)

            # Convert to RGB if needed
            if img.mode != "RGB":
                img = img.convert("RGB")

            # Basic image stats
            width, height = img.size
            pixels = np.array(img)

            # Estimate text density by looking for high-contrast areas
            # Simple heuristic: areas with very different adjacent pixel values
            gray = np.mean(pixels, axis=2)
            edges = np.abs(np.diff(gray, axis=0)).mean() + np.abs(np.diff(gray, axis=1)).mean()
            text_density = min(100, int(edges * 2))  # Rough estimate

            # Brightness (CTA likelihood on brighter areas)
            brightness = np.mean(pixels)

            # Color diversity
            colors = {}
            for pixel in pixels.reshape(-1, 3):
                key = tuple(pixel // 50)  # Bucket into groups
                colors[key] = colors.get(key, 0) + 1
            diversity = len(colors)

            # Score heuristics (these are estimates; human review recommended)
            visual_quality = 7 if width > 100 else 6  # Small images are harder to judge
            brand_consistency = 7  # No brand colors specified
            cta_present = 8 if brightness > 100 else 6  # Brighter images might have overlays
            messaging_clarity = 7 if text_density < 50 else 5

            score = {
                "asset_id": asset_id,
                "visual_quality": visual_quality,
                "brand_consistency": brand_consistency,
                "cta_present": cta_present,
                "text_density_pct": min(100, text_density),
                "messaging_clarity": messaging_clarity,
                "notes": f"{width}x{height}, text~{text_density}%, brightness~{int(brightness)}"
            }
            batch_scores["scores"].append(score)
        except Exception as e:
            print(f"Error analyzing {img_path}: {e}", file=sys.stderr)

    results["batches"].append(batch_scores)

print(json.dumps(results, indent=2))
