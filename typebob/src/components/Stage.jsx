// components/Stage.jsx — the SVG stage for typebob.
//
// Two render paths, both real path morphs (never an opacity crossfade):
//   1. HELD — a face's exact geometry, with live eyes (gaze + blink) exactly
//      like the bob app.
//   2. MORPH — either a face->face transition (while the typing advances the
//      face) or the face<->PERIOD transition that ends a run. The dot is the
//      sentence's own full stop: faceToDot pairs every shape of the face with
//      a circle of the period's measured ink radius, filled with the text ink,
//      so the face gathers into the period itself.
//
// BODIES: the plain circle is the exact baseline. Any other body (from the
// bottom bar, or a body morph in flight) renders the engine's 240-point ring
// (bodyFrameFor) and wraps EVERYTHING — ring and face content — in the same
// frame transform, so the face always sits inside the shape. On the dot
// collapse the frame scale multiplies down by bodyScale: ring and content
// shrink about the frame's centre, and the content's gather disc is aimed at
// the frame centre with a compensated radius, so both land exactly on the
// sentence's period, same as the plain circle.

import { useMemo } from "react";
import DATA from "../data.json";
import { getTransition, renderItem, faceToDot, dotToFace, bodyFrameFor } from "../engine/morph";

const VB = DATA.viewBox;
const CENTER = VB / 2;

// the same held-eye renderer the bob app uses: black eye ellipse, white pupil
// clipped to it, and the dome-edged blink lid carrying the eye's own tilt
function HeldEyes({ face, gaze, blink, lid }) {
  return ["L", "R"].map((s) => {
    const e = face["e" + s], p = face["p" + s];
    const { cx: ecx, cy: ecy, rx: erx, ry: ery, rot: erot, vis: evis } = e;
    const pcx = p.cx + gaze.x, pcy = p.cy + gaze.y;
    const lx = ecx - erx - 26, ly = ecy - ery - 26, lw = 2 * erx + 52, lh = 2 * ery + 52;
    const bv2 = Math.max(blink, 0.0001);
    const rotT = erot ? `rotate(${erot.toFixed(3)} ${ecx.toFixed(2)} ${ecy.toFixed(2)})` : undefined;
    return (
      <g key={s} opacity={evis.toFixed(3)}>
        <ellipse cx={ecx} cy={ecy} rx={erx} ry={ery} fill="black" transform={rotT} />
        <g clipPath={`url(#eyeClip${s})`}>
          {/* the pupil has two painted states: the white ellipse glint and,
              for the heart faces, the heart shape. They SHARE the opacity
              budget — the ellipse fades out as the heart takes over (drawn
              at p.vis * mode). Rendering both opaque filled the heart's notch
              with the ellipse beneath it, which read as a white blob. */}
          <ellipse cx={pcx} cy={pcy} rx={p.rx} ry={p.ry} fill="white"
            opacity={(p.vis * (1 - (p.mode || 0))).toFixed(3)}
            transform={p.rot ? `rotate(${p.rot.toFixed(3)} ${pcx.toFixed(2)} ${pcy.toFixed(2)})` : undefined} />
          {(p.mode || 0) > 0 && (
            <path d={s === "L" ? DATA.heartL : DATA.heartR} fill="white"
              opacity={(p.vis * p.mode).toFixed(3)}
              transform={erot ? `rotate(${p.rot.toFixed(3)} ${p.cx.toFixed(2)} ${p.cy.toFixed(2)})` : undefined} />
          )}
        </g>
        <path
          d={`M ${lx.toFixed(2)} ${ly.toFixed(2)} H ${(lx + lw).toFixed(2)} V ${(ly + lh - 80).toFixed(2)} Q ${(lx + lw / 2).toFixed(2)} ${(ly + lh + 80).toFixed(2)} ${lx.toFixed(2)} ${(ly + lh - 80).toFixed(2)} Z`}
          fill={lid}
          transform={`${erot ? `rotate(${erot.toFixed(3)} ${ecx.toFixed(2)} ${ecy.toFixed(2)}) ` : ""}translate(0 ${ly.toFixed(2)}) scale(1 ${bv2.toFixed(4)}) translate(0 ${-ly.toFixed(2)})`}
        />
      </g>
    );
  });
}

function Extras({ face }) {
  return DATA.extraKeys.map((k) => {
    if (k === "dots" || !(face.ex[k] > 0)) return null;
    return (
      <g key={k}>
        {DATA.extras[k].map((s, idx) => (
          <path key={idx} d={s.d} fill={s.fill || "none"} stroke={s.stroke || "none"}
            strokeWidth={s.sw || undefined} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </g>
    );
  });
}

// the typing face (face 2) wears the three-dot row, and while it is held the
// dots BOUNCE: the same raised-cosine hop the bob app runs (period 1150ms,
// 190ms stagger, 15-unit lift, a slight swell at the top). The phase is
// measured from the moment this face landed, so the row eases into its loop
// from rest and the moment typing starts bob visibly reads as "typing".
const DOTS_ROW = [[287.854, 395.304], [422.854, 395.304], [557.854, 395.304]];
const DOTS_PERIOD = 1150, DOTS_STAGGER = 190, DOTS_AMP = 15;

function DotsRow({ dotsT }) {
  return DATA.extras.dots.map((s, k) => {
    const ph = ((((dotsT - k * DOTS_STAGGER) % DOTS_PERIOD) + DOTS_PERIOD) % DOTS_PERIOD) / DOTS_PERIOD;
    const bob = ph < 0.5 ? (-DOTS_AMP * (1 - Math.cos(4 * Math.PI * ph))) / 2 : 0;
    const b = DOTS_ROW[k];
    const t = `translate(${b[0]} ${(b[1] + bob).toFixed(2)}) scale(${(1 - 0.11 * (bob / DOTS_AMP)).toFixed(4)}) translate(${-b[0]} ${-b[1]})`;
    return <path key={k} d={s.d} fill={s.fill || "#050505"} transform={t} />;
  });
}

export default function Stage({ faceIdx, color, bodyFill, dotInk, dotR, gaze, blink, morph, bodyScale = 1, dotsT = 0,
                               bodyFrom = "circle", bodyKey = "circle", bodyT = 1, ringFill = null }) {
  // body: the settled plain circle is the exact baseline (fill driven by
  // bodyFill — the face's colour, inked to the period on collapse). Anything
  // else renders the engine's ring through the frame transform below.
  const settledCircle = bodyFrom === "circle" && bodyKey === "circle" && bodyT >= 1;
  const bf = settledCircle ? null : bodyFrameFor(bodyFrom, bodyKey, bodyT, performance.now(), true);

  // the dot targets: with a ring frame the content gathers to the frame's own
  // bbox centre (which the frame maps to the viewport centre), and its radius
  // is compensated by the frame scale so the rendered disc — like the ring
  // collapsing under it — lands exactly on the period's measured size.
  const atX = bf ? bf.cx : null;
  const atY = bf ? bf.cy : null;
  const r0 = bf ? (VB / 2) / bf.s : (dotR || 46);
  const ink = dotInk || "#f2f2f2";

  // morph = { kind: 'face', j, t } | { kind: 'dot', dir, t } | null
  const items = useMemo(() => {
    if (!morph) return null;
    const at = atX == null ? undefined : [atX, atY];
    if (morph.kind === "dot") {
      return morph.dir === "in" ? faceToDot(faceIdx, ink, r0, at) : dotToFace(faceIdx, ink, r0, at);
    }
    return getTransition(faceIdx, morph.j, null, null).items;
  }, [morph && morph.kind, morph && morph.j, morph && morph.dir, faceIdx, ink, r0, atX, atY]);

  const face = DATA.faces[faceIdx];
  const faceB = morph && morph.kind === "face" ? DATA.faces[morph.j] : null;
  const morphing = !!morph;
  // the eye clips must belong to the face whose eyes are on screen: mid face
  // morph the pupils travel toward the TARGET's eye boxes, so the clip rides
  // the blend rather than snapping at the handoff
  const clipFace = faceB && morph.t > 0.5 ? faceB : face;

  // items render exactly the way the bob app renders them: fill rings, stroked
  // centerlines, stroke reveals, with ink lerped between the pair's ends
  const renders = items
    ? items.map((it) => ({ r: renderItem(it, morph.t, null) }))
    : [];

  const lidFill = bf ? (ringFill || color) : (bodyFill || color);

  const content = morphing ? (
    <g>
      {renders.map(({ r }) =>
        r.hidden ? null : r.draw ? (
          <path key={r.key} d={r.d} fill="none" stroke={r.ink} strokeWidth={r.sw}
            strokeLinecap="round" strokeLinejoin="round" strokeDasharray={r.dash} />
        ) : r.mode === "ring" ? (
          r.strokePaint
            ? <path key={r.key} d={r.d} fill="none" stroke={r.ink} strokeWidth={Math.max(0.5, r.sw)}
                strokeLinecap="round" strokeLinejoin="round" />
            : <path key={r.key} d={r.d} fill={r.ink} />
        ) : (
          <path key={r.key} d={r.d} fill="none" stroke={r.ink} strokeWidth={Math.max(0.5, r.sw)}
            strokeLinecap="round" strokeLinejoin="round" />
        ),
      )}
    </g>
  ) : (
    <g>
      <HeldEyes face={face} gaze={gaze} blink={blink} lid={lidFill} />
      <Extras face={face} />
      {faceIdx === 1 && <DotsRow dotsT={dotsT} />}
    </g>
  );

  return (
    <svg id="stage" viewBox={`0 0 ${VB} ${VB}`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="eyeClipL"><ellipse cx={clipFace.eL.cx} cy={clipFace.eL.cy} rx={clipFace.eL.rx} ry={clipFace.eL.ry} /></clipPath>
        <clipPath id="eyeClipR"><ellipse cx={clipFace.eR.cx} cy={clipFace.eR.cy} rx={clipFace.eR.rx} ry={clipFace.eR.ry} /></clipPath>
      </defs>

      {bf ? (
        // ring body + content ride ONE frame transform: the face sits inside
        // the shape, and bodyScale shrinks both about the frame's centre onto
        // the period's spot at the viewport centre
        <g transform={`translate(${CENTER} ${CENTER}) scale(${(bf.s * bodyScale).toFixed(5)}) translate(${(-bf.cx).toFixed(3)} ${(-bf.cy).toFixed(3)})`}>
          <path d={bf.d} fill={ringFill || bodyFill || color} />
          {content}
        </g>
      ) : (
        <>
          {/* body — the disc itself; its fill tints toward the text ink as it
              collapses, so the settled state IS the sentence's period */}
          <circle cx={CENTER} cy={CENTER} r={(VB / 2) * bodyScale} fill={bodyFill || color} />
          {content}
        </>
      )}
    </svg>
  );
}
