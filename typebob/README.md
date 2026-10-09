# typebob

Bob types paragraphs. The text owns the centre of the stage, bob rides just
right of the blinking write caret and switches faces as the words land. When
the paragraph reaches its final period he gathers into it: every shape morphs
into a circle of the period's exact ink size, colour and position. The text
fades, the dot lifts off to the next paragraph's write head, and blooms into
the idle face.

Vite + React. The app carries its own copy of the engine (`src/engine/` plus
`data.json`), so it runs on its own.

    npm install
    npm run dev -- --port 5175

## The run

Phases, in order: wake, idle, typing, dot, dothold, release, lift, wake.

- wake: the dot blooms into the idle face at the new write head
- typing: characters fade in one at a time; every span is mounted from the
  first frame at opacity 0 so the line never reflows, and the caret glides
  from slot to slot (across line wraps too)
- dot: bob slides onto the final period's spot and collapses to its exact
  ink size via `bodyScale`
- dothold / release: the period rests while the text fades around it
- lift: the dot glides to the next paragraph's write head along a small arc,
  then the cycle repeats

The face list of each paragraph drives the switches while typing. Timing
constants live at the top of `src/App.jsx` (CPS, FACE_MS, DOT_MS, LIFT_MS, ...).

## The period dot

The "." ink is measured for real: canvas `measureText` in the line's computed
font, using `actualBoundingBox*` for the ink box (an SVG `getBBox` would
return the whole em box). The final period is never typed out; bob collapses
onto its own span's position and that disc is the period.

## Bodies

The bottom bar carries ten swatches, the circle plus the nine silhouettes.
Picking one runs a real ring morph while everything else keeps running; a pick
mid-morph continues from a snapshot of the displayed shape. The engine's ring
build costs about 3 seconds of fit iteration, so it runs in a module worker
(`src/engine/ringwarm.js`) and is adopted before the first non-circle render;
picks made before it lands are held and replayed.
