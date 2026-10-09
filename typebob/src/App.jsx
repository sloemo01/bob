// App.jsx — typebob: the TEXT is the star and bob is its typist.
//
// A paragraph owns the middle of the stage, centred. All of its characters sit
// in the layout from the very first frame (invisible), so the text block NEVER
// reflows and never jiggles: typing just fades the characters in, and the
// caret is an absolutely-positioned element that GLIDES from slot to slot
// instead of jumping (including across line wraps). Bob sits at the write head
// — just right of the blinking caret where the next character spawns — and
// rides it as the paragraph grows, switching faces as the words come out.
// When the paragraph is down to its final period, bob slides onto the period's
// own spot and BECOMES it: every shape of him gathers into a circle of the
// period's exact ink size, in the text's exact ink colour, on the period's
// exact position. The paragraph is complete; the full stop rests. Then the
// text fades around it, and the dot — still the same tiny ink dot — LIFTS
// OFF, gliding across to the next paragraph's write head, where it blooms
// into the idle face. Paragraph, dot, done, next paragraph, in a loop.
//
// The last character of every paragraph is "." and it is NEVER revealed as
// text: bob IS that period, at the period's spot, size and colour.
//
// A NEW RUN STARTS ON THE IDLE FACE: the dot releases and blooms into face 1
// (neutral, eyes roving) while the write head just blinks; the moment typing
// begins, bob morphs into the TYPING face (the three bouncing dots), so the
// face itself announces that he is typing before the mood faces take over.
//
// One rAF loop drives everything: phase timing, text reveal, caret glide and
// bob's placement (written straight to the DOM every frame).

import { useEffect, useRef, useState } from "react";
import Stage from "./components/Stage";
import DATA from "./data.json";
import { smooth5, lerpColor, parseColor } from "./engine/geom";
import { bodySnapshot, adoptRingSet, CLOUD_FILL, SQUARE_FILL, HEX_FILL, PEBBLE_FILL, TRI_FILL, SB_FILL, TRIGON_FILL, DROPLET_FILL, DIA_FILL } from "./engine/morph";

const VB = DATA.viewBox;

const PARAGRAPHS = [
  // face numbers are 1-based. A run OPENS on face 1 (idle) and the moment
  // typing begins the list below takes over — every list starts with [2, 2],
  // so the first switch is idle -> TYPING face (three dots), which then
  // bounces while he types. (Face 3's spinner still needs machinery typebob
  // doesn't render, so it stays out.) The final "." is bob's — not typed out.
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

const TEXT_INK = "#f2f2f2";

// the body bar: every body from the bob app, with its own fill. "circle" is
// the default plain disc (it takes the face's own colour); the rest are the
// figma bodies. Picking one morphs the current body into it with a real
// 240-point ring blend (bodyFrameFor) while the typing cycle keeps running.
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
const TOUR_MS = 2000;       // the body tour: advance one body every 2 seconds
const WAKE_MS = 780;        // the bloom (period -> face) at the new write head
const IDLE_MS = 900;        // beat on the idle face before typing starts
const CPS = 24;             // characters per second
const FACE_MS = 560;        // face morph while typing
const FACE_DRAIN_MS = 330;  // once the last character is down, drain faster
const CHAR_SETTLE_MS = 170; // beat after the last character lands, before the gather
const DOT_MS = 850;         // the gather (slide onto the period + collapse)
const DOT_HOLD = 1200;      // how long the full stop rests
const RELEASE_MS = 400;     // the TEXT fades fully around the resting period
const LIFT_MS = 640;        // the dot glides across to the next write head
const GLIDE_TAU = 34;       // ms; the write head's glide, so the caret never jumps

export default function App() {
  const shellRef = useRef(null);
  const lineRef = useRef(null);
  const caretRef = useRef(null);
  const glowRef = useRef(null);
  const blmRef = useRef(null);
  const bobRef = useRef(null);

  const [state, setState] = useState({
    phase: "wake",   // wake | idle | typing | dot | dothold | release
    run: 0,
    chars: 0,        // characters revealed (the final "." is never counted)
    faceIdx: 0,      // 0-based; 0 = face 1, the idle face every run opens on
    morph: null,     // { kind: 'face', j, t } | { kind: 'dot', dir, t }
    bodyScale: 1,
    bodyFill: DATA.faces[0].color,
    dotR: 46,        // design units; recomputed per run from the real period
    dotsT: 0,        // ms since the held face landed (drives the typing bounce)
    bodyKey: "circle",   // the selected body
    bodyFrom: "circle",  // where the current body morph starts
    bodyT: 1,            // 0..1 progress of the body morph (1 = settled)
    gaze: { x: 0, y: 0 },
    blink: 0,
  });

  const ref = useRef({
    phase: "wake", phaseT0: performance.now(), run: 0, chars: 0, charsDoneAt: 0,
    faceIdx: 0, morph: null, bodyScale: 1,
    bodyFill: DATA.faces[0].color,
    bodyKey: "circle", bodyFrom: "circle", bodyT: 1,
    ringFillFrom: "#D9D9D9", ringFillTo: "#D9D9D9", ringFill: "#D9D9D9", inkK: 0,
    holdT0: 0,
    blinkNext: performance.now() + 1600, blinkT0: 0, blinkOn: false,
    gazeNext: performance.now() + 1100, gazeT0: 0, gazeFrom: [0, 0], gazeTo: [0, 0], gazeDur: 400,
    caretX: null, caretY: null, caretH: 20, gap: 8, fontPx: 20, glowW: 140, glowH: 78,
    bobX: 0, bobY: 0, dotX0: 0, dotY0: 0,
    dotPos: { x: 0, y: 0 }, dotDia: 3, dotOffX: 0, dotOffY: 0, dotR: 46, endScale: 0.09,
    liftFrom: { x: 0, y: 0 }, glowKey: "",
    wakeInit: false,
    // the auto body tour (armed in the loop effect below): walks BODIES one
    // step per TOUR_MS from the body shown at mount and halts after it has
    // stepped back onto that start body
    tour: null,
    // ringsReady flips true when the off-thread ring build lands (or fails
    // over to the main thread); the tour's first step waits on it so the
    // ~3s ring fit never runs inside a first render
    ringsReady: false, pendingPick: null,
  });

  // ---- measuring: the period's real ink, with the real text engine ---------
  const measureAll = () => {
    const R = ref.current;
    const lineEl = lineRef.current, caretEl = caretRef.current;
    if (!lineEl) return;
    const cs = getComputedStyle(lineEl);
    const fontPx = parseFloat(cs.fontSize) || 20;
    R.fontPx = fontPx;
    if (caretEl) R.caretH = caretEl.offsetHeight || fontPx * 1.1;
    R.gap = Math.max(6, Math.round(fontPx * 0.3));
    // the halo is sized from the line's own font (5.4em wide, 3em tall)
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
        // ink centre relative to the glyph origin (x) / baseline (y, +down)
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
    const R = ref.current;
    const bobEl = bobRef.current;
    const B = (bobEl && bobEl.offsetWidth) || 30;
    R.endScale = R.dotDia / B;
    R.dotR = (R.dotDia * VB) / (2 * B);
  };

  // the period's spot: glyph origin from its own span, baseline from the
  // zero-height marker that rides the text baseline
  const recalcDotPos = () => {
    const R = ref.current;
    const shellEl = shellRef.current;
    const lineEl = lineRef.current;
    const blm = blmRef.current;
    if (!shellEl || !lineEl || !blm) return;
    const total = PARAGRAPHS[R.run % PARAGRAPHS.length].text.length;
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
  }, []);

  // a body pick: morph from wherever the body is right now (a mid-flight
  // snapshot if one is still morphing) into the picked body — never a snap
  const chooseBody = (key) => {
    const R = ref.current;
    if (key === R.bodyKey && R.bodyT >= 1) return;
    const baseOf = (k) => (k === "circle" ? DATA.faces[R.faceIdx].color : (BODIES.find((b) => b.key === k) || BODIES[0]).fill);
    const cur = R.bodyT < 1 ? lerpColor(R.ringFillFrom, R.ringFillTo, smooth5(R.bodyT)) : baseOf(R.bodyKey);
    R.ringFillFrom = cur;
    R.ringFillTo = baseOf(key);
    R.bodyFrom = R.bodyT < 1 ? bodySnapshot(R.bodyFrom, R.bodyKey, R.bodyT) : R.bodyKey;
    R.bodyKey = key;
    R.bodyT = 0;
  };

  // a pick from the body bar is manual control: it stops the auto tour (if
  // it is still running) at the picked body instead of the tour pulling the
  // body on to the next one. Before the off-thread rings land the pick is
  // held (pendingPick) — rendering a non-circle body now would build the
  // rings on the main thread and freeze the page.
  const pickBody = (key) => {
    const R = ref.current;
    const T = R.tour;
    if (T) T.active = false;
    if (!R.ringsReady) { R.pendingPick = key; return; }
    chooseBody(key);
  };

  // ---- body rings, built off-thread -----------------------------------------
  // ringSet()'s first build is ~3s of fit iteration (mkDiamond ~700ms,
  // mkTriangle ~600ms, mkDroplet ~500ms, …). Done lazily it froze the page
  // for ~3s inside the first non-circle render (the tour's first step, body
  // circle -> cloud). ringwarm.js is a module worker that imports the engine
  // and posts the fully built rings back; adoptRingSet installs them so the
  // main thread never runs the build. onerror / the timeout are safety
  // valves: ringsReady flips anyway and the old lazy path takes over.
  useEffect(() => {
    const R = ref.current;
    let w = null;
    const flush = () => {
      if (w) { w.terminate(); w = null; }
      R.ringsReady = true;
      if (R.pendingPick) { const k = R.pendingPick; R.pendingPick = null; chooseBody(k); }
    };
    try {
      w = new Worker(new URL("./engine/ringwarm.js", import.meta.url), { type: "module" });
      w.onmessage = (e) => { R.ringsAdopted = adoptRingSet(e.data); flush(); };
      w.onerror = () => { console.warn("ringwarm failed; rings will build on the main thread"); flush(); };
    } catch (err) {
      console.warn("ringwarm unavailable; rings will build on the main thread", err);
      flush();
    }
    const fallback = setTimeout(() => { if (!R.ringsReady) { console.warn("ringwarm slow; falling back to the main thread"); flush(); } }, 8000);
    return () => { clearTimeout(fallback); if (w) w.terminate(); };
  }, []);

  useEffect(() => {
    let raf, last = performance.now();
    const R = ref.current;
    const setPhase = (p, now) => { R.phase = p; R.phaseT0 = now; };

    // arm the body tour: one lap down the BODIES list, starting from the body
    // shown right now, one step every TOUR_MS. Stepping back onto the start
    // body disarms it — the tour reaches the end and then the start, and
    // stops there.
    R.tour = { active: true, start: R.bodyKey, next: performance.now() + TOUR_MS };

    const loop = (now) => {
      const dt = Math.min(60, now - last);
      last = now;
      const run = PARAGRAPHS[R.run % PARAGRAPHS.length];
      const total = run.text.length;
      const lastIdx = total - 1;  // the period: bob becomes it

      if (R.dotDia == null) { measureAll(); recalcDot(); }

      // ---- body morph progress + fill ------------------------------------
      if (R.bodyT < 1) {
        R.bodyT = Math.min(1, R.bodyT + dt / BODY_MORPH_MS);
        if (R.bodyT >= 1) R.bodyFrom = R.bodyKey;  // settle back to plain keys
      }

      // ---- the auto body tour: one step down the BODIES list every TOUR_MS,
      // each a real ring morph taken from a settled body. The step that lands
      // back on the tour's start body disarms it: end reached, back to the
      // start, no further cycling. The first step also waits for the
      // off-thread ring warm-up (ringsReady): stepping before it lands would
      // render a non-circle body and build the rings on the main thread.
      if (R.tour && R.tour.active && now >= R.tour.next) {
        if (!R.ringsReady) R.tour.next = now + 200;   // re-check while the worker builds
        else if (R.bodyT >= 1) {
          const i = BODIES.findIndex((b) => b.key === R.bodyKey);
          const next = BODIES[(i + 1) % BODIES.length].key;
          chooseBody(next);
          if (next === R.tour.start) R.tour.active = false;
          R.tour.next = now + TOUR_MS;
        }
      }

      const baseOf = (k) => (k === "circle" ? DATA.faces[R.faceIdx].color : (BODIES.find((b) => b.key === k) || BODIES[0]).fill);
      const ringBase = R.bodyT < 1 ? lerpColor(R.ringFillFrom, R.ringFillTo, smooth5(R.bodyT)) : baseOf(R.bodyKey);
      R.ringFill = lerpColor(ringBase, TEXT_INK, R.inkK || 0);

      // every glow layer rides the body's own colour: write --glow-rgb on the
      // shell (cast light, hot ink and the caret halo all read it). It is the
      // same value the body renders with — swatch colour, lerped mid-morph,
      // inked to white while the body folds into the period — so the glow
      // re-tints the moment a body is picked and cools to white at the end.
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
          setPhase("idle", now);
        }
      } else if (R.phase === "idle") {
        R.bodyFill = DATA.faces[R.faceIdx].color;
        if (now - R.phaseT0 > IDLE_MS) setPhase("typing", now);
      } else if (R.phase === "typing") {
        const want = Math.min(lastIdx, Math.floor(((now - R.phaseT0) / 1000) * CPS));
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
            // a settled plain circle wears the face's own colour: refresh it
            // when the face lands (faces with their own colour, like the red
            // one, then read correctly instead of keeping the previous hue)
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
            setPhase("dot", now);
          }
        }
      } else if (R.phase === "dot") {
        const t = Math.min(1, (now - R.phaseT0) / DOT_MS);
        const e = smooth5(t);
        R.morph = { kind: "dot", dir: "in", t: e };
        R.bodyScale = 1 + (R.endScale - 1) * e;
        R.bodyFill = lerpColor(DATA.faces[R.faceIdx].color, TEXT_INK, e);
        R.inkK = e;
        if (t >= 1) setPhase("dothold", now);
      } else if (R.phase === "dothold") {
        // KEEP the collapsed pose rendered (morph = null would fall back to
        // the full face renderer): the period rests at the paragraph's end
        R.morph = { kind: "dot", dir: "in", t: 1 };
        R.bodyScale = R.endScale;
        R.bodyFill = TEXT_INK;
        R.inkK = 1;
        if (now - R.phaseT0 > DOT_HOLD) setPhase("release", now);
      } else if (R.phase === "release") {
        // the TEXT fades around the resting period; the dot itself stays put
        // and stays visible (it is bob — he does not blink out with the words)
        R.morph = { kind: "dot", dir: "in", t: 1 };
        R.bodyScale = R.endScale;
        R.bodyFill = TEXT_INK;
        R.inkK = 1;
        if (now - R.phaseT0 > RELEASE_MS) {
          // remember where the dot is resting: the lift starts from exactly
          // here, so there is no positional jump anywhere in the handoff
          R.liftFrom = { x: R.dotPos.x, y: R.dotPos.y };
          R.run = (R.run + 1) % PARAGRAPHS.length;
          // a run always OPENS on the idle face; the typing face morphs in
          // when the first characters land (the list's first beats)
          R.faceIdx = 0;
          R.chars = 0; R.charsDoneAt = 0;
          R.caretX = null; R.caretY = null;   // snap the write head (invisible)
          R.wakeInit = false;
          setPhase("lift", now);
        }
      } else if (R.phase === "lift") {
        // the dot LIFTS OFF the finished paragraph and glides across to the
        // next paragraph's write head — still the same tiny ink dot, no fade,
        // no respawn — then blooms into the idle face once it lands
        R.morph = { kind: "dot", dir: "in", t: 1 };
        R.bodyScale = R.endScale;
        R.bodyFill = TEXT_INK;
        R.inkK = 1;
        if (now - R.phaseT0 >= LIFT_MS) setPhase("wake", now);
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
          else {
            const k = 1 - Math.exp(-dt / GLIDE_TAU);
            cx += (tx0 - cx) * k;
            cy += (ty0 - cy) * k;
          }
        } else { cx = cx ?? 0; cy = cy ?? 0; }
        R.caretX = cx; R.caretY = cy;
        caretEl.style.transform = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px)`;

        // the write glow - a SMALL soft slab hugging the caret, casting a
        // fading light to its LEFT: sized from the caret height, right edge
        // pinned under the bar, gradient reaching zero alpha well inside the
        // box so the falloff is smooth and nothing ever clips or spills right
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

        // the blink: ONE shared phase drives BOTH the caret bar and the cast
        // glow, so they pulse in step — the cursor's own 0.95s cadence
        // (~54% on), now JS-timed so the two can never drift apart. The
        // caret's <i> carries it (its CSS animation is gone), and the glow
        // rides the same phase through its short soft edge.
        const blinkOn = now % 950 < 513;
        const caretVisible = R.phase === "wake" || R.phase === "idle" || R.phase === "typing";
        const ciEl = caretEl.firstElementChild;
        if (ciEl) ciEl.style.opacity = caretVisible ? (blinkOn ? "1" : "0") : "";
        if (glowEl) glowEl.style.opacity = R.phase === "typing" ? (blinkOn ? "1" : "0") : "";

        // bob: a centre point in shell coordinates (the box carries
        // translate(-50%, -50%)), riding just right of the write head
        const lineX = lr.left - sr.left, lineY = lr.top - sr.top;
        const caretW = caretEl.offsetWidth || 2;
        let bx, by;
        if (R.phase === "dot" || R.phase === "dothold" || R.phase === "release") {
          const e = R.phase === "dot" ? smooth5(Math.min(1, (now - R.phaseT0) / DOT_MS)) : 1;
          bx = R.dotX0 + (R.dotPos.x - R.dotX0) * e;
          by = R.dotY0 + (R.dotPos.y - R.dotY0) * e;
        } else if (R.phase === "lift") {
          // the dot travels from the finished paragraph's full stop to the
          // new write head along an eased arc — a gentle lift, not a jump
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
  }, []);

  const run = PARAGRAPHS[state.run % PARAGRAPHS.length];
  const chars = state.chars;
  // caret shows at the write head except while the period holds/releases
  const caretOn = state.phase === "wake" || state.phase === "idle" || state.phase === "typing";

  return (
    <div id="shell" ref={shellRef} data-phase={state.phase} data-run={state.run} data-face={state.faceIdx} data-body={state.bodyKey}>
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
        />
      </div>
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
    </div>
  );
}
