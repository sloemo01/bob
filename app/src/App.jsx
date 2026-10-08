import { useEffect, useMemo, useRef, useState } from "react";
import Stage from "./components/Stage";
import { createClock, N } from "./engine/clock";
import { bodySnapshot } from "./engine/morph";

// report the body's current silhouette to the embedding widget: the plugin
// clips its iframe box with it (the iframe's white backing square otherwise
// shows behind any non-circular body). Sampled off the LIVE rendered path so
// it tracks the morph exactly; ignored when the page isn't embedded.
function postClip() {
  try {
    if (window.parent === window) return;
    const svg = document.getElementById("stage");
    const el = document.querySelector("#stageg > path");
    if (!svg || !el) return;
    const L = el.getTotalLength();
    if (!L) return;
    const ctm = el.getScreenCTM();
    if (!ctm) return;
    const N = 96, vw = window.innerWidth, vh = window.innerHeight;
    const sp = svg.createSVGPoint();
    const px = [];
    for (let i = 0; i < N; i++) {
      const p = el.getPointAtLength((i / N) * L);
      sp.x = p.x; sp.y = p.y;
      const s = sp.matrixTransform(ctm);
      px.push([s.x, s.y]);
    }
    const ax = px.reduce((a, p) => a + p[0], 0) / N;
    const ay = px.reduce((a, p) => a + p[1], 0) / N;
    const ins = px.map(([x, y]) => [ax + (x - ax) * 0.97, ay + (y - ay) * 0.97]);
    // smooth closed cubic through the inset points (Catmull-Rom -> Bezier):
    // the host clips with clip-path: path(), so the edge is a true curve —
    // a polygon clip shows facets and steps from one body morph to the next
    let d = "M " + ins[0][0].toFixed(2) + " " + ins[0][1].toFixed(2);
    for (let i = 0; i < N; i++) {
      const p0 = ins[(i - 1 + N) % N], p1 = ins[i], p2 = ins[(i + 1) % N], p3 = ins[(i + 2) % N];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += " C " + c1x.toFixed(2) + " " + c1y.toFixed(2) + " " + c2x.toFixed(2) + " " + c2y.toFixed(2)
        + " " + p2[0].toFixed(2) + " " + p2[1].toFixed(2);
    }
    d += " Z";
    const out = ins.map(([x, y]) => [+((x / vw) * 100).toFixed(2), +((y / vh) * 100).toFixed(2)]);
    if (postClip.n < 3) { postClip.n++; console.error("[bob-face] clip post", out.length, "first", out[0]); }
    window.parent.postMessage({ type: "bob:clip", points: out, path: d }, "*");
  } catch (e) {
    if (postClip.err < 3) { postClip.err++; console.error("[bob-face] clip fail:", String(e)); }
  }
}
postClip.n = 0;
postClip.err = 0;

export default function App() {
  const params = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    return {
      face: Math.max(1, parseInt(q.get("face"), 10) || 1),
      only: q.get("only") || "",
      hold: Math.max(0, parseInt(q.get("hold"), 10) || 0),
      still: q.get("still") === "1",
      ff: Math.max(0, parseInt(q.get("ff"), 10) || 0),
      cloud: q.get("cloud") === "1",
      square: q.get("square") === "1",
      body: q.get("body") || "",
      drive: q.get("drive") === "1",
      ui: q.get("ui") !== "0",
      bg: q.get("bg") !== "0",
      fit: q.get("fit") === "1",
    };
  }, []);
  const BODIES = ["cloud", "square", "hexagon", "pebble", "triangle", "starburst", "diamond", "trigon", "droplet"];
  const initBody = BODIES.includes(params.body)
    ? params.body
    : params.cloud
      ? "cloud"
      : params.square
        ? "square"
        : "circle";
  const [bodyKey, setBodyKey] = useState(initBody);
  const [bodyState, setBodyState] = useState({ from: initBody, to: initBody, t: 1 });
  const bodyRef = useRef({ from: initBody, to: initBody, t: 1, t0: 0, dur: 760 });
  const setBody = (K, snap) => {
    const b = bodyRef.current;
    // idempotent: hosts re-post the body as a keepalive; already settled on
    // K means nothing to do (a cloud->cloud "morph" would just churn)
    if (K === b.to && b.t >= 1) return;
    // snap = land instantly, no morph: used when a host re-applies the body
    // as it becomes visible, so a pending morph can't play out on appearance
    if (snap) {
      b.from = K; b.to = K; b.t = 1;
      setBodyKey(K);
      setBodyState({ from: K, to: K, t: 1 });
      try { postClip(); } catch { /* noop */ }
      return;
    }
    b.from = b.t < 1 ? bodySnapshot(b.from, b.to, b.t) : b.to;
    b.to = K;
    b.t = 0;
    b.t0 = performance.now();
    setBodyKey(K);
    setBodyState({ from: b.from, to: K, t: 0 });
  };
  const frozen = params.still || params.ff > 0;
  const clockRef = useRef(null);
  if (!clockRef.current) clockRef.current = createClock(params);
  const [snap, setSnap] = useState(() => clockRef.current.snapshot());
  const wantRef = useRef(null);

  // embed options: transparent background / edge-to-edge face for the ball
  useEffect(() => {
    const cl = document.documentElement.classList;
    if (!params.bg) cl.add("nobg");
    if (params.fit) cl.add("fit");
    return () => { cl.remove("nobg"); cl.remove("fit"); };
  }, []);

  useEffect(() => {
    if (frozen) return; // frozen for stills / test captures
    let raf, last = performance.now();
    let lastClipPost = 0;
    const loop = (now) => {
      const dt = Math.min(80, now - last);
      last = now;
      let s = clockRef.current.step(dt);
      const want = wantRef.current;
      if (want) {
        // a face request from the host (drive mode) — wait out any
        // running morph first, goto() refuses mid-morph
        if (s.phase !== "morph") {
          if (s.i !== want - 1) { clockRef.current.goto(want); s = clockRef.current.snapshot(); }
          wantRef.current = null;
        }
      }
      setSnap(s);
      const b = bodyRef.current;
      if (b.t < 1) {
        const u = Math.min(1, (now - b.t0) / b.dur);
        b.t = u >= 1 ? 1 : u;
        setBodyState({ from: b.from, to: b.to, t: b.t });
      }
      // the clip follows the LIVE edge EVERY frame: the ambient wobble moves
      // the silhouette continuously, and a slower clip holds the edge still
      // between posts (reads as the edge stepping instead of moving)
      postClip();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const clipT0 = setTimeout(postClip, 450);
    // clip heartbeat: rAF throttles hard when the window is backgrounded and
    // can collapse a whole morph into one frame, so the event-driven posts
    // above can miss the final silhouette entirely — this always converges
    const clipTick = setInterval(postClip, 900);
    window.addEventListener("resize", postClip);
    const key = (e) => {
      if (e.key === "ArrowRight") { clockRef.current.advance(1); setSnap(clockRef.current.snapshot()); }
      else if (e.key === "ArrowLeft") { clockRef.current.advance(-1); setSnap(clockRef.current.snapshot()); }
      else if (e.key === " ") { e.preventDefault(); clockRef.current.toggle(); }
    };
    const move = (e) =>
      clockRef.current.setCursor(
        (e.clientX / window.innerWidth) * 2 - 1,
        (e.clientY / window.innerHeight) * 2 - 1,
      );
    const onMsg = (e) => {
      const d = e && e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "bob:face") {
        const n = Math.round(Number(d.face));
        if (Number.isFinite(n) && n >= 1 && n <= N) wantRef.current = n;
      } else if (d.type === "bob:mode") {
        clockRef.current.setDrive(!d.auto);
      } else if (d.type === "bob:body") {
        const k = typeof d.name === "string" ? d.name : "";
        if (k === "circle" || BODIES.includes(k)) setBody(k, !!d.snap);
      } else if (d.type === "bob:clip-request") {
        postClip();
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("mousemove", move);
    window.addEventListener("message", onMsg);
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage({ type: "bob:ready" }, "*");
    } catch { /* not embedded */ }
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clipT0);
      clearInterval(clipTick);
      window.removeEventListener("resize", postClip);
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("message", onMsg);
    };
  }, []);

  const act = (fn) => {
    fn();
    setSnap(clockRef.current.snapshot());
  };

  return (
    <>
      <Stage snap={snap} big={frozen} bodyFrom={bodyState.from} bodyTo={bodyState.to} bodyT={bodyState.t} />
      {frozen ? (
        <>
          <div id="hud">{String(snap.i + 1).padStart(2, "0")} / {N}</div>
          <div id="hint">&larr; &rarr; · space</div>
        </>
      ) : params.ui ? (
        <div id="controls">
          <div id="faces">
            {Array.from({ length: N }, (_, k) => {
              const on = snap.i === k || (snap.phase === "morph" && snap.j === k);
              return (
                <button
                  key={k}
                  className={on ? "on" : ""}
                  onClick={() => act(() => clockRef.current.goto(k + 1))}
                >
                  {k + 1}
                </button>
              );
            })}
          </div>
          <div id="bodies">
            <button
              id="bodytoggle"
              className={bodyKey === "cloud" ? "on" : ""}
              onClick={() => setBody(bodyKey === "cloud" ? "circle" : "cloud")}
            >
              cloud
            </button>
            {BODIES.filter((k) => k !== "cloud").map((k) => (
              <button
                key={k}
                id={"b-" + k}
                className={bodyKey === k ? "on" : ""}
                onClick={() => setBody(bodyKey === k ? "circle" : k)}
              >
                {k}
              </button>
            ))}
          </div>
          <div id="transport">
            <button id="playpause" onClick={() => act(() => clockRef.current.toggle())}>
              {snap.pause ? "play" : "pause"}
            </button>
            <div id="count">{String(snap.i + 1).padStart(2, "0")} / {N}</div>
            <div id="keys">&larr; &rarr; · space</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
