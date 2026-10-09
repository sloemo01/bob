// components/Bob.jsx — bob as a drop-in React component.
//
// The whole character in one element: 24 morphing faces, live eyes that
// follow the cursor, blinks, and real SVG shape morphs between faces (no
// opacity crossfades). Drop it into any React app that has this repo's
// engine alongside it:
//
//   import Bob from "./components/Bob";
//   <Bob size={320} />
//
// Props
//   size      px width of the rendered bob (the SVG scales to it)
//   face      start face, 1-based (1..24)
//   only      restrict the auto-cycle to a subset, e.g. "2,3,5"
//   hold      ms each face holds before morphing (0 = engine default)
//   drive     true = don't auto-cycle; the host calls ref.goto(n)
//   body      starting body: circle | cloud | square | hexagon | pebble
//             | triangle | starburst | diamond | trigon | droplet
//   paused    freeze the animation (play/pause)
//   lookAtCursor  eyes follow the pointer across the element (default true)
//   onFace    (index, total) => void, fired whenever the resting face changes
//
// Imperative handle (ref): { goto(n), advance(dir), toggle(), setCursor(x,y),
//                            faces, snapshot() }
//
// All options are read at mount; later face changes go through the ref.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import Stage from "./Stage";
import { createClock, N } from "../engine/clock";

const BODY_DUR = 760; // ms; a body switch is a real morph, never a snap

// one scoped stylesheet, injected once per document
const STYLE_ID = "bob-component-style";
function useScopedStyle() {
  useEffect(() => {
    if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      ".bob-wrap{display:inline-block;line-height:0}" +
      // scope the SVG to the wrapper even when the host page styles #stage
      // itself (the demo's index.css pins #stage to a fixed width)
      ".bob-wrap svg,.bob-wrap #stage{width:100%;height:auto;display:block}";
    document.head.appendChild(s);
  }, []);
}

export default forwardRef(function Bob(
  {
    size = 320,
    face = 1,
    only = "",
    hold = 0,
    drive = false,
    body = "circle",
    paused = false,
    lookAtCursor = true,
    onFace,
    className = "",
    style,
  },
  ref,
) {
  useScopedStyle();

  const wrapRef = useRef(null);
  const clockRef = useRef(null);
  if (!clockRef.current) {
    clockRef.current = createClock({ face, only, hold, still: false, ff: 0, drive });
  }
  const [snap, setSnap] = useState(() => clockRef.current.snapshot());
  const [bodyState, setBodyState] = useState({ from: body, to: body, t: 1 });
  const bodyRef = useRef({ from: body, to: body, t: 1, t0: 0, dur: BODY_DUR });

  // ---- the loop: step the clock, render, carry the body morph ----------
  useEffect(() => {
    let raf;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(80, now - last);
      last = now;
      setSnap(clockRef.current.step(dt));
      const b = bodyRef.current;
      if (b.t < 1) {
        const u = Math.min(1, (now - b.t0) / b.dur);
        b.t = u >= 1 ? 1 : u;
        setBodyState({ from: b.from, to: b.to, t: b.t });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- the body prop: any later change is a real morph --------------------
  useEffect(() => {
    const b = bodyRef.current;
    if (body === b.to) return;
    b.from = b.to;
    b.to = body;
    b.t = 0;
    b.t0 = performance.now();
    setBodyState({ from: b.from, to: body, t: 0 });
  }, [body]);

  // ---- paused prop: keep the clock's own pause in sync --------------------
  useEffect(() => {
    const c = clockRef.current;
    if (c.snapshot().pause === paused) return;
    c.toggle();
    setSnap(c.snapshot());
  }, [paused]);

  // ---- eyes follow the pointer across the element ------------------------
  useEffect(() => {
    if (!lookAtCursor) return;
    const move = (e) => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1));
      const y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1));
      clockRef.current.setCursor(x, y);
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [lookAtCursor]);

  // ---- face change callback ------------------------------------------------
  useEffect(() => {
    if (onFace) onFace(snap.i, N);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.i]);

  useImperativeHandle(ref, () => ({
    goto: (n) => {
      clockRef.current.goto(n);
      setSnap(clockRef.current.snapshot());
    },
    advance: (dir) => {
      clockRef.current.advance(dir);
      setSnap(clockRef.current.snapshot());
    },
    toggle: () => {
      clockRef.current.toggle();
      setSnap(clockRef.current.snapshot());
    },
    setCursor: (x, y) => clockRef.current.setCursor(x, y),
    snapshot: () => clockRef.current.snapshot(),
    get faces() {
      return N;
    },
  }));

  return (
    <div
      ref={wrapRef}
      className={`bob-wrap ${className}`.trim()}
      style={{ width: size, ...style }}
    >
      <Stage
        snap={snap}
        bodyFrom={bodyState.from}
        bodyTo={bodyState.to}
        bodyT={bodyState.t}
      />
    </div>
  );
});
