// engine/clock.js — the animation state machine: face sequence, eye motion and
// the face-2/3 dots system. React renders snapshots of this; no DOM here.

import DATA from "../data.json";
import { lerp, smooth5, easeSin, transformD, transformDR, ellipsePath } from "./geom";

export const N = DATA.faces.length;
export const MORPH_MS = 1060;
// transitions with a late guest (the "?" writing itself on after the eyes)
// get extra room so every beat still reads unhurried
const MORPH_FIX = { "4-5": 1800, "5-4": 1800, "10-11": 1250, "11-10": 1250 };
const morphDur = (a, b) => MORPH_FIX[`${a}-${b}`] || MORPH_MS;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// dots layout + motion (ported from the vanilla build)
const DOTS_ROW = [[287.854, 395.304], [422.854, 395.304], [557.854, 395.304]];
const DOTS_SPIN = [[280.655, 286.136], [601.021, 370.854], [370.854, 557.273]];
const DOTS_CEN = [422.854, 422.854];
const SPIN_SEG = 300, SPIN_PERIOD = 2450, SPIN_ROT = 0.18, SPIN_RAMP = 500;
const SPIN_ORIG = [417.51, 404.754];
const TUCK_IN = [800, 1100, 500], TUCK_OUT = [1850, 1550, 2150];
function tuckU(t, tin, tout) {
  if (t < tin) return 0;
  if (t < tin + SPIN_SEG) return easeSin((t - tin) / SPIN_SEG);
  if (t < tout) return 1;
  if (t < tout + SPIN_SEG) return 1 - easeSin((t - tout) / SPIN_SEG);
  return 0;
}
const toPolar = (arr) =>
  arr.map((p) => [
    Math.hypot(p[0] - DOTS_CEN[0], p[1] - DOTS_CEN[1]),
    Math.atan2(p[1] - DOTS_CEN[1], p[0] - DOTS_CEN[0]),
  ]);
const P_ROW = toPolar(DOTS_ROW), P_SPIN = toPolar(DOTS_SPIN);
export { DOTS_ROW, DOTS_SPIN, DOTS_CEN };

// the timer face's needle: rotation centre (the dial's centre in design
// coords) and its tick — a wind-up, a crisp snap forward one slot, a hold
export const CLOCK_ORIG = [684.135, 593.545];
const TICK_MS = 700, TICK_DEG = 30;
// the long hand is drawn pointing exactly at the 12, so the landings need no
// angular compensation at all. (An earlier version measured the drawn angle
// from the path tokens and caught a bezier CONTROL point — which sits a few
// units off the actual tip — and subtracting that tilted every landing.)
export const HAND_ANGLE0 = 0;
function tickDeg(ms) {
  const n = Math.floor(ms / TICK_MS);
  const u = (ms % TICK_MS) / TICK_MS;
  let f;
  if (u < 0.1) f = -2 * (u / 0.1);                                  // wind back
  else if (u < 0.24) { const p = (u - 0.1) / 0.14; f = -2 + 32 * p * p * (3 - 2 * p); }
  else f = TICK_DEG;                                                 // hold the slot
  return n * TICK_DEG + f - HAND_ANGLE0;
}

// face 4's prompt bar doubles as a terminal cursor: it blinks while the face
// is held (a crisp square blink with ~60ms edges), so the "> _" prompt reads
// as a terminal that is executing rather than a still image
function promptBlink(ms) {
  const u = (ms % 1060) / 1060;
  const e = (x) => { const q = Math.min(1, Math.max(0, x)); return q * q * (3 - 2 * q); };
  if (u < 0.47) return 1;
  if (u < 0.53) return 1 - e((u - 0.47) / 0.06);
  if (u < 0.97) return 0;
  return e((u - 0.97) / 0.06);
}

// the sleepy Z's on face 11: each rises, drifts out and scales away, then
// scales back in — a quiet sleeping loop, one Z taking its turn before the
// next. Scale-to-nothing rather than an opacity fade, so a morph that starts
// mid-cycle can freeze the exact pose with nothing left to pop. Each Z's
// first turn is DELAYED by its slot (never phase-advanced): a morph landing
// on this face hands over to the same resting pose it just morphed into, and
// then the Z's take their turns — a phase-advanced loop snapped the top Z
// from full size to a dot on the first hold frame.
const ZZZ_PERIOD = 3100;
const ZZZ_CENTERS = [[623.2, 450.1], [679.5, 353.5], [735.8, 256.8]];
export function zzzPathsAt(tAbs) {
  const out = {};
  DATA.extras.zzz.forEach((s, k) => {
    const raw = tAbs - (k * ZZZ_PERIOD) / 3;
    const p = raw <= 0 ? 0 : (raw % ZZZ_PERIOD) / ZZZ_PERIOD;
    let dx = 0, dy = 0, sc = 1;
    if (p < 0.5) {
      const u = smooth5(p / 0.5);
      dy = -30 * u; dx = 8 * u; sc = 1 - 0.06 * u;
    } else if (p < 0.62) {
      const u = smooth5((p - 0.5) / 0.12);
      dy = -30 - 5 * u; dx = 8; sc = 0.94 * (1 - u) + 0.001;
    } else if (p < 0.84) {
      dy = -35; dx = 8; sc = 0.001;
    } else {
      const u = smooth5((p - 0.84) / 0.16);
      dy = -35 * (1 - u); dx = 8 * (1 - u); sc = 0.001 + 0.999 * u;
    }
    const c = ZZZ_CENTERS[k];
    out["zzz#" + k] = transformD(s.d, dx, dy, sc, c[0], c[1]);
  });
  return out;
}

// face 14's sweat drop: it wells up and sags downward a touch, then draws
// back — a slow continuous swell. No reset pop (the cycle starts and ends at
// the base pose), so a morph freeze lands exactly where the drop is.
const TEAR_PERIOD = 3600, TEAR_AMP = 15;
const TEAR_CENTER = [718.0, 290.0];
export function tearPathsAt(tAbs) {
  const dy = TEAR_AMP * 0.5 * (1 - Math.cos((2 * Math.PI * (tAbs % TEAR_PERIOD)) / TEAR_PERIOD));
  const c = TEAR_CENTER;
  return { "tear#0": transformD(DATA.extras.tear[0].d, 0, dy, 1, c[0], c[1]) };
}

// face 5 is the excited face: its scrunch chevrons hop together on a |sin|
// arc — quick off the base, easing at the top — and land back on the resting
// pose every cycle. chev5PathsAt(0) equals the resting pose, so a morph into
// face 5 hands over to the live bounce without a jump.
export const CHEV5_PERIOD = 520, CHEV5_AMP = 26;
export function chev5PathsAt(tAbs) {
  const up = Math.abs(Math.sin((Math.PI * (tAbs % CHEV5_PERIOD)) / CHEV5_PERIOD));
  const dy = -CHEV5_AMP * up;
  const out = {};
  for (const key of ["chevBigL", "chevBigR"]) out[key + "#0"] = transformD(DATA.extras[key][0].d, 0, dy, 1, 422.854, 422.854);
  return out;
}

// face 10 is the writing face: both pens trace a line like a hand writing a
// word — the nibs travel right on a wavy stroke (the nib dips and the pen
// rocks about its own tip), then the pair lifts and eases back to the resting
// pose to start the next word. penPathsAt(0) and (period) are the resting
// pose, so morphs in and out hand over cleanly.
export const PEN_PERIOD = 1600;
// pivots are the actual nib tips, so the tip stays planted while the body
// moves. The pen writes four short letter-strokes with a quick micro-lift
// between them — the rhythm of a hand writing — then lifts and repositions,
// all without drawing anything: the motion alone carries the read.
const PEN_TIPS = [[710, 582], [710, 582], [710, 582], [416, 726], [416, 726]];
const PEN_LETTERS = 4, PEN_STEP = 15, PEN_STROKE_U = 0.62;
function penParams(u) {
  if (u < PEN_STROKE_U) {
    const seg = PEN_STROKE_U / PEN_LETTERS;
    const k = Math.min(PEN_LETTERS - 1, Math.floor(u / seg));
    const s = (u - k * seg) / seg;
    const e = 0.45 * (s * s * (3 - 2 * s)) + 0.55 * s;   // a slight stop between letters
    const dx = PEN_STEP * (k + e);
    const bump = s > 0.78 ? Math.sin((Math.PI * (s - 0.78)) / 0.22) : 0;
    return { dx, dy: -3.0 * bump, rot: 0 };
  }
  const t = (u - PEN_STROKE_U) / (1 - PEN_STROKE_U);
  const sm = t * t * (3 - 2 * t);
  return {
    dx: PEN_STEP * PEN_LETTERS * (1 - sm),
    dy: -11 * Math.sin(Math.PI * t),
    rot: -1.2 * Math.sin(Math.PI * t),
  };
}
export function penPathsAt(tAbs) {
  const { dx, dy, rot } = penParams((tAbs % PEN_PERIOD) / PEN_PERIOD);
  const out = {};
  for (let k = 0; k < 5; k++) {
    const tip = PEN_TIPS[k];
    out["pen#" + k] = transformDR(DATA.extras.pen[k].d, dx, dy, rot, tip[0], tip[1]);
  }
  return out;
}

// face 8 is the tool face: a light crank — the wrench rocks about its own head
// like a bolt is being turned (the handle sweeps gently up and down, never a
// jolt); the cycle starts and ends on the resting pose, so morphs hand over
// cleanly and a mid-rock freeze carries the live pose out.
const CRANK_AMP = 8, CRANK_PERIOD = 1600, CRANK_PIVOT = [445.0, 622.0];
export function toolPathsAt(tAbs) {
  const ang = CRANK_AMP * Math.sin((2 * Math.PI * (tAbs % CRANK_PERIOD)) / CRANK_PERIOD);
  const out = {};
  DATA.extras.tool.forEach((s, k) => {
    out["tool#" + k] = transformDR(s.d, 0, 0, ang, CRANK_PIVOT[0], CRANK_PIVOT[1]);
  });
  return out;
}

// face 7 is the searching face: the magnifier sweeps gently left and right,
// like it is inspecting something — small and soft, starting and ending on
// the resting pose so morphs hand over cleanly.
const MAG_AMP = 18, MAG_PERIOD = 2000, MAG_PIVOT = [450.4, 654.4];
export function magPathsAt(tAbs) {
  const dx = MAG_AMP * Math.sin((2 * Math.PI * (tAbs % MAG_PERIOD)) / MAG_PERIOD);
  const out = {};
  DATA.extras.mag.forEach((s, k) => {
    out["mag#" + k] = transformD(s.d, dx, 0, 1, MAG_PIVOT[0], MAG_PIVOT[1]);
  });
  return out;
}

// face 10 is the reading face: the gaze steps across the line left to right
// in small saccades (a little vertical wander for the page), holds a beat at
// the line's end, then swings back to the start for the next line.
const READ_STEPS = [[-17, -2], [-9, 0], [-1, 1], [8, 0], [16, -2]];

// the held pupils sit at their shape position PLUS the live gaze offset; the
// morph items render from the raw shape, so without freezing the gaze the
// pupil pops by the offset (up to ~25 units) the instant a morph starts.
function gazePupils(face, gaze) {
  const out = {};
  for (const s of ["L", "R"]) {
    const p = face["p" + s];
    if (!p || p.mode >= 0.5) continue;
    out["pup" + s] = ellipsePath(p.cx + gaze.x, p.cy + gaze.y, p.rx, p.ry, p.rot);
  }
  return out;
}

export function createClock(opts) {
  const { face = 1, only = "", hold = 0, still = false, ff = 0 } = opts;
  // drive mode: the host drives every face change over
  // postMessage; the auto-cycle waits until setDrive(false).
  let driveOn = !!opts.drive;
  const ONLY = (only || "").split(",").map(Number).filter((n) => n >= 1 && n <= N);
  const SEQ = ONLY.length ? ONLY.map((n) => n - 1) : DATA.faces.map((_, k) => k);
  let i = clamp((face | 0) - 1, 0, N - 1);
  if (!SEQ.includes(i)) i = SEQ[0];
  let j = i, phase = "hold", tPhase = 0, pause = false;
  const HOLD_FIX = hold > 0 ? hold : 0;
  let holdMs = HOLD_FIX || (i === 15 ? 8400 : i === 0 ? 20000 : 2900);
  let holdT0 = 0, clock = 0, liveT = 0, frozenDots = null, frozenDotsT = 0, frozenZzz = null, frozenTear = null, frozenChev = null, frozenPen = null, frozenGaze = null, frozenClock = null, frozenTool = null, frozenMag = null;
  let lastDots = null, lastDotsT = 0; // the dots pose the last snapshot rendered
  const gaze = { x: 0, y: 0, fx: 0, fy: 0, tx: 0, ty: 0, t0: 0, dur: 400 };
  const blink = { state: "idle", t0: 0, v: 0, next: 900 };
  // a blink that gets cut off by a morph would resume at the next hold with
  // the whole remaining cycle collapsed into one frame (the lid snapped shut
  // right as the morph landed). Each fresh hold drops any half-done blink and
  // re-arms the countdown instead.
  const armBlink = (lo = 1800, hi = 4200) => {
    blink.state = "idle"; blink.v = 0; blink.next = clock + rnd(lo, hi);
  };
  let nextS = 0, cursor = null, readIdx = 0, gazeSweepL = 0, gazeSweepA = 0;

  function scheduleNext() {
    nextS = clock + rnd(650, 2200);
    blink.next = clock + rnd(2300, 5200);
  }
  scheduleNext();
  function lookAt(tx, ty, dur = 190) {
    gaze.fx = gaze.x; gaze.fy = gaze.y;
    gaze.tx = tx; gaze.ty = ty;
    gaze.t0 = clock; gaze.dur = dur;
  }
  function advance(dir) {
    if (phase === "morph") return;
    j = SEQ[(SEQ.indexOf(i) + dir + SEQ.length) % SEQ.length];
    // freeze the live poses while the phase is still "hold" — dotsState's
    // 2<->3 branch returns canonical slots once the phase is "morph", which
    // snapped the dots from their mid-spin gather pose
    // freeze the pose the screen actually shows (the last snapshot), bob
    // included for the typing row — capturing fresh one frame ahead snapped
    // the dots at the boundary
    const live = (i === 1 || i === 2) && lastDots;
    frozenDots = live ? lastDots.pos.map((p, k) => [p[0], p[1] + (lastDots.bob[k] || 0)]) : null;
    frozenDotsT = live ? lastDotsT : 0;
    frozenZzz = i === 11 ? zzzPathsAt(clock - holdT0) : null;
    frozenTear = i === 14 ? tearPathsAt(clock - holdT0) : null;
    frozenChev = i === 4 ? chev5PathsAt(clock - holdT0) : null;
    frozenPen = i === 10 ? penPathsAt(clock - holdT0) : null;
    frozenTool = i === 7 ? toolPathsAt(clock - holdT0) : null;
    frozenMag = i === 6 ? magPathsAt(clock - holdT0) : null;
    frozenGaze = gazePupils(DATA.faces[i], gaze);
  frozenClock = i === 15 ? { "clock#2": transformDR(DATA.extras.clock[DATA.extras.clock.length - 1].d, 0, 0, tickDeg(clock - holdT0), CLOCK_ORIG[0], CLOCK_ORIG[1]) } : null;
    phase = "morph"; tPhase = 0;
    lookAt(0, 0, Math.round(morphDur(i, j) * 0.55));
  }

  // jump straight to a face (the transport buttons): morphs there from
  // wherever the face is now, or switches instantly while paused
  function goto(n) {
    if (n < 1 || n > N || n - 1 === i) return;
    if (phase === "morph") return; // let the running morph land first
    if (pause) {
      i = n - 1; j = n - 1; phase = "hold"; tPhase = 0; readIdx = 0;
      holdMs = HOLD_FIX || (i === 15 ? 8400 : i === 0 ? 20000 : rnd(2600, 3500) + (i === 2 ? 2700 : 0));
      holdT0 = clock; frozenDots = null; frozenZzz = null; frozenTear = null; frozenChev = null; frozenPen = null; frozenGaze = null; frozenClock = null; frozenTool = null; frozenMag = null;
      armBlink();
      return;
    }
    j = n - 1;
    // freeze the pose the screen actually shows (the last snapshot), bob
    // included for the typing row — capturing fresh one frame ahead snapped
    // the dots at the boundary
    const live = (i === 1 || i === 2) && lastDots;
    frozenDots = live ? lastDots.pos.map((p, k) => [p[0], p[1] + (lastDots.bob[k] || 0)]) : null;
    frozenDotsT = live ? lastDotsT : 0;
    frozenZzz = i === 11 ? zzzPathsAt(clock - holdT0) : null;
    frozenTear = i === 14 ? tearPathsAt(clock - holdT0) : null;
    frozenChev = i === 4 ? chev5PathsAt(clock - holdT0) : null;
    frozenPen = i === 10 ? penPathsAt(clock - holdT0) : null;
    frozenTool = i === 7 ? toolPathsAt(clock - holdT0) : null;
    frozenMag = i === 6 ? magPathsAt(clock - holdT0) : null;
    frozenGaze = gazePupils(DATA.faces[i], gaze);
  frozenClock = i === 15 ? { "clock#2": transformDR(DATA.extras.clock[DATA.extras.clock.length - 1].d, 0, 0, tickDeg(clock - holdT0), CLOCK_ORIG[0], CLOCK_ORIG[1]) } : null;
    phase = "morph"; tPhase = 0;
    lookAt(0, 0, Math.round(morphDur(i, j) * 0.55));
  }
  function toggle() { pause = !pause; }

  function dotsState() {
    const da = DATA.faces[i].ex.dots || 0, db = DATA.faces[j].ex.dots || 0;
    const tE = phase === "morph" ? smooth5(Math.min(1, tPhase / morphDur(i, j))) : 1;
    const op = phase === "morph" ? lerp(da, db, tE) : da;
    let pos = DOTS_ROW, bob = [0, 0, 0];
    if (still) {
      pos = i === 2 ? DOTS_SPIN : DOTS_ROW;
    } else if (phase === "morph" && ((i === 1 && j === 2) || (i === 2 && j === 1))) {
      // a plain glide: out of face 3 from the dots' live pose (frozen at the
      // morph start — mid-dive included) into the typing row; into face 3,
      // from the row out to the orbit slots its loop begins from. The old
      // formula whirled the dots a full turn around the centre and snapped
      // the live pose to a canonical one at the start.
      const from = i === 2 ? (frozenDots || DOTS_SPIN.map((p) => [p[0], p[1]])) : frozenDots || DOTS_ROW;
      const to = i === 2 ? DOTS_ROW : DOTS_SPIN;
      pos = from.map((p, k) => [
        p[0] + (to[k][0] - p[0]) * tE,
        p[1] + (to[k][1] - p[1]) * tE,
      ]);
    } else if (phase === "morph" && i === 2 && j !== 1) {
      // 3 -> 4: the dots keep riding the ring's slow rotation from the pose
      // they froze at — the gather loop's dives (into the centre and back)
      // would fight the morph and make each dot meander to its target.
      // Rotating the frozen pose is the smooth part of the spinner's
      // motion, so the peel-off keeps its momentum without the wobble.
      const tAbs = Math.max(0, clock - holdT0);
      const toRot2 = (tt) => {
        const x = Math.min(1, Math.max(0, tt) / SPIN_RAMP);
        const ramp = tt < SPIN_RAMP ? SPIN_RAMP * x * x * x * x * (x * x - 3 * x + 2.5) : tt - SPIN_RAMP / 2;
        return (SPIN_ROT * ramp * Math.PI) / 180;
      };
      const f = frozenDots || DOTS_SPIN.map((p) => [p[0], p[1]]);
      const dr = toRot2(tAbs) - toRot2(frozenDotsT);
      const ca = Math.cos(dr), sa = Math.sin(dr);
      pos = f.map((p) => {
        const bx = p[0] - SPIN_ORIG[0], by = p[1] - SPIN_ORIG[1];
        return [SPIN_ORIG[0] + bx * ca - by * sa, SPIN_ORIG[1] + bx * sa + by * ca];
      });
    } else if ((phase === "hold" && i === 2) || (phase === "morph" && (i === 2 || j === 2))) {
      const tAbs = Math.max(0, clock - holdT0);
      const tCyc = tAbs % SPIN_PERIOD;
      const toRot = (tt) => {
        const x = Math.min(1, Math.max(0, tt) / SPIN_RAMP);
        const ramp = tt < SPIN_RAMP ? SPIN_RAMP * x * x * x * x * (x * x - 3 * x + 2.5) : tt - SPIN_RAMP / 2;
        return (SPIN_ROT * ramp * Math.PI) / 180;
      };
      const rigid = (k, rot) => {
        const ca = Math.cos(rot), sa = Math.sin(rot);
        const bx = DOTS_SPIN[k][0] - SPIN_ORIG[0], by = DOTS_SPIN[k][1] - SPIN_ORIG[1];
        return [SPIN_ORIG[0] + bx * ca - by * sa, SPIN_ORIG[1] + bx * sa + by * ca];
      };
      pos = DOTS_SPIN.map((p, k) => {
        const tin = TUCK_IN[k], tout = TUCK_OUT[k];
        if (tCyc >= tin && tCyc < tin + SPIN_SEG) {
          const u = easeSin((tCyc - tin) / SPIN_SEG);
          const P0 = rigid(k, toRot(tAbs - (tCyc - tin)));
          return [P0[0] + (DOTS_CEN[0] - P0[0]) * u, P0[1] + (DOTS_CEN[1] - P0[1]) * u];
        }
        if (tCyc >= tout && tCyc < tout + SPIN_SEG) {
          const u = easeSin((tCyc - tout) / SPIN_SEG);
          const P1 = rigid(k, toRot(tAbs + (tout + SPIN_SEG - tCyc)));
          return [DOTS_CEN[0] + (P1[0] - DOTS_CEN[0]) * u, DOTS_CEN[1] + (P1[1] - DOTS_CEN[1]) * u];
        }
        if (tCyc >= tin + SPIN_SEG && tCyc < tout) return [DOTS_CEN[0], DOTS_CEN[1]];
        return rigid(k, toRot(tAbs));
      });
    } else if (phase === "hold" && i === 1) {
      // the typing bounce: per dot a raised-cosine bump (soft launch, soft
      // landing, no velocity cliff) and a phase measured from the hold's own
      // start, so the row begins at rest and each dot eases into its loop
      const period = 1150, stagger = 190, amp = 15;
      const tH = clock - holdT0;
      bob = [0, 1, 2].map((k) => {
        const ph = ((((tH - k * stagger) % period) + period) % period) / period;
        return ph < 0.5 ? (-amp * (1 - Math.cos(4 * Math.PI * ph))) / 2 : 0;
      });
    }
    return { op, pos, bob };
  }

  function step(dt) {
    if (!pause) {
      // while paused the clock stops, so every live pose (the typing bounce
      // included) waits exactly where it was and resume continues from there
      clock += dt;
      liveT += dt;
      tPhase += dt;
      if (phase === "hold") {
        if (!still && !driveOn && tPhase >= holdMs) {
          j = SEQ[(SEQ.indexOf(i) + 1) % SEQ.length];
          // same as advance/goto: freeze the last displayed pose, bob incl.
          const live2 = (i === 1 || i === 2) && lastDots;
          frozenDots = live2 ? lastDots.pos.map((p, k) => [p[0], p[1] + (lastDots.bob[k] || 0)]) : null;
          frozenDotsT = live2 ? lastDotsT : 0;
          frozenZzz = i === 11 ? zzzPathsAt(clock - holdT0) : null;
          frozenTear = i === 14 ? tearPathsAt(clock - holdT0) : null;
          frozenChev = i === 4 ? chev5PathsAt(clock - holdT0) : null;
          frozenPen = i === 10 ? penPathsAt(clock - holdT0) : null;
          frozenTool = i === 7 ? toolPathsAt(clock - holdT0) : null;
          frozenMag = i === 6 ? magPathsAt(clock - holdT0) : null;
    frozenGaze = gazePupils(DATA.faces[i], gaze);
  frozenClock = i === 15 ? { "clock#2": transformDR(DATA.extras.clock[DATA.extras.clock.length - 1].d, 0, 0, tickDeg(clock - holdT0), CLOCK_ORIG[0], CLOCK_ORIG[1]) } : null;
          phase = "morph"; tPhase = 0;
          lookAt(0, 0, Math.round(morphDur(i, j) * 0.55));
        }
      } else if (phase === "morph") {
        if (tPhase >= morphDur(i, j)) {
          i = j; phase = "hold"; tPhase = 0; holdT0 = clock; readIdx = 0;
          frozenDots = null; frozenZzz = null; frozenTear = null; frozenChev = null; frozenPen = null; frozenGaze = null; frozenClock = null; frozenTool = null; frozenMag = null;
          holdMs = HOLD_FIX || (i === 15 ? 8400 : i === 0 ? 20000 : rnd(2600, 3500) + (i === 2 ? 2700 : 0));
          armBlink();
          scheduleNext();
        }
      }
    }
    if (!still && !pause) {
      if (phase === "hold" && clock >= nextS && !cursor) {
        if (i === 9) {
          // the reading face: step across the line, beat at the end, fly back
          if (readIdx >= READ_STEPS.length) {
            lookAt(READ_STEPS[0][0], READ_STEPS[0][1], 240);
            readIdx = 1;
            nextS = clock + rnd(340, 500);
          } else {
            lookAt(READ_STEPS[readIdx][0], READ_STEPS[readIdx][1], rnd(150, 230));
            const end = readIdx === READ_STEPS.length - 1;
            readIdx += 1;
            nextS = clock + (end ? rnd(430, 680) : rnd(300, 520));
          }
        } else if (i === 0) {
          // the idle face: the eyes rove the whole field. The eye is a tall
          // oval, so vertical travel dominates — the pupil orbits the ellipse
          // of its reachable poses (x +4..+105, y -76..+206 around the rest
          // pose, inside the eye crop) with compass sweeps, darts, micro
          // re-fixations and double-takes.
          const OX = 54.5, OY = 65, RX = 45, RY = 127;
          const where = () => {
            const a = Math.random() * Math.PI * 2;
            const rr = Math.sqrt(Math.random());
            return [OX + Math.cos(a) * RX * rr, OY + Math.sin(a) * RY * rr];
          };
          const r = Math.random();
          if (gazeSweepL > 0) {
            gazeSweepA += 0.785;
            gazeSweepL--;
            lookAt(OX + Math.cos(gazeSweepA) * RX, OY + Math.sin(gazeSweepA) * RY, rnd(540, 720));
            nextS = clock + rnd(430, 640);
          } else if (r < 0.09) {
            // a slow 360 sweep: eight unhurried perches around the whole circle
            gazeSweepL = 7;
            gazeSweepA = Math.random() * Math.PI * 2;
            lookAt(OX + Math.cos(gazeSweepA) * RX, OY + Math.sin(gazeSweepA) * RY, rnd(560, 760));
            nextS = clock + rnd(500, 700);
          } else if (r < 0.4) {
            const t = where();                                        // a long look somewhere
            lookAt(t[0], t[1], rnd(480, 880));
            nextS = clock + rnd(1100, 2600);
          } else if (r < 0.72) {
            const x = Math.max(4, Math.min(105, gaze.x + rnd(-14, 14))); // re-fixation
            const y = Math.max(-76, Math.min(206, gaze.y + rnd(-22, 22)));
            lookAt(x, y, rnd(320, 500));
            nextS = clock + rnd(750, 1700);
          } else {
            lookAt(OX + rnd(-1, 1) * RX * 0.8, OY + rnd(-1, 1) * RY * 0.8, rnd(420, 640));
            nextS = clock + rnd(900, 2000);
          }
        } else {
          lookAt(rnd(-1, 1) * 30, rnd(-1, 1) * 24, rnd(130, 260));
          nextS = clock + rnd(650, 2200);
        }
      }
      const k2 = clamp((clock - gaze.t0) / (gaze.dur || 1), 0, 1);
      const e = k2 < 0.5 ? 2 * k2 * k2 : 1 - Math.pow(-2 * k2 + 2, 2) / 2;
      gaze.x = lerp(gaze.fx, gaze.tx, e);
      gaze.y = lerp(gaze.fy, gaze.ty, e);
      if (blink.state === "idle" && clock >= blink.next) { blink.state = "closing"; blink.t0 = clock; }
      else if (blink.state === "closing") {
        const k3 = Math.min(1, (clock - blink.t0) / 90);
        blink.v = k3 < 0.5 ? 2 * k3 * k3 : 1 - Math.pow(-2 * k3 + 2, 2) / 2;
        if (k3 >= 1) { blink.state = "closed"; blink.t0 = clock; }
      } else if (blink.state === "closed") {
        if (clock - blink.t0 > 38) { blink.state = "opening"; blink.t0 = clock; }
      } else if (blink.state === "opening") {
        const k3 = Math.min(1, (clock - blink.t0) / 115);
        blink.v = 1 - (k3 < 0.5 ? 2 * k3 * k3 : 1 - Math.pow(-2 * k3 + 2, 2) / 2);
        if (k3 >= 1) { blink.state = "idle"; blink.v = 0; blink.next = clock + (Math.random() < 0.2 ? 280 : rnd(2300, 5200)); }
      }
    }
    return snapshot();
  }

  function snapshot() {
    const tRaw = phase === "morph" ? Math.min(1, tPhase / morphDur(i, j)) : 0;
    lastDots = dotsState();
    lastDotsT = clock - holdT0;
    return {
      i, j, phase,
      t: phase === "morph" ? smooth5(tRaw) : 1,
      tRaw: phase === "morph" ? tRaw : 1,
      still, pause,
      gaze: { ...gaze },
      blink: still ? 0 : blink.v,
      dots: dotsState(),
      frozenDots,
      zzz: !still && phase === "hold" && i === 11 ? zzzPathsAt(clock - holdT0) : null,
      frozenZzz,
      tear: !still && phase === "hold" && i === 14 ? tearPathsAt(clock - holdT0) : null,
      chev5: !still && phase === "hold" && i === 4 ? chev5PathsAt(clock - holdT0) : null,
      pen: !still && phase === "hold" && i === 10 ? penPathsAt(clock - holdT0) : null,
      tool: !still && phase === "hold" && i === 7 ? toolPathsAt(clock - holdT0) : null,
      mag: !still && phase === "hold" && i === 6 ? magPathsAt(clock - holdT0) : null,
      frozenTear,
      frozenChev,
      frozenPen,
      frozenTool,
      frozenMag,
      frozenGaze,
      frozenClock,
      clockTick: phase === "hold" && !still ? tickDeg(tPhase) : 0,
      promptBlink: phase === "hold" && !still && i === 3 ? promptBlink(tPhase) : 1,
      liveT,
      stageScale: still ? 1 : 1 + 0.0045 * Math.sin((clock / 2600) * Math.PI),
    };
  }

  let lastCur = "";
  function setCursor(nx, ny) {
    if (nx === null) { cursor = null; lastCur = ""; return; }
    const x = clamp(nx, -1, 1), y = clamp(ny, -1, 1);
    cursor = { x, y };
    const key = `${Math.round(x * 12)}:${Math.round(y * 12)}`;
    if (key !== lastCur) {
      lastCur = key;
      if (phase === "hold") lookAt(x * 34, y * 26, 240);
    }
  }

  function setDrive(v) { driveOn = !!v; }

  if (ff > 0) for (let tt = 16.67; tt <= ff; tt += 16.67) step(16.67);
  return { step, snapshot, advance, goto, toggle, setCursor, setDrive };
}
