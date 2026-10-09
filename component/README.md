# bob

The drop-in bob: 24 morphing faces, live eyes that follow the cursor, blinks,
and real SVG shape morphs between every pair. No opacity crossfades anywhere.
This folder is self-contained: the engine (`morph.js`, `clock.js`, `geom.js`),
`Stage`, and `data.json` all live inside it, so pointing a bundler at `src/`
is enough.

On npm as `@sloemo/bob` (the plain name `bob` is taken on the registry):

```bash
npm install @sloemo/bob
```

```jsx
import { Bob } from "@sloemo/bob";
// from this repo: import { Bob } from "./src";
```

The built bundles are `dist/bob.js` (ESM) and `dist/bob.cjs` (CommonJS), React
externalized. `index.d.ts` ships the prop and ref types.

## Props

| prop | default | meaning |
| --- | --- | --- |
| `size` | `320` | px width of the rendered bob (the SVG scales to it) |
| `face` | `1` | start face, 1-based (1..24), read at mount |
| `only` | `""` | restrict the auto-cycle to a subset, e.g. `"2,3,5"` |
| `hold` | `0` | ms each face holds before morphing (0 = engine default) |
| `drive` | `false` | don't auto-cycle; drive it with the ref instead |
| `body` | `"circle"` | starting body: `circle`, `cloud`, `square`, `hexagon`, `pebble`, `triangle`, `starburst`, `diamond`, `trigon`, `droplet`. Later changes morph. |
| `paused` | `false` | freeze the animation |
| `lookAtCursor` | `true` | eyes follow the pointer across the element |
| `onFace` | none | `(index, total) => void` on every resting-face change |
| `className`, `style` | none | passed through to the wrapper |

## Ref handle

```jsx
const bob = useRef(null);
<Bob ref={bob} drive />

bob.current.goto(7);      // morph to face 7 (1-based); ignored mid-morph
bob.current.advance(1);   // next face  (also advance(-1))
bob.current.toggle();     // play/pause (paused: goto switches instantly)
bob.current.setCursor(x, y); // eyes, normalized -1..1
bob.current.snapshot();   // raw engine state
bob.current.faces;        // 24
```

## Run the example

`example/index.html` is a no-build page that loads React from a CDN and the
built `dist/bob.js` next to it. Serve over http (ES modules reject `file://`):

```bash
node component/example/serve.mjs      # http://127.0.0.1:5184/example/
```

Or with any static server, e.g. `npx serve` at the repo root.

## Rebuilding

`src/` here is the source of truth for the shipped character. After any change
inside it, re-bundle `dist/`:

```bash
./build.sh          # or: npm run build
```

## Notes

- The component injects one scoped stylesheet (`#bob-component-style`) so the
  SVG keeps its own sizing inside any host page.
- `data.json` is generated from the Figma exports with `python3 build.py --json`
  in the repo root.

## License

MIT. See [LICENSE](LICENSE).
