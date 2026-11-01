#!/usr/bin/env python3
"""
Aderyth Visual Asset Optimizer
Converts raw Gemini-generated PNG/JPEG images into center-cropped, Lanczos-resized,
metadata-stripped .webp assets under frontend/assets/images/.

Usage:
  1) Single asset:
     python tools/optimize-visual-assets.py --single <src_path> <dest_rel_under_assets_images> <width> <height> [quality]
  2) Batch JSON file (list of {"src": "...", "dest": "textures/tex-clay-grain.webp", "w": 512, "h": 512, "q": 82}):
     python tools/optimize-visual-assets.py --batch <batch.json>
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
ASSETS_IMAGES_DIR = REPO_ROOT / "frontend" / "assets" / "images"


def center_crop_to_aspect(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    src_w, src_h = img.size
    target_ratio = target_w / target_h
    src_ratio = src_w / src_h

    if abs(src_ratio - target_ratio) < 0.005:
        return img

    if src_ratio > target_ratio:
        # Source is wider than target -> crop width
        new_w = int(round(src_h * target_ratio))
        left = (src_w - new_w) // 2
        return img.crop((left, 0, left + new_w, src_h))
    else:
        # Source is taller than target -> crop height
        new_h = int(round(src_w / target_ratio))
        top = (src_h - new_h) // 2
        return img.crop((0, top, src_w, top + new_h))


def process_one(src: str, dest_rel: str, width: int, height: int, quality: int = 82) -> dict:
    src_path = Path(src)
    if not src_path.exists():
        raise FileNotFoundError(f"Missing source image: {src_path}")

    dest_path = ASSETS_IMAGES_DIR / dest_rel
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(src_path) as im:
        rgb = im.convert("RGB")
        cropped = center_crop_to_aspect(rgb, width, height)
        resized = cropped.resize((width, height), Image.Resampling.LANCZOS)
        resized.save(dest_path, format="WEBP", quality=quality, method=6)

    kb = round(os.path.getsize(dest_path) / 1024, 1)
    print(f"[OK] {dest_rel} ({width}x{height}) -> {kb} KB")
    return {"dest": dest_rel, "kb": kb, "w": width, "h": height}


def main() -> None:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)

    if args[0] == "--single":
        src, dest_rel, w, h = args[1], args[2], int(args[3]), int(args[4])
        q = int(args[5]) if len(args) > 5 else 82
        process_one(src, dest_rel, w, h, q)
    elif args[0] == "--batch":
        batch_path = Path(args[1])
        items = json.loads(batch_path.read_text(encoding="utf-8"))
        total_kb = 0.0
        for item in items:
            res = process_one(
                item["src"],
                item["dest"],
                int(item["w"]),
                int(item["h"]),
                int(item.get("q", 82)),
            )
            total_kb += res["kb"]
        print(f"--- Batch complete: {len(items)} assets, {round(total_kb, 1)} KB total ---")
    else:
        raise ValueError(f"Unknown flag: {args[0]}")


if __name__ == "__main__":
    main()

