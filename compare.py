#!/usr/bin/env python3
"""Render each face statically (!still) with the playwright headless shell and diff
against the Figma shots. Face crops are normalized by the face-circle pixels on both
sides, so layout margins never skew the diff.

Usage: python3 compare.py [--use-existing] [faces...]
"""
import os, subprocess, sys
from PIL import Image, ImageChops
import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(ROOT, "assets", "shots")
OUT = os.path.join(ROOT, "assets", "render")
BASE = os.environ.get("BOB_BASE", f"file://{ROOT}/index.html")   # set BOB_BASE to a served copy if file: is blocked
SHELL_BIN = os.path.expanduser(
    "~/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell")

PAIRS = {1: "face01.png", 2: "shot_3_130.png", 3: "shot_3_131.png", 4: "shot_3_132.png",
         5: "shot_3_133.png", 6: "shot_3_134.png", 7: "shot_3_136.png",
         8: None,   # hand-built tool face — no Figma shot
         9: "shot_3_137.png", 10: "shot_3_138.png", 11: "shot_3_139.png", 12: "shot_3_140.png",
         13: "shot_3_141.png", 14: "shot_0_27.png", 15: "shot_3_142.png", 16: "shot_3_143.png",
         17: "shot_3_144.png", 18: "shot_3_145.png", 19: "shot_3_146.png", 20: "shot_3_147.png",
         21: "shot_3_148.png", 22: "shot_3_149.png", 23: "shot_3_85.png", 24: "shot_3_107.png"}

os.makedirs(OUT, exist_ok=True)

def grab(face):
    png = os.path.join(OUT, f"mine_{face:02d}.png")
    url = f"{BASE}?face={face}&still=1"
    cmd = [SHELL_BIN, "--headless", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
           "--force-device-scale-factor=1", "--window-size=1100,1100", "--user-data-dir=/tmp/bcsh",
           "--virtual-time-budget=2000", f"--screenshot={png}", url]
    r = subprocess.run(cmd, capture_output=True, timeout=60)
    if "Uncaught" in (r.stderr or b"").decode(errors="ignore"):
        print("!! JS error on face", face)
    return png

def norm(path, size=420):
    """Crop to the face circle (gray #D9D9D9 / red #FF3131 pixels) then resize."""
    im = Image.open(path).convert("RGBA")
    a = np.array(im)
    r, g, b, al = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int), a[..., 3]
    gray = (abs(r - g) < 14) & (abs(g - b) < 16) & (r > 150) & (r < 246)
    red = (r > 200) & (g < 120) & (b < 120)
    m = (gray | red) & (al > 200)
    if m.any():
        ys, xs = np.where(m)
        im = im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    im = im.resize((size, size), Image.LANCZOS)
    bg = Image.new("RGB", (size, size), (255, 255, 255))
    bg.paste(im, (0, 0), im)
    return bg

def diff_report(face, render=True):
    mine = norm(grab(face) if render else os.path.join(OUT, f"mine_{face:02d}.png"))
    theirs = norm(os.path.join(SHOTS, PAIRS[face]))
    d = ImageChops.difference(mine, theirs)
    h = d.convert("L").histogram()
    n = mine.size[0] * mine.size[1]
    mean = sum(i * c for i, c in enumerate(h)) / n
    cells = []
    cw = mine.size[0] // 6
    dl = d.convert("L")
    for cy in range(6):
        for cx in range(6):
            box = (cx * cw, cy * cw, (cx + 1) * cw, (cy + 1) * cw)
            ch = dl.crop(box).histogram()
            m = sum(i * c for i, c in enumerate(ch)) / (cw * cw)
            cells.append((m, cx, cy))
    cells.sort(reverse=True)
    worst = ", ".join(f"({cx},{cy})={m:.0f}" for m, cx, cy in cells[:4])
    strip = Image.new("RGB", (mine.size[0] * 2 + 8, mine.size[1]), (240, 240, 240))
    strip.paste(mine, (0, 0))
    strip.paste(theirs, (mine.size[0] + 8, 0))
    strip.save(os.path.join(OUT, f"pair_{face:02d}.png"))
    return mean, worst

args = [a for a in sys.argv[1:] if not a.startswith("--")]
render = "--use-existing" not in sys.argv
targets = [int(x) for x in args] or list(range(1, 25))
tot = 0
n = 0
for f in targets:
    if not PAIRS.get(f):
        print(f"F{f:02d}  (no figma baseline — hand-built face, skipped)")
        continue
    m, worst = diff_report(f, render)
    tot += m
    n += 1
    flag = "  <-- CHECK" if m > 12 else ""
    print(f"F{f:02d}  mean={m:6.2f}  worst: {worst}{flag}")
if n:
    print(f"avg mean diff: {tot / n:.2f}")
