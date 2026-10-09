# B.O.B (Basic Object Bender)

Two drop-in React components in one package: **Bob**, the character (24
morphing faces, live eyes that follow the cursor, blinks, real SVG shape
morphs between every pair), and **Typebob**, the typing scene where he types
paragraphs and folds into the final period. No opacity crossfades anywhere.
This folder is self-contained: the engine (`morph.js`, `clock.js`, `geom.js`),
the stages, and `data.json` all live inside it.

Pull them into any React project (18 or 19) from npm:

```bash
npm install @sloemo/bob    # the plain name "bob" is taken on the registry
```

```jsx
import { Bob, Typebob } from "@sloemo/bob";

function App() {
  return (
    <>
      <Bob size={320} />
      <div style={{ width: "100%", height: 420 }}>
        <Typebob />
      </div>
    </>
  );
}
```

Vendoring instead of npm? `import { Bob, Typebob } from "./src"` from within
this folder also works, and the repo root's README shows the copy-in variant.

The built bundles are `dist/bob.js` (ESM) and `dist/bob.cjs` (CommonJS), React
externalized. `index.d.ts` ships the prop and ref types for both components.

## Bob props

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

## Typebob props

| prop | default | meaning |
| --- | --- | --- |
| `paragraphs` | built-in demo set | `string` / `string[]` / `{ text, faces? }[]`, looped |
| `cps` | `24` | typing speed, characters per second |
| `body` | `"circle"` | starting body (same list as Bob's) |
| `tour` | `true` | auto body tour: one step per `tourMs` until it lands back on the start body |
| `tourMs` | `2000` | ms per tour step |
| `paused` | `false` | freeze the scene (a virtual clock; resume continues it) |
| `showBar` | `true` | the bottom body bar with one swatch per body |
| `onParagraph` | none | `(index) => void` when a paragraph finishes |
| `className`, `style` | none | passed through to the wrapper |

A paragraph is `{ text, faces? }`; strings are shorthand for `{ text }`. A
missing final "." is added for you: bob becomes that period, so every
paragraph ends with one. The optional `faces` array pins the face parade
(1-based face numbers) walked while the text types.

## Ref handles

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

```jsx
const type = useRef(null);
<Typebob ref={type} />

type.current.setBody("cloud");  // same list as the body prop
type.current.snapshot();        // { phase, run, chars, faceIdx, body, paragraphs }
type.current.paragraphs;        // paragraphs in the loop
```

## Run the example

`example/index.html` is a no-build page that loads React from a CDN and the
built `dist/bob.js` next to it, with a tab for each component. Serve over http
(ES modules reject `file://`):

```bash
node component/example/serve.mjs      # http://127.0.0.1:5184/example/
```

Or with any static server, e.g. `npx serve` at the repo root.

## Rebuilding

`src/` here is the source of truth for both components. After any change
inside it, re-bundle `dist/`:

```bash
./build.sh          # or: npm run build
```

## Notes

- Bob injects one scoped stylesheet (`#bob-component-style`); Typebob injects
  its own (`#typebob-component-style`) with every rule under `.typebob-root`,
  so both keep their sizing inside any host page. Give Typebob's container a
  width and height (it scales with its own box).
- `data.json` is generated from the Figma exports with `python3 build.py --json`
  in the repo root.

## License

MIT. See [LICENSE](LICENSE).
