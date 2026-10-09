// components/Typebob.jsx — typebob as a drop-in React component.
//
// bob types a paragraph, character by character; he rides the write head and
// switches faces as the words land, and when the paragraph reaches its final
// period he gathers into it: every shape morphs into a circle of the period's
// exact ink size, colour and position. The text fades, the dot lifts off to
// the next paragraph's write head and blooms into the idle face. Paragraph,
// dot, done, next paragraph, in a loop.
//
//   <Typebob />                          // the demo paragraphs
//   <Typebob paragraphs={["hello there."]} />
//   <Typebob paragraphs={[{ text: "...", faces: [2, 2, 7, 21, 1] }]} />
//
// Props
//   paragraphs  string | string[] | { text, faces? }[]  default: the demo set
//               (a missing final "." is added; bob IS that period)
//   cps         typing speed, characters per second (default 24)
//   body        starting body (circle | cloud | square | hexagon | pebble |
//               triangle | starburst | diamond | trigon | droplet); a later
//               change morphs
//   tour        auto body tour: one step every tourMs until it lands back on
//               the start body (default true)
//   tourMs      ms per tour step (default 2000)
//   paused      freeze the scene (a virtual clock; resume continues it)
//   showBar     the bottom body bar (default true)
//   onParagraph (index) => void, fired when a paragraph finishes
//
// Imperative handle (ref): { setBody(key), snapshot() }
//
// One rAF loop drives everything: phase timing, text reveal, caret glide and
// bob's placement, on a virtual clock so pause is an exact freeze.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Stage from "./TypebobStage";
import DATA from "../data.json";
import { smooth5, lerpColor, parseColor } from "../engine/geom";
import { bodySnapshot, adoptRingSet, CLOUD_FILL, SQUARE_FILL, HEX_FILL, PEBBLE_FILL, TRI_FILL, SB_FILL, TRIGON_FILL, DROPLET_FILL, DIA_FILL } from "../engine/morph";
import { TYPEOB_CSS } from "../styles";
// the ring warm-up worker, inlined: self-contained in both the ESM and CJS
// bundles, no emitted asset and no import.meta.url needed at runtime
import RingwarmWorker from "../engine/ringwarm.js?worker&inline";

const VB = DATA.viewBox;

// the demo paragraphs; every one ends on the final period bob becomes
const DEFAULT_PARAGRAPHS = [
  { text: "hey. i'm bob. i type every word of this out myself, one character at a time. as the letters land, my face keeps changing to match the mood, and the cursor rides along at the end of the line. when the paragraph is done, i have one last trick: i fold myself into a single dot, the little full stop at the end of it all, and then i start again.",
    faces: [2, 2, 1, 17, 8, 11, 7, 9, 2, 14, 24, 21, 1] },
  { text: "this one is about the way words stack up. one letter, then another, until a whole thought is standing there on the screen. i wear a different face for each stretch of it, because a wall of text deserves better than one expression. a wrench when it gets technical, a book when it gets quiet, hearts when it gets soft, a sweat drop when it goes on too long.",
    faces: [2, 2, 10, 7, 8, 14, 9, 18, 17, 21, 1] },
  { text: "here is the part i like best: the end. when the final character is down, i gather every bit of myself into one small circle, the same size and colour as the full stop at the end of the line. it isn't a trick, it's a morph. every path finds its way to the centre, the disc tucks in behind, and for a second i am a period. then the page clears, and i get to do it all again.",
    faces: [2, 2, 1, 17, 9, 24, 7, 2, 10, 21, 15, 14, 1] },
  { text: "people ask what happens between paragraphs. nothing, really. the line fades, i spawn back at the start of an empty one, small as a fleck, and bloom out into a proper shape while the cursor blinks at me. then the next paragraph begins and the whole thing repeats. it's a good life, if a slightly repetitive one. typist, face and full stop, all in a row.",
    faces: [2, 2, 19, 24, 6, 9, 17, 10, 21, 18, 1] },
  { text: "one more paragraph and then i'll call it a day. writing this way means the words never arrive all at once, they trickle in, one at a time, and the typing has a rhythm to it. the caret keeps time, my eyes follow the line, and the faces cycle through in their little parade. and when the last period lands, i'll be it. see you in the next one.",
    faces: [2, 2, 1, 7, 24, 17, 11, 10, 9, 21, 1, 18] },
];

// the face parade used when a caller-supplied paragraph carries no list
const GENERIC_FACES = [2, 2, 1, 17, 9, 24, 7, 10, 21, 1];

const TEXT_INK = "#f2f2f2";

// every body from the bob engine, with its own fill. "circle" is the plain
// disc (it takes the face's own colour); the rest are the figma bodies.
const BODIES = [
  { key: "circle", fill: "#D9D9D9" },
  { key: "cloud", fill: CLOUD_FILL },
  { key: "square", fill: SQUARE_FILL },
  { key: "hexagon", fill: HEX_FILL },
  { key: "pebble", fill: PEBBLE_FILL },
  { key: "triangle", fill: TRI_FILL },
  { key: "starburst", fill: SB_FILL },
  { key: "trigon", fill: TRIGON_FILL },
  { key: "droplet", fill: DROPLET_FILL },
  { key: "diamond", fill: DIA_FILL },
];
const BODY_MORPH_MS = 800;  // a body switch is a real morph, never a snap
const WAKE_MS = 780;        // the bloom (period -> face) at the new write head
const IDLE_MS = 900;        // beat on the idle face before typing starts
const FACE_MS = 560;        // face morph while typing
const FACE_DRAIN_MS = 330;  // once the last character is down, drain faster
const CHAR_SETTLE_MS = 170; // beat after the last character lands, before the gather
const DOT_MS = 850;         // the gather (slide onto the period + collapse)
const DOT_HOLD = 1200;      // how long the full stop rests
const RELEASE_MS = 400;     // the TEXT fades fully around the resting period
const LIFT_MS = 640;        // the dot glides across to the next write head
const GLIDE_TAU = 34;       // ms; the write head's glide, so the caret never jumps

let uidSeq = 0;

// one scoped stylesheet per document; every rule lives under .typebob-root
const STYLE_ID = "typebob-component-style";
function useScopedStyle() {
  useEffect(() => {
    if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = TYPEOB_CSS;
    document.head.appendChild(s);
  }, []);
}

function normalizeRuns(paragraphs) {
  const src = paragraphs == null ? DEFAULT_PARAGRAPHS
    : (Array.isArray(paragraphs) ? paragraphs : [paragraphs]);
  const out = src.map((p) => {
    const o = typeof p === "string" ? { text: p } : (p || {});
    let text = String(o.text == null ? "" : o.text).trim();
    // bob becomes the final period, so there must be one
    if (text && !text.endsWith(".")) text += ".";
    const faces = Array.isArray(o.faces) && o.faces.length ? o.faces : GENERIC_FACES;
    return { text, faces };
  }).filter((r) => r.text.length > 1);
  // an empty list would leave the loop with nothing to type
  return out.length ? out : DEFAULT_PARAGRAPHS;
}

export default forwardRef(function Typebob(
  {
    paragraphs,
    cps = 24,
    body = "circle",
    tour = true,
    tourMs = 2000,
    paused = false,
    showBar = true,
    onParagraph,
    className = "",
    style,
  },
  ref,
) {
  useScopedStyle();

  const uidRef = useRef(null);
  if (uidRef.current == null) uidRef.current = "tb" + (++uidSeq) + "-";
  const uid = uidRef.current;

  const shellRef = useRef(null);
  const lineRef = useRef(null);
  const caretRef = useRef(null);
  const glowRef = useRef(null);
  const blmRef = useRef(null);
  const bobRef = useRef(null);

  const runs = useMemo(() => normalizeRuns(paragraphs), [paragraphs]);
  const runsRef = useRef(runs);
  runsRef.current = runs;

  // live prop values the rAF loop reads (loop is mounted once)
  const propsRef = useRef(null);
  propsRef.current = { cps, tour, tourMs, onParagraph, paused };

  const [state, setState] = useState(() => ({
    phase: "wake",   // wake | idle | typing | dot | dothold | release | lift
    run: 0,
    chars: 0,        // characters revealed (the final "." is never counted)
    faceIdx: 0,      // 0-based; 0 = face 1, the idle face every run opens on
    morph: null,     // { kind: 'face', j, t } | { kind: 'dot', dir, t }
    bodyScale: 1,
    bodyFill: DATA.faces[0].color,
    dotR: 46,        // design units; recomputed per run from the real period
    dotsT: 0,        // ms since the held face landed (drives the typing bounce)
    // always start rendered on the plain circle: a non-circle body would
    // build the rings inside the first render and freeze the page. A
    // non-circle `body` prop is held and applied once the worker lands.
    bodyKey: "circle",
    bodyFrom: "circle",
    bodyT: 1,        // 0..1 progress of the body morph (1 = settled)
    gaze: { x: 0, y: 0 },
    blink: 0,
  }));

  const ref2 = useRef({
    phase: "wake", phaseT0: 0, run: 0, chars: 0, charsDoneAt: 0,
    faceIdx: 0, morph: null, bodyScale: 1,
    bodyFill: DATA.faces[0].color,
    bodyKey: "circle", bodyFrom: "circle", bodyT: 1,
    ringFillFrom: "#D9D9D9", ringFillTo: "#D9D9D9", ringFill: "#D9D9D9", inkK: 0,
    holdT0: 0,
    blinkNext: 1600, blinkT0: 0, blinkOn: false,
    gazeNext: 1100, gazeT0: 0, gazeX: 0, gazeY: 0, gazeFrom: [0, 0], gazeTo: [0, 0], gazeDur: 400,
    caretX: null, caretY: null, caretH: 20, gap: 8, fontPx: 20, glowW: 140, glowH: 78,
    bobX: 0, bobY: 0, dotX0: 0, dotY0: 0,
    dotPos: { x: 0, y: 0 }, dotDia: 3, dotOffX: 0, dotOffY: 0, dotR: 46, endScale: 0.09,
    liftFrom: { x: 0, y: 0 }, glowKey: "",
    wakeInit: false,
    tour: null,
    ringsReady: false, pendingPick: null,
  });
  const R = ref2.current;

  // ---- measuring: the period's real ink, with the real text engine ---------
  const measureAll = () => {
    const lineEl = lineRef.current, caretEl = caretRef.current;
    if (!lineEl) return;
    const cs = getComputedStyle(lineEl);
    const fontPx = parseFloat(cs.fontSize) || 20;
    R.fontPx = fontPx;
    if (caretEl) R.caretH = caretEl.offsetHeight || fontPx * 1.1;
    R.gap = Math.max(6, Math.round(fontPx * 0.3));
    R.glowW = Math.round(fontPx * 5.4);
    R.glowH = Math.round(fontPx * 3.0);
    const _glowEl = glowRef.current;
    if (_glowEl) { _glowEl.style.width = R.glowW + "px"; _glowEl.style.height = R.glowH + "px"; }
    // measure "." with canvas measureText: actualBoundingBox* give the glyph's
    // true INK box (an SVG getBBox returns the whole em box instead)
    try {
      const cv = document.createElement("canvas");
      const ctx = cv.getContext("2d");
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = ctx.measureText(".");
      const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
      const lw = m.actualBoundingBoxLeft, rw = m.actualBoundingBoxRight;
      const inkW = lw + rw, inkH = asc + desc;
      if (inkW > 0 && inkH > 0 && isFinite(inkW) && isFinite(inkH)) {
        R.dotDia = Math.max(inkW, inkH);
        R.dotOffX = (rw - lw) / 2;
        R.dotOffY = (desc - asc) / 2;
      } else {
        throw new Error("empty ink box");
      }
    } catch (err) {
      R.dotDia = fontPx * 0.11;
      R.dotOffX = fontPx * 0.03;
      R.dotOffY = -fontPx * 0.05;
    }
  };

  const recalcDot = () => {
    const bobEl = bobRef.current;
    const B = (bobEl && bobEl.offsetWidth) || 30;
    R.endScale = R.dotDia / B;
    R.dotR = (R.dotDia * VB) / (2 * B);
  };

  // the period's spot: glyph origin from its own span, baseline from the
  // zero-height marker that rides the text baseline
  const recalcDotPos = () => {
    const shellEl = shellRef.current;
    const lineEl = lineRef.current;
    const blm = blmRef.current;
    if (!shellEl || !lineEl || !blm) return;
    const total = runsRef.current[R.run % runsRef.current.length].text.length;
    const els = lineEl.querySelectorAll(".ch");
    const pEl = els[Math.min(total - 1, els.length - 1)];
    if (!pEl) return;
    const sr = shellEl.getBoundingClientRect();
    const pr = pEl.getBoundingClientRect();
    const br = blm.getBoundingClientRect();
    R.dotPos = { x: pr.left + R.dotOffX - sr.left, y: br.bottom + R.dotOffY - sr.top };
  };

  useEffect(() => {
    const measure = () => { measureAll(); recalcDot(); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a body pick: morph from wherever the body is right now (a mid-flight
  // snapshot if one is still morphing) into the picked body — never a snap
  const chooseBody = (key) => {
    if (key === R.bodyKey && R.bodyT >= 1) return;
    const baseOf = (k) => (k === "circle" ? DATA.faces[R.faceIdx].color : (BODIES.find((b) => b.key === k) || BODIES[0]).fill);
    const cur = R.bodyT < 1 ? lerpColor(R.ringFillFrom, R.ringFillTo, smooth5(R.bodyT)) : baseOf(R.bodyKey);
    R.ringFillFrom = cur;
    R.ringFillTo = baseOf(key);
    R.bodyFrom = R.bodyT < 1 ? bodySnapshot(R.bodyFrom, R.bodyKey, R.bodyT) : R.bodyKey;
    R.bodyKey = key;
    R.bodyT = 0;
  };

  // a pick from the body bar is manual control: it stops the auto tour at the
  // picked body. Before the off-thread rings land the pick is held — rendering
  // a non-circle body now would build the rings on the main thread.
  const pickBody = (key) => {
    const T = R.tour;
    if (T) T.active = false;
    if (!R.ringsReady) { R.pendingPick = key; return; }
    chooseBody(key);
  };

  // ---- body rings, built off-thread -----------------------------------------
  // ringSet()'s first build is seconds of fit iteration. Done lazily it froze
  // the page inside the first non-circle render; ringwarm.js is a module
  // worker that builds the rings and posts them back, and adoptRingSet
  // installs them so the main thread never runs the build. onerror / the
  // timeout are safety valves: ringsReady flips anyway and the lazy path takes
  // over. (A host bundler that cannot resolve the worker URL lands here too.)
  useEffect(() => {
    let w = null;
    const flush = () => {
      if (w) { w.terminate(); w = null; }
      R.ringsReady = true;
      if (R.pendingPick) { const k = R.pendingPick; R.pendingPick = null; chooseBody(k); }
    };
    // a non-circle `body` prop at mount is held until the rings land
    if (body && body !== "circle") R.pendingPick = body;
    try {
      w = new RingwarmWorker();
      w.onmessage = (e) => { R.ringsAdopted = adoptRingSet(e.data); flush(); };
      w.onerror = () => { flush(); };
    } catch (err) {
      flush();
    }
    const fallback = setTimeout(() => { if (!R.ringsReady) flush(); }, 8000);
    return () => { clearTimeout(fallback); if (w) w.terminate(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- the body prop: any later change is a real morph ----------------------
  useEffect(() => {
    if (body === R.bodyKey && R.bodyT >= 1) return;
    if (!R.ringsReady) { R.pendingPick = body; return; }
    chooseBody(body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  useEffect(() => {
    let raf, last = performance.now();
    let vn = 0;             // virtual clock: pause is an exact freeze
    const setPhase = (p) => { R.phase = p; R.phaseT0 = vn; };

    // arm the body tour: one lap down the BODIES list from the body shown at
    // mount, one step every tourMs; stepping back onto the start body disarms
    // it (end reached, back to the start, done)
    const P0 = propsRef.current;
    if (P0 && P0.tour !== false) {
      R.tour = { active: true, start: R.bodyKey, next: vn + (P0.tourMs || 2000) };
    }

    const loop = (realNow) => {
      const dt = Math.min(60, realNow - last);
      last = realNow;
      const isPaused = propsRef.current.paused;
      if (!isPaused) vn += dt;
      const now = vn;

      const runsNow = runsRef.current;
      const run = runsNow[R.run % runsNow.length];
      const total = run.text.length;
      const lastIdx = total - 1;  // the period: bob becomes it

      if (R.dotDia == null) { measureAll(); recalcDot(); }

      // ---- body morph progress + fill ------------------------------------
      if (!isPaused && R.bodyT < 1) {
        R.bodyT = Math.min(1, R.bodyT + dt / BODY_MORPH_MS);
        if (R.bodyT >= 1) R.bodyFrom = R.bodyKey;
      }

      // ---- the auto body tour: one step down the BODIES list every tourMs.
      // The step back onto the start body disarms it. The first step waits for
      // the off-thread ring warm-up (ringsReady).
      const P = propsRef.current;
      if (R.tour && R.tour.active && now >= R.tour.next) {
        if (P.tour === false) R.tour.active = false;
        else if (!R.ringsReady) R.tour.next = now + 200;
        else if (R.bodyT >= 1) {
          const i = BODIES.findIndex((b) => b.key === R.bodyKey);
          const next = BODIES[(i + 1) % BODIES.length].key;
          chooseBody(next);
          if (next === R.tour.start) R.tour.active = false;
          R.tour.next = now + (P.tourMs || 2000);
        }
      }

      const baseOf = (k) => (k === "circle" ? DATA.faces[R.faceIdx].color : (BODIES.find((b) => b.key === k) || BODIES[0]).fill);
      const ringBase = R.bodyT < 1 ? lerpColor(R.ringFillFrom, R.ringFillTo, smooth5(R.bodyT)) : baseOf(R.bodyKey);
      R.ringFill = lerpColor(ringBase, TEXT_INK, R.inkK || 0);

      // every glow layer rides the body's own colour
      const shellEl2 = shellRef.current;
      if (shellEl2) {
        const [gr, gg, gb] = parseColor(R.ringFill);
        const key2 = `${Math.round(gr)} ${Math.round(gg)} ${Math.round(gb)}`;
        if (key2 !== R.glowKey) {
          R.glowKey = key2;
          shellEl2.style.setProperty("--glow-rgb", key2);
        }
      }

      // ---- phase machine -------------------------------------------------
      if (R.phase === "wake") {
        if (!R.wakeInit) { measureAll(); recalcDot(); R.wakeInit = true; }
        const t = Math.min(1, (now - R.phaseT0) / WAKE_MS);
        const e = smooth5(t);
        R.morph = { kind: "dot", dir: "out", t: e };
        R.bodyScale = R.endScale + (1 - R.endScale) * e;
        R.bodyFill = lerpColor(TEXT_INK, DATA.faces[R.faceIdx].color, e);
        R.inkK = 1 - e;
        if (t >= 1) {
          R.morph = null; R.bodyScale = 1;
          R.bodyFill = DATA.faces[R.faceIdx].color;
          R.chars = 0; R.charsDoneAt = 0;
          R.holdT0 = now;
          setPhase("idle");
        }
      } else if (R.phase === "idle") {
        R.bodyFill = DATA.faces[R.faceIdx].color;
        if (now - R.phaseT0 > IDLE_MS) setPhase("typing");
      } else if (R.phase === "typing") {
        const want = Math.min(lastIdx, Math.floor(((now - R.phaseT0) / 1000) * (P.cps || 24)));
        R.chars = want;
        // the face walks the run's face list as the text advances; a switch
        // starts a real face->face morph that must LAND before the next beat
        const beats = run.faces;
        const beat = Math.floor((R.chars / Math.max(1, lastIdx)) * beats.length);
        const wantFace = beats[Math.min(beats.length - 1, beat)] - 1;
        if (R.morph && R.morph.kind === "face") {
          const ms = R.chars >= lastIdx ? FACE_DRAIN_MS : FACE_MS;
          R.morph.t = Math.min(1, R.morph.t + dt / ms);
          if (R.morph.t >= 1) {
            R.faceIdx = R.morph.j; R.morph = null; R.holdT0 = now;
            R.bodyFill = DATA.faces[R.faceIdx].color;
          }
        } else if (wantFace !== R.faceIdx && R.chars > 0) {
          R.morph = { kind: "face", j: wantFace, t: 0, prev: R.faceIdx };
        }
        if (R.chars >= lastIdx) {
          if (!R.charsDoneAt) R.charsDoneAt = now;
          if (!R.morph && now - R.charsDoneAt >= CHAR_SETTLE_MS) {
            R.dotX0 = R.bobX; R.dotY0 = R.bobY;
            measureAll(); recalcDot(); recalcDotPos();
            setPhase("dot");
          }
        }
      } else if (R.phase === "dot") {
        const t = Math.min(1, (now - R.phaseT0) / DOT_MS);
        const e = smooth5(t);
        R.morph = { kind: "dot", dir: "in", t: e };
        R.bodyScale = 1 + (R.endScale - 1) * e;
        R.bodyFill = lerpColor(DATA.faces[R.faceIdx].color, TEXT_INK, e);
        R.inkK = e;
        if (t >= 1) setPhase("dothold");
      } else if (R.phase === "dothold") {
        // KEEP the collapsed pose rendered: the period rests at the end
        R.morph = { kind: "dot", dir: "in", t: 1 };
        R.bodyScale = R.endScale;
        R.bodyFill = TEXT_INK;
        R.inkK = 1;
        if (now - R.phaseT0 > DOT_HOLD) setPhase("release");
      } else if (R.phase === "release") {
        // the TEXT fades around the resting period; the dot itself stays put
        R.morph = { kind: "dot", dir: "in", t: 1 };
        R.bodyScale = R.endScale;
        R.bodyFill = TEXT_INK;
        R.inkK = 1;
        if (now - R.phaseT0 > RELEASE_MS) {
          R.liftFrom = { x: R.dotPos.x, y: R.dotPos.y };
          R.run = (R.run + 1) % runsNow.length;
          const cb = propsRef.current.onParagraph;
          if (cb) cb(R.run);
          R.faceIdx = 0;
          R.chars = 0; R.charsDoneAt = 0;
          R.caretX = null; R.caretY = null;   // snap the write head (invisible)
          R.wakeInit = false;
          setPhase("lift");
        }
      } else if (R.phase === "lift") {
        // the dot LIFTS OFF the finished paragraph and glides across
        R.morph = { kind: "dot", dir: "in", t: 1 };
        R.bodyScale = R.endScale;
        R.bodyFill = TEXT_INK;
        R.inkK = 1;
        if (now - R.phaseT0 >= LIFT_MS) setPhase("wake");
      }

      // ---- write head + bob placement ------------------------------------
      const bobEl = bobRef.current, caretEl = caretRef.current;
      const shellEl = shellRef.current, lineEl = lineRef.current;
      if (bobEl && caretEl && shellEl && lineEl) {
        const sr = shellEl.getBoundingClientRect();
        const lr = lineEl.getBoundingClientRect();
        const B = bobEl.offsetWidth || 30;
        const els = lineEl.querySelectorAll(".ch");
        const head = els[Math.min(R.chars, els.length - 1)];
        const hr = head ? head.getBoundingClientRect() : null;

        // the caret GLIDES toward the write slot — never a jump (across line
        // wraps too: it slides down-left to the start of the next line)
        let cx = R.caretX, cy = R.caretY;
        if (hr) {
          const tx0 = hr.left - lr.left;
          const ty0 = hr.top - lr.top + (hr.height - R.caretH) / 2;
          if (cx == null || cy == null) { cx = tx0; cy = ty0; }
          else if (!isPaused) {
            const k = 1 - Math.exp(-dt / GLIDE_TAU);
            cx += (tx0 - cx) * k;
            cy += (ty0 - cy) * k;
          }
        } else { cx = cx ?? 0; cy = cy ?? 0; }
        R.caretX = cx; R.caretY = cy;
        caretEl.style.transform = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px)`;

        // the write glow - a SMALL soft slab hugging the caret
        const glowEl = glowRef.current;
        if (glowEl) {
          const ch = R.caretH || 20;
          const gw = Math.max(22, ch * 1.15);
          const gh = Math.max(34, ch * 1.5);
          const blur = Math.max(2.5, ch * 0.1);
          const cx0 = lr.left - sr.left + cx;
          const cy0 = lr.top - sr.top + cy + R.caretH / 2;
          glowEl.style.width = gw.toFixed(1) + "px";
          glowEl.style.height = gh.toFixed(1) + "px";
          glowEl.style.filter = `blur(${blur.toFixed(1)}px)`;
          glowEl.style.transform =
            `translate(${(cx0 + 3 - gw).toFixed(2)}px, ${(cy0 - gh / 2).toFixed(2)}px)`;
        }

        // the blink: ONE shared phase drives BOTH the caret bar and the glow
        const blinkOn = now % 950 < 513;
        const caretVisible = R.phase === "wake" || R.phase === "idle" || R.phase === "typing";
        const ciEl = caretEl.firstElementChild;
        if (ciEl) ciEl.style.opacity = caretVisible ? (blinkOn ? "1" : "0") : "";
        if (glowEl) glowEl.style.opacity = R.phase === "typing" ? (blinkOn ? "1" : "0") : "";

        // bob: a centre point in shell coordinates, riding the write head
        const lineX = lr.left - sr.left, lineY = lr.top - sr.top;
        const caretW = caretEl.offsetWidth || 2;
        let bx, by;
        if (R.phase === "dot" || R.phase === "dothold" || R.phase === "release") {
          const e = R.phase === "dot" ? smooth5(Math.min(1, (now - R.phaseT0) / DOT_MS)) : 1;
          bx = R.dotX0 + (R.dotPos.x - R.dotX0) * e;
          by = R.dotY0 + (R.dotPos.y - R.dotY0) * e;
        } else if (R.phase === "lift") {
          const e = smooth5(Math.min(1, (now - R.phaseT0) / LIFT_MS));
          const h0 = els[0];
          const h0r = h0 ? h0.getBoundingClientRect() : null;
          let wx2, wy2;
          if (h0r) {
            const cx0 = h0r.left - lr.left;
            const cy0 = h0r.top - lr.top + (h0r.height - R.caretH) / 2;
            wx2 = lineX + cx0 + caretW + R.gap + R.dotDia / 2;
            wy2 = lineY + cy0 + R.caretH / 2;
          } else { wx2 = sr.width / 2; wy2 = sr.height / 2; }
          const arc = -20 * Math.sin(Math.PI * e);
          bx = R.liftFrom.x + (wx2 - R.liftFrom.x) * e;
          by = R.liftFrom.y + (wy2 - R.liftFrom.y) * e + arc;
        } else if (R.phase === "wake") {
          const e = smooth5(Math.min(1, (now - R.phaseT0) / WAKE_MS));
          const spawnX = lineX + cx + caretW + R.gap + R.dotDia / 2;
          const rideX = lineX + cx + caretW + R.gap + B / 2;
          bx = spawnX + (rideX - spawnX) * e;
          by = lineY + cy + R.caretH / 2;
        } else {
          bx = lineX + cx + caretW + R.gap + B / 2;
          by = lineY + cy + R.caretH / 2;
        }
        R.bobX = bx; R.bobY = by;
        bobEl.style.transform = `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) translate(-50%, -50%)`;
      }

      // ---- eyes: gaze + blink, only while a face is actually shown ------
      if (!R.morph || R.morph.kind === "face") {
        if (now >= R.gazeNext) {
          R.gazeFrom = R.gazeTo;
          R.gazeTo = [(Math.random() * 2 - 1) * 34, (Math.random() * 2 - 1) * 26];
          R.gazeT0 = now; R.gazeDur = 380 + Math.random() * 260;
          R.gazeNext = now + 900 + Math.random() * 1600;
        }
        const gt = Math.min(1, (now - R.gazeT0) / R.gazeDur);
        const ge = gt * gt * (3 - 2 * gt);
        R.gazeX = R.gazeFrom[0] + (R.gazeTo[0] - R.gazeFrom[0]) * ge;
        R.gazeY = R.gazeFrom[1] + (R.gazeTo[1] - R.gazeFrom[1]) * ge;
        if (now >= R.blinkNext) { R.blinkOn = true; R.blinkT0 = now; R.blinkNext = now + 2200 + Math.random() * 3200; }
        if (R.blinkOn) {
          const bt = (now - R.blinkT0) / 150;
          R.blink = bt >= 1 ? 0 : Math.sin(Math.PI * Math.min(1, bt));
          if (bt >= 1) R.blinkOn = false;
        } else R.blink = 0;
      }

      setState({
        phase: R.phase,
        run: R.run,
        chars: R.chars,
        faceIdx: R.faceIdx,
        morph: R.morph,
        bodyScale: R.bodyScale,
        bodyFill: R.bodyFill,
        dotR: R.dotR,
        dotsT: R.faceIdx === 1 && !R.morph ? now - R.holdT0 : 0,
        bodyKey: R.bodyKey,
        bodyFrom: R.bodyFrom,
        bodyT: R.bodyT,
        ringFill: R.ringFill,
        gaze: { x: R.gazeX || 0, y: R.gazeY || 0 },
        blink: R.blink || 0,
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    setBody: (key) => pickBody(key),
    snapshot: () => ({
      phase: R.phase, run: R.run, chars: R.chars, faceIdx: R.faceIdx + 1,
      body: R.bodyKey, paragraphs: runsRef.current.length,
    }),
    get paragraphs() { return runsRef.current.length; },
  }));

  const run = runs[state.run % runs.length];
  const chars = state.chars;
  const caretOn = state.phase === "wake" || state.phase === "idle" || state.phase === "typing";

  return (
    <div
      ref={shellRef}
      className={`typebob-root ${className}`.trim()}
      style={style}
      data-phase={state.phase}
      data-run={state.run}
      data-face={state.faceIdx}
      data-body={state.bodyKey}
    >
      {/* the write glow sits BEFORE #line in tree order: both are positioned
          siblings, so paint order is tree order — the text renders over the
          glow and stays crisp inside the pool of light */}
      <i id="glow" ref={glowRef} className={state.phase === "typing" ? "on" : ""} aria-hidden="true" />
      <div id="line" ref={lineRef}>
        {run.text.split("").map((ch, i) => (
          <span key={i} className={"ch" + (i < chars && i < run.text.length - 1 ? " on" : "")}>{ch}</span>
        ))}
        <i id="blm" ref={blmRef} aria-hidden="true" />
        <span id="caret" ref={caretRef} className={caretOn ? "on" : ""} aria-hidden="true"><i /></span>
      </div>
      <div id="bob" ref={bobRef} aria-hidden="true">
        <Stage
          faceIdx={state.faceIdx}
          color={DATA.faces[state.faceIdx].color}
          bodyFill={state.bodyFill}
          dotInk={TEXT_INK}
          dotR={state.dotR}
          gaze={state.gaze}
          blink={state.blink}
          morph={state.morph}
          bodyScale={state.bodyScale}
          dotsT={state.dotsT}
          bodyFrom={state.bodyFrom}
          bodyKey={state.bodyKey}
          bodyT={state.bodyT}
          ringFill={state.ringFill}
          uid={uid}
          live={!paused}
        />
      </div>
      {showBar && (
        <div id="bar" role="toolbar" aria-label="body">
          {BODIES.map((b) => (
            <button
              key={b.key}
              type="button"
              className={"bod" + (state.bodyKey === b.key ? " on" : "")}
              style={{ "--f": b.fill }}
              title={b.key}
              aria-label={"body: " + b.key}
              onClick={() => pickBody(b.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
});
