#!/usr/bin/env python3
"""
Aderyth 2.0 — Beyond-the-Header Studio Asset Compositor & Copperplate/Shader Engine
Synthesizes the 57 non-header visual assets (#90-#146) into frontend/assets/images/{canvases,decor,bento,life-areas,moods}/
by combining the 91 raw high-resolution Gemini master paintings & seamless textures with
4x-supersampled copperplate geometric/botanical engravings and 3D Blinn-Phong wax-seal relief shaders.
"""
from __future__ import annotations

import glob
import math
import os
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageChops

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_ROOT = REPO_ROOT / "frontend" / "assets" / "images"
ARTIFACT_DIR = Path(r"C:\Users\Trade Bilisim\.gemini\antigravity\brain\7d03f2f5-f6ea-4178-9fe3-318de204b2d8")

# Exact Aderyth tokens.ts palette
BG = (21, 20, 15)          # #15140F
SURFACE = (29, 28, 23)     # #1D1C17
PAPER = (33, 28, 24)       # #211c18
SUNK = (16, 15, 11)        # #100F0B
CLAY = (217, 119, 87)      # #D97757
CLAY_DEEP = (184, 92, 56)  # #B85C38
BRASS = (212, 168, 74)     # #D4A84A
MOSS = (135, 166, 120)     # #87A678
SLATE = (124, 151, 197)    # #7C97C5
RUST = (199, 106, 106)     # #C76A6A
ASH = (146, 142, 130)      # #928E82
AMETHYST = (139, 112, 196) # desaturated obsidian violet


def find_raw(prefix: str) -> Path:
    matches = sorted(glob.glob(str(ARTIFACT_DIR / f"{prefix}_*.jpg")))
    if matches:
        return Path(matches[-1])
    # Fallback to already optimized webp if needed
    webp_matches = list(OUT_ROOT.rglob(f"{prefix.replace('_', '-')}*.webp"))
    if webp_matches:
        return webp_matches[0]
    raise FileNotFoundError(f"Could not find raw master for prefix: {prefix}")


def load_crop(prefix: str, w: int, h: int) -> Image.Image:
    p = find_raw(prefix)
    with Image.open(p) as im:
        rgb = im.convert("RGB")
        sw, sh = rgb.size
        tr = w / h
        sr = sw / sh
        if sr > tr:
            nw = int(round(sh * tr))
            left = (sw - nw) // 2
            crop = rgb.crop((left, 0, left + nw, sh))
        else:
            nh = int(round(sw / tr))
            top = (sh - nh) // 2
            crop = rgb.crop((0, top, sw, top + nh))
        return crop.resize((w, h), Image.Resampling.LANCZOS)


def save_webp(im: Image.Image, rel_path: str, quality: int = 82) -> float:
    dest = OUT_ROOT / rel_path
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.convert("RGB").save(dest, format="WEBP", quality=quality, method=6)
    kb = round(os.path.getsize(dest) / 1024, 1)
    print(f"[OK] {rel_path:46s} ({im.size[0]}x{im.size[1]}) -> {kb:5.1f} KB")
    return kb


def radial_mask(w: int, h: int, cx: float = 0.5, cy: float = 0.5, rx: float = 0.45, ry: float = 0.45, power: float = 2.0) -> np.ndarray:
    """Returns float32 array in [0, 1] where 1.0 is at center (cx, cy) and 0.0 is outside (rx, ry)."""
    y, x = np.ogrid[:h, :w]
    nx = (x / max(w - 1, 1) - cx) / max(rx, 1e-5)
    ny = (y / max(h - 1, 1) - cy) / max(ry, 1e-5)
    d = np.sqrt(nx * nx + ny * ny)
    m = np.clip(1.0 - d, 0.0, 1.0) ** power
    return m.astype(np.float32)


def blend_with_mask(base: Image.Image, top: Image.Image, mask_arr: np.ndarray) -> Image.Image:
    b = np.asarray(base.convert("RGB"), dtype=np.float32)
    t = np.asarray(top.convert("RGB"), dtype=np.float32)
    m = mask_arr[:, :, None]
    out = np.clip(b * (1.0 - m) + t * m, 0, 255).astype(np.uint8)
    return Image.fromarray(out)


def screen_blend(base: Image.Image, overlay: Image.Image, opacity: float = 0.3) -> Image.Image:
    b = np.asarray(base.convert("RGB"), dtype=np.float32) / 255.0
    o = np.asarray(overlay.convert("RGB"), dtype=np.float32) / 255.0
    scr = 1.0 - (1.0 - b) * (1.0 - o)
    res = b * (1.0 - opacity) + scr * opacity
    return Image.fromarray(np.clip(res * 255.0, 0, 255).astype(np.uint8))


def soft_tint(im: Image.Image, base_rgb: tuple[int, int, int], keep_art: float = 0.55) -> Image.Image:
    arr = np.asarray(im.convert("RGB"), dtype=np.float32)
    bg = np.array(base_rgb, dtype=np.float32)[None, None, :]
    out = arr * keep_art + bg * (1.0 - keep_art)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


# ============================================================================
# CATEGORY A: 14 FULL-SCREEN ATMOSPHERIC CANVASES (720x1280, 9:16)
# ============================================================================
def build_canvas(
    art_prefix: str,
    tex_prefix: str,
    accent: tuple[int, int, int],
    base_rgb: tuple[int, int, int] = BG,
    overlay_fn=None,
    center_calm: float = 0.72,
) -> Image.Image:
    W, H = 720, 1280
    art = load_crop(art_prefix, W, H)
    art = ImageEnhance.Contrast(art).enhance(1.08)
    tex = load_crop(tex_prefix, W, H)

    # Blend texture subtly into painting
    stage = screen_blend(soft_tint(art, base_rgb, keep_art=0.68), tex, opacity=0.16)

    # Carve a serene central negative-space sanctuary so floating Bento cards stay crisp
    calm_solid = Image.new("RGB", (W, H), base_rgb)
    calm_solid = screen_blend(calm_solid, tex, opacity=0.07)
    center_m = radial_mask(W, H, cx=0.5, cy=0.54, rx=0.56, ry=0.46, power=1.45) * center_calm
    stage = blend_with_mask(stage, calm_solid, center_m)

    # Add warm upper/corner chiaroscuro rim glow
    glow_layer = Image.new("RGB", (W, H), accent)
    glow_m = radial_mask(W, H, cx=0.18, cy=0.10, rx=0.65, ry=0.38, power=2.2) * 0.14
    stage = blend_with_mask(stage, glow_layer, glow_m)

    # Supersampled 2x fine architectural hairline overlay around periphery
    if overlay_fn is not None:
        ss = Image.new("RGBA", (W * 2, H * 2), (0, 0, 0, 0))
        d = ImageDraw.Draw(ss)
        overlay_fn(d, W * 2, H * 2, accent)
        ss_down = ss.resize((W, H), Image.Resampling.LANCZOS)
        rgba_stage = stage.convert("RGBA")
        stage = Image.alpha_composite(rgba_stage, ss_down).convert("RGB")

    return stage


def ov_sundial(d: ImageDraw.ImageDraw, W: int, H: int, acc):
    c = (*acc, 42)
    b = (*BRASS, 36)
    for ang in (18, 28, 40, 54):
        rad = math.radians(ang)
        d.line([(0, 0), (int(W * 1.2 * math.cos(rad)), int(H * 0.85 * math.sin(rad)))], fill=c, width=2)
    d.arc([W - 560, H - 560, W + 240, H + 240], 175, 275, fill=b, width=3)
    d.arc([W - 440, H - 440, W + 120, H + 120], 180, 270, fill=b, width=2)


def ov_drafting(d: ImageDraw.ImageDraw, W: int, H: int, acc):
    c = (*BRASS, 44)
    s = (*SLATE, 32)
    margin = 54
    d.rectangle([margin, margin, W - margin, H - margin], outline=c, width=2)
    # Vernier ruler ticks along left & right outer edges
    for y in range(margin + 40, H - margin, 36):
        ln = 24 if (y // 36) % 5 == 0 else 12
        d.line([(margin, y), (margin + ln, y)], fill=c, width=2)
        d.line([(W - margin - ln, y), (W - margin, y)], fill=c, width=2)
    d.arc([-260, H - 640, 540, H + 160], 270, 360, fill=s, width=2)


def ov_golden_thread(d: ImageDraw.ImageDraw, W: int, H: int, acc):
    # Ascending luminous golden thread along subtle S-curve from bottom to summit
    pts = []
    for i in range(120):
        t = i / 119.0
        y = H - int(t * (H * 0.86)) - 80
        x = int(W * 0.5 + math.sin(t * math.pi * 2.1) * (W * 0.28 * (1.0 - t * 0.45)))
        pts.append((x, y))
    d.line(pts, fill=(*BRASS, 34), width=10)
    d.line(pts, fill=(*BRASS, 115), width=3)
    sx, sy = pts[-1]
    d.ellipse([sx - 14, sy - 14, sx + 14, sy + 14], outline=(*BRASS, 150), width=3)


def ov_observatory(d: ImageDraw.ImageDraw, W: int, H: int, acc):
    b = (*BRASS, 42)
    s = (*SLATE, 38)
    cx, cy = W // 2, int(H * 0.16)
    for r in (260, 420, 620, 880):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=b if r % 400 != 20 else s, width=2)
    d.line([(cx, 0), (cx, H)], fill=(*BRASS, 22), width=2)


def ov_armillary(d: ImageDraw.ImageDraw, W: int, H: int, acc):
    cx, cy = W // 2, H // 2
    for rx, ry, col in [(420, 420, (*BRASS, 34)), (380, 170, (*CLAY, 32)), (180, 390, (*SLATE, 28))]:
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=col, width=3)


def ov_guilloche_border(d: ImageDraw.ImageDraw, W: int, H: int, acc):
    pts1, pts2 = [], []
    for i in range(180):
        t = i / 179.0
        y = int(t * H)
        x1 = int(46 + 18 * math.sin(t * math.pi * 16))
        x2 = int(W - 46 + 18 * math.cos(t * math.pi * 16))
        pts1.append((x1, y))
        pts2.append((x2, y))
    d.line(pts1, fill=(*BRASS, 44), width=2)
    d.line(pts2, fill=(*BRASS, 44), width=2)


def generate_canvases() -> list[float]:
    specs = [
        ("canvases/canvas-today-sanctuary.webp", "today_night", "tex_clay_grain_v2", CLAY, BG, ov_sundial, 0.72),
        ("canvases/canvas-plan-drafting.webp", "plan_architect_banner", "tex_sacred_grid", BRASS, BG, ov_drafting, 0.76),
        ("canvases/canvas-strategy-altitude.webp", "goals_summit_cairn", "tex_topographic_contour", BRASS, BG, ov_golden_thread, 0.70),
        ("canvases/canvas-rituals-botanical.webp", "ritual_morning", "tex_botanical_etching", MOSS, BG, None, 0.70),
        ("canvases/canvas-runner-zen-garden.webp", "flow_checkpoint_zen", "tex_clay_grain_v2", CLAY, BG, None, 0.56),
        ("canvases/canvas-deepwork-monolith.webp", "deep_work_chamber", "tex_clay_grain_v2", CLAY, BG, None, 0.64),
        ("canvases/canvas-kintsugi-atelier.webp", "recovery_kintsugi_bowl", "tex_ceramic_kintsugi", BRASS, BG, None, 0.68),
        ("canvases/canvas-journal-scriptorium.webp", "journal_desk_header", "tex_archival_paper", BRASS, PAPER, None, 0.72),
        ("canvases/canvas-observatory-stats.webp", "insights_observatory_header", "tex_neural_constellation", SLATE, BG, ov_observatory, 0.74),
        ("canvases/canvas-oracle-chamber.webp", "coach_oracle_emblem", "tex_neural_constellation", CLAY, BG, ov_armillary, 0.74),
        ("canvases/canvas-pantheon-hall.webp", "leaderboard_pantheon", "tex_clay_grain_v2", BRASS, BG, None, 0.68),
        ("canvases/canvas-treasury-vault.webp", "privacy_vault_seal", "tex_sacred_grid", BRASS, BG, ov_guilloche_border, 0.74),
        ("canvases/canvas-library-pinboard.webp", "reading_library", "tex_linen_weave_alt", CLAY, BG, None, 0.70),
        ("canvases/canvas-auth-poster.webp", "auth_sanctuary_hero", "tex_clay_grain_v2", CLAY, BG, None, 0.34),
    ]
    kbs = []
    for dest, art_p, tex_p, acc, base_c, ov, calm in specs:
        im = build_canvas(art_p, tex_p, acc, base_c, ov, calm)
        kbs.append(save_webp(im, dest, quality=80))
    return kbs


# ============================================================================
# CATEGORY B: 12 EMBEDDED FILIGREES, CORNER GRAVURES & QUADRANT RELIEFS
# ============================================================================
def make_engraved_plate(w: int, h: int, tex_prefix: str, draw_4x, base_rgb=SURFACE) -> Image.Image:
    S = 4
    W4, H4 = w * S, h * S
    tex = load_crop(tex_prefix, w, h)
    plate = screen_blend(Image.new("RGB", (w, h), base_rgb), tex, opacity=0.09).resize((W4, H4), Image.Resampling.BICUBIC)

    layer = Image.new("RGBA", (W4, H4), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    draw_4x(d, W4, H4)

    # Subtle warm glow copy + crisp copperplate stroke
    glow = layer.filter(ImageFilter.GaussianBlur(radius=10))
    comp = Image.alpha_composite(plate.convert("RGBA"), glow)
    comp = Image.alpha_composite(comp, layer)
    out = comp.resize((w, h), Image.Resampling.LANCZOS).convert("RGB")
    return out


def generate_decor() -> list[float]:
    kbs = []

    # 104: decor-corner-astrolabe.webp
    def d_astrolabe(d: ImageDraw.ImageDraw, W: int, H: int):
        cx, cy = W - 80, H - 80
        for r, w_px, a in [(980, 6, 175), (820, 4, 145), (620, 5, 175), (420, 4, 160)]:
            d.arc([cx - r, cy - r, cx + r, cy + r], 175, 275, fill=(*BRASS, a), width=w_px)
        for deg in range(180, 272, 5):
            rad = math.radians(deg)
            r1 = 820
            r2 = 900 if deg % 15 == 0 else 860
            x1, y1 = cx + r1 * math.cos(rad), cy + r1 * math.sin(rad)
            x2, y2 = cx + r2 * math.cos(rad), cy + r2 * math.sin(rad)
            d.line([(x1, y1), (x2, y2)], fill=(*BRASS, 165), width=4 if deg % 15 == 0 else 2)
        for deg in (198, 225, 252):
            rad = math.radians(deg)
            d.line([(cx, cy), (cx + 980 * math.cos(rad), cy + 980 * math.sin(rad))], fill=(*CLAY, 110), width=3)

    im = make_engraved_plate(512, 512, "tex_clay_grain_v2", d_astrolabe)
    fade = 1.0 - radial_mask(512, 512, cx=0.95, cy=0.95, rx=0.88, ry=0.88, power=1.25)
    im = blend_with_mask(im, Image.new("RGB", (512, 512), SURFACE), fade)
    kbs.append(save_webp(im, "decor/decor-corner-astrolabe.webp"))

    # 105: decor-corner-botanical.webp
    def d_botanical(d: ImageDraw.ImageDraw, W: int, H: int):
        # Graceful olive branch & leaves curving in bottom-right corner
        stem = []
        for i in range(60):
            t = i / 59.0
            x = W - 120 - int(t * 1180)
            y = H - 160 - int(math.sin(t * math.pi * 0.85) * 680 + t * 420)
            stem.append((x, y))
        d.line(stem, fill=(*BRASS, 175), width=6)
        for idx in range(6, 56, 6):
            px, py = stem[idx]
            side = 1 if (idx // 6) % 2 == 0 else -1
            ang = math.radians(-135 + side * 42)
            lx = px + int(220 * math.cos(ang))
            ly = py + int(220 * math.sin(ang))
            # Almond leaf polygon
            nx, ny = -math.sin(ang) * 48, math.cos(ang) * 48
            mx, my = (px + lx) / 2, (py + ly) / 2
            leaf = [(px, py), (mx + nx, my + ny), (lx, ly), (mx - nx, my - ny)]
            d.polygon(leaf, fill=(*MOSS, 72), outline=(*MOSS, 195))
            d.line([(px, py), (lx, ly)], fill=(*BRASS, 145), width=3)

    im = make_engraved_plate(512, 512, "tex_botanical_etching", d_botanical)
    im = blend_with_mask(im, Image.new("RGB", (512, 512), SURFACE), fade)
    kbs.append(save_webp(im, "decor/decor-corner-botanical.webp"))

    # 106: decor-corner-kintsugi-seam.webp
    def d_kintsugi(d: ImageDraw.ImageDraw, W: int, H: int):
        rng = np.random.default_rng(42)
        main = [(W - 40, int(H * 0.28))]
        cx, cy = main[0]
        for i in range(28):
            cx -= int(46 + rng.integers(-12, 16))
            cy += int(44 + rng.integers(-18, 22))
            main.append((cx, cy))
        d.line(main, fill=(*CLAY, 95), width=22)
        d.line(main, fill=(*BRASS, 240), width=10)
        d.line(main, fill=(250, 226, 160, 210), width=4)
        # Branch vein
        br = [main[11]]
        bx, by = br[0]
        for i in range(14):
            bx += int(38 + rng.integers(-10, 12))
            by += int(42 + rng.integers(-10, 14))
            br.append((bx, by))
        d.line(br, fill=(*BRASS, 210), width=7)

    im = make_engraved_plate(512, 512, "tex_ceramic_kintsugi", d_kintsugi)
    im = blend_with_mask(im, Image.new("RGB", (512, 512), SURFACE), fade)
    kbs.append(save_webp(im, "decor/decor-corner-kintsugi-seam.webp"))

    # 107: decor-corner-blueprint.webp
    def d_blueprint(d: ImageDraw.ImageDraw, W: int, H: int):
        for step in range(240, 1500, 220):
            d.line([(W - step, H), (W - step, H - 1400)], fill=(*SLATE, 65), width=2)
            d.line([(W, H - step), (W - 1400, H - step)], fill=(*SLATE, 65), width=2)
        cx, cy = W - 460, H - 460
        d.ellipse([cx - 340, cy - 340, cx + 340, cy + 340], outline=(*SLATE, 175), width=5)
        d.ellipse([cx - 210, cy - 210, cx + 210, cy + 210], outline=(*CLAY, 175), width=4)
        d.rectangle([cx - 210, cy - 210, cx + 210, cy + 210], outline=(*BRASS, 140), width=3)
        d.line([(cx - 420, cy), (cx + 420, cy)], fill=(*BRASS, 150), width=3)
        d.line([(cx, cy - 420), (cx, cy + 420)], fill=(*BRASS, 150), width=3)

    im = make_engraved_plate(512, 512, "tex_sacred_grid", d_blueprint)
    im = blend_with_mask(im, Image.new("RGB", (512, 512), SURFACE), fade)
    kbs.append(save_webp(im, "decor/decor-corner-blueprint.webp"))

    # 108: decor-divider-sundial.webp (900x200)
    def d_sundial_div(d: ImageDraw.ImageDraw, W: int, H: int):
        cy = H // 2
        cx = W // 2
        d.line([(160, cy), (W - 160, cy)], fill=(*BRASS, 130), width=4)
        # Central sun disc + 8 rays
        r_sun = 78
        for k in range(12):
            ang = math.radians(k * 30)
            r_out = 138 if k % 3 == 0 else 108
            d.line(
                [(cx + (r_sun + 12) * math.cos(ang), cy + (r_sun + 12) * math.sin(ang)),
                 (cx + r_out * math.cos(ang), cy + r_out * math.sin(ang))],
                fill=(*CLAY, 210), width=5
            )
        d.ellipse([cx - r_sun, cy - r_sun, cx + r_sun, cy + r_sun], fill=(*BG, 255), outline=(*BRASS, 240), width=6)
        d.ellipse([cx - 38, cy - 38, cx + 38, cy + 38], fill=(*CLAY, 220))
        # Flanking lunar phases
        for dx, crescent_shift in [(-380, -22), (-680, -38), (380, 22), (680, 38)]:
            mx = cx + dx
            mr = 44 if abs(dx) < 500 else 32
            d.ellipse([mx - mr, cy - mr, mx + mr, cy + mr], fill=(*BRASS, 200))
            d.ellipse([mx - mr + crescent_shift, cy - mr, mx + mr + crescent_shift, cy + mr], fill=(*BG, 255))

    im = make_engraved_plate(900, 200, "tex_clay_grain_v2", d_sundial_div, base_rgb=BG)
    kbs.append(save_webp(im, "decor/decor-divider-sundial.webp"))

    # 109-112: 4 Eisenhower Quadrant Relief Medallions (512x512)
    def make_quadrant(draw_symbol, dest_name: str, accent_col):
        def d_quad(d: ImageDraw.ImageDraw, W: int, H: int):
            cx, cy = W // 2, H // 2
            d.ellipse([cx - 760, cy - 760, cx + 760, cy + 760], outline=(*accent_col, 120), width=6)
            d.ellipse([cx - 690, cy - 690, cx + 690, cy + 690], outline=(*BRASS, 85), width=3)
            draw_symbol(d, cx, cy)
        qim = make_engraved_plate(512, 512, "tex_clay_grain_v2", d_quad)
        kbs.append(save_webp(qim, f"decor/{dest_name}"))

    # 109: flame & anvil
    def sym_flame(d: ImageDraw.ImageDraw, cx: int, cy: int):
        # Classical anvil base + sculpted flame
        d.polygon([(cx - 320, cy + 360), (cx + 320, cy + 360), (cx + 220, cy + 180), (cx - 220, cy + 180)],
                  fill=(*RUST, 65), outline=(*RUST, 190))
        d.polygon([(cx - 380, cy + 180), (cx + 420, cy + 180), (cx + 260, cy + 80), (cx - 280, cy + 80)],
                  fill=(*CLAY, 85), outline=(*BRASS, 180))
        flame = [(cx, cy - 460), (cx + 210, cy - 150), (cx + 150, cy + 50), (cx, cy + 20), (cx - 150, cy + 50), (cx - 210, cy - 150)]
        d.polygon(flame, fill=(*CLAY, 110), outline=(*CLAY, 235))
        inner = [(cx, cy - 300), (cx + 100, cy - 110), (cx, cy + 10), (cx - 100, cy - 110)]
        d.polygon(inner, fill=(*BRASS, 170))

    make_quadrant(sym_flame, "decor-quadrant-flame.webp", RUST)

    # 110: compass / Polaris star
    def sym_compass(d: ImageDraw.ImageDraw, cx: int, cy: int):
        for k in range(8):
            ang = math.radians(k * 45)
            r_long = 520 if k % 2 == 0 else 330
            a1 = ang + math.radians(16)
            a2 = ang - math.radians(16)
            poly = [
                (cx, cy),
                (cx + 120 * math.cos(a1), cy + 120 * math.sin(a1)),
                (cx + r_long * math.cos(ang), cy + r_long * math.sin(ang)),
                (cx + 120 * math.cos(a2), cy + 120 * math.sin(a2)),
            ]
            col = BRASS if k % 2 == 0 else CLAY
            d.polygon(poly, fill=(*col, 110), outline=(*col, 230))
        d.ellipse([cx - 85, cy - 85, cx + 85, cy + 85], fill=(*SURFACE, 255), outline=(*BRASS, 240), width=6)

    make_quadrant(sym_compass, "decor-quadrant-compass.webp", CLAY)

    # 111: twin hourglass
    def sym_hourglass(d: ImageDraw.ImageDraw, cx: int, cy: int):
        d.line([(cx - 320, cy - 460), (cx + 320, cy - 460)], fill=(*BRASS, 230), width=12)
        d.line([(cx - 320, cy + 460), (cx + 320, cy + 460)], fill=(*BRASS, 230), width=12)
        top_b = [(cx - 270, cy - 450), (cx + 270, cy - 450), (cx + 30, cy), (cx - 30, cy)]
        bot_b = [(cx - 30, cy), (cx + 30, cy), (cx + 270, cy + 450), (cx - 270, cy + 450)]
        d.polygon(top_b, fill=(*BRASS, 55), outline=(*BRASS, 210))
        d.polygon(bot_b, fill=(*BRASS, 55), outline=(*BRASS, 210))
        sand_bot = [(cx, cy + 140), (cx + 230, cy + 440), (cx - 230, cy + 440)]
        d.polygon(sand_bot, fill=(*BRASS, 155))
        d.line([(cx, cy - 120), (cx, cy + 180)], fill=(*BRASS, 220), width=6)

    make_quadrant(sym_hourglass, "decor-quadrant-hourglass.webp", BRASS)

    # 112: calm feather & zen ripple
    def sym_feather(d: ImageDraw.ImageDraw, cx: int, cy: int):
        for r in (240, 390, 540):
            d.arc([cx - r, cy + 100 - r // 3, cx + r, cy + 100 + r // 3], 0, 360, fill=(*ASH, 110), width=4)
        spine = []
        for i in range(40):
            t = i / 39.0
            spine.append((cx - 220 + int(t * 460), cy + 280 - int(t * 680 + math.sin(t * math.pi) * 80)))
        d.line(spine, fill=(*ASH, 230), width=7)
        for idx in range(5, 36, 3):
            px, py = spine[idx]
            w_vane = int(145 * math.sin((idx / 39.0) * math.pi))
            d.line([(px, py), (px - w_vane, py - w_vane // 2)], fill=(*ASH, 165), width=4)
            d.line([(px, py), (px + w_vane, py + w_vane // 3)], fill=(*ASH, 165), width=4)

    make_quadrant(sym_feather, "decor-quadrant-feather.webp", ASH)

    # 113: decor-golden-thread-node.webp (256x256)
    def d_node(d: ImageDraw.ImageDraw, W: int, H: int):
        cx, cy = W // 2, H // 2
        d.line([(cx, 0), (cx, H)], fill=(*BRASS, 180), width=8)
        d.ellipse([cx - 280, cy - 280, cx + 280, cy + 280], fill=(*SURFACE, 255), outline=(*BRASS, 240), width=8)
        d.polygon([(cx, cy - 220), (cx + 220, cy), (cx, cy + 220), (cx - 220, cy)],
                  fill=(*CLAY, 110), outline=(*BRASS, 240))
        d.ellipse([cx - 72, cy - 72, cx + 72, cy + 72], fill=(*BRASS, 245))

    kbs.append(save_webp(make_engraved_plate(256, 256, "tex_clay_grain_v2", d_node), "decor/decor-golden-thread-node.webp"))

    # 114: decor-guilloche-wave.webp (900x360)
    def d_guilloche(d: ImageDraw.ImageDraw, W: int, H: int):
        for phase in range(14):
            pts = []
            ph = phase * 0.42
            for i in range(260):
                t = i / 259.0
                x = int(t * W)
                y = int(H * 0.5 + math.sin(t * math.pi * 5 + ph) * (H * 0.34) + math.cos(t * math.pi * 11 - ph) * (H * 0.10))
                pts.append((x, y))
            col = BRASS if phase % 2 == 0 else CLAY
            d.line(pts, fill=(*col, 72), width=3)

    kbs.append(save_webp(make_engraved_plate(900, 360, "tex_archival_paper", d_guilloche), "decor/decor-guilloche-wave.webp"))

    # 115: decor-obsidian-prism.webp (512x512)
    def d_prism(d: ImageDraw.ImageDraw, W: int, H: int):
        cx, cy = W // 2, H // 2
        top = (cx, cy - 580)
        bot = (cx, cy + 580)
        mid = [(cx - 380, cy - 110), (cx - 150, cy + 60), (cx + 170, cy + 40), (cx + 380, cy - 120)]
        d.polygon([top, mid[0], mid[1]], fill=(*AMETHYST, 85), outline=(*SLATE, 210))
        d.polygon([top, mid[1], mid[2]], fill=(*SLATE, 115), outline=(*BRASS, 220))
        d.polygon([top, mid[2], mid[3]], fill=(*AMETHYST, 65), outline=(*SLATE, 210))
        d.polygon([bot, mid[0], mid[1]], fill=(*AMETHYST, 55), outline=(*SLATE, 195))
        d.polygon([bot, mid[1], mid[2]], fill=(*AMETHYST, 95), outline=(*BRASS, 220))
        d.polygon([bot, mid[2], mid[3]], fill=(*SLATE, 70), outline=(*SLATE, 195))

    kbs.append(save_webp(make_engraved_plate(512, 512, "tex_sacred_grid", d_prism), "decor/decor-obsidian-prism.webp"))
    return kbs


# ============================================================================
# CATEGORY C: 18 IN-CARD BENTO VIGNETTES (800x450 / 720x540)
# ============================================================================
def build_bento_card(
    art_prefix: str,
    w: int,
    h: int,
    accent: tuple[int, int, int],
    base_rgb=SURFACE,
    fade_left: bool = True,
    motif_fn=None,
) -> Image.Image:
    art = load_crop(art_prefix, w, h)
    art = ImageEnhance.Contrast(art).enhance(1.1)
    tex = load_crop("tex_clay_grain_v2", w, h)
    solid = screen_blend(Image.new("RGB", (w, h), base_rgb), tex, opacity=0.08)

    if fade_left:
        # Left 48% fades smoothly into solid #1D1C17 for crisp card typography; right 52% reveals painting
        x = np.linspace(0.0, 1.0, w, dtype=np.float32)[None, :]
        mask = np.clip((x - 0.16) / 0.62, 0.0, 1.0) ** 1.25
        mask = np.broadcast_to(mask, (h, w)).copy()
        # Soft bottom vignette too
        y = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
        ymask = 1.0 - 0.35 * (y ** 2.2)
        stage = blend_with_mask(solid, art, mask * ymask * 0.88)
    else:
        # Bottom-left fade for 4:3 cards
        m = radial_mask(w, h, cx=0.72, cy=0.36, rx=0.88, ry=0.88, power=1.15) * 0.86
        stage = blend_with_mask(solid, art, m)

    if motif_fn is not None:
        ss = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
        d = ImageDraw.Draw(ss)
        motif_fn(d, w * 2, h * 2, accent)
        stage = Image.alpha_composite(stage.convert("RGBA"), ss.resize((w, h), Image.Resampling.LANCZOS)).convert("RGB")

    return stage


def m_reel_frame(d: ImageDraw.ImageDraw, W: int, H: int, acc):
    rx1, ry1, rx2, ry2 = int(W * 0.64), int(H * 0.12), int(W * 0.90), int(H * 0.88)
    d.rounded_rectangle([rx1, ry1, rx2, ry2], radius=36, outline=(*BRASS, 210), width=5)
    cx, cy = (rx1 + rx2) // 2, (ry1 + ry2) // 2
    d.ellipse([cx - 64, cy - 64, cx + 64, cy + 64], fill=(*BG, 170), outline=(*acc, 230), width=4)
    d.polygon([(cx - 18, cy - 28), (cx - 18, cy + 28), (cx + 30, cy)], fill=(*BRASS, 240))


def m_podium(d: ImageDraw.ImageDraw, W: int, H: int, acc):
    bx = int(W * 0.68)
    by = int(H * 0.86)
    # 2nd, 1st, 3rd stepped brass-trimmed monoliths
    for ox, ph, col in [(-150, 210, SLATE), (0, 320, BRASS), (150, 150, CLAY)]:
        d.rectangle([bx + ox - 64, by - ph, bx + ox + 64, by], fill=(*BG, 185), outline=(*col, 225), width=5)


def m_pin(d: ImageDraw.ImageDraw, W: int, H: int, acc):
    px, py = W // 2, int(H * 0.22)
    d.line([(px + 6, py + 10), (px + 84, py + 76)], fill=(0, 0, 0, 120), width=10)
    d.ellipse([px - 28, py - 28, px + 28, py + 28], fill=(*BRASS, 245), outline=(*CLAY_DEEP, 240), width=5)
    d.ellipse([px - 10, py - 12, px + 6, py + 4], fill=(255, 240, 195, 210))


def generate_bento() -> list[float]:
    specs = [
        ("bento/bento-spark-reels.webp", "flow_cbt_dopamine", 800, 450, CLAY, SURFACE, True, m_reel_frame),
        ("bento/bento-low-energy-moss.webp", "empty_habits", 800, 450, MOSS, SURFACE, True, None),
        ("bento/bento-evening-shutdown.webp", "pack_sleep_reset_v2", 800, 450, BRASS, BG, False, None),
        ("bento/bento-recovery-today.webp", "recovery_kintsugi_bowl", 720, 540, MOSS, SURFACE, False, None),
        ("bento/bento-recovery-tomorrow.webp", "today_dawn", 720, 540, CLAY, SURFACE, False, None),
        ("bento/bento-recovery-split.webp", "runner_stepping_stones", 720, 540, BRASS, SURFACE, False, None),
        ("bento/bento-recovery-release.webp", "ritual_evening", 720, 540, SLATE, SURFACE, False, None),
        ("bento/bento-coach-analyze.webp", "insights_observatory_header", 720, 540, CLAY, SURFACE, False, None),
        ("bento/bento-coach-suggest.webp", "habit_detail_aura", 720, 540, MOSS, SURFACE, False, None),
        ("bento/bento-coach-shield.webp", "bad_habit_shield", 720, 540, BRASS, SURFACE, False, None),
        ("bento/bento-coach-plan.webp", "plan_architect_banner", 720, 540, SLATE, SURFACE, False, None),
        ("bento/bento-profile-league.webp", "leaderboard_pantheon", 720, 540, BRASS, SURFACE, False, m_podium),
        ("bento/bento-profile-treasury.webp", "economy_focus_coin", 720, 540, CLAY, SURFACE, False, None),
        ("bento/bento-profile-vitrine.webp", "badge_legend_rank", 720, 540, MOSS, SURFACE, False, None),
        ("bento/bento-hub-tools-strategy.webp", "goals_summit_cairn", 800, 450, BRASS, SURFACE, True, None),
        ("bento/bento-hub-tools-deepfocus.webp", "focus_complete_gong", 800, 450, CLAY, SURFACE, True, None),
        ("bento/bento-book-exlibris.webp", "reading_library", 720, 540, BRASS, SURFACE, True, None),
        ("bento/bento-note-parchment.webp", "notes_atelier", 800, 320, BRASS, PAPER, False, m_pin),
    ]
    kbs = []
    for dest, art_p, w, h, acc, base_c, fl, mf in specs:
        im = build_bento_card(art_p, w, h, acc, base_c, fl, mf)
        kbs.append(save_webp(im, dest, quality=82))
    return kbs


# ============================================================================
# CATEGORY D: 8 LIFE AREAS COLLECTIBLE TAROT/EDITORIAL CARDS (720x540)
# ============================================================================
def generate_life_areas() -> list[float]:
    def tarot_frame(sym_kind: str):
        def fn(d: ImageDraw.ImageDraw, W: int, H: int, acc):
            # Subtle museum tarot double hairline border
            d.rounded_rectangle([28, 28, W - 28, H - 28], radius=34, outline=(*BRASS, 115), width=3)
            cx, cy = int(W * 0.76), int(H * 0.36)
            d.ellipse([cx - 150, cy - 150, cx + 150, cy + 150], fill=(*BG, 145), outline=(*acc, 215), width=5)
            d.ellipse([cx - 126, cy - 126, cx + 126, cy + 126], outline=(*BRASS, 140), width=2)
            if sym_kind == "saglik":
                pts = [(cx - 90, cy + 10), (cx - 42, cy + 10), (cx - 20, cy - 62), (cx + 14, cy + 68), (cx + 42, cy - 24), (cx + 90, cy - 24)]
                d.line(pts, fill=(*MOSS, 240), width=7)
            elif sym_kind == "kariyer":
                for step in range(4):
                    sx = cx - 72 + step * 36
                    sy = cy + 64 - step * 32
                    d.rectangle([sx, sy, cx + 76, cy + 72], outline=(*BRASS, 220), width=4)
            elif sym_kind == "egitim":
                d.ellipse([cx - 78, cy - 78, cx + 78, cy + 78], outline=(*BRASS, 225), width=4)
                d.ellipse([cx - 78, cy - 32, cx + 78, cy + 32], outline=(*CLAY, 220), width=4)
                d.line([(cx, cy - 92), (cx, cy + 92)], fill=(*BRASS, 220), width=4)
            elif sym_kind == "finans":
                for dy, rx in [(44, 72), (10, 56), (-24, 40), (-54, 24)]:
                    d.ellipse([cx - rx, cy + dy - 16, cx + rx, cy + dy + 16], fill=(*BRASS, 110), outline=(*BRASS, 235), width=4)
            elif sym_kind == "aile":
                d.ellipse([cx - 68, cy - 76, cx + 68, cy + 20], fill=(*MOSS, 85), outline=(*BRASS, 225), width=4)
                d.line([(cx, cy - 10), (cx, cy + 76)], fill=(*CLAY, 235), width=8)
                d.line([(cx, cy + 20), (cx - 40, cy - 18)], fill=(*CLAY, 220), width=5)
                d.line([(cx, cy + 20), (cx + 40, cy - 18)], fill=(*CLAY, 220), width=5)
            elif sym_kind == "sosyal":
                for ang in (90, 210, 330):
                    rad = math.radians(ang)
                    px, py = cx + int(50 * math.cos(rad)), cy + int(50 * math.sin(rad))
                    d.ellipse([px - 42, py - 42, px + 42, py + 42], outline=(*BRASS, 225), width=4)
            elif sym_kind == "ruhsal":
                for k in range(8):
                    rad = math.radians(k * 45)
                    r = 88 if k % 2 == 0 else 44
                    d.line([(cx, cy), (cx + r * math.cos(rad), cy + r * math.sin(rad))], fill=(*BRASS, 235), width=5)
            elif sym_kind == "hobiler":
                d.arc([cx - 70, cy - 60, cx + 70, cy + 80], 0, 180, fill=(*BRASS, 235), width=6)
                for dx in (-36, -12, 12, 36):
                    d.line([(cx + dx, cy - 58), (cx + dx, cy + 68)], fill=(*CLAY, 210), width=3)
        return fn

    areas = [
        ("life-areas/area-saglik.webp", "pack_fitness_foundation", MOSS, "saglik"),
        ("life-areas/area-kariyer.webp", "projects_workshop", SLATE, "kariyer"),
        ("life-areas/area-egitim.webp", "reading_library", BRASS, "egitim"),
        ("life-areas/area-finans.webp", "economy_focus_coin", BRASS, "finans"),
        ("life-areas/area-aile.webp", "pack_morning_reset", CLAY, "aile"),
        ("life-areas/area-sosyal.webp", "today_dusk", AMETHYST, "sosyal"),
        ("life-areas/area-ruhsal.webp", "flow_checkpoint_zen", MOSS, "ruhsal"),
        ("life-areas/area-hobiler.webp", "notes_atelier", CLAY, "hobiler"),
    ]
    kbs = []
    for dest, art_p, acc, key in areas:
        im = build_bento_card(art_p, 720, 540, acc, SURFACE, fade_left=False, motif_fn=tarot_frame(key))
        kbs.append(save_webp(im, dest, quality=82))
    return kbs


# ============================================================================
# CATEGORY E: 5 EMBOSSED 3D SEALING-WAX MOOD STAMPS (384x384)
# ============================================================================
def render_wax_seal(wax_rgb: tuple[int, int, int], gold_flecks: bool, draw_relief) -> Image.Image:
    N = 768  # 2x supersampled 3D heightfield normal-map shader
    paper_bg = load_crop("tex_archival_paper", 384, 384)
    paper_bg = soft_tint(paper_bg, PAPER, keep_art=0.55)

    y, x = np.mgrid[:N, :N].astype(np.float32)
    cx, cy = N * 0.5, N * 0.5
    dx, dy = x - cx, y - cy
    r = np.sqrt(dx * dx + dy * dy)
    theta = np.arctan2(dy, dx)

    # Organic molten wax outer silhouette wobble
    r_outer = (N * 0.40) * (
        1.0
        + 0.032 * np.sin(5 * theta + 0.7)
        + 0.021 * np.cos(8 * theta - 1.2)
        + 0.014 * np.sin(13 * theta + 2.1)
    )
    inside = np.clip((r_outer - r) / 14.0, 0.0, 1.0)

    # Wax heightfield: thick rounded outer lip + recessed flat stamp well + raised inner ring
    rim_dist = r / np.maximum(r_outer, 1.0)
    outer_lip = np.exp(-((rim_dist - 0.83) ** 2) / (2 * 0.075 ** 2)) * 1.15
    well = np.clip(1.0 - (rim_dist / 0.74) ** 8, 0.0, 1.0) * (-0.35)
    inner_ring = np.exp(-((rim_dist - 0.67) ** 2) / (2 * 0.018 ** 2)) * 0.65

    # Draw custom relief symbol into grayscale height mask
    sym_im = Image.new("L", (N, N), 0)
    sd = ImageDraw.Draw(sym_im)
    draw_relief(sd, int(cx), int(cy), int(N * 0.22))
    sym_im = sym_im.filter(ImageFilter.GaussianBlur(radius=4.5))
    sym_h = (np.asarray(sym_im, dtype=np.float32) / 255.0) * 0.85

    # Fine micro-wax grain
    rng = np.random.default_rng(int(wax_rgb[0] * 17 + wax_rgb[1]))
    grain = rng.normal(0.0, 0.018, (N, N)).astype(np.float32)

    H_map = (0.45 + outer_lip + well + inner_ring + sym_h + grain) * inside

    # Surface normals via Sobel-like gradient
    gy, gx = np.gradient(H_map * 34.0)
    nz = np.ones_like(gx)
    norm = np.sqrt(gx * gx + gy * gy + nz * nz)
    nx, ny, nz = -gx / norm, -gy / norm, nz / norm

    # Key directional studio light from top-left (-0.55, -0.60, 0.58)
    lx, ly, lz = -0.55, -0.60, 0.58
    ll = math.sqrt(lx * lx + ly * ly + lz * lz)
    lx, ly, lz = lx / ll, ly / ll, lz / ll

    ndotl = np.clip(nx * lx + ny * ly + nz * lz, 0.0, 1.0)
    # Blinn-Phong warm wax sheen
    hx, hy, hz = lx, ly, lz + 1.0
    hl = math.sqrt(hx * hx + hy * hy + hz * hz)
    hx, hy, hz = hx / hl, hy / hl, hz / hl
    spec = np.clip(nx * hx + ny * hy + nz * hz, 0.0, 1.0) ** 26

    base_col = np.array(wax_rgb, dtype=np.float32)[None, None, :]
    lit = base_col * (0.36 + 0.78 * ndotl[:, :, None]) + np.array([255, 236, 200], dtype=np.float32)[None, None, :] * (spec[:, :, None] * 0.34)

    # Optional antique gold leaf highlights on raised relief & inner ring (Mood 5 Harika)
    if gold_flecks:
        gold_mask = np.clip((sym_h + inner_ring - 0.32) * 1.9, 0.0, 1.0)[:, :, None]
        gold_col = np.array(BRASS, dtype=np.float32)[None, None, :] * (0.55 + 0.75 * ndotl[:, :, None]) + 95.0 * spec[:, :, None]
        lit = lit * (1.0 - gold_mask * 0.72) + gold_col * (gold_mask * 0.72)

    wax_rgba = np.zeros((N, N, 4), dtype=np.uint8)
    wax_rgba[:, :, :3] = np.clip(lit, 0, 255).astype(np.uint8)
    wax_rgba[:, :, 3] = np.clip(inside * 255.0, 0, 255).astype(np.uint8)
    wax_pil = Image.fromarray(wax_rgba, mode="RGBA").resize((384, 384), Image.Resampling.LANCZOS)

    # Soft cast shadow onto dark parchment (#211c18)
    alpha_ch = wax_pil.split()[3]
    shadow = Image.new("RGBA", (384, 384), (0, 0, 0, 0))
    sh_mask = alpha_ch.filter(ImageFilter.GaussianBlur(radius=9))
    sh_arr = (np.asarray(sh_mask, dtype=np.float32) * 0.62).astype(np.uint8)
    shadow.putalpha(Image.fromarray(sh_arr))

    canvas = paper_bg.convert("RGBA")
    canvas.alpha_composite(shadow, dest=(6, 9))
    canvas.alpha_composite(wax_pil, dest=(0, 0))
    return canvas.convert("RGB")


def generate_moods() -> list[float]:
    # 1: Zor (raincloud & waves)
    def r_zor(d: ImageDraw.ImageDraw, cx: int, cy: int, R: int):
        d.ellipse([cx - int(R * 0.65), cy - int(R * 0.55), cx - int(R * 0.05), cy - int(R * 0.02)], fill=235)
        d.ellipse([cx - int(R * 0.32), cy - int(R * 0.78), cx + int(R * 0.36), cy - int(R * 0.05)], fill=245)
        d.ellipse([cx + int(R * 0.05), cy - int(R * 0.52), cx + int(R * 0.66), cy - int(R * 0.02)], fill=235)
        for dx in (-int(R * 0.36), 0, int(R * 0.36)):
            d.line([(cx + dx, cy + int(R * 0.14)), (cx + dx - 18, cy + int(R * 0.56))], fill=230, width=18)

    # 2: Yorgun (low crescent moon & calm horizon wave)
    def r_yorgun(d: ImageDraw.ImageDraw, cx: int, cy: int, R: int):
        mr = int(R * 0.58)
        d.ellipse([cx - mr, cy - mr - 12, cx + mr, cy + mr - 12], fill=245)
        d.ellipse([cx - mr + int(R * 0.34), cy - mr - 36, cx + mr + int(R * 0.34), cy + mr - 36], fill=0)
        d.line([(cx - int(R * 0.72), cy + int(R * 0.58)), (cx + int(R * 0.72), cy + int(R * 0.58))], fill=225, width=18)

    # 3: Orta (balanced circle & horizon line)
    def r_orta(d: ImageDraw.ImageDraw, cx: int, cy: int, R: int):
        cr = int(R * 0.52)
        d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], outline=245, width=22)
        d.line([(cx - int(R * 0.82), cy), (cx + int(R * 0.82), cy)], fill=245, width=20)

    # 4: Iyi (rising sun over gentle hills)
    def r_iyi(d: ImageDraw.ImageDraw, cx: int, cy: int, R: int):
        sr = int(R * 0.42)
        d.chord([cx - sr, cy - sr + 8, cx + sr, cy + sr + 8], 180, 360, fill=245)
        for ang in (205, 235, 270, 305, 335):
            rad = math.radians(ang)
            d.line(
                [(cx + int((sr + 18) * math.cos(rad)), cy + 8 + int((sr + 18) * math.sin(rad))),
                 (cx + int((sr + 56) * math.cos(rad)), cy + 8 + int((sr + 56) * math.sin(rad)))],
                fill=235, width=16
            )
        d.arc([cx - int(R * 0.85), cy + 8, cx + int(R * 0.15), cy + int(R * 0.82)], 190, 350, fill=240, width=20)
        d.arc([cx - int(R * 0.15), cy + 16, cx + int(R * 0.85), cy + int(R * 0.88)], 190, 350, fill=240, width=20)

    # 5: Harika (radiant 8-ray gilded sunburst)
    def r_harika(d: ImageDraw.ImageDraw, cx: int, cy: int, R: int):
        for k in range(8):
            ang = math.radians(k * 45)
            rl = int(R * (0.88 if k % 2 == 0 else 0.64))
            d.line([(cx, cy), (cx + int(rl * math.cos(rad := ang)), cy + int(rl * math.sin(rad)))], fill=245, width=20)
        sr = int(R * 0.34)
        d.ellipse([cx - sr, cy - sr, cx + sr, cy + sr], fill=255)

    specs = [
        ("moods/mood-1-zor.webp", RUST, False, r_zor),
        ("moods/mood-2-yorgun.webp", CLAY_DEEP, False, r_yorgun),
        ("moods/mood-3-orta.webp", BRASS, False, r_orta),
        ("moods/mood-4-iyi.webp", MOSS, False, r_iyi),
        ("moods/mood-5-harika.webp", MOSS, True, r_harika),
    ]
    kbs = []
    for dest, col, gf, fn in specs:
        kbs.append(save_webp(render_wax_seal(col, gf, fn), dest, quality=85))
    return kbs


def main() -> None:
    all_kbs: list[float] = []
    print("=== Generating Category A: 14 Full-Screen Canvases ===")
    all_kbs.extend(generate_canvases())
    print("=== Generating Category B: 12 Embedded Filigrees & Quadrant Reliefs ===")
    all_kbs.extend(generate_decor())
    print("=== Generating Category C: 18 In-Card Bento Vignettes ===")
    all_kbs.extend(generate_bento())
    print("=== Generating Category D: 8 Life Areas Tarot Cards ===")
    all_kbs.extend(generate_life_areas())
    print("=== Generating Category E: 5 3D Wax-Seal Mood Stamps ===")
    all_kbs.extend(generate_moods())
    print(f"\n[DONE] Generated {len(all_kbs)} beyond-header WebP assets ({round(sum(all_kbs)/1024, 2)} MB total).")


if __name__ == "__main__":
    main()
