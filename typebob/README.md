# typebob

Bob types paragraphs. The text owns the centre of the stage, bob rides just
right of the blinking write caret and switches faces as the words land. When
the paragraph reaches its final period he gathers into it: every shape morphs
into a circle of the period's exact ink size, colour and position. The text
fades, the dot lifts off to the next paragraph's write head, and blooms into
the idle face.

Two ways to use it:

- **The app** (`src/`): a Vite + React page that runs the scene full-bleed, on
  its own copy of the engine (`src/engine/` plus `data.json`).
- **The component**: the same scene as a drop-in React component, shipped in
  the bob npm package (`../component/`) alongside the plain character.

## The app

    npm install
    npm run dev -- --port 5175

## The npm component

    npm install @sloemo/bob    # Bob (the character) and Typebob (this scene)

```jsx
import { Typebob } from "@sloemo/bob";

<div style={{ width: "100%", height: 420 }}>
  <Typebob />
</div>
```

Props (`paragraphs`, `cps`, `body`, `tour`, `paused`, ...), the ref handle and
the TypeScript types are documented in
[`../component/README.md`](../component/README.md). There is a no-build example
with both components:

    node component/example/serve.mjs     # http://127.0.0.1:5184/example/

Rebuild the bundle after changing anything under `../component/src` with
`../component/build.sh`. The engine inside `../component/src` is the source of
truth for the shipped component; `src/` (the app) keeps its own copy.

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
constants live at the top of `component/src/components/Typebob.jsx` (defaults)
and `src/App.jsx` (the app).

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
(`src/engine/ringwarm.js`; the component inlines the same worker into its
bundle) and is adopted before the first non-circle render; picks made before
it lands are held and replayed.

## License

MIT. See [LICENSE](../LICENSE).
