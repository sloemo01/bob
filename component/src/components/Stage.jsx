// components/Stage.jsx — the SVG stage. Holds render the exact face geometry;
// morphs render flubber-interpolated paths (no opacity crossfades).

import DATA from "../data.json";
import { lerp, lerpColor, ellipsePath, parseColor } from "../engine/geom";
import { clipPathD, getTransition, renderItem, isDotsMorph, NOOP_RECT, bodyFrameFor, CLOUD_FILL, SQUARE_FILL, HEX_FILL, DIA_FILL, TRIGON_FILL, SB_FILL, DROPLET_FILL } from "../engine/morph";
import { DOTS_ROW, DOTS_SPIN, CLOCK_ORIG, zzzPathsAt, HAND_ANGLE0 } from "../engine/clock";
import { transformDR, warpD } from "../engine/geom";

const MARK_BASES = { check: "#2E9E5B", redx: "#D64545", warn: "#D9901F", blush: "#FF2E2E" };
// per-body colour edits adopted from the Figma sheet (the 21 and 23 columns):
// checks brighten to #1FF575 and the signal marks go orange/amber on the
// shapes recoloured there; bodies not listed keep the base + clash rule
const CHECK_ADOPTED = { [CLOUD_FILL]: "#1FF575", [SQUARE_FILL]: "#1FF575", [HEX_FILL]: "#1FF575", [TRIGON_FILL]: "#1FF575", [SB_FILL]: "#1FF575" };
const WARN_ADOPTED = { [CLOUD_FILL]: "#FF9B00", [SQUARE_FILL]: "#FF9B00", [HEX_FILL]: "#FF9B00", [DIA_FILL]: "#FF9B00", [TRIGON_FILL]: "#FFBB52", [DROPLET_FILL]: "#FF9B00" };
const ADOPTED = { check: CHECK_ADOPTED, warn: WARN_ADOPTED };
const TEAR_BASE = "#514F4F"; // the tear's own drawn colour
function hslOf(hex) {
  const [R, G, B] = parseColor(hex);
  const r = R / 255, g = G / 255, b = B / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}
function withL(hex, l) {
  const { h, s } = hslOf(hex);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m0 = l - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
  return "#" + rgb.map((v) => Math.round((v + m0) * 255).toString(16).padStart(2, "0")).join("");
}
// coloured marks (the face-21 tick, the red X, the warn amber, the blush) keep
// their hue on every body; when the body sits close in hue AND lightness the
// mark drops to a deep shade of itself so it still reads
function markPaint(base, body, gate) {
  if (!base || !body || gate <= 0.001) return base;
  const a = hslOf(base), b = hslOf(body);
  let dh = Math.abs(a.h - b.h);
  dh = Math.min(dh, 360 - dh);
  if (dh < 45 && Math.abs(a.l - b.l) < 0.3) {
    return lerpColor(base, withL(base, Math.min(a.l, 0.3)), gate);
  }
  return base;
}
const polyStr = (arr) => {
  const o = [];
  for (let k = 0; k < 8; k += 2) o.push(arr[k].toFixed(1) + "," + arr[k + 1].toFixed(1));
  return o.join(" ");
};
// crop polygons sweep in edge by edge, each edge moving only inward, so the
// cutoff arrives from the top and the sides close in from outside the eye.
// A cornerwise lerp between a far frame and a small wedge instead lets the
// polygon pinch into a narrow band across the eye — the eye looks like it
// shuts from both sides mid-flight.
const edgeLine = (p, q) => {
  // the line through p and q as (nx, ny, c): nx*x + ny*y = c
  const nx = q[1] - p[1], ny = p[0] - q[0];
  const L = Math.hypot(nx, ny) || 1;
  return [nx / L, ny / L, (nx * p[0] + ny * p[1]) / L];
};
const lineMeet = (a, b) => {
  const det = a[0] * b[1] - a[1] * b[0];
  if (Math.abs(det) < 1e-9) return [0, 0];
  return [(a[2] * b[1] - a[1] * b[2]) / det, (a[0] * b[2] - a[2] * b[0]) / det];
};
function cropEdges(poly) {
  const F = [[poly[0], poly[1]], [poly[2], poly[3]], [poly[4], poly[5]], [poly[6], poly[7]]];
  const E = [[F[0], F[1]], [F[1], F[2]], [F[2], F[3]], [F[3], F[0]]];
  const mids = E.map(([p, q]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
  const pick = (sc) => { let b = 0, bv = Infinity; mids.forEach((m, k) => { const v = sc(m); if (v < bv) { bv = v; b = k; } }); return b; };
  return {
    top: E[pick((m) => m[1])], right: E[pick((m) => -m[0])],
    bottom: E[pick((m) => -m[1])], left: E[pick((m) => m[0])],
  };
}
const lerpCrop = (a, b, t) => {
  const A = a || NOOP_RECT, B = b || NOOP_RECT;
  const EA = cropEdges(A), EB = cropEdges(B);
  const lines = ["top", "right", "bottom", "left"].map((k) => {
    let [p1, p2] = EA[k];
    let [q1, q2] = EB[k];
    // keep each edge's endpoints paired so the edge never flips end-for-end
    const straight = Math.hypot(p1[0] - q1[0], p1[1] - q1[1]) + Math.hypot(p2[0] - q2[0], p2[1] - q2[1]);
    const crossed = Math.hypot(p1[0] - q2[0], p1[1] - q2[1]) + Math.hypot(p2[0] - q1[0], p2[1] - q1[1]);
    if (crossed < straight) { const tmp = q1; q1 = q2; q2 = tmp; }
    const r1 = [lerp(p1[0], q1[0], t), lerp(p1[1], q1[1], t)];
    const r2 = [lerp(p2[0], q2[0], t), lerp(p2[1], q2[1], t)];
    return edgeLine(r1, r2);
  });
  const P = [
    lineMeet(lines[0], lines[3]), lineMeet(lines[0], lines[1]),
    lineMeet(lines[2], lines[1]), lineMeet(lines[2], lines[3]),
  ];
  return [P[0][0], P[0][1], P[1][0], P[1][1], P[2][0], P[2][1], P[3][0], P[3][1]];
};

// the blink lid's lower edge dips by this much at its middle (design units):
// a straight chop left the low pupil on face 9 showing as a flat-topped slab
const DOME = 80;

// the timer (face 15) is styled as a 3D ball: the black dial gets a sphere
// gradient, and its content (the knob and the hand) bends with the ball's
// curvature near the rim. The warp is render-time only — morph paths are
// interpolated exactly as before, so the transitions stay smooth.
const TIMER_BALL = { cx: 684.135, cy: 593.545, R: 70.3, amt: 0.22 };
const ballWarp = (d, id) =>
  id && id.startsWith("clock") && id !== "clock#0"
    ? warpD(d, TIMER_BALL.cx, TIMER_BALL.cy, TIMER_BALL.R, TIMER_BALL.amt)
    : d;

// the cloud body (figma node 12:2) and its circle<->cloud ring morph live in
// the engine (morph.js): bodyFrameFor() blends any two body rings (circle /
// cloud / square) and fits the result to the stage, cloud wobble included.

function HeldEyes({ face, gaze, blink, color, still }) {
  return ["L", "R"].map((s) => {
    const e = face["e" + s], p = face["p" + s];
    const { cx: ecx, cy: ecy, rx: erx, ry: ery, rot: erot, vis: evis } = e;
    const pcx = p.cx + gaze.x, pcy = p.cy + gaze.y;
    const lx = ecx - erx - 26, ly = ecy - ery - 26, lw = 2 * erx + 52, lh = 2 * ery + 52;
    const bv2 = Math.max(still ? 0 : blink, 0.0001);
    const rotT = erot ? `rotate(${erot.toFixed(3)} ${ecx.toFixed(2)} ${ecy.toFixed(2)})` : undefined;
    return (
      <g key={s} opacity={evis.toFixed(3)}>
        <g clipPath={`url(#crop${s}clip)`}>
          <ellipse cx={ecx} cy={ecy} rx={erx} ry={ery} fill="black" transform={rotT} />
          <g clipPath={`url(#eyeClip${s})`}>
            <ellipse
              cx={pcx} cy={pcy} rx={p.rx} ry={p.ry} fill="white"
              opacity={(p.vis * (1 - (p.mode || 0))).toFixed(3)}
              transform={p.rot ? `rotate(${p.rot.toFixed(3)} ${pcx.toFixed(2)} ${pcy.toFixed(2)})` : undefined}
            />
            {(p.mode || 0) > 0 && (
              <path
                d={s === "L" ? DATA.heartL : DATA.heartR} fill="white"
                opacity={(p.vis * p.mode).toFixed(3)}
                transform={erot ? `rotate(${p.rot.toFixed(3)} ${p.cx.toFixed(2)} ${p.cy.toFixed(2)})` : undefined}
              />
            )}
          </g>
          {/* the blink lid lives OUTSIDE the eye clip: clipped content rasterises
              with a hard edge, which made the lid's boundary jagged mid-blink.
              Unclipped, grey-over-grey beyond the eye is invisible anyway.
              The lid carries the eye's own tilt (some faces' eyes lean a few
              degrees) so its edge stays parallel to the eye, and its lower
              edge is a dome (middle deepest) rather than a straight chop —
              on face 9 the pupil sits low (reading gaze), so a flat edge left
              a straight-topped white slab of pupil showing mid-blink, which
              read as a rectangle. The dome leaves the eye's natural bottom
              crescent instead. */}
          <path
            d={`M ${lx.toFixed(2)} ${ly.toFixed(2)} H ${(lx + lw).toFixed(2)} V ${(ly + lh - DOME).toFixed(2)} Q ${(lx + lw / 2).toFixed(2)} ${(ly + lh + DOME).toFixed(2)} ${lx.toFixed(2)} ${(ly + lh - DOME).toFixed(2)} Z`}
            fill={color}
            transform={`${erot ? `rotate(${erot.toFixed(3)} ${ecx.toFixed(2)} ${ecy.toFixed(2)}) ` : ""}translate(0 ${ly.toFixed(2)}) scale(1 ${bv2.toFixed(4)}) translate(0 ${(-ly).toFixed(2)})`}
          />
        </g>
      </g>
    );
  });
}

function Extras({ face, clockTick = 0, promptBlink = 1, liveD = null, still = false, tearCol = null, markCols = null }) {
  return DATA.extraKeys.map((k) => {
    if (k === "dots" || !(face.ex[k] > 0)) return null;
    return (
      <g key={k}>
        {DATA.extras[k].map((s, idx) => (
          <path
            key={idx}
            d={(liveD && liveD[k + "#" + idx]) || s.d}
            fill={
              k === "tear" && tearCol
                ? tearCol
                : markCols && markCols[k] && s.fill && s.fill.toLowerCase() === MARK_BASES[k].toLowerCase()
                  ? markCols[k]
                  : s.fill || "none"
            }
            stroke={
              markCols && markCols[k] && s.stroke && s.stroke.toLowerCase() === MARK_BASES[k].toLowerCase()
                ? markCols[k]
                : s.stroke || "none"
            }
            strokeWidth={s.sw || undefined}
            strokeLinecap="round" strokeLinejoin="round"
            opacity={k === "barR04" && promptBlink < 1 ? promptBlink.toFixed(3) : undefined}
            transform={
              k === "clock" && idx === DATA.extras.clock.length - 1
                ? `rotate(${clockTick.toFixed(2)} ${CLOCK_ORIG[0]} ${CLOCK_ORIG[1]})`
                : undefined
            }
          />
        ))}
      </g>
    );
  });
}

function DotsOverlay({ snap }) {
  const { op, pos, bob } = snap.dots;
  const still = snap.still;
  if (op < 0.01) return null;
  const morphing = !still && snap.phase === "morph";
  const dotsMorph = morphing && isDotsMorph(snap.i, snap.j);
  // during the 1<->2 morph the dots are drawn by the morph layer, and any
  // other morph that consumes them (3 -> 4) as well
  if (morphing && !dotsMorph) return null;
  return DATA.extras.dots.map((s, k) => {
    const b = DOTS_ROW[k];
    const t = still
      ? `translate(${pos[k][0].toFixed(2)} ${pos[k][1].toFixed(2)}) translate(${-b[0]} ${-b[1]})`
      : `translate(${pos[k][0].toFixed(2)} ${(pos[k][1] + bob[k]).toFixed(2)}) scale(${(1 - 0.11 * (bob[k] / 15)).toFixed(4)}) translate(${-b[0]} ${-b[1]})`;
    return <path key={k} d={s.d} fill="#050505" transform={t} />;
  });
}

function MorphView({ snap, hasCropL, hasCropR, tearCol = null, markCols = null }) {
  if (isDotsMorph(snap.i, snap.j)) return null; // the dots system animates that one
  const dyn = {
    ...(snap.frozenDots
      ? Object.fromEntries(snap.frozenDots.map((p, k) => ["dots#" + k, ellipsePath(p[0], p[1], 52, 52)]))
      : {}),
    ...(snap.frozenZzz || {}),
    ...(snap.frozenTear || {}),
    ...(snap.frozenChev || {}),
    ...(snap.frozenPen || {}),
    ...(snap.frozenTool || {}),
    ...(snap.frozenMag || {}),
    ...(snap.frozenGaze || {}),
    ...(snap.frozenClock || {}),
  };
  // a morph INTO face 3 must land the dots on the spinner's orbit slots — the
  // pose its loop begins from — and one INTO face 11 lands on the Z's t0 pose
  const dynB = {
    ...(snap.j === 2 && snap.i !== 2
      ? Object.fromEntries(DOTS_SPIN.map((p, k) => ["dots#" + k, ellipsePath(p[0], p[1], 52, 52)]))
      : {}),
    ...(snap.j === 11 && snap.i !== 10 ? zzzPathsAt(0) : {}),
    // a morph INTO 15 lands the hand on the corrected hold pose (tickDeg(0)),
    // not the figma-exact drawn angle, so the first tick starts from straight
    ...(snap.j === 15 && snap.i !== 14
      ? { "clock#2": transformDR(DATA.extras.clock[DATA.extras.clock.length - 1].d, 0, 0, -HAND_ANGLE0, CLOCK_ORIG[0], CLOCK_ORIG[1]) }
      : {}),
  };
  const { items } = getTransition(
    snap.i, snap.j,
    Object.keys(dyn).length ? dyn : null,
    Object.keys(dynB).length ? dynB : null
  );
  const t = snap.tRaw != null ? snap.tRaw : snap.t;
  const renders = items.map((it) => {
    const r = renderItem(it, t, snap.dots.pos);
    const tearW =
      ((it.a && it.a.id === "tear#0") ? 1 - t : 0) + ((it.b && it.b.id === "tear#0") ? t : 0);
    if (tearW > 0.001 && tearCol) r.ink = lerpColor(r.ink, tearCol, tearW);
    if (markCols) {
      const mk = ["check", "redx", "warn", "blush"].find(
        (m) =>
          (it.a && (it.a.id || "").startsWith(m)) || (it.b && (it.b.id || "").startsWith(m)),
      );
      if (mk && markCols[mk]) {
        const w2 =
          ((it.a && (it.a.id || "").startsWith(mk)) ? 1 - t : 0) +
          ((it.b && (it.b.id || "").startsWith(mk)) ? t : 0);
        if (w2 > 0.001) r.ink = lerpColor(r.ink, markCols[mk], w2);
      }
    }
    return { it, r };
  });
  // the morphing eye shapes (used to clip pupils)
  const eyeD = {};
  for (const { it, r } of renders) {
    if (r.draw) continue;
    for (const s of [it.a, it.b]) {
      if (s && (s.id === "eyeL" || s.id === "eyeR")) eyeD[s.id] = r;
    }
  }
  // eyes and pupils also live inside the live crop polygons while morphing,
  // exactly like the held frame — the crop's top edge descends from above as
  // the transition runs, so the angry-eye cutoff arrives from the top instead
  // of snapping on at the handoff
  const eyeSide = (it) => {
    const ids = [it.a && it.a.id, it.b && it.b.id];
    if (ids.indexOf("eyeL") >= 0 || ids.indexOf("pupL") >= 0) return "L";
    if (ids.indexOf("eyeR") >= 0 || ids.indexOf("pupR") >= 0) return "R";
    return null;
  };
  // pupil clipping schedule: a pupil inside its own eye (blooming in/out or
  // holding) is clipped exactly like the held frame; one that ARRIVES (a dot
  // becoming the pupil, 2->1) travels free and then the clip's margin closes
  // evenly onto it; one that DEPARTS (the pupil becoming the middle dot, 1->2)
  // keeps a tight clip early so its spill never pops, then releases.
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const sm = (p) => { const q = clamp01(p); return q * q * (3 - 2 * q); };
  const pupilClip = (it, r) => {
    const aP = it.a && (it.a.id === "pupL" || it.a.id === "pupR") ? it.a.id : null;
    const bP = it.b && (it.b.id === "pupL" || it.b.id === "pupR") ? it.b.id : null;
    const side = aP || bP;
    if (!side) return null;
    const eye = side === "pupL" ? "eyeL" : "eyeR";
    const other = aP ? it.b : it.a;
    const otherPupil = other && (other.id === "pupL" || other.id === "pupR");
    // m = the clip margin in design units. 0 = clipped exactly like the held
    // frame; large = the clip sits far outside and hides nothing. The margin
    // moves smoothly, so both the departure (release) and the arrival
    // (tighten) read as an even rim closing, never a snap.
    let m = 0;
    if (aP && other && !otherPupil) m = 260 * sm((r.tt - 0.05) / 0.5) ** 2;       // departing
    else if (bP && other && !otherPupil) m = 260 * (1 - sm((r.tt - 0.35) / 0.6)) ** 2; // arriving
    return { eye, m };
  };
  return (
    <>
      {renders.map(({ it, r }) => {
        const pc = pupilClip(it, r);
        const rd = r;
        const ep = pc ? eyeD[pc.eye] : null;
        const el = rd.hidden ? null : rd.draw ? (
          <path
            key={rd.key} d={rd.d} fill="none" stroke={rd.ink} strokeWidth={rd.sw}
            strokeLinecap="round" strokeLinejoin="round" strokeDasharray={rd.dash}
          />
        ) : rd.mode === "ring" ? (
          rd.strokePaint ? (
            <path
              key={rd.key} d={rd.d} fill="none" stroke={rd.ink}
              strokeWidth={Math.max(0.5, rd.sw)} strokeLinecap="round" strokeLinejoin="round"
            />
          ) : (
            <path key={rd.key} d={rd.d} fill={rd.ink} />
          )
        ) : (
          <path
            key={rd.key} d={rd.d} fill="none" stroke={rd.ink}
            strokeWidth={Math.max(0.5, rd.sw)} strokeLinecap="round" strokeLinejoin="round"
          />
        );
        let core = el;
        if (ep && ep.pts) {
          const cid = `mvC${r.key}`;
          core = (
            <g key={r.key} clipPath={`url(#${cid})`}>
              <defs><clipPath id={cid}><path d={clipPathD(ep.pts, pc.m)} /></clipPath></defs>
              {el}
            </g>
          );
        }
        const side = eyeSide(it);
        if ((side === "L" && hasCropL) || (side === "R" && hasCropR)) {
          return <g key={r.key} clipPath={`url(#crop${side}clip)`}>{core}</g>;
        }
        return core;
      })}
    </>
  );
}

export default function Stage({ snap, big, bodyFrom = "circle", bodyTo = "circle", bodyT = 1 }) {
  const { i, j, phase, t, still } = snap;
  const fa = DATA.faces[i], fb = DATA.faces[j];
  const morphing = !still && phase === "morph";
  const color = morphing ? lerpColor(fa.color, fb.color, t) : fa.color;
  // still mode = frozen canonical rest pose; it honors an explicit body so a
  // capture can render a face on any body (?still=1&body=cloud), and still
  // defaults to the plain circle when no body is given (the exact baseline)
  const bFrom = bodyFrom;
  const bTo = bodyTo;
  const bT = still ? 1 : bodyT;
  const settledCircle = bTo === "circle" && bT >= 1;
  const bf = settledCircle ? null : bodyFrameFor(bFrom, bTo, bT, snap.liveT || 0, !big);
  // body colour: the shape fills tint the default body grey, but a face with
  // its own body colour (12's angry red) takes over every shape — the tints
  // fade with the face colour's distance from the default grey
  const tearGate = still ? 0 : bf ? 1 - (bf.cw || 0) : 0;
  let tearCol = TEAR_BASE;
  if (bf && bf.tears) {
    // weighted over TEAR_BASE, never sequential lerps: a shape-to-shape blend
    // crosses straight between the two body tears instead of compounding
    const tsum = bf.tears.reduce((s, t) => s + t.w, 0);
    const tmass = Math.min(1, tsum);
    if (tmass > 0.001) {
      const [br, bgc, bbc] = parseColor(TEAR_BASE);
      const oT = [br * (1 - tmass), bgc * (1 - tmass), bbc * (1 - tmass)];
      for (const t of bf.tears) {
        const [tr, tg, tb] = parseColor(t.fill);
        const tw = (tmass * t.w) / tsum;
        oT[0] += tr * tw; oT[1] += tg * tw; oT[2] += tb * tw;
      }
      tearCol = `rgb(${Math.round(oT[0])}, ${Math.round(oT[1])}, ${Math.round(oT[2])})`;
    }
    tearCol = lerpColor(TEAR_BASE, tearCol, tearGate);
  }
  let bodyColor = color;
  let keeper = 1;
  if (bf && bf.tints.length) {
    const [r, g, b] = parseColor(color);
    const dist = Math.max(Math.abs(r - 0xd9), Math.abs(g - 0xd9), Math.abs(b - 0xd9));
    keeper = Math.min(1, Math.max(0, 1 - dist / 100));
    // weighted average over the base: shape-to-shape blends go straight from
    // fill to fill instead of compounding through the base grey (which left
    // a washed-out white in the middle of the morph)
    const bsum = bf.tints.reduce((s, t) => s + t.w, 0);
    const bmass = Math.min(1, bsum) * keeper;
    if (bmass > 0.001) {
      const oB = [r * (1 - bmass), g * (1 - bmass), b * (1 - bmass)];
      for (const tn of bf.tints) {
        const [tr, tg, tb] = parseColor(tn.fill);
        const bw2 = (bmass * tn.w) / bsum;
        oB[0] += tr * bw2; oB[1] += tg * bw2; oB[2] += tb * bw2;
      }
      bodyColor = `rgb(${Math.round(oB[0])}, ${Math.round(oB[1])}, ${Math.round(oB[2])})`;
    }
  }
  const markCols = {};
  for (const k in MARK_BASES) markCols[k] = markPaint(MARK_BASES[k], bodyColor, tearGate);
  // follow the body's own blend: an adopted colour greets the shape as it
  // becomes that body and fades back with the tint weight
  if (bf) for (const tn of bf.tints) {
    const key = tn.fill.toUpperCase();
    for (const mk in ADOPTED) {
      const o = ADOPTED[mk][key];
      if (o) markCols[mk] = lerpColor(markCols[mk], o, Math.min(1, tn.w * keeper));
    }
  }
  const cropL = morphing ? lerpCrop(fa.cropL, fb.cropL, t) : (fa.cropL || NOOP_RECT);
  const cropR = morphing ? lerpCrop(fa.cropR, fb.cropR, t) : (fa.cropR || NOOP_RECT);
  const eyeClip = (e) => (
    <ellipse
      cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry}
      transform={e.rot ? `rotate(${e.rot.toFixed(3)} ${e.cx.toFixed(2)} ${e.cy.toFixed(2)})` : undefined}
    />
  );
  return (
    <svg id="stage" className={big ? "big" : undefined} viewBox={`0 0 ${DATA.viewBox} ${DATA.viewBox}`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="timerBall" cx="0.38" cy="0.32" r="0.72">
          <stop offset="0" stopColor="#3C3C3C" />
          <stop offset="0.42" stopColor="#0F0F0F" />
          <stop offset="0.75" stopColor="#000000" />
          <stop offset="1" stopColor="#000000" />
        </radialGradient>
        <clipPath id="faceClip">
          {bf ? (
            <path d={bf.d} />
          ) : (
            <circle cx="422.854" cy="422.854" r="422.854" />
          )}
        </clipPath>
        <clipPath id="eyeClipL">{eyeClip(fa.eL)}</clipPath>
        <clipPath id="eyeClipR">{eyeClip(fa.eR)}</clipPath>
        <clipPath id="cropLclip"><polygon points={polyStr(cropL)} /></clipPath>
        <clipPath id="cropRclip"><polygon points={polyStr(cropR)} /></clipPath>
      </defs>
      <g
        id="stageg"
        transform={`translate(422.854 422.854) scale(${(snap.stageScale * (bf ? bf.s : 1)).toFixed(5)}) translate(${(-(bf ? bf.cx : 422.854)).toFixed(3)} ${(-(bf ? bf.cy : 422.854)).toFixed(3)})`}
      >
        {bf ? (
          <path d={bf.d} fill={bodyColor} />
        ) : (
          <circle cx="422.854" cy="422.854" r="422.854" fill={color} />
        )}
        {/* everything dynamic is clipped to the face circle: the blink lids are
            taller than the eye by a margin and on faces whose eyes sit high
            (9, 10) the lid's corner poked past the face's edge and showed as a
            grey rectangle over the page background */}
        <g clipPath="url(#faceClip)">
          {morphing ? (
            <MorphView snap={snap} hasCropL={!!(fa.cropL || fb.cropL)} hasCropR={!!(fa.cropR || fb.cropR)} tearCol={tearGate > 0.001 ? tearCol : null} markCols={tearGate > 0.001 ? markCols : null} />
          ) : (
            <>
              <HeldEyes face={fa} gaze={still ? { x: 0, y: 0 } : snap.gaze} blink={snap.blink} color={bodyColor} still={still} />
              <Extras face={fa} clockTick={snap.clockTick || 0} promptBlink={snap.promptBlink == null ? 1 : snap.promptBlink} still={still} tearCol={tearGate > 0.001 ? tearCol : null} markCols={tearGate > 0.001 ? markCols : null} liveD={{ ...(snap.zzz || {}), ...(snap.tear || {}), ...(snap.chev5 || {}), ...(snap.pen || {}), ...(snap.tool || {}), ...(snap.mag || {}) }} />
            </>
          )}
          <DotsOverlay snap={snap} />
        </g>
      </g>
    </svg>
  );
}
