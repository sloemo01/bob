#!/usr/bin/env python3
"""Build bob/index.html - the 24-face morph stage, generated from the Figma SVG exports.

Reads assets/faces/*.svg (exact exports from the Figma file) and writes a
self-contained index.html: parametrized SVG stage + tween/morph engine + eye motion.
"""
import re, json, pathlib

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "assets" / "faces"

# ---------------------------------------------------------------- svg helpers
def _tags(fname):
    s = (SRC / fname).read_text()
    out = []
    for m in re.finditer(r"<(path|ellipse|circle)\b([^>]*?)/?>", s):
        attrs = {}
        for a in re.finditer(r"([\w:-]+)=\"([^\"]*)\"", m.group(2)):
            attrs[a.group(1)] = a.group(2)
        attrs["_tag"] = m.group(1)
        out.append(attrs)
    return out

def path_d(fname, pid):
    for t in _tags(fname):
        if t.get("id") == pid and "_d" not in t:
            pass
    for t in _tags(fname):
        if t.get("id") == pid:
            assert "d" in t, f"{fname}:{pid} has no d"
            return t["d"]
    raise KeyError(f"{fname}:{pid}")

def path_tag(fname, pid):
    for t in _tags(fname):
        if t.get("id") == pid:
            return t
    raise KeyError(f"{fname}:{pid}")

def paths_fill(fname, fill):
    return [t for t in _tags(fname) if t.get("fill") == fill and t["_tag"] == "path"]

def P(d, **kw):
    a = {k: v for k, v in kw.items()}
    extra = " ".join(f'{k.replace("_","-")}="{v}"' for k, v in a.items())
    return f'<path d="{d}" {extra}/>'

ROUND = 'stroke-linecap="round" stroke-linejoin="round"'

F = {}  # extras markup

# F02 / F03 dots (one system: typing row -> spinner) -------------------------
d = [path_d("f03_g31_whole.svg", f"Vector_{i}") for i in (2, 3, 4)]
F["dots"] = "".join(f'<g id="dotrow{k}"><path d="{x}" fill="#050505"/></g>' for k, x in enumerate(d))

# F04 chevron + bar ---------------------------------------------------------
chev4 = path_d("f04b_g32_g3.svg", "Vector")
bar4  = path_d("f04b_g32_g3.svg", "Vector_2")
F["chevL04"] = f'<g transform="translate(214.9 258.0)"><path d="{chev4}" stroke="#1A1A1A" stroke-width="50" fill="none" {ROUND}/></g>'
F["barR04"]  = f'<g transform="translate(214.9 258.0)"><path d="{bar4}" fill="#1A1A1A" stroke="#1A1A1A" stroke-width="18"/></g>'

# F05 big chevrons ----------------------------------------------------------
chev5 = path_d("f05_g33_g4.svg", "Vector")
F["chevBigL"] = f'<g transform="translate(181.9 227.7)"><path d="{chev5}" stroke="#1A1A1A" stroke-width="50" fill="none" {ROUND}/></g>'
F["chevBigR"] = f'<g transform="translate(653.6 227.7) scale(-1 1)"><path d="{chev5}" stroke="#1A1A1A" stroke-width="50" fill="none" {ROUND}/></g>'

# F06 question mark ---------------------------------------------------------
F["qmark"] = '<g transform="translate(98.09 182.67)">' + "".join(
    P(path_d("f06_g34_g.svg", i), stroke="#1A1A1A", stroke_width=t,
      stroke_linecap="round", stroke_linejoin="round",
      fill="#1A1A1A" if i == "Vector_2" else "none")
    for i, t in (("Vector", 27), ("Vector_2", 0))
) + "</g>"

# F07 spirals ---------------------------------------------------------------
def _core_center(d, frac=0.08, steps=48):
    # center of the spiral's inner curl — the point it visually spins around
    pts = [float(v) for v in re.findall(r'-?\d+\.?\d*', d)]
    xs = [pts[0]]; ys = [pts[1]]
    x0, y0 = pts[0], pts[1]
    k = 2
    while k + 6 <= len(pts):
        x1, y1, x2, y2, x3, y3 = pts[k:k + 6]
        for sM in range(steps + 1):
            t = sM / steps; m = 1 - t
            xs.append(m*m*m*x0 + 3*m*m*t*x1 + 3*m*t*t*x2 + t*t*t*x3)
            ys.append(m*m*m*y0 + 3*m*m*t*y1 + 3*m*t*t*y2 + t*t*t*y3)
        x0, y0 = x3, y3
        k += 6
    segs = [((xs[i+1]-xs[i])**2 + (ys[i+1]-ys[i])**2) ** 0.5 for i in range(len(xs)-1)]
    lim = frac * sum(segs)
    acc = 0.0
    cut = len(xs)
    for i, sg in enumerate(segs):
        acc += sg
        if acc > lim:
            cut = i + 1
            break
    return sum(xs[:cut]) / cut, sum(ys[:cut]) / cut

def _spiral(i, nudge, del_deg):
    d = path_d("f07_g36.svg", i)
    cx, cy = _core_center(d)
    return (f'<g class="spiral" data-cx="{cx:.2f}" data-cy="{cy:.2f}" data-nx="{nudge}" data-del="{del_deg}">'
            f'<path d="{d}" stroke="black" stroke-width="23" {ROUND} fill="none"/></g>')

F["spirals"] = _spiral("Vector", 14, 0) + _spiral("Vector_2", -14, 90)

# F08 magnifier -------------------------------------------------------------
F["mag"] = '<g transform="translate(369.9 573.9) scale(1.04)">' + "".join(
    f'<path d="{path_d("f08_g37_g.svg", i)}" stroke="#1A1A1A" stroke-width="{w}" {ROUND} fill="none"/>'
    for i, w in (("Vector", 48), ("Vector_2", 28))) + "</g>"

# TOOL -- wrench (hand-built, the tool-use face): one wrench below the eyes in
# the magnifier's zone, angled like it is being cranked; standard eyes --------
F["tool"] = ('<g transform="translate(445 622) rotate(-40)">'
             '<path d="M -18.47 -50.74 L -15.00 -27.00 L -13.45 -25.01 L -11.65 -23.26 L -9.61 -21.77 L -7.39 -20.58 L -5.02 -19.71 L -2.56 -19.18 L -0.05 -19.00 L 2.47 -19.17 L 4.93 -19.69 L 7.30 -20.54 L 9.53 -21.72 L 11.57 -23.20 L 13.39 -24.94 L 15.00 -27.00 L 18.47 -50.74 L 27.00 -46.77 L 34.71 -41.37 L 41.37 -34.71 L 46.77 -27.00 L 50.74 -18.47 L 53.18 -9.38 L 54.00 -0.00 L 53.18 9.38 L 50.74 18.47 L 46.77 27.00 L 41.37 34.71 L 34.71 41.37 L 27.00 46.77 L 18.47 50.74 L 9.38 53.18 L 0.00 54.00 L -9.38 53.18 L -18.47 50.74 L -27.00 46.77 L -34.71 41.37 L -41.37 34.71 L -46.77 27.00 L -50.74 18.47 L -53.18 9.38 L -54.00 0.00 L -53.18 -9.38 L -50.74 -18.47 L -46.77 -27.00 L -41.37 -34.71 L -34.71 -41.37 L -27.00 -46.77 Z" stroke="#1A1A1A" stroke-width="28" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
             '<path d="M -13 30 L -13 170 L -12.56 173.36 L -11.26 176.50 L -9.19 179.19 L -6.50 181.26 L -3.36 182.56 L 0.00 183.00 L 3.36 182.56 L 6.50 181.26 L 9.19 179.19 L 11.26 176.50 L 12.56 173.36 L 13 170 L 13 30" stroke="#1A1A1A" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
             '</g>')

# F09 lightbulb -------------------------------------------------------------
F["bulb"] = '<g transform="translate(363.09 81.84)">' + "".join(
    f'<path d="{path_d("f09_g38_g.svg", i)}" stroke="#1A1A1A" stroke-width="16.8" {ROUND} fill="none"/>'
    for i in ("Vector", "Vector_2", "Vector_3")) + "</g>"

# F10 book ------------------------------------------------------------------
F["book"] = '<g transform="translate(236.74 502.98)">' + "".join(
    f'<path d="{path_d("f10_g39_g.svg", i)}" stroke="#1A1A1A" stroke-width="22.8" {ROUND} fill="none"/>'
    for i in ("Vector", "Vector_2")) + "</g>"

# F11 pen -------------------------------------------------------------------
pen = "".join(P(path_d("f11_g40_g.svg", i), fill=c) for i, c in
              (("Vector", "#1A1A1A"), ("Vector_2", "#1A1A1A"), ("Vector_3", "#E8E8E8"),
               ("Vector_4", "#6E6E6E"), ("Vector_5", "#6E6E6E")))
F["pen"] = f'<g transform="translate(721.8 606.5) rotate(154.01) scale(1.0)">{pen}</g>'

# F12 closed arcs + zzz -----------------------------------------------------
F["arcs"] = "".join(P(path_d("f12_g41.svg", i), fill="#050505") for i in ("Vector", "Vector_2"))
zz = ""
for i, w, op in (("Vector_3", 4.5, 0.67), ("Vector_4", 7.65, 0.95), ("Vector_5", 10.8, 0.67)):
    zz += f'<g opacity="{op}"><path d="{path_d("f12_g41.svg", i)}" stroke="#1A1A1A" stroke-width="{w}" {ROUND} fill="none"/></g>'
F["zzz"] = zz

# F13 anger marks -----------------------------------------------------------
marks = paths_fill("f13_g42.svg", "#212121")
assert len(marks) == 4, f"f13 marks: {len(marks)}"
F["anger"] = '<g transform="translate(-40.796 0)">' + "".join(P(t["d"], fill="#212121") for t in marks) + "</g>"

# F14 blush -----------------------------------------------------------------
F["blush"] = ('<ellipse cx="238.422" cy="557.026" rx="93.3775" ry="46.2551" fill="#FF2E2E"/>'
              '<ellipse cx="609.103" cy="557.026" rx="93.3775" ry="46.2551" fill="#FF2E2E"/>')

# F15 teardrop --------------------------------------------------------------
F["tear"] = f'<path d="{path_d("f15_g43.svg", "Vector 5")}" fill="#514F4F"/>'

# F16 alarm clock -----------------------------------------------------------
# F16 clock: dial (black) + base (static: hub + short boot hand) + long hand
# (the only part the timer rotates; its base is rounded around the pivot so
# the joint holds at every tick angle). Paths are in the group's local space;
# the pivot is the dial centre (70.3049, 70.3049).
F["clock"] = '<g transform="translate(613.83 523.24)">' \
             '<circle cx="70.3049" cy="70.3049" r="70.3049" fill="black"/>' \
             '<path d="M 60.305 69.226 L 80.305 69.226 L 105.153 84.964 C 109.819 87.919 111.206 94.097 108.251 98.763 C 105.296 103.429 99.118 104.815 94.452 101.86 L 60.305 80.233 Z" fill="white"/>' \
             '<path d="M 60.305 69.226 C 59.892 73.056 61.702 76.785 64.967 78.830 C 68.232 80.874 72.378 80.874 75.643 78.830 C 78.907 76.785 80.718 73.056 80.305 69.226 L 80.305 36.381 C 80.305 30.859 75.828 26.381 70.305 26.381 C 64.782 26.381 60.305 30.859 60.305 36.381 Z" fill="white"/></g>'

# F17 hearts (pupil replacement, frame coords) ------------------------------
HEART_L = path_d("f17_g45.svg", "Heart 1")
HEART_R = path_d("f17_g45.svg", "Heart 2")

# F18 right chevron ---------------------------------------------------------
F["chevR18"] = f'<path d="{path_d("f18_g46.svg", "Vector")}" stroke="#1A1A1A" stroke-width="50" {ROUND} fill="none"/>'

# F22 arches + green check --------------------------------------------------
arch = path_d("f22_g50_g.svg", "Vector")
F["arches"] = (f'<g transform="translate(180.18 274.41)"><path d="{arch}" stroke="#1A1A1A" stroke-width="34" {ROUND} fill="none"/></g>'
               f'<g transform="translate(450.18 274.41)"><path d="{arch}" stroke="#1A1A1A" stroke-width="34" {ROUND} fill="none"/></g>')
F["check"] = '<g transform="translate(293.46 486.62)">' + "".join(
    f'<path d="{path_d("f22_g50_g1.svg", i)}" stroke="#2E9E5B" stroke-width="{w}" {ROUND} fill="none"/>'
    for i, w in (("Vector", 30), ("Vector_2", 33))) + "</g>"

# F23 X eyes + red X --------------------------------------------------------
xeye = "".join(f'<path d="{path_d("f23_ui_g.svg", i)}" stroke="#1A1A1A" stroke-width="30" {ROUND} fill="none"/>'
               for i in ("Vector", "Vector_2"))
F["xeyes"] = (f'<g transform="translate(194.57 221.90)">{xeye}</g>'
              f'<g transform="translate(465.14 221.90)">{xeye}</g>')
F["redx"] = '<g transform="translate(318.75 527.61)">' + "".join(
    f'<path d="{path_d("f23_ui_g1.svg", i)}" stroke="#D64545" stroke-width="41" {ROUND} fill="none"/>'
    for i in ("Vector", "Vector_2")) + "</g>"

# F24 warning triangle ------------------------------------------------------
F["warn"] = '<g transform="translate(296.63 556.11)">' + "".join(
    (f'<path d="{path_d("f24_mouth.svg", i)}" stroke="#D9901F" stroke-width="{w}" {ROUND} fill="none"/>'
     if i != "Vector_3" else f'<path d="{path_d("f24_mouth.svg", i)}" fill="#D9901F"/>')
    for i, w in (("Vector", 31), ("Vector_2", 25), ("Vector_3", 0))) + "</g>"

# ---------------------------------------------------------------- face table
NOOP = [-600.0, -600.0, 1446.0, -600.0, 1446.0, 1446.0, -600.0, 1446.0]

def eye(cx, cy, rx=106.0, ry=204.0, rot=0.0, vis=1.0):
    return {"cx": cx, "cy": cy, "rx": rx, "ry": ry, "rot": rot, "vis": vis}

def pup(cx, cy, rx=81.5, ry=89.0, rot=0.0, vis=None, mode=0.0):
    return {"cx": cx, "cy": cy, "rx": rx, "ry": ry, "rot": rot, "vis": vis, "mode": mode}

# helper: crop parallelogram from a transformed rect (matrix a b c d e f), w h
def crop_matrix(a, b, c, d, e, f, w, h):
    pts = [(0, 0), (w, 0), (w, h), (0, h)]
    out = []
    for x, y in pts:
        out += [round(a * x + c * y + e, 3), round(b * x + d * y + f, 3)]
    return out

def crop_rot(deg, cx, cy, w, h, dx=0.0):
    import math
    th = math.radians(deg)
    co, si = math.cos(th), math.sin(th)
    pts = [(0, 0), (w, 0), (w, h), (0, h)]
    out = []
    for x, y in pts:
        out += [round(cx + x * co - y * si + dx, 3), round(cy + x * si + y * co, 3)]
    return out

def crop_rect(x, y, w, h):
    return [x, y, x + w, y, x + w, y + h, x, y + h]

EXTRA_KEYS = ["dots", "chevL04", "barR04", "chevBigL", "chevBigR", "qmark",
              "spirals", "mag", "tool", "bulb", "book", "pen", "arcs", "zzz", "anger", "blush", "tear",
              "clock", "chevR18", "arches", "check", "xeyes", "redx", "warn"]

faces = []
def face(node, eL, pL, eR, pR, cropL=None, cropR=None, color="#D9D9D9", ex=None):
    t = {"node": node, "color": color,
         "eL": eL, "pL": pL, "eR": eR, "pR": pR,
         "cropL": cropL or NOOP, "cropR": cropR or NOOP,
         "ex": ex or {}}
    faces.append(t)

STD = (284.925, 353.026), (230.386, 288.234), (554.925, 353.026), (495.141, 288.234)

# 01 0:3 – neutral
face("0:3", eye(284.925, 353.026), pup(230.386, 288.234), eye(554.925, 353.026), pup(495.141, 288.234))
# 02 3:130 – ellipsis dots (typing)
face("3:130", eye(284.925, 353.026, vis=0), pup(230.386, 288.234, vis=0), eye(554.925, 353.026, vis=0), pup(495.141, 288.234, vis=0), ex={"dots": 1})
# 03 3:131 – startled dots (spinner)
face("3:131", eye(284.925, 353.026, vis=0), pup(230.386, 288.234, vis=0), eye(554.925, 353.026, vis=0), pup(495.141, 288.234, vis=0), ex={"dots": 1})
# 04 3:132 – skeptical (chevron + bar)
face("3:132", eye(284.925, 353.026, vis=0), pup(230.386, 288.234, vis=0), eye(554.925, 353.026, vis=0), pup(495.141, 288.234, vis=0), ex={"chevL04": 1, "barR04": 1})
# 05 3:133 – scrunched double chevron
face("3:133", eye(284.925, 353.026, vis=0), pup(230.386, 288.234, vis=0), eye(554.925, 353.026, vis=0), pup(495.141, 288.234, vis=0), ex={"chevBigL": 1, "chevBigR": 1})
# 06 3:134 – confused, rotated eyes + ?
face("3:134", eye(363.319, 396.686, rot=5.22895), pup(314.912, 327.193, rot=5.22895),
               eye(632.196, 421.293, rot=5.22895), pup(578.565, 351.322, rot=5.22895), ex={"qmark": 1})
# 07 3:135 – dizzy spirals — removed at user request (uncomment to restore)
# face("3:135", eye(284.925, 353.026, vis=0), pup(230.386, 288.234, vis=0), eye(554.925, 353.026, vis=0), pup(495.141, 288.234, vis=0), ex={"spirals": 1})
# 08 3:136 – searching, pupils down + magnifier
face("3:136", eye(284.925, 353.026), pup(284.925, 405.117), eye(554.925, 353.026), pup(554.925, 399.199), ex={"mag": 1})
# 08b TOOL – wrench below the eyes (eyes down watching it; cranks live)
face("tool", eye(284.925, 353.026), pup(284.925, 405.117), eye(554.925, 353.026), pup(554.925, 399.199), ex={"tool": 1})
# 09 3:137 – idea, eyes low + pupils up + bulb
face("3:137", eye(287.854, 444.472), pup(312.354, 329.472), eye(557.854, 444.472), pup(521.654, 315.359), ex={"bulb": 1})
# 10 3:138 – reading, pupils down + book (same eye pose as 09)
face("3:138", eye(287.854, 279.103), pup(287.854, 333.854), eye(557.855, 279.103), pup(557.855, 333.854), ex={"book": 1})
# 11 3:139 – writing + pen
face("3:139", eye(287.854, 310.407), pup(287.854, 353.009), eye(557.854, 310.407), pup(557.854, 349.599), ex={"pen": 1})
# 12 3:140 – sleepy arcs + zzz
face("3:140", eye(284.925, 353.026, vis=0), pup(230.386, 288.234, vis=0), eye(554.925, 353.026, vis=0), pup(495.141, 288.234, vis=0), ex={"arcs": 1, "zzz": 1})
# 13 3:141 – angry red face (coords recentred by -40.796)
face("3:141", eye(217.643, 381.576), pup(217.643, 381.576), eye(487.639, 381.576), pup(487.639, 389.637),
     cropL=crop_rot(18.6248, 108.935, 256.824, 418.272, 341.092, dx=-40.796),
     cropR=crop_matrix(-0.94763, 0.31937, 0.31937, 0.94763, 662.271, 262.126, 418.272, 341.092),
     color="#FF3131", ex={"anger": 1})
# 14 0:27 – blushing smile
face("0:27", eye(284.925, 353.026), pup(230.386, 288.234), eye(554.925, 353.026), pup(495.141, 288.234), ex={"blush": 1})
# 15 3:142 – nervous (tilted eyes, tall pupils) + teardrop
face("3:142", eye(248.667, 432.122, rot=-3.9364), pup(246.084, 394.578, ry=137.17, rot=-3.9364),
              eye(518.031, 413.587, rot=-3.9364), pup(515.447, 376.042, ry=137.17, rot=-3.9364), ex={"tear": 1})
# 16 3:143 – drowsy, flat-top crops + alarm clock
face("3:143", eye(238.605, 335.153), pup(192.489, 305.452), eye(508.605, 335.153), pup(458.033, 305.452),
     cropL=crop_rect(65.775, 263.019, 290.110, 319.669), cropR=crop_rect(372.527, 263.019, 311.611, 319.669),
     ex={"clock": 1})
# 17 3:144 – lovestruck (heart pupils)
face("3:144", eye(284.925, 353.026), pup(230.386, 288.234, mode=1), eye(554.925, 353.026), pup(495.141, 288.234, mode=1))
# 18 3:145 – winking (right eye chevron)
face("3:145", eye(284.925, 353.026), pup(243.12, 333.854), eye(554.925, 353.026, vis=0), pup(495.141, 288.234, vis=0), ex={"chevR18": 1})
# 19 3:146 – derpy outward
face("3:146", eye(300.89, 353.026), pup(219.39, 353.026), eye(544.818, 353.026), pup(626.318, 353.026))
# 20 3:147 – bored, tilted-top lids
face("3:147", eye(284.926, 353.026), pup(230.387, 288.234), eye(554.923, 353.026), pup(495.138, 288.234),
     cropL=crop_rot(9.22299, 175.307, 230.946, 259.373, 300.165),
     cropR=crop_matrix(-0.987072, 0.160277, 0.160277, 0.987072, 650.024, 161.778, 259.373, 366.635))
# 21 3:148 – unimpressed side-eye (mirrored lids)
face("3:148", eye(284.926, 353.026), pup(230.387, 288.234), eye(554.923, 353.026), pup(495.138, 288.234),
     cropL=crop_matrix(-0.987072, 0.160277, 0.160277, 0.987072, 383.219, 230.946, 259.373, 335.726),
     cropR=crop_rot(9.22299, 441.049, 233.938, 259.373, 360.277))
# 22 3:149 – content (arch eyes) + green check
face("3:149", eye(284.925, 353.026, vis=0), pup(230.386, 288.234, vis=0), eye(554.925, 353.026, vis=0), pup(495.141, 288.234, vis=0), ex={"arches": 1, "check": 1})
# 23 3:85 – dead (X eyes) + red X
face("3:85", eye(284.925, 353.026, vis=0), pup(230.386, 288.234, vis=0), eye(554.925, 353.026, vis=0), pup(495.141, 288.234, vis=0), ex={"xeyes": 1, "redx": 1})
# 24 3:107 – alarmed (big eyes) + warning triangle
face("3:107", eye(284.88, 357.55, rx=112, ry=212), pup(230.34, 292.76), eye(554.97, 357.55, rx=112, ry=212), pup(495.19, 292.76), ex={"warn": 1})

# flatten per-face to numeric vectors --------------------------------------
def hex2rgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]

flat_faces = []
for t in faces:
    v = hex2rgb(t["color"])
    for e, p in ((t["eL"], t["pL"]), (t["eR"], t["pR"])):
        v += [e["cx"], e["cy"], e["rx"], e["ry"], e["rot"], e["vis"]]
        pv = p["vis"] if p["vis"] is not None else e["vis"]
        v += [p["cx"], p["cy"], p["rx"], p["ry"], p["rot"], pv, p["mode"]]
    v += t["cropL"] + t["cropR"]
    v += [float(t["ex"].get(k, 0)) for k in EXTRA_KEYS]
    flat_faces.append(v)

assert all(len(v) == 45 + len(EXTRA_KEYS) for v in flat_faces)

CENTERS = {
    "dots": [422.9, 395.3], "chevL04": [283.4, 338.0],
    "barR04": [544.4, 338.2], "chevBigL": [274.4, 338.0], "chevBigR": [696.2, 338.0],
    "qmark": [158.0, 284.0], "spirals": [520.0, 510.0], "mag": [472.0, 679.0],
    "bulb": [413.5, 146.2], "book": [422.9, 612.3], "pen": [820.0, 780.0], "arcs": [423.0, 353.0],
    "zzz": [690.0, 255.0], "anger": [700.0, 235.0], "blush": [422.9, 557.0], "tear": [718.0, 290.0],
    "clock": [684.1, 593.5], "chevR18": [576.0, 353.0], "arches": [422.9, 318.0], "check": [422.9, 615.0],
    "xeyes": [422.9, 330.0], "redx": [422.9, 611.5], "warn": [422.9, 664.9],
}

extras_svg = "\n".join(f'<g id="x-{k}"><g class="st">{F[k]}</g></g>' for k in EXTRA_KEYS)

# ---- component export: python3 build.py --json -----------------------------
if "--json" in __import__("sys").argv:
    import math as _math
    import xml.etree.ElementTree as _ET

    def _parse_mat(tr):
        M = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
        for fn, arg in re.findall(r'(\w+)\s*\(([^)]*)\)', tr or ""):
            a = [float(x) for x in re.findall(r'-?\d+\.?\d*', arg)]
            if fn == 'translate':
                m = (1, 0, 0, 1, a[0], a[1] if len(a) > 1 else 0)
            elif fn == 'scale':
                m = (a[0], 0, 0, a[1] if len(a) > 1 else a[0], 0, 0)
            elif fn == 'rotate':
                th = _math.radians(a[0]); co, si = _math.cos(th), _math.sin(th)
                if len(a) == 3:
                    cxr, cyr = a[1], a[2]
                    m = (co, si, -si, co, cxr - co * cxr + si * cyr, cyr - si * cxr - co * cyr)
                else:
                    m = (co, si, -si, co, 0, 0)
            elif fn == 'matrix':
                m = tuple(a[:6])
            else:
                m = (1, 0, 0, 1, 0, 0)
            M = (M[0]*m[0] + M[2]*m[1], M[1]*m[0] + M[3]*m[1],
                 M[0]*m[2] + M[2]*m[3], M[1]*m[2] + M[3]*m[3],
                 M[0]*m[4] + M[2]*m[5] + M[4], M[1]*m[4] + M[3]*m[5] + M[5])
        return M

    def _xform_d(d, M):
        toks = re.findall(r'[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?', d)
        a, b, c, dd, e, f = M
        out = []; i = 0; cx = cy = 0.0; sx = sy = 0.0; cmd = 'M'
        def p2(x, y):
            return f"{(a*x + c*y + e):.3f} {(b*x + dd*y + f):.3f}"
        CNT = {'M': 2, 'L': 2, 'C': 6, 'S': 4, 'Q': 4, 'T': 2}
        while i < len(toks):
            t = toks[i]
            if re.fullmatch(r'[A-Za-z]', t):
                cmd = t; i += 1
                if cmd in ('Z', 'z'):
                    out.append('Z'); cx, cy = sx, sy
                    continue
                if cmd in ('H', 'V'):
                    v = float(toks[i]); i += 1
                    if cmd == 'H':
                        cx = v
                    else:
                        cy = v
                    out.append('L'); out.append(p2(cx, cy))
                    continue
                out.append(cmd)
                continue
            n = CNT[cmd]
            args = [float(x) for x in toks[i:i + n]]; i += n
            pts = [args[k:k + 2] for k in range(0, n, 2)]
            for (px_, py_) in pts:
                out.append(p2(px_, py_))
            if cmd == 'M':
                sx, sy = args[-2], args[-1]
            cx, cy = args[-2], args[-1]
        return " ".join(out)

    def _nodes(frag, M0=(1.0, 0.0, 0.0, 1.0, 0.0, 0.0)):
        root = _ET.fromstring(f'<r xmlns="http://www.w3.org/2000/svg">{frag}</r>')
        shapes = []
        def walk(el, M):
            for ch in el:
                tag = ch.tag.split('}')[1]
                M1 = _parse_mat(ch.get('transform'))
                A, B = M, M1
                MM = (A[0]*B[0] + A[2]*B[1], A[1]*B[0] + A[3]*B[1],
                      A[0]*B[2] + A[2]*B[3], A[1]*B[2] + A[3]*B[3],
                      A[0]*B[4] + A[2]*B[5] + A[4], A[1]*B[4] + A[3]*B[5] + A[5])
                if tag == 'path' and ch.get('d'):
                    s = {"d": _xform_d(ch.get('d'), MM), "fill": ch.get('fill', 'none')}
                    if ch.get('stroke'):
                        s["stroke"] = ch.get('stroke')
                        s["sw"] = float(ch.get('stroke-width') or 1)
                    shapes.append(s)
                elif tag in ('circle', 'ellipse'):
                    ccx = float(ch.get('cx') or 0); ccy = float(ch.get('cy') or 0)
                    rx_ = float(ch.get('rx') or ch.get('r') or 0)
                    ry_ = float(ch.get('ry') or ch.get('r') or 0)
                    kk = 0.55228475
                    d = (f"M {ccx - rx_} {ccy} "
                         f"C {ccx - rx_} {ccy - ry_ * kk} {ccx - rx_ * kk} {ccy - ry_} {ccx} {ccy - ry_} "
                         f"C {ccx + rx_ * kk} {ccy - ry_} {ccx + rx_} {ccy - ry_ * kk} {ccx + rx_} {ccy} "
                         f"C {ccx + rx_} {ccy + ry_ * kk} {ccx + rx_ * kk} {ccy + ry_} {ccx} {ccy + ry_} "
                         f"C {ccx - rx_ * kk} {ccy + ry_} {ccx - rx_} {ccy + ry_ * kk} {ccx - rx_} {ccy} Z")
                    s = {"d": _xform_d(d, MM), "fill": ch.get('fill', 'none')}
                    if ch.get('stroke'):
                        s["stroke"] = ch.get('stroke')
                        s["sw"] = float(ch.get('stroke-width') or 1)
                    shapes.append(s)
                else:
                    walk(ch, MM)
        walk(root, M0)
        return shapes

    out = {"viewBox": 845.708, "extraKeys": EXTRA_KEYS, "centers": CENTERS,
           "heartL": HEART_L, "heartR": HEART_R, "faces": [], "extras": {}}
    for t in faces:
        out["faces"].append({
            "node": t["node"], "color": t["color"],
            "eL": t["eL"], "eR": t["eR"],
            "pL": {**t["pL"], "vis": t["pL"]["vis"] if t["pL"]["vis"] is not None else t["eL"]["vis"]},
            "pR": {**t["pR"], "vis": t["pR"]["vis"] if t["pR"]["vis"] is not None else t["eR"]["vis"]},
            "cropL": None if t["cropL"] is NOOP else t["cropL"],
            "cropR": None if t["cropR"] is NOOP else t["cropR"],
            "ex": t["ex"]})
    for k in EXTRA_KEYS:
        out["extras"][k] = _nodes(F.get(k, ""))
    # the cloud body (figma node 12:2): same eye scale as the faces, so it
    # drops onto the content 1:1; the app places it (anchors + stage fit)
    _cloud_svg = (ROOT / "assets" / "cloud" / "cloud_12_2.svg").read_text()
    _cm = re.search(r'id="Cloud body"[^>]*d="([^"]+)"', _cloud_svg)
    out["cloud"] = {"d": _cm.group(1), "fill": "#8293FF"}
    # figma node 38:205 triangle (#0BCAFF); normalize H/V commands to L so the
    # morph engine's path sampler only sees M/L/C/Z
    _tri_svg = (ROOT / "assets" / "triangle" / "tri_38_205.svg").read_text()
    _tm = re.search(r'id="Polygon 1" d="([^"]+)" fill="(#\w+)"', _tri_svg)
    _d = _tm.group(1)
    # H346.784 -> L 346.784 <prev y>: the engine's sampler needs M/L/C/Z only
    _d = re.sub(r"(-?[\d.]+)\s+(-?[\d.]+)\s*H\s*(-?[\d.]+)", r"\1 \2 L \3 \2", _d)
    out["triangle"] = {"d": _d, "fill": _tm.group(2)}
    _hex_svg = (ROOT / "assets" / "hexagon" / "hex_12_77.svg").read_text()
    _hm = re.search(r'id="Polygon 2" d="([^"]+)" fill="(#\w+)"', _hex_svg)
    _hd = _hm.group(1)
    _hd = re.sub(r"(-?[\d.]+)\s+(-?[\d.]+)\s*H\s*(-?[\d.]+)", r"\1 \2 L \3 \2", _hd)
    out["hexagon"] = {"d": _hd, "fill": _hm.group(2)}
    _dia_svg = (ROOT / "assets" / "diamond" / "dia_12_92.svg").read_text()
    _dm = re.search(r'id="Polygon 2" d="([^"]+)" fill="(#\w+)"', _dia_svg)
    _dd = _dm.group(1)
    _dd = re.sub(r"(-?[\d.]+)\s+(-?[\d.]+)\s*H\s*(-?[\d.]+)", r"\1 \2 L \3 \2", _dd)
    out["diamond"] = {"d": _dd, "fill": _dm.group(2)}
    _sb_svg = (ROOT / "assets" / "starburst" / "sb_12_172.svg").read_text()
    _sm = re.search(r'id="Star 1" d="([^"]+)" fill="(#\w+)"', _sb_svg)
    _sd = _sm.group(1)
    _sd = re.sub(r"(-?[\d.]+)\s+(-?[\d.]+)\s*H\s*(-?[\d.]+)", r"\1 \2 L \3 \2", _sd)
    out["starburst"] = {"d": _sd, "fill": _sm.group(2)}
    _tg_svg = (ROOT / "assets" / "trigon" / "tri_12_72.svg").read_text()
    _gm = re.search(r'id="Polygon 2" d="([^"]+)" fill="(#\w+)"', _tg_svg)
    _gd = _gm.group(1)
    _gd = re.sub(r"(-?[\d.]+)\s+(-?[\d.]+)\s*H\s*(-?[\d.]+)", r"\1 \2 L \3 \2", _gd)
    out["trigon"] = {"d": _gd, "fill": _gm.group(2)}
    _dr_svg = (ROOT / "assets" / "droplet" / "dr_22_3.svg").read_text()
    _rm = re.search(r'id="Droplet" d="([^"]+)" fill="(#\w+)"', _dr_svg)
    _rd = _rm.group(1)
    _rd = re.sub(r"(-?[\d.]+)\s+(-?[\d.]+)\s*H\s*(-?[\d.]+)", r"\1 \2 L \3 \2", _rd)
    out["droplet"] = {"d": _rd, "fill": _rm.group(2)}
    _p = pathlib.Path("component/src/data.json")
    _p.write_text(json.dumps(out))
    print("wrote component/src/data.json:", len(json.dumps(out)), "chars,", len(out["faces"]), "faces, cloud", len(_cm.group(1)), "chars")

# ---------------------------------------------------------------- engine
ENGINE = r"""
const N = FACES.length;
const q = new URLSearchParams(location.search);
const STILL = q.get('still') === '1' || (q.get('still') !== '0' && matchMedia('(prefers-reduced-motion: reduce)').matches);
const FF = Math.max(0, parseInt(q.get('ff'), 10) || 0);   // fast-forward N ms at load (for testing exact moments)
const HOLD_FIX = Math.max(0, parseInt(q.get('hold'), 10) || 0);   // fixed hold time in ms
const ONLY = (q.get('only') || '').split(',').map((s) => parseInt(s, 10)).filter((n) => n >= 1 && n <= FACES.length);
const SEQ = ONLY.length ? ONLY.map((n) => n - 1) : FACES.map((_, k) => k);
let i = Math.max(0, Math.min(N - 1, (parseInt(q.get('face'), 10) || 1) - 1));
if (!SEQ.includes(i)) i = SEQ[0];
let j = i, phase = 'hold', tPhase = 0, pause = false;
let holdMs = HOLD_FIX || (i === 0 ? 20000 : 2900);
const MORPH_MS = 1060;
let last = performance.now();
const $ = (id) => document.getElementById(id);

const E = { face: $('face'), stage: $('stageg'), hud: $('hud'), eye: {} };
['L', 'R'].forEach((s) => {
  E.eye[s] = {
    wrap: $('eye' + s + 'wrap'), shape: $('eye' + s + 'shape'), clip: $('eyeClip' + s + 'shape'),
    pupil: $('pupil' + s), heart: $('heart' + s), lid: $('lid' + s), crop: $('crop' + s + 'poly'),
  };
});
const X = {};
EXTRA_KEYS.forEach((k) => { X[k] = $('x-' + k); });
const EX0 = 45;

// dots system: F02 typing row <-> F03 spinner (spin-in on morph, gather loop on hold)
const DOTS = [$('dotrow0'), $('dotrow1'), $('dotrow2')];
const DOTS_ROW = [[287.854, 395.304], [422.854, 395.304], [557.854, 395.304]];
const DOTS_SPIN = [[280.655, 286.136], [601.021, 370.854], [370.854, 557.273]];  // figma face-3 layout: A, B, C
const DOTS_CEN = [422.854, 422.854];
// spinner gather loop (from the spin reference file): C tucks into the center, then A, then B;
// then B pops back out, then A, then C. end pose == start pose, so it repeats seamlessly.
// under the gathers the whole ring keeps spinning (same direction as the swirl-in).
const SPIN_SEG = 300, SPIN_PERIOD = 2450;
const SPIN_ROT = 0.18;   // deg/ms: ring rotation speed (~2s per turn)
const SPIN_RAMP = 500;   // spin-up time after the hold starts
const SPIN_ORIG = [417.51, 404.754];  // centroid of the three slots: the ring rotates rigidly about this (no sway)
const TUCK_IN = [800, 1100, 500];     // per dot A, B, C: tuck-in start
const TUCK_OUT = [1850, 1550, 2150];  // pop-out start
const easeSin = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);   // gentle glide for the dives
function tuckU(t, tin, tout) {
  if (t < tin) return 0;
  if (t < tin + SPIN_SEG) return easeSin((t - tin) / SPIN_SEG);
  if (t < tout) return 1;
  if (t < tout + SPIN_SEG) return 1 - easeSin((t - tout) / SPIN_SEG);
  return 0;
}
[2, 0, 1].forEach((k) => DOTS[k].parentNode.appendChild(DOTS[k]));  // paint order C < A < B, so dots stack on top of each other at the center
let holdT0 = 0;
const SPIRALS = Array.from(document.querySelectorAll('#x-spirals .spiral'));
const SPIRAL_PATHS = SPIRALS.map((el) => el.firstElementChild);
const SPIRAL_LEN = SPIRAL_PATHS.map((p) => p.getTotalLength());
const SPIRAL_MARCH_MS = 640;                 // time for the pattern to advance one dash+gap
const SPIRAL_DASH = 0.14, SPIRAL_GAP = 0.11; // exactly 4 chasing arcs per spiral

const lerp = (a, b, t) => a + (b - a) * t;
const easeMorph = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth5 = (t) => t * t * t * (t * (t * 6 - 15) + 10);   // zero velocity AND acceleration at both ends
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// ---- eye motion state
const gaze = { x: 0, y: 0, fx: 0, fy: 0, tx: 0, ty: 0, t0: 0, dur: 1 };
const blink = { v: 0, state: 'idle', t0: 0, next: 0 };
let nextS = 0, pointer = null, gazeSweepL = 0, gazeSweepA = 0;
let curEyeRx = 106, curPupRx = 81.5;   // for gaze clamp (updated in apply)

addEventListener('pointermove', (e) => {
  const r = E.face.getBoundingClientRect();
  pointer = { x: (e.clientX - r.left) / r.width * 845.708, y: (e.clientY - r.top) / r.height * 845.708 };
});

function rnd(a, b) { return a + Math.random() * (b - a); }

function triggerSaccade(now) {
  gaze.fx = gaze.x; gaze.fy = gaze.y;
  let tx, ty;
  const goPtr = pointer && Math.random() < 0.5;
  if (goPtr) {
    const dx = pointer.x - 422.854, dy = pointer.y - 422.854;
    const m = Math.hypot(dx, dy) || 1;
    const rr = rnd(18, 60);
    tx = dx / m * rr + rnd(-14, 14); ty = dy / m * rr * 0.75 + rnd(-10, 10);
  } else {
    const a = rnd(0, Math.PI * 2);
    const rr = Math.random() < 0.35 ? rnd(50, 95) : rnd(10, 48);
    tx = Math.cos(a) * rr; ty = Math.sin(a) * rr * 0.8;
  }
  const lim = 95;
  const m2 = Math.hypot(tx, ty);
  if (m2 > lim) { tx = tx / m2 * lim; ty = ty / m2 * lim; }
  gaze.tx = tx; gaze.ty = ty; gaze.t0 = now;
  gaze.dur = Math.random() < 0.12 ? rnd(380, 520) : rnd(140, 300);
}

function idleSaccade(now) {
  // the idle face: the eyes rove the whole reachable field, calmly. The eye
  // is a tall oval so vertical travel dominates — the pupil orbits the
  // ellipse of its poses (x +4..+105, y -76..+206 around the rest pose)
  // with slow glides, long dwells and unhurried 360 sweeps.
  gaze.fx = gaze.x; gaze.fy = gaze.y;
  const OX = 54.5, OY = 65, RX = 45, RY = 127;
  let tx, ty, dur;
  const r = Math.random();
  if (gazeSweepL > 0) {
    gazeSweepA += Math.PI / 4; gazeSweepL--;
    tx = OX + Math.cos(gazeSweepA) * RX; ty = OY + Math.sin(gazeSweepA) * RY;
    dur = rnd(540, 720); nextS = now + rnd(430, 640);
  } else if (r < 0.09) {
    gazeSweepL = 7; gazeSweepA = rnd(0, Math.PI * 2);
    tx = OX + Math.cos(gazeSweepA) * RX; ty = OY + Math.sin(gazeSweepA) * RY;
    dur = rnd(560, 760); nextS = now + rnd(500, 700);
  } else if (r < 0.4) {
    const a = rnd(0, Math.PI * 2), rr = Math.sqrt(Math.random());
    tx = OX + Math.cos(a) * RX * rr; ty = OY + Math.sin(a) * RY * rr;
    dur = rnd(480, 880); nextS = now + rnd(1100, 2600);
  } else if (r < 0.72) {
    tx = Math.max(4, Math.min(105, gaze.x + rnd(-14, 14)));
    ty = Math.max(-76, Math.min(206, gaze.y + rnd(-22, 22)));
    dur = rnd(320, 500); nextS = now + rnd(750, 1700);
  } else {
    tx = OX + rnd(-1, 1) * RX * 0.8; ty = OY + rnd(-1, 1) * RY * 0.8;
    dur = rnd(420, 640); nextS = now + rnd(900, 2000);
  }
  gaze.tx = tx; gaze.ty = ty; gaze.t0 = now; gaze.dur = dur;
}

function scheduleNext(now) {
  nextS = now + rnd(650, 2200);
  blink.next = now + rnd(2300, 5200);
}

function beginMorph(now) {
  gaze.fx = gaze.x; gaze.fy = gaze.y;
  gaze.tx = 0; gaze.ty = 0; gaze.t0 = now; gaze.dur = Math.round(MORPH_MS * 0.55);
}

function stepEyeMotion(now, dt) {
  if (STILL || pause) return;
  if (phase === 'hold' && now >= nextS) { if (i === 0) { idleSaccade(now); } else { triggerSaccade(now); nextS = now + rnd(650, 2200); } }
  // gaze tween always runs (settles to 0 during morphs)
  let k = Math.min(1, (now - gaze.t0) / gaze.dur);
  k = easeOut(k);
  gaze.x = lerp(gaze.fx, gaze.tx, k);
  gaze.y = lerp(gaze.fy, gaze.ty, k);
  // blinks only while holding a face
  if (phase !== 'hold') return;
  if (blink.state === 'idle' && now >= blink.next) { blink.state = 'closing'; blink.t0 = now; }
  if (blink.state === 'closing') {
    const k2 = Math.min(1, (now - blink.t0) / 75);
    blink.v = easeOut(k2);
    if (k2 >= 1) { blink.state = 'closed'; blink.t0 = now; }
  } else if (blink.state === 'closed') {
    if (now - blink.t0 > 38) { blink.state = 'opening'; blink.t0 = now; }
  } else if (blink.state === 'opening') {
    const k2 = Math.min(1, (now - blink.t0) / 115);
    blink.v = 1 - (k2 < 0.5 ? 2 * k2 * k2 : 1 - Math.pow(-2 * k2 + 2, 2) / 2);
    if (k2 >= 1) { blink.state = 'idle'; blink.v = 0; blink.next = now + (Math.random() < 0.2 ? 280 : rnd(2300, 5200)); }
  }
}

// ---- apply tweened params to DOM
function mixColor(fa, fb, t) {
  return `rgb(${Math.round(lerp(fa[0], fb[0], t))},${Math.round(lerp(fa[1], fb[1], t))},${Math.round(lerp(fa[2], fb[2], t))})`;
}

let lastHud = '';
function apply(P, fa, fb, t) {
  E.face.setAttribute('fill', mixColor(fa, fb, t));
  ['L', 'R'].forEach((s, si) => {
    const o = 3 + si * 13;
    const ecx = P[o], ecy = P[o + 1], erx = P[o + 2], ery = P[o + 3], erot = P[o + 4], evis = P[o + 5];
    const pcx = P[o + 6], pcy = P[o + 7], prx = P[o + 8], pry = P[o + 9], prot = P[o + 10], pvis = P[o + 11], pmode = P[o + 12];
    const e = E.eye[s];
    if (si === 0) { curEyeRx = erx; curPupRx = prx; }
    e.wrap.setAttribute('opacity', evis.toFixed(3));
    const rot = erot ? ` rotate(${erot.toFixed(3)} ${ecx.toFixed(2)} ${ecy.toFixed(2)})` : '';
    if (rot) { e.shape.setAttribute('transform', rot); } else { e.shape.removeAttribute('transform'); }
    e.shape.setAttribute('cx', ecx.toFixed(2)); e.shape.setAttribute('cy', ecy.toFixed(2));
    e.shape.setAttribute('rx', erx.toFixed(2)); e.shape.setAttribute('ry', ery.toFixed(2));
    e.clip.setAttribute('cx', ecx.toFixed(2)); e.clip.setAttribute('cy', ecy.toFixed(2));
    e.clip.setAttribute('rx', erx.toFixed(2)); e.clip.setAttribute('ry', ery.toFixed(2));
    if (rot) { e.clip.setAttribute('transform', rot); } else { e.clip.removeAttribute('transform'); }
    // pupil + gaze
    const gx = STILL ? 0 : gaze.x, gy = STILL ? 0 : gaze.y;
    const px = pcx + gx, py = pcy + gy;
    e.pupil.setAttribute('cx', px.toFixed(2)); e.pupil.setAttribute('cy', py.toFixed(2));
    e.pupil.setAttribute('rx', prx.toFixed(2)); e.pupil.setAttribute('ry', pry.toFixed(2));
    if (prot) { e.pupil.setAttribute('transform', `rotate(${prot.toFixed(3)} ${px.toFixed(2)} ${py.toFixed(2)})`); }
    else { e.pupil.removeAttribute('transform'); }
    const heartOp = pvis * pmode;
    e.pupil.setAttribute('opacity', (pvis * (1 - pmode)).toFixed(3));
    e.heart.setAttribute('opacity', heartOp.toFixed(3));
    if (erot) { e.heart.setAttribute('transform', `rotate(${prot.toFixed(3)} ${pcx.toFixed(2)} ${pcy.toFixed(2)})`); }
    else { e.heart.removeAttribute('transform'); }
    // blink lid
    const lid = e.lid;
    const lx = ecx - erx - 26, ly = ecy - ery - 26, lw = 2 * erx + 52, lh = 2 * ery + 52;
    lid.setAttribute('x', lx.toFixed(2)); lid.setAttribute('y', ly.toFixed(2));
    lid.setAttribute('width', lw.toFixed(2)); lid.setAttribute('height', lh.toFixed(2));
    lid.setAttribute('fill', mixColor(fa, fb, t));
    const bv = STILL ? 0 : blink.v;
    const bv2 = Math.max(bv, 0.0001);   // 0 -> fully retracted lid, never a no-op "none"
    lid.setAttribute('transform', `translate(0 ${ly.toFixed(2)}) scale(1 ${bv2.toFixed(4)}) translate(0 ${(-ly).toFixed(2)})`);
    // crop polygon
    const co = 29 + si * 8;
    const pts = [];
    for (let k2 = 0; k2 < 8; k2 += 2) pts.push(P[co + k2].toFixed(1) + ',' + P[co + k2 + 1].toFixed(1));
    e.crop.setAttribute('points', pts.join(' '));
  });
  // extras
  for (let k2 = 0; k2 < EXTRA_KEYS.length; k2++) {
    const key = EXTRA_KEYS[k2];
    const op = P[EX0 + k2];
    const el = X[key];
    el.style.opacity = op.toFixed(3);
    el.style.display = op < 0.004 ? 'none' : '';
    if (op > 0.004 && op < 0.996) {
      const c = CENTERS[key];
      const s = 0.9 + 0.1 * op;
      el.firstElementChild.setAttribute('transform', `translate(${c[0]} ${c[1]}) scale(${s.toFixed(4)}) translate(${-c[0]} ${-c[1]})`);
    } else if (op >= 0.996) {
      el.firstElementChild.removeAttribute('transform');
    }
  }
  // hud
  const hud = String(i + 1).padStart(2, '0') + ' / ' + N;
  if (hud !== lastHud) { E.hud.textContent = hud; lastHud = hud; }
}

function frame(now) {
  const dt = Math.min(80, now - last); last = now;
  if (!pause) {
    tPhase += dt;
    if (phase === 'hold') {
      if (!STILL && tPhase >= holdMs) { // start morph
        j = SEQ[(SEQ.indexOf(i) + 1) % SEQ.length]; phase = 'morph'; tPhase = 0; beginMorph(now);
      }
    } else if (phase === 'morph') {
      if (tPhase >= MORPH_MS) { i = j; phase = 'hold'; tPhase = 0; holdT0 = now; holdMs = HOLD_FIX || (i === 0 ? 20000 : rnd(2600, 3500) + (i === 2 ? 2700 : 0)); scheduleNext(now); }   // face 3 lingers ~2.7s longer
    }
  }
  stepEyeMotion(now, dt);
  const t = phase === 'morph' ? smooth5(Math.min(1, tPhase / MORPH_MS)) : 1;
  apply(phase === 'morph' ? blend(FACES[i], FACES[j], t) : FACES[i], FACES[i], FACES[j], t);
  // dots system: typing on F02, spin-in/out to the F03 spinner
  {
    const opDots = parseFloat(X.dots.style.opacity || '0');
    if (opDots > 0.01) {
      const C = DOTS_CEN;
      const toPolar = (arr) => arr.map((p) => [Math.hypot(p[0] - C[0], p[1] - C[1]), Math.atan2(p[1] - C[1], p[0] - C[0])]);
      let pos, bob = [0, 0, 0];
      if (STILL) {
        pos = (i === 2) ? DOTS_SPIN : DOTS_ROW;
      } else if (phase === 'morph' && ((i === 1 && j === 2) || (i === 2 && j === 1))) {
        const st = (i === 1) ? t : 1 - t;
        const exr = st;   // revolution shares the same curve as the travel, so they finish together
        const P_ROW = toPolar(DOTS_ROW), P_SPIN = toPolar(DOTS_SPIN);
        const dir = (i === 1) ? 1 : -1;
        pos = P_ROW.map(([r0, a0], k) => {
          let d = P_SPIN[k][1] - a0;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          const r = r0 + (P_SPIN[k][0] - r0) * st;
          const a = a0 + d * st + dir * 2 * Math.PI * exr;
          return [C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)];
        });
      } else if ((phase === 'hold' && i === 2) || (phase === 'morph' && (i === 2 || j === 2))) {
        const tAbs = Math.max(0, now - holdT0);
        const tCyc = tAbs % SPIN_PERIOD;
        // rotation ramps in with zero acceleration (smootherstep integral), then constant
        const toRot = (t) => {
          const x = Math.min(1, Math.max(0, t) / SPIN_RAMP);
          const ramp = t < SPIN_RAMP ? SPIN_RAMP * x * x * x * x * (x * x - 3 * x + 2.5) : t - SPIN_RAMP / 2;
          return SPIN_ROT * ramp * Math.PI / 180;
        };
        const rigid = (k, rot) => {   // where slot k sits on the spinning ring at this angle
          const ca = Math.cos(rot), sa = Math.sin(rot);
          const bx = DOTS_SPIN[k][0] - SPIN_ORIG[0], by = DOTS_SPIN[k][1] - SPIN_ORIG[1];
          return [SPIN_ORIG[0] + bx * ca - by * sa, SPIN_ORIG[1] + bx * sa + by * ca];
        };
        pos = DOTS_SPIN.map((p, k) => {
          const tin = TUCK_IN[k], tout = TUCK_OUT[k];
          if (tCyc >= tin && tCyc < tin + SPIN_SEG) {         // dive: straight glide from the ring point to the center
            const u = easeSin((tCyc - tin) / SPIN_SEG);
            const P0 = rigid(k, toRot(tAbs - (tCyc - tin)));
            return [P0[0] + (C[0] - P0[0]) * u, P0[1] + (C[1] - P0[1]) * u];
          }
          if (tCyc >= tout && tCyc < tout + SPIN_SEG) {       // pop: straight glide from the center out to the landing point
            const u = easeSin((tCyc - tout) / SPIN_SEG);
            const P1 = rigid(k, toRot(tAbs + (tout + SPIN_SEG - tCyc)));
            return [C[0] + (P1[0] - C[0]) * u, C[1] + (P1[1] - C[1]) * u];
          }
          if (tCyc >= tin + SPIN_SEG && tCyc < tout) return [C[0], C[1]];   // docked on the center
          return rigid(k, toRot(tAbs));                       // riding the ring
        });
      } else {
        pos = DOTS_ROW;
        if (phase === 'hold' && i === 1) {
          const period = 1150, stagger = 190, amp = 15;
          bob = [0, 1, 2].map((k) => {
            const ph = (((now - k * stagger) % period) + period) % period / period;
            return ph < 0.5 ? -amp * Math.sin(Math.PI * ph / 0.5) : 0;
          });
        }
      }
      for (let k = 0; k < 3; k++) {
        const s = 1 - 0.11 * (bob[k] / 15);
        const b = DOTS_ROW[k];
        DOTS[k].setAttribute('transform',
          `translate(${pos[k][0].toFixed(2)} ${(pos[k][1] + bob[k]).toFixed(2)}) scale(${s.toFixed(4)}) translate(${-b[0]} ${-b[1]})`);
      }
    } else {
      DOTS.forEach((el) => el.removeAttribute('transform'));
    }
  }
  // F07 dizzy lines: four arcs chase each other down the spiral and into the eye center.
  // the pattern advances exactly one dash+gap per period, so it wraps seamlessly.
  {
    const opSp = parseFloat(X.spirals.style.opacity || '0');
    if (opSp > 0.01 && !STILL) {
      const ph = (now % SPIRAL_MARCH_MS) / SPIRAL_MARCH_MS;
      for (let k = 0; k < SPIRAL_PATHS.length; k++) {
        const p = SPIRAL_PATHS[k], L = SPIRAL_LEN[k];
        p.setAttribute('stroke-dasharray', `${(L * SPIRAL_DASH).toFixed(1)} ${(L * SPIRAL_GAP).toFixed(1)}`);
        p.setAttribute('stroke-dashoffset', (ph * (SPIRAL_DASH + SPIRAL_GAP) * L).toFixed(1));
      }
    } else {
      for (const p of SPIRAL_PATHS) { p.removeAttribute('stroke-dasharray'); p.removeAttribute('stroke-dashoffset'); }
    }
  }
  // breathing on stage
  if (!STILL) {
    const b = 1 + 0.0045 * Math.sin(now / 2600 * Math.PI);
    E.stage.setAttribute('transform', `translate(422.854 422.854) scale(${b.toFixed(5)}) translate(-422.854 -422.854)`);
  }
  if (!FF) requestAnimationFrame(frame);
}

function blend(a, b, t) {
  const out = new Array(a.length);
  for (let k2 = 0; k2 < a.length; k2++) out[k2] = a[k2] + (b[k2] - a[k2]) * t;
  return out;
}

// controls
function advance(dir) {
  if (phase === 'morph') return;
  const pos = SEQ.indexOf(i);
  j = SEQ[(pos + dir + SEQ.length) % SEQ.length]; phase = 'morph'; tPhase = 0;
}
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') advance(1);
  else if (e.key === 'ArrowLeft') advance(-1);
  else if (e.key === ' ') { e.preventDefault(); pause = !pause; }
});
addEventListener('click', () => advance(1));

scheduleNext(0);
if (FF) {
  const step = 16.67;
  for (let tt = step; tt <= FF; tt += step) frame(tt);
} else {
  requestAnimationFrame(frame);
}
"""

# ---------------------------------------------------------------- html
HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>bob · faces</title>
<style>
  html, body { margin: 0; height: 100%; background: #0e0e11; overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center; }
  #stage { width: min(86vmin, 780px); height: auto; display: block; }
  #hud {
    position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%);
    font: 500 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.22em; color: rgba(255,255,255,0.42); user-select: none;
  }
  #hint {
    position: fixed; right: 18px; bottom: 22px;
    font: 500 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.12em; color: rgba(255,255,255,0.22); user-select: none;
    transition: opacity 1.2s ease; 
  }
  #hint.off { opacity: 0; }
</style>
</head>
<body>
<svg id="stage" viewBox="0 0 845.708 845.708" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="eyeClipL"><ellipse id="eyeClipLshape"/></clipPath>
    <clipPath id="eyeClipR"><ellipse id="eyeClipRshape"/></clipPath>
    <clipPath id="cropLclip"><polygon id="cropLpoly"/></clipPath>
    <clipPath id="cropRclip"><polygon id="cropRpoly"/></clipPath>
  </defs>
  <g id="stageg">
    <circle id="face" cx="422.854" cy="422.854" r="422.854" fill="#D9D9D9"/>
    <g id="eyeLwrap">
      <g clip-path="url(#cropLclip)">
        <ellipse id="eyeLshape" fill="black"/>
        <g clip-path="url(#eyeClipL)">
          <ellipse id="pupilL" fill="white"/>
          <path id="heartL" d="__HEART_L__" fill="white" opacity="0"/>
          <rect id="lidL" fill="#D9D9D9"/>
        </g>
      </g>
    </g>
    <g id="eyeRwrap">
      <g clip-path="url(#cropRclip)">
        <ellipse id="eyeRshape" fill="black"/>
        <g clip-path="url(#eyeClipR)">
          <ellipse id="pupilR" fill="white"/>
          <path id="heartR" d="__HEART_R__" fill="white" opacity="0"/>
          <rect id="lidR" fill="#D9D9D9"/>
        </g>
      </g>
    </g>
    <g id="xextras">
__EXTRAS__
    </g>
  </g>
</svg>
<div id="hud">01 / 24</div>
<div id="hint">&larr; &rarr; · space</div>
<script>
const FACES = [__FACES__];
const EXTRA_KEYS = __EXKEYS__;
const CENTERS = __CENTERS__;
__ENGINE__
setTimeout(() => document.getElementById('hint').classList.add('off'), 6000);
</script>
</body>
</html>
"""

faces_js = ",\n".join("[" + ",".join(f"{v:.4f}" if isinstance(v, float) else str(v) for v in row) + "]" for row in flat_faces)

html = (HTML
        .replace("__HEART_L__", HEART_L)
        .replace("__HEART_R__", HEART_R)
        .replace("__EXTRAS__", extras_svg)
        .replace("__FACES__", faces_js)
        .replace("__EXKEYS__", json.dumps(EXTRA_KEYS))
        .replace("__CENTERS__", json.dumps(CENTERS))
        .replace("__ENGINE__", ENGINE))

(ROOT / "index.html").write_text(html)
print(f"wrote index.html ({len(html)} bytes); faces={len(flat_faces)}; extras={len(EXTRA_KEYS)}")
