// morph engine: pairs the shapes of face A with the shapes of face B and
// interpolates the actual path geometry — no opacity crossfades anywhere.
//
// Model: every shape is classified as a closed FILL region or a STROKE
// (open or closed). Before interpolating:
//   - fill <-> fill          -> ink rings, painted fill
//   - stroke <-> stroke      -> same-closure pairs keep the stroke paint
//                               (centerlines + lerped width); mixed closure
//                               cuts the closed one open
//   - fill <-> stroke        -> the stroked side is converted to its real
//                               outline (ink region), so no fill/stroke crossfade
// Rings are dense-resampled to a common count and rotation-aligned; open
// paths are resampled and orientation-matched. Then points just lerp.

import DATA from "../data.json";
import { ellipsePath, tinyCircle, lerp, lerpColor, parseColor, smooth5 } from "./geom";
import { DOTS_SPIN, DOTS_CEN } from "./clock";

export const NOOP_RECT = [-600, -600, 1446, -600, 1446, 1446, -600, 1446];

// ordered shape list of a face: eyes, pupils, then extras in canonical order
export function shapeList(face) {
  const out = [];
  if (face.eL.vis >= 0.5)
    out.push({ id: "eyeL", d: ellipsePath(face.eL.cx, face.eL.cy, face.eL.rx, face.eL.ry, face.eL.rot), fill: "black" });
  if (face.pL.vis >= 0.5)
    out.push({ id: "pupL", d: face.pL.mode >= 0.5 ? DATA.heartL : ellipsePath(face.pL.cx, face.pL.cy, face.pL.rx, face.pL.ry, face.pL.rot), fill: "white" });
  if (face.eR.vis >= 0.5)
    out.push({ id: "eyeR", d: ellipsePath(face.eR.cx, face.eR.cy, face.eR.rx, face.eR.ry, face.eR.rot), fill: "black" });
  if (face.pR.vis >= 0.5)
    out.push({ id: "pupR", d: face.pR.mode >= 0.5 ? DATA.heartR : ellipsePath(face.pR.cx, face.pR.cy, face.pR.rx, face.pR.ry, face.pR.rot), fill: "white" });
  for (const k of DATA.extraKeys) {
    if ((face.ex[k] || 0) > 0) {
      DATA.extras[k].forEach((s, i) => {
        out.push({ id: `${k}#${i}`, d: s.d, fill: s.fill || "none", stroke: s.stroke, sw: s.sw });
      });
    }
  }
  return out;
}

// --- path sampling ----------------------------------------------------------

function densePoints(d) {
  const toks = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const pts = [];
  let i = 0, x = 0, y = 0, sx = 0, sy = 0, cmd = "M";
  const push = (px, py) => {
    const l = pts[pts.length - 1];
    if (!l || Math.hypot(px - l[0], py - l[1]) > 1e-6) pts.push([px, py]);
  };
  while (i < toks.length) {
    const t = toks[i];
    if (/[A-Za-z]/.test(t)) {
      cmd = t; i += 1;
      if (cmd === "Z" || cmd === "z") { push(sx, sy); x = sx; y = sy; }
      continue;
    }
    if (cmd === "C") {
      const a = toks.slice(i, i + 6).map(Number); i += 6;
      const len = Math.hypot(a[0] - x, a[1] - y) + Math.hypot(a[2] - a[0], a[3] - a[1]) + Math.hypot(a[4] - a[2], a[5] - a[3]);
      const n = Math.max(8, Math.min(48, Math.ceil(len / 4)));
      for (let k = 1; k <= n; k++) {
        const u = k / n, m = 1 - u;
        push(
          m * m * m * x + 3 * m * m * u * a[0] + 3 * m * u * u * a[2] + u * u * u * a[4],
          m * m * m * y + 3 * m * m * u * a[1] + 3 * m * u * u * a[3] + u * u * u * a[5],
        );
      }
      x = a[4]; y = a[5];
    } else {
      const a = toks.slice(i, i + 2).map(Number); i += 2;
      if (cmd === "L") {
        const len = Math.hypot(a[0] - x, a[1] - y);
        const n = Math.max(1, Math.min(60, Math.ceil(len / 4)));
        for (let k = 1; k <= n; k++) push(x + ((a[0] - x) * k) / n, y + ((a[1] - y) * k) / n);
      } else {
        push(a[0], a[1]);
      }
      x = a[0]; y = a[1];
      if (cmd === "M") { sx = x; sy = y; }
    }
  }
  return pts;
}

function signedArea(pts) {
  let A = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    A += a[0] * b[1] - b[0] * a[1];
  }
  return A / 2;
}

function ringPerim(pts) {
  let s = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}

function openPerim(pts) {
  let s = 0;
  for (let k = 0; k < pts.length - 1; k++) s += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
  return s;
}

function resampleRing(pts, n) {
  if (pts.length < 2) {
    const p = pts[0] || [0, 0];
    return Array.from({ length: n }, () => [p[0], p[1]]);
  }
  const m = pts.length;
  const cum = [0];
  for (let k = 0; k < m; k++) {
    const a = pts[k], b = pts[(k + 1) % m];
    cum.push(cum[k] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[m] || 1;
  const out = [];
  let k = 0;
  for (let j = 0; j < n; j++) {
    const target = (j / n) * total;
    while (k < m - 1 && cum[k + 1] < target) k++;
    const a = pts[k], b = pts[(k + 1) % m];
    const seg = cum[k + 1] - cum[k] || 1;
    const u = (target - cum[k]) / seg;
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}

function resampleOpen(pts, n) {
  const m = pts.length;
  const cum = [0];
  for (let k = 0; k < m - 1; k++) cum.push(cum[k] + Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]));
  const total = cum[m - 1] || 1;
  const out = [];
  let k = 0;
  for (let j = 0; j < n; j++) {
    const target = (j / (n - 1)) * total;
    while (k < m - 2 && cum[k + 1] < target) k++;
    const a = pts[k], b = pts[k + 1];
    const seg = cum[k + 1] - cum[k] || 1;
    const u = (target - cum[k]) / seg;
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}

function bestShift(pa, pb) {
  const n = pa.length;
  const cost = (s) => {
    let d = 0;
    for (let i = 0; i < n; i++) {
      const q = pb[(i + s) % n];
      const dx = pa[i][0] - q[0], dy = pa[i][1] - q[1];
      d += dx * dx + dy * dy;
    }
    return d;
  };
  const step = Math.max(1, Math.floor(n / 64));
  let best = 0, bestD = Infinity;
  for (let s = 0; s < n; s += step) {
    const d = cost(s);
    if (d < bestD) { bestD = d; best = s; }
  }
  for (let s = best - step; s <= best + step; s++) {
    const ss = ((s % n) + n) % n;
    const d = cost(ss);
    if (d < bestD) { bestD = d; best = ss; }
  }
  return best;
}

function polyPath(p, close) {
  let d = "M " + p[0][0].toFixed(2) + " " + p[0][1].toFixed(2);
  for (let k = 1; k < p.length; k++) d += " L " + p[k][0].toFixed(2) + " " + p[k][1].toFixed(2);
  return close ? d + " Z" : d;
}

function pointCenterOf(pts) {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  return [cx / pts.length, cy / pts.length];
}

// --- ink outline of a stroked path -------------------------------------------

// fold guard: wherever the outline doubles back on itself (a needle/cusp from
// the offset construction), pull the tip home until no near-reversal remains.
// legit geometry never exceeds ~65 deg per point, so this only eats defects.
function deSpike(P) {
  let cur = P;
  for (let pass = 0; pass < 40; pass++) {
    const n = cur.length;
    let worst = 0, wi = -1;
    for (let i = 0; i < n; i++) {
      const p0 = cur[(i - 1 + n) % n], p1 = cur[i], p2 = cur[(i + 1) % n];
      const v1x = p1[0] - p0[0], v1y = p1[1] - p0[1];
      const v2x = p2[0] - p1[0], v2y = p2[1] - p1[1];
      const l1 = Math.hypot(v1x, v1y) || 1, l2 = Math.hypot(v2x, v2y) || 1;
      const ang = Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2))));
      if (ang > worst) { worst = ang; wi = i; }
    }
    if (wi < 0 || worst < 1.74) break; // ~100 deg
    const n2 = cur.length;
    const a = cur[(wi - 1 + n2) % n2], b = cur[(wi + 1) % n2];
    const nxt = cur.slice();
    nxt[wi] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    cur = nxt;
  }
  return cur;
}

// sliver collapse: doubled-back path pairs have zero area, so they are
// invisible in a held pose — but when two neighbouring points of a sliver
// interpolate toward different targets the sliver tears open mid-morph.
// Stitch each reversal shut by merging the tip with its neighbours, then
// re-uniform the ring afterwards. Legit miters (~115 deg) survive.
function collapse(P) {
  let cur = P.slice();
  for (let pass = 0; pass < 80; pass++) {
    if (cur.length <= 8) break;
    const n = cur.length;
    let wi = -1;
    for (let i = 0; i < n; i++) {
      const p0 = cur[(i - 1 + n) % n], p1 = cur[i], p2 = cur[(i + 1) % n];
      const v1x = p1[0] - p0[0], v1y = p1[1] - p0[1];
      const v2x = p2[0] - p1[0], v2y = p2[1] - p1[1];
      const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
      if (l1 < 0.25 || l2 < 0.25) { wi = i; break; }
      const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
      if (dot < -0.6) { wi = i; break; } // turn past ~127 deg
    }
    if (wi < 0) break;
    const n2 = cur.length;
    const ia = (wi - 1 + n2) % n2, ib = (wi + 1) % n2;
    const mid = [(cur[ia][0] + cur[ib][0]) / 2, (cur[ia][1] + cur[ib][1]) / 2];
    const nxt = [];
    for (let i = 0; i < n2; i++) {
      if (i === ia || i === wi) continue;
      if (i === ib) { nxt.push(mid); continue; }
      nxt.push(cur[i]);
    }
    cur = nxt;
  }
  return cur;
}

function lineIntersect(p1, d1, p2, d2) {
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}

function sideOffset(P, h, s) {
  // per-segment offsets with exact joins: no blended tangents anywhere, so a
  // corner comes out as one clean round join outside / one miter point inside
  const n = P.length;
  const seg = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = P[i + 1][0] - P[i][0], dy = P[i + 1][1] - P[i][1];
    const L = Math.hypot(dx, dy) || 1e-9;
    seg.push({ tx: dx / L, ty: dy / L, a: Math.atan2(dy, dx) });
  }
  const off = (p, a) => [
    p[0] + Math.cos(a + (s * Math.PI) / 2) * h,
    p[1] + Math.sin(a + (s * Math.PI) / 2) * h,
  ];
  const out = [];
  const put = (p) => {
    const l = out[out.length - 1];
    if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.05) out.push(p);
  };
  for (let i = 0; i < seg.length; i++) {
    const sg = seg[i];
    let miterAt = null;
    if (i === 0) {
      put(off(P[0], sg.a));
    } else {
      const pv = seg[i - 1];
      let dd = sg.a - pv.a;
      dd = ((dd + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      if (Math.abs(dd) > 0.012) {
        if (s * dd < 0) {
          // outside of the turn: round join
          const steps = Math.max(2, Math.ceil(Math.abs(dd) / 0.2));
          for (let k = 0; k <= steps; k++) {
            const aa = pv.a + (s * Math.PI) / 2 + dd * (k / steps);
            put([P[i][0] + Math.cos(aa) * h, P[i][1] + Math.sin(aa) * h]);
          }
        } else {
          // inside of the turn: the offset lines meet at the miter; pull the
          // previous segment's endpoint back to it so nothing overshoots
          const A1 = off(P[i - 1], pv.a), A2 = off(P[i], sg.a);
          const q = lineIntersect(A1, [pv.tx, pv.ty], A2, [sg.tx, sg.ty]);
          const m = q && Math.hypot(q[0] - P[i][0], q[1] - P[i][1]) < 4 * h ? q : off(P[i], sg.a);
          if (out.length && Math.hypot(out[out.length - 1][0] - P[i][0], out[out.length - 1][1] - P[i][1]) < 2 * h) {
            out[out.length - 1] = m;
          } else {
            put(m);
          }
          miterAt = m;
        }
      } else {
        put(off(P[i], sg.a));
      }
    }
    const e = off(P[i + 1], sg.a);
    if (!(miterAt && (e[0] - miterAt[0]) * sg.tx + (e[1] - miterAt[1]) * sg.ty < 0)) {
      put(e);
    }
  }
  return out;
}

function strokeOutline(ptsIn, w, isClosed) {
  let P = ptsIn;
  if (P.length > 2 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 0.5) {
    P = P.slice(0, -1);
  }
  if (P.length < 3) return null;
  const h = w / 2;

  if (isClosed) {
    const Pc = P.concat([P[0], P[1]]);
    const a = sideOffset(Pc, h, +1);
    const b = sideOffset(Pc, h, -1);
    const O = Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? a : b;
    const I = O === a ? b : a;
    return deSpike(O.concat(I.slice().reverse()));
  }

  const left = sideOffset(P, h, +1);
  const right = sideOffset(P, h, -1);
  const ang = (v) => Math.atan2(v[1], v[0]);
  const norm2pi = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const angDiff = (x, y) => { const z = norm2pi(x - y); return Math.min(z, 2 * Math.PI - z); };
  const cap = (c, fromA, toA, tipA) => {
    const dNorm = norm2pi(toA - fromA);
    const cand = [dNorm, dNorm - 2 * Math.PI];
    const sweep = angDiff(fromA + cand[0] / 2, tipA) < angDiff(fromA + cand[1] / 2, tipA) ? cand[0] : cand[1];
    const steps = Math.max(3, Math.ceil(Math.abs(sweep) / 0.3));
    const res = [];
    for (let k = 1; k < steps; k++) {
      const aa = fromA + (sweep * k) / steps;
      res.push([c[0] + Math.cos(aa) * h, c[1] + Math.sin(aa) * h]);
    }
    return res;
  };
  const n = P.length;
  const endTip = ang([P[n - 1][0] - P[n - 2][0], P[n - 1][1] - P[n - 2][1]]);
  const startTip = ang([P[0][0] - P[1][0], P[0][1] - P[1][1]]);
  const lEnd = left[left.length - 1], rEnd = right[right.length - 1];
  const capEnd = cap(P[n - 1], ang([lEnd[0] - P[n - 1][0], lEnd[1] - P[n - 1][1]]),
                     ang([rEnd[0] - P[n - 1][0], rEnd[1] - P[n - 1][1]]), endTip);
  const capStart = cap(P[0], ang([right[0][0] - P[0][0], right[0][1] - P[0][1]]),
                       ang([left[0][0] - P[0][0], left[0][1] - P[0][1]]), startTip);
  return deSpike(left.concat(capEnd, right.slice().reverse(), capStart));
}

// --- classification + pair preparation --------------------------------------

function classify(s) {
  const pts = densePoints(s.d);
  const closedByZ = /[Zz]\s*$/.test(s.d);
  const gap = pts.length > 1
    ? Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1])
    : 1e9;
  const closed = closedByZ || gap < 2;
  // a shape with an opaque fill reads as its fill region; an extra stroke just
  // fattens the edge (ignoring it would punch a phantom hole in solids)
  const hasFill = !!(s.fill && s.fill !== "none");
  const isStroke = !!(s.stroke && (s.sw || 0) > 0);
  return {
    pts, closed,
    paint: hasFill ? "fill" : isStroke ? "stroke" : "fill",
    ink: hasFill ? s.fill : isStroke ? s.stroke : s.fill || "none",
    sw: s.sw || 0,
    fat: hasFill && isStroke ? (s.sw || 0) / 2 : 0,
  };
}

// does a bare degenerate of this shape shrink in place (a round loop or a
// straight bar) rather than un-writing along its length?
function shrinksInPlace(kind) {
  if (kind.paint !== "stroke") return false;
  const n = kind.pts ? kind.pts.length : 0;
  if (kind.closed && n >= 8) {
    let mx = 0, my = 0;
    for (const p of kind.pts) { mx += p[0]; my += p[1]; }
    mx /= n; my /= n;
    let rmean = 0;
    for (const p of kind.pts) rmean += Math.hypot(p[0] - mx, p[1] - my);
    rmean /= n;
    let rvar = 0;
    for (const p of kind.pts) { const dr = Math.hypot(p[0] - mx, p[1] - my) - rmean; rvar += dr * dr; }
    const rstd = Math.sqrt(rvar / n);
    if (rmean > 4 && rstd / rmean < 0.16) return true;
  }
  if (n >= 2) {
    const p0 = kind.pts[0], p1 = kind.pts[n - 1];
    const bx = p1[0] - p0[0], by = p1[1] - p0[1];
    const L0 = Math.hypot(bx, by) || 1;
    let dev = 0;
    for (const p of kind.pts) {
      dev = Math.max(dev, Math.abs((p[0] - p0[0]) * by - (p[1] - p0[1]) * bx) / L0);
    }
    if (!kind.closed && dev < 4 && L0 > 20) return true;
  }
  return false;
}

function degenerate(kind, c, id, shrink) {
  // A stroke being drawn on or withdrawn is an ERASE/RETRACT along its own
  // length, never an imploding speck — this holds whether or not the path
  // happens to carry a closing Z (the alarm stroke, the bulb, the magnifier
  // handle all do). Ring-like loops are the exception: unwinding a gap around
  // a circle reads as "not going away" (the magnifier's lens), so a round
  // loop shrinks in place instead.
  if (kind.paint === "stroke") {
    // a leaving shape nested inside a sibling that is also leaving rides
    // that sibling's branch: if the container shrinks the inner implodes with
    // it (21->5's check), and if the container un-writes the inner un-writes
    // too (a book's spine must not deflate while its page unwinds — and the
    // reverse must write both back on)
    if (shrink === "shrink" || shrink === true) {
      const ss = 0.012;
      return {
        pts: kind.pts.map((p) => [c[0] + (p[0] - c[0]) * ss, c[1] + (p[1] - c[1]) * ss]),
        closed: false, paint: "stroke", ink: kind.ink, sw: 0,
      };
    }
    if (shrink === "erase") {
      return { pts: [[c[0] - 0.75, c[1]], [c[0] + 0.75, c[1]]], closed: false, paint: "stroke", ink: kind.ink, sw: 0, vanishes: true };
    }
    const n = kind.pts ? kind.pts.length : 0;
    if (kind.closed && n >= 8) {
      let mx = 0, my = 0;
      for (const p of kind.pts) { mx += p[0]; my += p[1]; }
      mx /= n; my /= n;
      let rmean = 0;
      for (const p of kind.pts) rmean += Math.hypot(p[0] - mx, p[1] - my);
      rmean /= n;
      let rvar = 0;
      for (const p of kind.pts) { const dr = Math.hypot(p[0] - mx, p[1] - my) - rmean; rvar += dr * dr; }
      const rstd = Math.sqrt(rvar / n);
      if (rmean > 4 && rstd / rmean < 0.16) {
        const s = 0.012;
        return {
          pts: kind.pts.map((p) => [c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s]),
          closed: true, paint: kind.paint, ink: kind.ink, sw: 0,
        };
      }
    }
    // a straight bar shrinks in place (the red X's two strokes dissolving
    // inward together); a curvy stroke unwrites along its length
    if (n >= 2) {
      const p0 = kind.pts[0], p1 = kind.pts[n - 1];
      const bx = p1[0] - p0[0], by = p1[1] - p0[1];
      const L0 = Math.hypot(bx, by) || 1;
      let dev = 0;
      for (const p of kind.pts) {
        dev = Math.max(dev, Math.abs((p[0] - p0[0]) * by - (p[1] - p0[1]) * bx) / L0);
      }
      if (!kind.closed && dev < 4 && L0 > 20) {
        const s = 0.012;
        return {
          pts: kind.pts.map((p) => [c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s]),
          closed: false, paint: "stroke", ink: kind.ink, sw: 0,
        };
      }
    }
    return { pts: [[c[0] - 0.75, c[1]], [c[0] + 0.75, c[1]]], closed: false, paint: "stroke", ink: kind.ink, sw: 0, vanishes: true };
  }
  const sw = kind.paint === "stroke" ? 0 : kind.sw;
  if (kind.closed && kind.pts && kind.pts.length >= 3) {
    const s = 0.012;
    return {
      pts: kind.pts.map((p) => [c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s]),
      closed: true, paint: kind.paint, ink: kind.ink, sw,
    };
  }
  return { pts: densePoints(tinyCircle(c[0], c[1], 1.2)), closed: true, paint: kind.paint, ink: kind.ink, sw };
}

function preparePair(aS, bS, hint) {
  let A = aS ? classify(aS) : null;
  let B = bS ? classify(bS) : null;
  if (!A) A = degenerate(B, pointCenterOf(B.pts), bS && bS.id, hint && hint.b);
  if (!B) B = degenerate(A, pointCenterOf(A.pts), aS && aS.id, hint && hint.a);

  const openize = (X, target) => {
    let P = X.pts.slice();
    const dup = P.length > 2 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 0.5;
    if (dup) P = P.slice(0, -1);
    if (!X.closed) return P;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < P.length; i++) {
      const d = (P[i][0] - target[0]) ** 2 + (P[i][1] - target[1]) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return P.slice(bi).concat(P.slice(0, bi), [P[bi]]);
  };

  // round dot or capsule <-> open stroke: run the pair as a round-capped stroke
  // the whole way. A dot is a zero-length segment, a pill is its long axis —
  // both stroked at their minor dimension render pixel-true, and every
  // mid-frame stays a clean bending stroke instead of tumbling ink rings.
  const capOf = (X) => {
    if (X.paint !== "fill" || !X.closed || X.pts.length < 6) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of X.pts) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const w = maxX - minX, h = maxY - minY;
    const short = Math.min(w, h), long = Math.max(w, h);
    if (short < 5 || long > short * 4.5) return null;
    const rrf = short / 2;
    const a0 = w >= h ? [minX + rrf, (minY + maxY) / 2] : [(minX + maxX) / 2, minY + rrf];
    const b0 = w >= h ? [maxX - rrf, a0[1]] : [a0[0], maxY - rrf];
    const abx = b0[0] - a0[0], aby = b0[1] - a0[1];
    const L2 = abx * abx + aby * aby || 1e-9;
    let dev = 0;
    for (const p of X.pts) {
      let t = ((p[0] - a0[0]) * abx + (p[1] - a0[1]) * aby) / L2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(p[0] - (a0[0] + abx * t), p[1] - (a0[1] + aby * t));
      dev = Math.max(dev, Math.abs(d - rrf));
    }
    if (dev >= rrf * 0.045) return null;
    // Near-perfect circles (dots, dev≈0) may always round-stroke. A slightly
    // eccentric near-circle (a pupil, ~2% off) must not: its round-cap
    // approximation sits a couple of units off the real outline and pops at
    // the handoff — it takes the exact ink path. Elongated capsules (a bar,
    // whose centreline runs well past its radius) keep the clean fat-line
    // morph they were made for.
    const a0x = a0[0], a0y = a0[1];
    const Lc = Math.hypot(b0[0] - a0x, b0[1] - a0y);
    if (dev >= rrf * 0.012 && Lc < rrf) return null;
    // a stroke on top of the fill fattens the ink by X.fat on every side
    const rr = rrf + X.fat;
    const horiz = w >= h;
    const a = horiz ? [minX - X.fat + rr, (minY + maxY) / 2] : [(minX + maxX) / 2, minY - X.fat + rr];
    const b = horiz ? [maxX + X.fat - rr, a[1]] : [a[0], maxY + X.fat - rr];
    return { a, b, sw: 2 * rr };
  };
  const capA = capOf(A), capB = capOf(B);
  const oStroke = (X) => X.paint === "stroke" && !X.closed;
  if ((capA && oStroke(B)) || (capB && oStroke(A))) {
    let pa = capA ? [capA.a, capA.b] : openize(A, B.pts[0]);
    let pb = capB ? [capB.a, capB.b] : openize(B, A.pts[0]);
    const per = Math.max(openPerim(pa), openPerim(pb));
    const n = Math.max(90, Math.min(320, Math.round(per / 3)));
    pa = resampleOpen(pa, n);
    pb = resampleOpen(pb, n);
    const d0 = Math.hypot(pa[0][0] - pb[0][0], pa[0][1] - pb[0][1]) + Math.hypot(pa[n - 1][0] - pb[n - 1][0], pa[n - 1][1] - pb[n - 1][1]);
    const d1 = Math.hypot(pa[0][0] - pb[n - 1][0], pa[0][1] - pb[n - 1][1]) + Math.hypot(pa[n - 1][0] - pb[0][0], pa[n - 1][1] - pb[0][1]);
    if (d1 < d0) pb = pb.slice().reverse();
    return { mode: "open", pa, pb, inkA: A.ink, inkB: B.ink,
             swA: capA ? capA.sw : A.sw, swB: capB ? capB.sw : B.sw };
  }

  const bothFill = A.paint === "fill" && B.paint === "fill";
  const bothStroke = A.paint === "stroke" && B.paint === "stroke";

  if (bothFill || !bothStroke) {
    // ink regions, painted fill (stroked sides become their real outline)
    const toInk = (X) => {
      if (X.paint === "stroke") return strokeOutline(X.pts, X.sw, X.closed) || X.pts;
      if (X.fat > 0 && X.closed && X.pts.length >= 3) {
        // fill + fat stroke: the ink is the fill region grown by half the stroke
        const a = sideOffset(X.pts, X.fat, +1);
        const b = sideOffset(X.pts, X.fat, -1);
        return Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? a : b;
      }
      return X.pts;
    };
    let pa = toInk(A).slice(), pb = toInk(B).slice();
    if (signedArea(pa) < 0) pa.reverse();
    if (signedArea(pb) < 0) pb.reverse();
    const per = Math.max(ringPerim(pa), ringPerim(pb));
    const n = Math.max(110, Math.min(340, Math.round(per / 3)));
    pa = resampleRing(collapse(resampleRing(pa, n)), n);
    pb = resampleRing(collapse(resampleRing(pb, n)), n);
    // pre-align across scale/position: when the source is much smaller or far
    // from the target, let it slide & inflate to the target's frame first —
    // (The old framing stage that scaled a far source into the target's frame
    // is gone: with the exact joints, sliver collapse, orientation fixes and
    // single blend now in place, its area-based scaling only produced
    // oversized slabs — a 211-wide arc flew as a 429-wide one — while adding
    // nothing; the ring it protected blends at the same sharpness without it.)
    const pre = null;
    const s = bestShift(pa, pb);
    pb = pb.map((_, i) => pb[(i + s) % n]);
    return { mode: "ring", pa, pb, pre, shift: s, inkA: A.ink, inkB: B.ink, swA: 0, swB: 0 };
  }

  if (A.closed && B.closed) {
    // closed strokes: keep stroke paint on the centerlines
    let pa = A.pts.slice(), pb = B.pts.slice();
    if (signedArea(pa) < 0) pa.reverse();
    if (signedArea(pb) < 0) pb.reverse();
    const per = Math.max(ringPerim(pa), ringPerim(pb));
    const n = Math.max(84, Math.min(240, Math.round(per / 4)));
    pa = resampleRing(collapse(resampleRing(pa, n)), n);
    pb = resampleRing(collapse(resampleRing(pb, n)), n);
    const s = bestShift(pa, pb);
    pb = pb.map((_, i) => pb[(i + s) % n]);
    return { mode: "ring", pa, pb, shift: s, inkA: A.ink, inkB: B.ink, swA: A.sw, swB: B.sw, strokePaint: true };
  }

  // open strokes: open <-> open, or mixed closure (cut the closed one open)
  let pa = openize(A, B.pts[0]);
  let pb = openize(B, A.pts[0]);
  const per = Math.max(openPerim(pa), openPerim(pb));
  const n = Math.max(84, Math.min(300, Math.round(per / 4)));
  pa = resampleOpen(pa, n);
  pb = resampleOpen(pb, n);
  const d0 = Math.hypot(pa[0][0] - pb[0][0], pa[0][1] - pb[0][1]) + Math.hypot(pa[n - 1][0] - pb[n - 1][0], pa[n - 1][1] - pb[n - 1][1]);
  const d1 = Math.hypot(pa[0][0] - pb[n - 1][0], pa[0][1] - pb[n - 1][1]) + Math.hypot(pa[n - 1][0] - pb[0][0], pa[n - 1][1] - pb[0][1]);
  if (d1 < d0) pb = pb.slice().reverse();
  return { mode: "open", pa, pb, inkA: A.ink, inkB: B.ink, swA: A.sw, swB: B.sw, vanishes: !!(A.vanishes || B.vanishes) };
}

// --- pairing ----------------------------------------------------------------

// hand-tuned pairings where the heuristic would read wrong; everything else
// is paired same-id first, then greedily by nearest centroid.
export const OVERRIDES = {
  "0-1": { pairs: [["eyeL", "dots#0"], ["pupL", "dots#1"], ["eyeR", "dots#2"]], collapseA: ["pupR"] },
  "2-3": { pairs: [["dots#0", "chevL04#0"], ["dots#1", "barR04#0"]], mergePairs: [["dots#2", "barR04#0"]] },
  "4-5": { pairs: [["chevBigL#0", "eyeL"], ["chevBigR#0", "eyeR"]] },
  // each X-eye resolves into its own typing dot, and the red X — sitting
  // right under the middle dot — rises to become it. Without this the left
  // X splits (one diagonal slides 135 units into the middle dot) while the
  // red X just erases. Both diagonals of each X now converge onto their dot,
  // the red X's strokes rising together into the middle one.
  "22-1": { pairs: [["xeyes#0", "dots#0"], ["redx#0", "dots#1"], ["xeyes#2", "dots#2"]],
            mergePairs: [["xeyes#1", "dots#0"], ["redx#1", "dots#1"], ["xeyes#3", "dots#2"]] },
  // the teardrop slides down and becomes the timer's dial, so the dial never
  // grows out of a speck; the needle then blooms in on top of the dial
  "14-15": { pairs: [["tear#0", "clock#0"]] },
  // eyes close into the sleepy arcs (not the pupils — the pupil sits nearer
  // an arc than the eye does, which would send the big eye across the whole
  // face to become a Z); the pen's parts become the Z's
  // the pen lifts into the Z's size-matched: the barrel rises into the top Z,
  // the clip into the middle one, and the nib speck into the small bottom Z
  // while the two grip pieces fuse into it from the left. Eyes close into the
  // arcs; pupils bloom/collapse with them. (The greedy used to merge the
  // barrel + both grips into the top Z and grow the middle Z out of the 12x16
  // nib speck — a sudden blob up top and a dot popping into a Z.)
  "10-11": { pairs: [["eyeL", "arcs#0"], ["eyeR", "arcs#1"],
                     ["pen#0", "zzz#2"], ["pen#1", "zzz#1"], ["pen#2", "zzz#0"]],
             mergePairs: [["pen#3", "zzz#0"], ["pen#4", "zzz#0"]],
             collapseA: ["pupL", "pupR"] },
  // face 21 hides its eyes (the closed arches are its eyes), so without this
  // the greedy pairs the open eyes and pupils with the arches and the check —
  // fat green blob-strokes. Eyes close into the arches; the check enters on
  // its own (ring grows, tick draws)
  "20-21": { pairs: [["eyeL", "arches#0"], ["eyeR", "arches#1"]], collapseA: ["pupL", "pupR"] },
  // 12's eyes open out of 11's closed arcs, the pupils bloom once their eyes
  // are there, and the Z's morph straight into the anger mark (the greedy
  // pairs them; nothing else can touch them — the whitelist keeps the eyes
  // and pupils off the zzz). Both directions run the same pairing, so the
  // anger also melts back into the Z's on the way out.
  "11-12": { pairs: [["arcs#0", "eyeL"], ["arcs#1", "eyeR"]] },
  // the dead face collapses into the spinner: each X folds into its own dot
  // (both diagonals converging) and the red X into the centre one. Without
  // this one diagonal of each X and the whole red X just erased.
  "22-2": { pairs: [["xeyes#0", "dots#0"], ["xeyes#2", "dots#2"], ["redx#0", "dots#1"]],
            mergePairs: [["xeyes#1", "dots#0"], ["xeyes#3", "dots#2"], ["redx#1", "dots#1"]] },
  // the dead face resolving into the prompt: each X's both diagonals converge
  // onto its mark (left X -> ">", right X -> "_") instead of one strand of
  // each erasing; the red X leaves together, both strokes at once.
  "22-3": { pairs: [["xeyes#0", "chevL04#0"], ["xeyes#2", "barR04#0"]],
            mergePairs: [["xeyes#1", "chevL04#0"], ["xeyes#3", "barR04#0"]] },
  // same read into the scrunch face: left X -> left chevron, right X -> right
  "22-4": { pairs: [["xeyes#0", "chevBigL#0"], ["xeyes#2", "chevBigR#0"]],
            mergePairs: [["xeyes#1", "chevBigL#0"], ["xeyes#3", "chevBigR#0"]] },
  // 13 <-> 14: the tear face has ONE teardrop while the blush face has two
  // cheeks. The greedy gave the right cheek the tear and left the left one
  // dying alone at its spot — it just vanished mid-morph. Both cheeks now
  // ride into the teardrop together, and on the way back the tear's mass
  // splits so the left cheek breaks off and flies home.
  "13-14": { pairs: [["blush#1", "tear#0", 0, 0.75]], mergePairs: [["blush#0", "tear#0", 0.3, 1]] },
  "3-0": { pairs: [["chevL04#0", "eyeL"], ["barR04#0", "eyeR"]] },
  "3-18": { pairs: [["chevL04#0", "eyeL"], ["barR04#0", "eyeR"]] },
  "3-20": { pairs: [["chevL04#0", "eyeL"], ["barR04#0", "eyeR"]] },
  // the prompt unfolding into the wink face: the ">" folds into the left eye
  // that appears exactly where it sits (it used to un-write while the eye
  // grew over it — two clashing shapes at the same spot), and the "_" rises
  // into the wink. The pupil still grows in on its own.
  "3-17": { pairs: [["chevL04#0", "eyeL"], ["barR04#0", "chevR18#0"]] },
};
function flipSpec(spec) {
  const flip = ([a, b, w0, w1]) => (w0 == null ? [b, a] : [b, a, w0, w1]);
  return {
    pairs: spec.pairs.map(flip),
    collapseA: spec.collapseB || [],
    mergePairs: (spec.mergePairs || []).map(flip),
  };
}
export const isDotsMorph = (ia, ib) => (ia === 1 && ib === 2) || (ia === 2 && ib === 1);

const cache = new Map();
export function getTransition(ia, ib, dynD, dynB) {
  const key = `${ia}-${ib}`;
  if (!dynD && !dynB && cache.has(key)) return cache.get(key);
  const A = shapeList(DATA.faces[ia]);
  const B = shapeList(DATA.faces[ib]);
  if (dynD) for (const s of A) if (dynD[s.id]) s.d = dynD[s.id];   // live dot positions at morph start
  if (dynB) for (const s of B) if (dynB[s.id]) s.d = dynB[s.id];   // live dot positions at morph end (face 3's orbit slots)
  const spec = OVERRIDES[key] || (OVERRIDES[`${ib}-${ia}`] ? flipSpec(OVERRIDES[`${ib}-${ia}`]) : null);
  const remA = new Map(A.map((s) => [s.id, s]));
  const remB = new Map(B.map((s) => [s.id, s]));
  const pairs = [];
  const take = (a, b) => {
    if (a) remA.delete(a.id);
    if (b) remB.delete(b.id);
    pairs.push([a || null, b || null]);
  };
  const winSpec = [];
  if (spec) {
    const aSnap = new Map(A.map((s) => [s.id, s]));
    const bSnap = new Map(B.map((s) => [s.id, s]));
    for (const [aid, bid, w0, w1] of spec.pairs) {
      take(remA.get(aid) || null, remB.get(bid) || null);
      if (w0 != null) winSpec.push([aid, bid, w0, w1]);
    }
    // merge pairs: several shapes converging onto (or diverging from) ONE
    // partner. They read the pristine snapshots, so they work whether the
    // shared shape was consumed by a primary pair or not — 3->4's spare dot
    // merges into the bar, and on 4->3 the bar splits back into two dots.
    for (const [aid, bid, w0, w1] of spec.mergePairs || []) {
      const a0 = aSnap.get(aid), b0 = bSnap.get(bid);
      if (!a0 || !b0) continue;
      remA.delete(aid);
      remB.delete(bid);   // consumed here too, or it spawns a phantom in the leftover pass
      pairs.push([{ ...a0 }, { ...b0 }]);
      if (w0 != null) winSpec.push([aid, bid, w0, w1]);
    }
    for (const aid of spec.collapseA || []) { const a = remA.get(aid); if (a) take(a, null); }
  }
  for (const id of [...remA.keys()]) if (remB.has(id)) take(remA.get(id), remB.get(id));
  const ca = [...remA.values()].map((s) => ({ s, c: pointCenterOf(densePoints(s.d)) }));
  const cb = [...remB.values()].map((s) => ({ s, c: pointCenterOf(densePoints(s.d)) }));
  const cand = [];
  const fam = { eyeL: 1, pupL: 1, eyeR: 1, pupR: 1 };
  // an eye or pupil may only ever pair with the other closed-lid features —
  // the arcs/arches they close into, face 17's wink chevron, face 5's scrunch
  // chevrons, face 2's typing dots (its resting "eyes"), and face 22's X-eyes
  // (a crossed-out eye unfolding into an open one). Everything else (a prompt
  // bar, a check mark, a bloodshot vein) is a scramble; that family collapses
  // here and grows there on its own.
  const eyeCloseKind = { arcs: 1, arches: 1, dots: 1, chevR18: 1, xeyes: 1, chevBigL: 1, chevBigR: 1 };
  // closed-lid features (a sleepy arc, a wink chevron, a scrunch) belong to
  // the EYE, not the pupil: without a nudge the greedy sends a sleepy face's
  // arcs into the pupils — they sit nearer — while the eyes balloon in from
  // specks. A pupil may still take one when its own eye is already spoken
  // for (the X-eye pairs split across eye and pupil), so this is a distance
  // penalty, not a ban.
  const closedLidKind = { arcs: 1, arches: 1, chevR18: 1, xeyes: 1, chevBigL: 1, chevBigR: 1 };
  // those features are sided (the index/name encodes left|right). An eye
  // must pair with the lid on ITS side — 6->11 otherwise crossed both: the
  // left eye slid right into the right arc and the right eye just collapsed.
  const SIDE = { eyeL: 0, pupL: 0, eyeR: 1, pupR: 1,
    "arcs#0": 0, "arcs#1": 1, "arches#0": 0, "arches#1": 1,
    "xeyes#0": 0, "xeyes#1": 0, "xeyes#2": 1, "xeyes#3": 1,
    chevR18: 1, "chevR18#0": 1, chevBigL: 0, "chevBigL#0": 0, chevBigR: 1, "chevBigR#0": 1 };
  for (const a of ca) for (const b of cb) {
    const d = Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]);
    const aFace = fam[a.s.id] || 0, bFace = fam[b.s.id] || 0;
    let pen = 0;
    if (aFace !== bFace) {
      const extraId = aFace ? b.s.id : a.s.id;
      const kind = String(extraId).split("#")[0];
      if (!eyeCloseKind[kind]) continue;
      const faceSide = aFace ? a.s.id : b.s.id;
      if (closedLidKind[kind] && /^pup/.test(faceSide)) pen = 150;
      // around the spinner the dots are the EYES' partners: with the pupils
      // eligible too, 7->3 sent both pupils into the side dots, one eye
      // sailed across to the centre slot and the other just collapsed.
      // The centre dot blooms in on its own instead.
      if (kind === "dots" && (ia === 2 || ib === 2) && /^pup/.test(faceSide)) continue;
    } else if (!aFace && !bFace) {
      // extra <-> extra: a closed-lid feature still belongs to an eye first.
      // Without this the "?"'s dot steals a sleepy arc before the eye can
      // take it (6->11: the dot sat nearer the arc than the eye did). The
      // typing dots are exempt — a crossed-out eye unfolding into them is a
      // real read, not a steal.
      const ka = String(a.s.id).split("#")[0], kb = String(b.s.id).split("#")[0];
      if ((closedLidKind[ka] && kb !== "dots") || (closedLidKind[kb] && ka !== "dots")) pen = 260;
    }
    // around the spinner the dots belong to the eyes and their closed-lid
    // features only. Any other extra passing through (a magnifier handle, the
    // book, the timer) would scrub into a dot; instead the remaining dots
    // bloom in on their own.
    if (ia === 2 || ib === 2) {
      const ida = String(a.s.id).split("#")[0], idb = String(b.s.id).split("#")[0];
      if (ida === "dots" || idb === "dots") {
        const other = ida === "dots" ? b.s.id : a.s.id;
        const ok = fam[other] || closedLidKind[String(other).split("#")[0]];
        if (!ok) continue;
      }
    }
    const sa = SIDE[a.s.id], sb = SIDE[b.s.id];
    if (sa != null && sb != null && sa !== sb) continue;
    cand.push({ a, b, d: d + pen });
  }
  cand.sort((x, y) => x.d - y.d);
  const usedA = new Set(), usedB = new Set();
  for (const { a, b } of cand) {
    if (usedA.has(a.s.id) || usedB.has(b.s.id)) continue;
    usedA.add(a.s.id); usedB.add(b.s.id);
    take(a.s, b.s);
  }
  // shapes that form ONE graphic (the "?" with its dot, the magnifier's lens
  // and handle, the check's ring and tick, an X's two strokes, the book's
  // page and spine, the pen/bulb/alarm parts) must not split: when only some
  // of them found a partner, the rest die in place and read as a stroke
  // stranded mid-air. A sibling that DID pair carries the stragglers onto the
  // same target (nearest sibling wins), so the whole graphic rides off
  // together — the same converge the X-eyes use on their way to the prompt.
  const ONE_FAM = { qmark: 1, mag: 1, book: 1, check: 1, xeyes: 1, redx: 1, pen: 1, bulb: 1, warn: 1, spirals: 1, anger: 1 };
  for (const { s, c } of ca) {
    if (usedA.has(s.id) || !remA.has(s.id)) continue;
    const famK = String(s.id).split("#")[0];
    let target = null, td = 1e9;
    if (ONE_FAM[famK]) {
      for (const [pa, pb] of pairs) {
        if (!pa || !pb || String(pa.id).split("#")[0] !== famK) continue;
        const pc = pointCenterOf(densePoints(pa.d));
        const dd = Math.hypot(pc[0] - c[0], pc[1] - c[1]);
        if (dd < td) { td = dd; target = pb; }
      }
    }
    if (target) {
      remA.delete(s.id);
      pairs.push([{ ...s }, { ...target }]);
    } else {
      take(s, null);
    }
  }
  for (const { s } of cb) if (!usedB.has(s.id) && remB.has(s.id)) take(null, s);

  // a leaving shape nested inside a sibling that is also leaving agrees with
  // that sibling's branch: the check's tick implodes with its ring, the
  // book's spine un-writes with its page. (Equal bboxes — crossing strokes
  // like the X's — never count as nesting.)
  let aHint = new Map(), bHint = new Map();
  {
    const leafKinds = (side) => {
      const P = new Map();
      for (const [a, b] of pairs) {
        const s = side ? b : a;
        const gone = side ? !a : !b;
        if (s && gone) P.set(s.id, classify(s));
      }
      return P;
    };
    const inside = (pi, pj) => {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of pi) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
      let a0 = 1e9, c0 = 1e9, a1 = -1e9, c1 = -1e9;
      for (const p of pj) { if (p[0] < a0) a0 = p[0]; if (p[0] > a1) a1 = p[0]; if (p[1] < c0) c0 = p[1]; if (p[1] > c1) c1 = p[1]; }
      return x0 >= a0 - 8 && x1 <= a1 + 8 && y0 >= c0 - 8 && y1 <= c1 + 8 &&
        (x1 - x0) * (y1 - y0) < 0.7 * Math.max(1, (a1 - a0) * (c1 - c0));
    };
    const hintSet = (P) => {
      const H = new Map();
      for (const [i1, k1] of P) for (const [i2, k2] of P) {
        if (i1 === i2) continue;
        if (inside(k1.pts, k2.pts) && !inside(k2.pts, k1.pts)) H.set(i1, shrinksInPlace(k2) ? "shrink" : "erase");
      }
      return H;
    };
    aHint = hintSet(leafKinds(0));
    bHint = hintSet(leafKinds(1));
  }
  const items = pairs.map(([a, b], idx) => ({ idx, a, b, shift: 0, ...preparePair(a, b, { a: a && aHint.get(a.id), b: b && bHint.get(b.id) }) }));
  // spec windows: a pair can ride an explicit slice of the morph, so when two
  // shapes head to one partner they don't both cross the face at the same time
  for (const [aid, bid, w0, w1] of winSpec) {
    const it = items.find((q) => q.a && q.b && q.a.id === aid && q.b.id === bid);
    if (it) it.winT = [w0, w1];
  }

  // the dots are live when face 3 hands off: on 3 -> 4 they keep riding the
  // spinner for a beat while they peel off (no velocity snap), and the spare
  // dot finishes its dive into the eye center. On 4 -> 3 they land back on the
  // spinner's own slots, not the typing row.
  if (ia === 2 && ib === 3) {
    for (const it of items) {
      const m = it.a && /^dots#(\d)$/.exec(it.a.id);
      if (!m) continue;
      it.liveSlot = +m[1];
      if (!it.b) {
        it.pb = resampleRing(densePoints(tinyCircle(DOTS_CEN[0], DOTS_CEN[1], 1.2)), it.pa.length);
      }
    }
  } else if (ia === 3 && ib === 2) {
    for (const it of items) {
      const m = it.b && /^dots#(\d)$/.exec(it.b.id);
      if (!m) continue;
      const k = +m[1];
      if (it.mode === "open") {
        const q = DOTS_SPIN[k];
        it.pb = resampleOpen([[q[0] - 0.5, q[1]], [q[0] + 0.5, q[1]]], it.pa.length);
      } else {
        it.pb = resampleRing(densePoints(ellipsePath(DOTS_SPIN[k][0], DOTS_SPIN[k][1], 52, 52)), it.pa.length);
        const s = bestShift(it.pa, it.pb);
        it.pb = it.pb.map((_, i) => it.pb[(i + s) % it.pa.length]);
        it.shift = s;
      }
    }
  }

  // appearance choreography — kept only for the already-tuned transitions
  // (3->4, 4->5, 5<->6): the spare dot leaves early there, the glints bloom
  // once the eyes land and the "?" writes itself on. Everywhere else features
  // grow / leave across the whole morph, so they arrive together with the
  // paired shapes instead of sitting dead through a window and blooming late.
  // appearance choreography — only for the literal sequence transitions it
  // was designed on (3→4, 4→5, 5→6 and 14→15, both directions). A range check
  // like "min(index) in 2..4" also swept in random pairs (19↔5), where the
  // whole face then sat dead for the first half and ballooned out at the end.
  const pair = ia + "-" + ib;
  const tuned = pair === "2-3" || pair === "3-2" || pair === "3-4" || pair === "4-3" ||
                pair === "4-5" || pair === "5-4" || pair === "14-15" || pair === "15-14";
  for (const it of items) {
    if (it.liveSlot != null) continue;
    const a = it.a, b = it.b;
    const isQ = (x) => /^qmark/.test(x || "");
    if (!a && b) {
      if (it.mode === "open" && b.sw && it.vanishes) {
        it.draw = 1;
        if (tuned) it.winT = isQ(b.id) ? [0.86, 0.985] : [0.45, 0.9];
      } else if (it.mode === "ring") {
        if (tuned) it.winT = isQ(b.id) ? [0.985, 1.0] : [0.5, 0.85];
      }
    } else if (a && !b) {
      if (it.mode === "open" && a.sw && it.vanishes) {
        it.draw = -1;
        if (tuned) it.winT = isQ(a.id) ? [0.05, 0.5] : [0.5, 0.95];
      } else if (it.mode === "ring") {
        if (tuned) it.winT = isQ(a.id) ? [0, 0.015] : [0.05, 0.45];
      }
    }
  }

  // paint order: mirror the held frame's z-order. Eyes and pupils keep their
  // canonical stacking (eyeL, pupL, eyeR, pupR) no matter what they morph
  // into — keying purely on the target slot would paint an eye over the very
  // pupil it belongs to whenever they head to differently-ordered shapes
  // (the glint would vanish under the eye on the first frame). Other shapes
  // follow the target's order, anything on its way out paints last.
  const slot = { eyeL: 0, pupL: 1, eyeR: 2, pupR: 3 };
  const bOrd = new Map(B.map((s, k) => [s.id, k]));
  const aOrd = new Map(A.map((s, k) => [s.id, k]));
  const keyOf = (it) => {
    const aS = it.a ? slot[it.a.id] : undefined;
    const bS = it.b ? slot[it.b.id] : undefined;
    if (aS != null || bS != null) return Math.min(aS != null ? aS : 99, bS != null ? bS : 99);
    if (it.b) return 100 + bOrd.get(it.b.id);
    return 1000 + aOrd.get(it.a.id);
  };
  items.sort((p, q) => keyOf(p) - keyOf(q));

  const tr = { items };
  if (!dynD) cache.set(key, tr);
  return tr;
}

// --- rendering --------------------------------------------------------------

// animated pupil clip: the eye's outline grown outward by `m` design units.
// The margin shrinks uniformly onto the eye as m -> 0 (below half a unit the
// exact ring is used, so the landed frame matches the held clip precisely).
// A uniform margin trims every side of the pupil evenly — a pointwise blend
// against a far rectangle would let one side trim while another stays loose.
export function clipPathD(pts, m) {
  if (!(m > 0.5)) return polyPath(pts, true);
  const a = sideOffset(pts, m, +1);
  const b = sideOffset(pts, m, -1);
  const grown = Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? a : b;
  return polyPath(grown, true);
}

export function renderItem(item, t, dotsPos) {
  // t comes in raw/linear. Items with an explicit window ride it; the rest
  // stagger in real time. Either way each item is eased exactly once.
  let tt;
  if (item.winT) {
    const u = Math.max(0, Math.min(1, (t - item.winT[0]) / (item.winT[1] - item.winT[0])));
    tt = smooth5(u);
  } else {
    const st = (item.idx % 3) * 0.055;
    const ttR = t <= st ? 0 : Math.min(1, (t - st) / (1 - st));
    tt = smooth5(ttR);
  }
  if (item.draw != null) {
    // stroke reveal: the shape writes itself on (draw=1) or retracts (draw=-1)
    const from = item.draw > 0 ? item.pb : item.pa;
    const ink = item.draw > 0 ? item.inkB : item.inkA;
    const sw = item.draw > 0 ? item.swB : item.swA;
    const len = openPerim(from);
    const p = item.draw > 0 ? tt : 1 - tt;
    const L = Math.max(0, len * p);
    if (L < 0.6) {
      // a zero-length round-capped dash renders as a dot in Chromium, so a
      // not-yet-started (or fully erased) reveal must render nothing at all
      return { key: item.idx, hidden: true };
    }
    return {
      key: item.idx, draw: true, d: polyPath(from, false), ink,
      sw: Math.max(0.5, sw), dash: `${L.toFixed(1)} ${(len + 12).toFixed(1)}`,
    };
  }
  const { pb } = item;
  let pa = item.pa;
  if (item.liveSlot != null && dotsPos && dotsPos[item.liveSlot]) {
    // follow the still-running spinner so the handoff has no velocity snap
    const p = dotsPos[item.liveSlot];
    const n = pa.length;
    if (item.mode === "open") {
      pa = resampleOpen([[p[0] - 0.5, p[1]], [p[0] + 0.5, p[1]]], n);
    } else {
      const live = resampleRing(densePoints(ellipsePath(p[0], p[1], 52, 52)), n);
      const s = item.shift || 0;
      pa = live.map((_, i) => live[(i + s) % n]);
    }
  }
  const out = new Array(pa.length);
  if (item.mode === "ring" && item.pre && !item.liveSlot) {
    // one continuous eased motion: source -> framed source -> target, as a
    // quadratic blend. No phases, no seams — same feel as the stroke morphs
    const A = (1 - tt) * (1 - tt), B = 2 * tt * (1 - tt), C = tt * tt;
    for (let k = 0; k < pa.length; k++) {
      const p0 = pa[k], q = item.pre[k], r2 = pb[k];
      out[k] = [A * p0[0] + B * q[0] + C * r2[0], A * p0[1] + B * q[1] + C * r2[1]];
    }
  } else {
    for (let k = 0; k < pa.length; k++) {
      out[k] = [pa[k][0] + (pb[k][0] - pa[k][0]) * tt, pa[k][1] + (pb[k][1] - pa[k][1]) * tt];
    }
  }
  return {
    key: item.idx,
    mode: item.mode,
    d: polyPath(out, item.mode === "ring"),
    ink: lerpColor(item.inkA, item.inkB, tt),
    sw: lerp(item.swA, item.swB, tt),
    strokePaint: !!item.strokePaint,
    pts: out,
    tt,
  };
}


// --- body morph: circle <-> cloud (figma 12:2) <-> square (figma 15:4) ------
// Each body is a 240-point ring in content coords, aligned to a common
// parameterisation so any pair blends point-to-point. The cloud is drawn at
// the faces' own eye scale and anchored so every face's content sits inside
// the puffs with margin; the square (design: 984.3125 units, corner radius
// 219, fill #D9D9D9 = the faces' own grey) is scaled to fill the viewBox
// exactly like the circle, so circle <-> square is a pure silhouette change in
// place. Every frame's blend is fitted to the viewBox from its own ring
// bounds, so no pair can be shaved by the viewport.

export const CLOUD_FILL = "#8293FF";
export const TRI_FILL = "#0BCAFF"; // figma node 38:205
export const HEX_FILL = "#DD00FF"; // figma node 12:77
export const DIA_FILL = "#0FE147"; // figma node 12:92
export const SB_FILL = "#0597FF"; // figma node 12:172
export const SQUARE_FILL = "#FF2E63"; // fun override of the node 15:4 grey
export const PEBBLE_FILL = "#FFD166"; // warm sandy gold for the pebble
export const TRIGON_FILL = "#FF6B35"; // coral orange for the trigon (node 12:72's
// own fill is #FF006F; picked a different fun one so it doesn't twin the square)
export const DROPLET_FILL = "#C6FF00"; // electric lime (node 22:3's own fill
// is #9C08FF purple, too close to the hexagon's magenta)


// the face-14 sweat droplet reads against the body: a dark tone-on-tone shade
// of the body's own hue for light or hue-close bodies; the vivid contrasting
// ones keep the blue. Built in HSL: keep the hue, drop lightness to 32%.
function darkShade(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const l = 0.32, s = 0.7;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m0 = l - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
  return (
    "#" +
    rgb.map((v) => Math.round((v + m0) * 255).toString(16).padStart(2, "0")).join("")
  );
}

const TEAR_KEEP = "#4FC3FF"; // bodies the blue already reads against
const _tearOf = (fill) =>
  ["#FF2E63", "#DD00FF", "#0597FF", "#FF6B35"].indexOf(fill) >= 0 ? TEAR_KEEP : darkShade(fill);

const CLOUD_TX = -389.174, CLOUD_TY = -308.449;
const SQ_RATIO = 219 / 984.3125;
const BODY_N = 240;

function alignTo(base, ring) {
  let r = ring;
  if (signedArea(r) * signedArea(base) < 0) r = r.slice().reverse();
  const s = bestShift(base, r);
  return r.map((_, i) => r[(i + s) % BODY_N]);
}

function mkCircle() {
  const c = [422.854, 422.854], r = 422.854;
  return Array.from({ length: BODY_N }, (_, k) => {
    const a = (k / BODY_N) * 2 * Math.PI;
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
  });
}

function mkCloud(circ) {
  let ring = resampleRing(densePoints(DATA.cloud.d), BODY_N);
  ring = ring.map(([x, y]) => [x + CLOUD_TX, y + CLOUD_TY]);
  ring = alignTo(circ, ring);
  const grown = relaxFolds(growRing(ring));
  // fit on the grown ring: the blend's frame always encloses its own render
  // ring, so no pair can overshoot the viewBox mid-morph
  return { fit: grown, render: grown };
}

function mkSquare(circ) {
  const V = DATA.viewBox, r = V * SQ_RATIO;
  const X0 = 422.854 - V / 2, Y0 = 422.854 - V / 2, X1 = X0 + V, Y1 = Y0 + V;
  const pts = [];
  const arc = (cx, cy, a0, a1) => {
    for (let k = 0; k <= 20; k++) {
      const a = ((a0 + (a1 - a0) * (k / 20)) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  pts.push([X1, Y0 + r]);
  pts.push([X1, Y1 - r]);
  arc(X1 - r, Y1 - r, 0, 90);
  pts.push([X0 + r, Y1]);
  arc(X0 + r, Y1 - r, 90, 180);
  pts.push([X0, Y0 + r]);
  arc(X0 + r, Y0 + r, 180, 270);
  pts.push([X1 - r, Y0]);
  arc(X1 - r, Y0 + r, 270, 360);
  return alignTo(circ, resampleRing(pts, BODY_N));
}

// --- extra geometric bodies ----------------------------------------------
// rounded polygon: fillet every corner with its own radius, walk the arcs
function roundedPoly(V, R) {
  const n = V.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const P = V[i], A = V[(i - 1 + n) % n], B = V[(i + 1) % n];
    let u1x = P[0] - A[0], u1y = P[1] - A[1];
    const l1 = Math.hypot(u1x, u1y) || 1; u1x /= l1; u1y /= l1;
    let u2x = B[0] - P[0], u2y = B[1] - P[1];
    const l2 = Math.hypot(u2x, u2y) || 1; u2x /= l2; u2y /= l2;
    const delta = Math.atan2(u1x * u2y - u1y * u2x, u1x * u2x + u1y * u2y);
    if (Math.abs(delta) < 1e-4) { out.push([P[0], P[1]]); continue; }
    const tc = Math.min(R[i] * Math.tan(Math.abs(delta) / 2), 0.45 * Math.min(l1, l2));
    const rr = tc / Math.tan(Math.abs(delta) / 2);
    const Ax = P[0] - u1x * tc, Ay = P[1] - u1y * tc;
    const Bx = P[0] + u2x * tc, By = P[1] + u2y * tc;
    let n1x = -u1y, n1y = u1x;
    if (n1x * u2x + n1y * u2y < 0) { n1x = -n1x; n1y = -n1y; }
    const Cx = Ax + n1x * rr, Cy = Ay + n1y * rr;
    const a0 = Math.atan2(Ay - Cy, Ax - Cx), a1 = Math.atan2(By - Cy, Bx - Cx);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const steps = Math.max(2, Math.round(Math.abs(da) / (Math.PI / 24)));
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (da * k) / steps;
      out.push([Cx + rr * Math.cos(a), Cy + rr * Math.sin(a)]);
    }
  }
  return out;
}

let _cpts = null;
function contentPoints() {
  if (_cpts) return _cpts;
  const pts = [];
  for (const f of DATA.faces) {
    for (const s of ["L", "R"]) {
      const e = f["e" + s];
      if (e.vis >= 0.5) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * 2 * Math.PI;
          pts.push([e.cx + e.rx * Math.cos(a), e.cy + e.ry * Math.sin(a)]);
        }
      }
    }
    for (const k of DATA.extraKeys) {
      if ((f.ex[k] || 0) > 0) {
        for (const sh of DATA.extras[k]) {
          const nums = (sh.d.match(/-?\d*\.?\d+/g) || []).map(Number);
          const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
          if (!xs.length) continue;
          let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
          if (k === "zzz") { y0 -= 32; x1 += 10; }
          if (k === "tear") y1 += 16;
          if (k === "chevBigL" || k === "chevBigR") y0 -= 26;
          if (k === "pen") { x1 += 62; y0 -= 12; }
          pts.push([x0, y0], [x1, y0], [x0, y1], [x1, y1]);
        }
      }
    }
  }
  _cpts = pts;
  return pts;
}

function ringMargin(ring, pts) {
  let worst = 1e9;
  for (const [px, py] of pts) {
    let m = 1e9;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy || 1;
      let tt = ((px - a[0]) * dx + (py - a[1]) * dy) / L2;
      tt = Math.max(0, Math.min(1, tt));
      const d = Math.hypot(px - (a[0] + dx * tt), py - (a[1] + dy * tt));
      if (d < m) m = d;
    }
    if (m < worst) worst = m;
  }
  return worst;
}

function insideRing(ring, px, py) {
  let ins = false, j = ring.length - 1;
  for (let i = 0; i < ring.length; i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) ins = !ins;
    j = i;
  }
  return ins;
}

// rings for the geometric bodies; each grows (uniform scale about its bbox
// centre) until every content point is inside with margin, so containment is
// guaranteed by construction
function fitRing(verts, radii, circ, margin = 36) {
  let V = verts.map(([x, y]) => [x, y]);
  const cpts = contentPoints().filter(([px, py]) => px > -400 && px < 1300 && py > -400 && py < 1300);
  let ring = null;
  for (let it = 0; it < 90; it++) {
    ring = resampleRing(roundedPoly(V, radii), BODY_N);
    const m = ringMargin(ring, cpts);
    const ok = m >= margin && cpts.every(([px, py]) => insideRing(ring, px, py));
    if (ok) break;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of V) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const ccx = (x0 + x1) / 2, ccy = (y0 + y1) / 2;
    V = V.map(([x, y]) => [ccx + (x - ccx) * 1.015, ccy + (y - ccy) * 1.015]);
  }
  return alignTo(circ, ring);
}

function mkHexagon(circ) {
  // figma 12:77: the design's own rounded hexagon; placed by a small anchor
  // search (it carries no eye spot), then auto-fitted
  const base = resampleRing(densePoints(DATA.hexagon.d), BODY_N);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of base) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const bcx = (x0 + x1) / 2, bcy = (y0 + y1) / 2;
  const bmax = Math.max(x1 - x0, y1 - y0);
  let best = null, bestDim = Infinity;
  for (const [ax, ay] of [[428, 432], [428, 404], [428, 460], [400, 432], [456, 432], [400, 404], [456, 460], [428, 376], [428, 490]]) {
    const s0 = 900 / bmax;
    const ring = base.map(([x, y]) => [ax + (x - bcx) * s0, ay + (y - bcy) * s0]);
    const fitted = fitRingPts(ring, circ);
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const [x, y] of fitted) {
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
    const dim = Math.max(bx1 - bx0, by1 - by0);
    if (dim < bestDim) { bestDim = dim; best = fitted; }
  }
  return best;
}

// generic: scale an arbitrary closed ring about its bbox centre until every
// content point is inside with margin
function fitRingPts(pts, circ, margin = 36) {
  const cpts = contentPoints().filter(([px, py]) => px > -400 && px < 1300 && py > -400 && py < 1300);
  let ring = resampleRing(pts, BODY_N);
  for (let it = 0; it < 90; it++) {
    const m = ringMargin(ring, cpts);
    const ok = m >= margin && cpts.every(([px, py]) => insideRing(ring, px, py));
    if (ok) break;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of ring) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const ccx = (x0 + x1) / 2, ccy = (y0 + y1) / 2;
    ring = ring.map(([x, y]) => [ccx + (x - ccx) * 1.015, ccy + (y - ccy) * 1.015]);
  }
  return alignTo(circ, ring);
}

// The stage transform pins each body ring's bounding-box centre to the middle
// of the viewport, so a ring whose bbox centre sits right of the face centre
// reads with the eyes pushed left inside the shape. Slide the ring sideways
// until its bbox centre is back on the face centre's x — the eyes move right,
// the vertical placement and the size stay as fitted (grow only if the slide
// breaks containment).
const FACE_CX = 422.854;
function slideRightFit(ring, circ, margin = 36) {
  let x0 = Infinity, x1 = -Infinity;
  for (const [x] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  let out = ring.map(([x, y]) => [x + FACE_CX - (x0 + x1) / 2, y]);
  const cpts = contentPoints().filter(([px, py]) => px > -400 && px < 1300 && py > -400 && py < 1300);
  for (let it = 0; it < 120; it++) {
    const m = ringMargin(out, cpts);
    const ok = m >= margin && cpts.every(([px, py]) => insideRing(out, px, py));
    if (ok) break;
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const [x, y] of out) {
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
    const ccx = (bx0 + bx1) / 2, ccy = (by0 + by1) / 2;
    out = out.map(([x, y]) => [ccx + (x - ccx) * 1.015, ccy + (y - ccy) * 1.015]);
  }
  return alignTo(circ, out);
}

// figma 38:205: the design's own rounded point-up triangle (this node carries
// no eyes, so the face anchors at the shape's midline, ~51% down its height,
// same rule the previous triangle's eye spot followed). Anchoring there on
// the content's average eye spot spends the space where the content needs it;
// a small anchor search then picks the placement with the best final fit.
function mkTriangle(circ) {
  const base = resampleRing(densePoints(DATA.triangle.d), BODY_N);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of base) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const bmax = Math.max(x1 - x0, y1 - y0);
  const emx = 703.6, emy = 655.14; // new node's midline anchor (51% down)
  let best = null, bestDim = Infinity;
  for (const [ax, ay] of [[422.8, 365.6], [422.8, 340], [422.8, 392], [404, 365.6], [442, 365.6], [422.8, 322], [422.8, 410]]) {
    const s0 = 900 / bmax;
    const ring = base.map(([x, y]) => [ax + (x - emx) * s0, ay + (y - emy) * s0]);
    const fitted = fitRingPts(ring, circ);
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const [x, y] of fitted) {
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
    const dim = Math.max(bx1 - bx0, by1 - by0);
    if (dim < bestDim) { bestDim = dim; best = fitted; }
  }
  return best;
}

function mkStarburst(circ) {
  // figma 12:172: the design's own 8-point rounded star (it carries its eye
  // spot at (887.4, 775.0)); anchored there, best of a small anchor search
  const base = resampleRing(densePoints(DATA.starburst.d), BODY_N);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of base) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const emx = 887.43, emy = 775.02;
  const bmax = Math.max(x1 - x0, y1 - y0);
  let best = null, bestDim = Infinity;
  for (const [ax, ay] of [[422.8, 365.6], [422.8, 340], [422.8, 392], [404, 365.6], [442, 365.6], [422.8, 322], [422.8, 410]]) {
    const s0 = 900 / bmax;
    const ring = base.map(([x, y]) => [ax + (x - emx) * s0, ay + (y - emy) * s0]);
    const fitted = fitRingPts(ring, circ);
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const [x, y] of fitted) {
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
    const dim = Math.max(bx1 - bx0, by1 - by0);
    if (dim < bestDim) { bestDim = dim; best = fitted; }
  }
  return slideRightFit(best, circ);
}

function mkDiamond(circ) {
  // figma 12:92: the design's own rounded diamond; anchor search + auto-fit
  const base = resampleRing(densePoints(DATA.diamond.d), BODY_N);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of base) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const bcx = (x0 + x1) / 2, bcy = (y0 + y1) / 2;
  const bmax = Math.max(x1 - x0, y1 - y0);
  let best = null, bestDim = Infinity;
  for (const [ax, ay] of [[428, 432], [428, 404], [428, 460], [400, 432], [456, 432], [400, 404], [456, 460], [428, 376], [428, 490]]) {
    const s0 = 900 / bmax;
    const ring = base.map(([x, y]) => [ax + (x - bcx) * s0, ay + (y - bcy) * s0]);
    const fitted = fitRingPts(ring, circ);
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const [x, y] of fitted) {
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
    const dim = Math.max(bx1 - bx0, by1 - by0);
    if (dim < bestDim) { bestDim = dim; best = fitted; }
  }
  return slideRightFit(best, circ);
}

// droplet body tint (single colour; the face-14 sweat tear is recoloured
// render-side in the Stage)
function mkDroplet(circ) {
  // figma 22:3: the design's own teardrop; anchor search + auto-fit
  const base = resampleRing(densePoints(DATA.droplet.d), BODY_N);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of base) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const bcx = (x0 + x1) / 2, bcy = (y0 + y1) / 2;
  const bmax = Math.max(x1 - x0, y1 - y0);
  let best = null, bestDim = Infinity;
  for (const [ax, ay] of [[428, 432], [428, 404], [428, 460], [400, 432], [456, 432], [400, 404], [456, 460], [428, 376], [428, 490]]) {
    const s0 = 900 / bmax;
    const ring = base.map(([x, y]) => [ax + (x - bcx) * s0, ay + (y - bcy) * s0]);
    const fitted = fitRingPts(ring, circ);
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const [x, y] of fitted) {
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
    const dim = Math.max(bx1 - bx0, by1 - by0);
    if (dim < bestDim) { bestDim = dim; best = fitted; }
  }
  return best;
}

function mkTrigon(circ) {
  // figma 12:72: the design's own tall rounded hexagon ("trigon");
  // anchor search (no eyes carried) + auto-fit
  const base = resampleRing(densePoints(DATA.trigon.d), BODY_N);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of base) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const bcx = (x0 + x1) / 2, bcy = (y0 + y1) / 2;
  const bmax = Math.max(x1 - x0, y1 - y0);
  let best = null, bestDim = Infinity;
  for (const [ax, ay] of [[428, 432], [428, 404], [428, 460], [400, 432], [456, 432], [400, 404], [456, 460], [428, 376], [428, 490]]) {
    const s0 = 900 / bmax;
    const ring = base.map(([x, y]) => [ax + (x - bcx) * s0, ay + (y - bcy) * s0]);
    const fitted = fitRingPts(ring, circ);
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const [x, y] of fitted) {
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
    const dim = Math.max(bx1 - bx0, by1 - by0);
    if (dim < bestDim) { bestDim = dim; best = fitted; }
  }
  return slideRightFit(best, circ);
}

function mkPebble(circ) {
  const pts = contentPoints();
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const N = BODY_N;
  // radial envelope of the content, binned by angle
  const raw = new Array(N).fill(0);
  for (const [px, py] of pts) {
    const dx = px - cx, dy = py - cy;
    const r = Math.hypot(dx, dy);
    const a = ((Math.atan2(dy, dx) / (2 * Math.PI)) + 1) % 1;
    const bin = Math.min(N - 1, Math.floor(a * N));
    if (r > raw[bin]) raw[bin] = r;
  }
  // close the gaps: running max over a small window, then low-pass (k <= 5)
  const win = new Array(N);
  for (let i = 0; i < N; i++) {
    let mx = 0;
    for (let d = -14; d <= 14; d++) {
      const v = raw[((i + d) % N + N) % N];
      if (v > mx) mx = v;
    }
    win[i] = mx;
  }
  const K = 5;
  const coef = (k) => {
    let ac = 0, bs = 0;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 2 * Math.PI;
      ac += win[i] * Math.cos(k * a);
      bs += win[i] * Math.sin(k * a);
    }
    return [ac / N, bs / N];
  };
  const [c0] = coef(0);
  const cs = [c0];
  for (let k = 1; k <= K; k++) cs.push(coef(k));
  const fit = (a) => {
    let r = cs[0];
    for (let k = 1; k <= K; k++) r += 2 * (cs[k][0] * Math.cos(k * a) + cs[k][1] * Math.sin(k * a));
    return r;
  };
  // pad so the smooth curve never dips under the raw envelope; then add the
  // organic margin wobble (>= 4 everywhere)
  let def = 0;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI;
    def = Math.max(def, win[i] - fit(a));
  }
  const base = def + 30;
  const ring = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI;
    const m = base + 16 * Math.cos(2 * a + 1.1) + 10 * Math.cos(3 * a - 0.6);
    const r = fit(a) + m;
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return alignTo(circ, ring);
}

let _rings = null;
function ringSet() {
  if (_rings) return _rings;
  const circle = mkCircle();
  const cloud = mkCloud(circle);
  const mk = (ring) => ({ fit: ring, render: ring, cloud: false });
  _rings = {
    circle: { fit: circle, render: circle, circle: true },
    cloud: { fit: cloud.fit, render: cloud.render, cloud: true, fill: CLOUD_FILL, tear: _tearOf(CLOUD_FILL) },
    square: { fit: mkSquare(circle), render: null, cloud: false, fill: SQUARE_FILL, tear: _tearOf(SQUARE_FILL) },
    hexagon: { fit: mkHexagon(circle), render: null, cloud: false, fill: HEX_FILL, tear: _tearOf(HEX_FILL) },
    pebble: { fit: mkPebble(circle), render: null, cloud: false, fill: PEBBLE_FILL, tear: _tearOf(PEBBLE_FILL) },
    triangle: { fit: mkTriangle(circle), render: null, cloud: false, fill: TRI_FILL, tear: _tearOf(TRI_FILL) },
    starburst: { fit: mkStarburst(circle), render: null, cloud: false, fill: SB_FILL, tear: _tearOf(SB_FILL) },
    trigon: { fit: mkTrigon(circle), render: null, cloud: false, fill: TRIGON_FILL, tear: _tearOf(TRIGON_FILL) },
    droplet: { fit: mkDroplet(circle), render: null, cloud: false, fill: DROPLET_FILL, tear: _tearOf(DROPLET_FILL) },
    diamond: { fit: mkDiamond(circle), render: null, cloud: false, fill: DIA_FILL, tear: _tearOf(DIA_FILL) },
  };
  _rings.triangle.render = _rings.triangle.fit;
  _rings.hexagon.render = _rings.hexagon.fit;
  _rings.diamond.render = _rings.diamond.fit;
  _rings.starburst.render = _rings.starburst.fit;
  _rings.square.render = _rings.square.fit;
  _rings.pebble.render = _rings.pebble.fit;
  _rings.trigon.render = _rings.trigon.fit;
  _rings.droplet.render = _rings.droplet.fit;
  return _rings;
}

function ringOf(from) {
  return typeof from === "string" ? ringSet()[from] : from;
}

// face 23's warning mark sits close to the cloud's bottom edge, so the bottom
// arc grows outward (down) before anything else — the wobble then rides on
// this fuller base, still inward-only.
const BOT_GROW = { amp: 65, power: 3 };

function growRing(pts) {
  const n = pts.length;
  let gx = 0, gy = 0;
  for (const [x, y] of pts) { gx += x; gy += y; }
  gx /= n; gy /= n;
  return pts.map(([x, y], i) => {
    const dx = x - gx, dy = y - gy;
    const r = Math.hypot(dx, dy) || 1;
    const down = Math.max(0, dy / r);
    if (down <= 0) return [x, y];
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const L = Math.hypot(tx, ty) || 1;
    tx /= L; ty /= L;
    let nx = -ty, ny = tx;
    if ((x - gx) * nx + (y - gy) * ny < 0) { nx = -nx; ny = -ny; }
    const u = BOT_GROW.amp * Math.pow(down, BOT_GROW.power);
    return [x + nx * u, y + ny * u];
  });
}

// Outward offsets fold back on themselves where the boundary curves away from
// the push (the cloud's side bites), leaving hairline slivers in the edge. The
// authored silhouette's turns all stay under ~75deg, so anything sharper is a
// fold: relax those neighbourhoods (and only those) until the edge is clean.
function relaxFolds(pts, maxTurn = 1.4, iters = 60, span = 8, minSeg = 9) {
  const n = pts.length;
  const out = pts.map((p) => [p[0], p[1]]);
  const segAt = (i) => {
    const a = out[i], b = out[(i + 1) % n];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  const turnAt = (i) => {
    const a = out[(i - 1 + n) % n], b = out[i], c = out[(i + 1) % n];
    const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
    const l1 = Math.hypot(v1x, v1y) || 1, l2 = Math.hypot(v2x, v2y) || 1;
    const d = (v1x * v2x + v1y * v2y) / (l1 * l2);
    return Math.acos(Math.max(-1, Math.min(1, d)));
  };
  for (let it = 0; it < iters; it++) {
    const bad = [];
    for (let i = 0; i < n; i++) {
      // a fold reads as a sharp turn, and the relax's own leftovers can linger
      // as pinched corners next to stubby segments — both count as unresolved
      if (turnAt(i) > maxTurn || segAt((i - 1 + n) % n) < minSeg || segAt(i) < minSeg) bad.push(i);
    }
    if (!bad.length) break;
    const touched = new Set();
    for (const i of bad) for (let k = -span; k <= span; k++) touched.add((i + k + n) % n);
    const cp = out.map((p) => [p[0], p[1]]);
    for (const i of touched) {
      const a = cp[(i - 1 + n) % n], b = cp[i], c = cp[(i + 1) % n];
      out[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
    }
  }
  return out;
}

// --- ambient cloud motion ----------------------------------------------------
// slow travelling waves push each ring point along its inward normal, so the
// lobes gently undulate like a live cloud. Inward-only from the base
// silhouette: the frame fit is computed from the unwobbled rings, so the shape
// can never poke past the viewBox no matter where the waves are.
const WAVES = [
  { k: 4, period: 5600, amp: 10, dir: 1, ph: 0.4 },
  { k: 7, period: 3900, amp: 6, dir: -1, ph: 2.1 },
  { k: 2, period: 8800, amp: 5, dir: 1, ph: 4.6 },
];

function wobbleBlob(pts, tMs, amt) {
  const n = pts.length;
  let gx = 0, gy = 0;
  for (const [x, y] of pts) { gx += x; gy += y; }
  gx /= n; gy /= n;
  return pts.map(([x, y], i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const L = Math.hypot(tx, ty) || 1;
    tx /= L; ty /= L;
    let nx = -ty, ny = tx;
    if ((gx - x) * nx + (gy - y) * ny < 0) { nx = -nx; ny = -ny; }
    let u = 0;
    for (const w of WAVES) {
      const th = 2 * Math.PI * (w.k * (i / n) + w.dir * (tMs / 1000) / (w.period / 1000)) + w.ph;
      u += w.amp * (1 - Math.cos(th)) / 2;
    }
    return [x + nx * u * amt, y + ny * u * amt];
  });
}

// stage frame: the blend's own bounds decide scale + pivot, so the silhouette
// fills the viewBox exactly like the circle does and can never be shaved by
// the viewport mid-morph.
function frameOf(pts) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const bw = x1 - x0, bh = y1 - y0;
  return { s: DATA.viewBox / Math.max(bw, bh), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

function lerpP(a, b, e) {
  return a.map(([x, y], i) => [x + (b[i][0] - x) * e, y + (b[i][1] - y) * e]);
}

// from: a body key or a snapshot from bodySnapshot(); toKey: a body key.
// live=false renders the calm base (frozen captures).
export function bodyFrameFor(from, toKey, tRaw, tMs = 0, live = true) {
  const e = smooth5(Math.min(1, Math.max(0, tRaw)));
  const A = ringOf(from), B = ringSet()[toKey];
  const fit = lerpP(A.fit, B.fit, e);
  let render = lerpP(A.render, B.render, e);
  // ambient edge motion on every body shape (the plain circle stays calm so
  // the base face keeps its exact look); fades with the circle's weight
  const circleW = (A.circle ? 1 - e : 0) + (B.circle ? e : 0);
  const wobW = 1 - circleW;
  if (live && wobW > 0.001) render = wobbleBlob(render, tMs, wobW);
  const f = frameOf(fit);
  const tints = [];
  if (A.fill && 1 - e > 0.001) tints.push({ fill: A.fill, w: 1 - e });
  if (B.fill && e > 0.001) tints.push({ fill: B.fill, w: e });
  const tears = [];
  if (A.tear && 1 - e > 0.001) tears.push({ fill: A.tear, w: 1 - e });
  if (B.tear && e > 0.001) tears.push({ fill: B.tear, w: e });
  return { d: polyPath(render, true), s: f.s, cx: f.cx, cy: f.cy, tints, tears, cw: circleW };
}

// capture the in-flight visual so a redirect can morph on from exactly here
export function bodySnapshot(from, toKey, tRaw) {
  const e = smooth5(Math.min(1, Math.max(0, tRaw)));
  const A = ringOf(from), B = ringSet()[toKey];
  // carry the colour on screen too: without it a redirect dropped the old
  // tint and flashed the base grey before blending to the new target. The
  // composite mirrors Stage's weighted blend over the default grey, so the
  // redirect restarts from the exact displayed colour
  let fill = null;
  const wA = A.fill ? 1 - e : 0, wB = B.fill ? e : 0;
  const wS = Math.min(1, wA + wB);
  if (wS > 0.001) {
    const [br, bg2, bb2] = parseColor("#D9D9D9");
    const o = [br * (1 - wS), bg2 * (1 - wS), bb2 * (1 - wS)];
    if (wA > 0.001) { const [r2, g2, b2] = parseColor(A.fill); o[0] += r2 * wA; o[1] += g2 * wA; o[2] += b2 * wA; }
    if (wB > 0.001) { const [r2, g2, b2] = parseColor(B.fill); o[0] += r2 * wB; o[1] += g2 * wB; o[2] += b2 * wB; }
    fill = `rgb(${Math.round(o[0])}, ${Math.round(o[1])}, ${Math.round(o[2])})`;
  }
  return {
    fit: lerpP(A.fit, B.fit, e),
    render: lerpP(A.render, B.render, e),
    cloud: (A.cloud ? 1 - e : 0) + (B.cloud ? e : 0) > 0.5,
    fill,
  };
}
