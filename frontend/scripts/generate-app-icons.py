#!/usr/bin/env python3
"""Generate Atlas's app icons from the app's own palette.

## Why this exists

`assets/images/icon.png`, `favicon.png` and `adaptive-icon.png` were the same
file: Expo's default blue "e". The app would have installed as another
framework's logo, which is wrong for users and is someone else's mark to be
shipping on a store listing.

## What this is, and is not

It is NOT a brand identity. Designing one is a design decision and not the
job of a hardening pass. What this produces is a deliberately restrained
placeholder built ONLY from decisions the codebase has already made:

    ground  colors.bg      #15140F   (lib/tokens.ts)
    mark    colors.accent  #D97757   (lib/tokens.ts)

A geometric "A" — two legs and a crossbar — drawn as polygons so it stays
crisp at every size rather than a scaled bitmap. It is honest about being a
placeholder: it introduces no shape, colour or typeface that is not already in
the app.

A designer replacing it should regenerate the same four files at the same
sizes; `docs/BRANDING.md` lists what each one is for.

## Why the script is committed

An icon checked in as a binary with no source cannot be adjusted — the next
person has to redraw it. This is 60 lines and reproduces all four exactly:

    python scripts/generate-app-icons.py
"""
import os

from PIL import Image, ImageDraw

BG = (0x15, 0x14, 0x0F, 255)      # colors.bg
ACCENT = (0xD9, 0x77, 0x57, 255)  # colors.accent
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'images')


def draw_mark(size, inset_ratio, transparent_bg):
    """One square canvas with the mark centred.

    `inset_ratio` is how much of the canvas the mark occupies. Android's
    adaptive icon crops to a circle of ~66% of the canvas, so the foreground
    layer needs the mark well inside that; a full-bleed icon can use more.
    """
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0) if transparent_bg else BG)
    d = ImageDraw.Draw(img)

    m = size * inset_ratio          # mark height
    cx, cy = size / 2, size / 2
    top = cy - m / 2
    bot = cy + m / 2
    half_w = m * 0.42               # half the span of the legs at the base
    stroke = m * 0.155

    # Left and right legs of the A, as quadrilaterals from apex to base.
    apex_l = (cx - stroke * 0.55, top)
    apex_r = (cx + stroke * 0.55, top)
    d.polygon([apex_l, apex_r, (cx - half_w + stroke, bot), (cx - half_w, bot)], fill=ACCENT)
    d.polygon([apex_r, apex_l, (cx + half_w - stroke, bot), (cx + half_w, bot)], fill=ACCENT)

    # Crossbar, at the optical rather than geometric middle.
    bar_y = top + m * 0.66
    bar_half = half_w * 0.60
    d.rectangle([cx - bar_half, bar_y, cx + bar_half, bar_y + stroke * 0.85], fill=ACCENT)
    return img


def rounded(img, radius_ratio=0.22):
    """iOS masks the icon itself; Android and the web favicon do not."""
    size = img.size[0]
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1],
                                           radius=int(size * radius_ratio), fill=255)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def save(img, name):
    path = os.path.abspath(os.path.join(OUT, name))
    img.save(path, 'PNG')
    print('%-24s %4dx%-4d  %6d bytes' % (name, img.size[0], img.size[1], os.path.getsize(path)))


if __name__ == '__main__':
    # Store icon: full bleed, square. Apple rounds it; Google Play does too.
    save(draw_mark(1024, 0.52, transparent_bg=False), 'icon.png')

    # Android adaptive foreground: transparent, mark kept inside the safe
    # circle. The background colour comes from app.json, not from here.
    save(draw_mark(1024, 0.36, transparent_bg=True), 'adaptive-icon.png')

    # Web favicon: rounded, because nothing masks it for us.
    save(rounded(draw_mark(96, 0.52, transparent_bg=False)), 'favicon.png')

    # Splash: the mark alone on transparent; app.json paints the ground.
    save(draw_mark(512, 0.46, transparent_bg=True), 'splash-icon.png')
