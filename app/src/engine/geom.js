// path + color utilities shared by the morph engine

export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth5 = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const easeMorph = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeSin = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);

// ellipse as a 4-segment cubic path (rotation baked in)
const K = 0.5522847498307936;
export function ellipsePath(cx, cy, rx, ry, rot = 0) {
  const th = (rot * Math.PI) / 180;
  const co = Math.cos(th), si = Math.sin(th);
  const T = ([x, y]) => [
    cx + (x - cx) * co - (y - cy) * si,
    cy + (x - cx) * si + (y - cy) * co,
  ];
  const p = [
    [cx + rx, cy], [cx + rx, cy + ry * K], [cx + rx * K, cy + ry], [cx, cy + ry],
    [cx - rx * K, cy + ry], [cx - rx, cy + ry * K], [cx - rx, cy],
    [cx - rx, cy - ry * K], [cx - rx * K, cy - ry], [cx, cy - ry],
    [cx + rx * K, cy - ry], [cx + rx, cy - ry * K], [cx + rx, cy],
  ].map(T);
  let d = `M ${p[0][0].toFixed(2)} ${p[0][1].toFixed(2)}`;
  for (let i = 1; i < p.length; i += 3) {
    d += ` C ${p[i][0].toFixed(2)} ${p[i][1].toFixed(2)} ${p[i + 1][0].toFixed(2)} ${p[i + 1][1].toFixed(2)} ${p[i + 2][0].toFixed(2)} ${p[i + 2][1].toFixed(2)}`;
  }
  return d + " Z";
}

export const tinyCircle = (cx, cy, r = 1.5) => ellipsePath(cx, cy, r, r);

// centroid + approximate area sampled from an absolute M/C/L/Z path
export function tess(pathD, steps = 8) {
  const toks = pathD.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const pts = [];
  let i = 0, x = 0, y = 0, sx = 0, sy = 0, cmd = "M";
  const push = (px, py) => pts.push([px, py]);
  while (i < toks.length) {
    const t = toks[i];
    if (/[A-Za-z]/.test(t)) {
      cmd = t; i += 1;
      if (cmd === "Z") { push(sx, sy); x = sx; y = sy; }
      continue;
    }
    const n = cmd === "C" ? 6 : 2;
    const a = toks.slice(i, i + n).map(Number); i += n;
    if (cmd === "C") {
      for (let k = 0; k <= steps; k++) {
        const u = k / steps, m = 1 - u;
        push(
          m*m*m*x + 3*m*m*u*a[0] + 3*m*u*u*a[2] + u*u*u*a[4],
          m*m*m*y + 3*m*m*u*a[1] + 3*m*u*u*a[3] + u*u*u*a[5],
        );
      }
    } else {
      push(a[0], a[1]);
    }
    x = a[n - 2]; y = a[n - 1];
    if (cmd === "M") { sx = x; sy = y; }
  }
  if (!pts.length) return { cx: 0, cy: 0, area: 0, pts };
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  let area2 = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    area2 += pts[k][0] * pts[k + 1][1] - pts[k + 1][0] * pts[k][1];
  }
  return { cx, cy, area: Math.abs(area2) / 2, pts };
}

const NAMED = { black: [0, 0, 0, 1], white: [255, 255, 255, 1] };
export function parseColor(c) {
  if (!c || c === "none") return [0, 0, 0, 0];
  if (NAMED[c]) return NAMED[c].slice();
  if (c[0] === "#") {
    const h = c.slice(1);
    const v = h.length === 3 ? h.split("").map((x) => x + x) : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
    return [parseInt(v[0], 16), parseInt(v[1], 16), parseInt(v[2], 16), 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const a = m[1].split(",").map(Number);
    return [a[0], a[1], a[2], a.length > 3 ? a[3] : 1];
  }
  return [0, 0, 0, 1];
}
export const colorStr = ([r, g, b, a]) =>
  a >= 0.999 ? `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
             : `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a.toFixed(3)})`;
export const lerpColor = (ca, cb, t) => {
  const A = parseColor(ca), B = parseColor(cb);
  return colorStr([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t), lerp(A[3], B[3], t)]);
};

// map every coordinate pair of an absolute-command path string through a
// similarity transform about (cx, cy). The generated face geometry uses only
// absolute M/L/C/Q commands, so a plain token walk is exact.
// rotate + translate in path-d space (transformD's sibling for the live
// character beats that need a pivot — the writing pen rocks about its nib).
// Only used on pair-per-command paths (M/L/C/Z), which is what the extras use.
export function transformDR(d, dx, dy, deg, cx, cy) {
  const toks = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const rad = (deg * Math.PI) / 180, ca = Math.cos(rad), sa = Math.sin(rad);
  const out = [];
  let px = null;
  for (const tk of toks) {
    if (/[A-Za-z]/.test(tk)) { out.push(tk); px = null; continue; }
    const v = parseFloat(tk);
    if (px === null) { px = v; continue; }
    const bx = px - cx, by = v - cy;
    out.push((cx + bx * ca - by * sa + dx).toFixed(3));
    out.push((cy + bx * sa + by * ca + dy).toFixed(3));
    px = null;
  }
  return out.join(" ");
}

// radial foreshortening inside a disc: content near the rim bends in with
// the sphere's curvature (1:1 at the centre, pulled in near the edge, the rim
// itself fixed so the silhouette never moves). Used at RENDER time on the
// timer's hand and knob so they read as sitting on a 3D ball; the morph
// engine's paths are untouched, so transitions stay smooth.
export function warpD(d, cx, cy, R, amt) {
  const toks = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const out = [];
  let px = null;
  const f = (u) => {
    const s = Math.max(0, Math.min(1, (u - 0.45) / 0.55));
    return 1 - amt * (s * s * (3 - 2 * s));
  };
  for (const tk of toks) {
    if (/[A-Za-z]/.test(tk)) { out.push(tk); px = null; continue; }
    const v = parseFloat(tk);
    if (px === null) { px = v; continue; }
    const dx = px - cx, dy = v - cy;
    const r = Math.hypot(dx, dy);
    if (r < 1e-9 || r > R) {
      out.push(px.toFixed(3)); out.push(v.toFixed(3));
    } else {
      const k = f(r / R);
      out.push((cx + dx * k).toFixed(3));
      out.push((cy + dy * k).toFixed(3));
    }
    px = null;
  }
  return out.join(" ");
}

export function transformD(d, dx, dy, sc, cx, cy) {
  const toks = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const out = [];
  let i = 0;
  for (const tk of toks) {
    if (/[A-Za-z]/.test(tk)) { out.push(tk); i = 0; continue; }
    const v = parseFloat(tk);
    out.push((i % 2 === 0 ? cx + (v - cx) * sc + dx : cy + (v - cy) * sc + dy).toFixed(3));
    i++;
  }
  return out.join(" ");
}
