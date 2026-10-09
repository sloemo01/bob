# bob · faces — packed React component

The drop-in bob: 24 morphing faces, live eyes that follow the cursor, blinks,
and real SVG shape morphs between every pair. No opacity crossfades anywhere.
This folder is self-contained — engine (`morph.js`, `clock.js`, `geom.js`),
`Stage`, and `data.json` all live inside it, so pointing your bundler at
`component/src` is enough.

## Use it from this repo

```jsx
// your app
import { Bob } from "../bob/component/src";
// or once packed: import { Bob } from "../bob/component/dist/bob.js";

function Page() {
  return <Bob size={320} />;
}
```

Vite / webpack / Rspack handle the JSX and JSON imports inside `src/` directly,
so nothing else is needed. React is the only peer dependency.

## Use it from npm (after `npm pack` or publishing this folder)

```bash
cd component
npm pack            # or: npm publish (after un-privating)
```

```jsx
import { Bob } from "bob-faces";
import "bob-faces/style.css"; // not needed — the component injects its own
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
| `body` | `"circle"` | starting body — `circle`, `cloud`, `square`, `hexagon`, `pebble`, `triangle`, `starburst`, `diamond`, `trigon`, `droplet`. Later changes morph. |
| `paused` | `false` | freeze the animation |
| `lookAtCursor` | `true` | eyes follow the pointer across the element |
| `onFace` | — | `(index, total) => void` on every resting-face change |
| `className`, `style` | — | passed through to the wrapper |

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

`example/index.html` is a no-build page that loads the ESM bundle from a CDN
and the repo's own built `dist/bob.js`. Serve the repo root over http (ES
modules reject `file://`):

```bash
node component/example/serve.mjs      # http://127.0.0.1:5184/example/
```

Or with any static server, e.g. `npx serve` at the repo root.

## Rebuilding after an engine change

`app/src` remains the source of truth. `component/build.sh` syncs the copy
and re-bundles `dist/`:

```bash
./component/build.sh
```

## Notes

- The component injects one scoped stylesheet (`#bob-component-style`) so the
  SVG keeps its own sizing inside any host page.
- `data.json` is generated from the Figma exports with `python3 build.py --json`
  in the repo root; it is copied here by `build.sh`.
