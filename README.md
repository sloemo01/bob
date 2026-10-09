# bob · faces

24 morphing character faces built from the Figma file "Untitled" (page 0:1).

![bobvid demo](bobvid-demo.gif)

## React app (current)

`app/` is the React implementation. Every transition between consecutive faces is
a real SVG shape morph — each shape of face A is paired with a shape of face B
(eyes ↔ dots ↔ accessories) and the actual path geometry is interpolated with
flubber. There are no opacity crossfades between faces; shapes that have no
counterpart collapse to a point and grow back from one.

- `app/src/engine/clock.js` — the state machine (sequence, eye motion, dots)
- `app/src/engine/morph.js` — shape pairing + flubber interpolation
- `app/src/engine/geom.js` — path + color utilities
- `app/src/components/Stage.jsx` — the SVG stage component
- `app/src/data.json` — generated from the Figma exports (`python3 build.py --json`)

Run it:

    cd app && npm run dev        # http://localhost:5173

Query params kept from the vanilla build: `?face=N`, `?only=2,3`, `?hold=ms`,
`?still=1`, `?ff=ms`. The still comparison harness works against either build:

    BOB_BASE=http://localhost:5173/ python3 compare.py 1 2 3

## The vanilla build

- Every face uses the exact geometry from the SVG exports in `assets/faces/`
  (circle, eyes, pupils, and accessories: dots, chevrons, hearts, book, pen, ...).
- Faces hold, then morph into the next with a soft ease. Eyes live: saccades,
  occasional blinks, and they glance toward the cursor.
- Face 2's dots type (staggered lift). As face 2 morphs to face 3, the dots swirl
  one full turn out of the row into face 3's spinner layout (exactly as drawn in
  Figma). On face 3 the ring keeps spinning the whole time, and the gather loop
  from the spin reference file plays underneath: dot C tucks into the center, then
  A, then B — all stacked — then B pops back out, then A, then C, and the cycle
  repeats. End pose equals start pose, so the loop is seamless.

## Files

- `index.html` — the app (self-contained, generated; open directly in a browser
  or serve it locally)
- `build.py` — regenerates `index.html` from `assets/faces/*.svg` + the engine;
  edit and re-run to change anything
- `compare.py` — renders every face headless (`?face=N&still=1`) and diffs it
  against the Figma screenshot of that frame; writes `assets/render/pair_NN.png`
  (left = build, right = Figma) and prints a mean-diff table
- `assets/faces/` — per-face SVG exports from the Figma file
- `assets/shots/` — per-face PNG screenshots from Figma (ground truth)
- `assets/render/` — headless renders, pair strips, `sheetA/B.png` contact sheets

## URL params

- `?face=N` start at face N (1-24)
- `still=1` freeze the exact resting pose of that face (used by compare.py)
- `ff=ms` fast-forward the animation N ms at load (deterministic state capture)

## Controls

- `←` / `→` step faces, `space` pause, click advance

## Notes

- Face 3's spinner keeps the Figma arrangement; only its motion (spin, chase,
  depth) is animated. All other faces are pixel-matched to their Figma frames.
