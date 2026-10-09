# typebob

bob the typing character as a drop-in React component. He types a paragraph,
character by character, riding the write head and switching faces as the words
land; when the paragraph reaches its final period he gathers into it, every
shape morphing into a circle of the period's exact ink size, colour and
position. The text fades, the dot lifts off to the next paragraph's write
head, and blooms into the idle face.

Self-contained: the engine (`morph.js`, `clock.js`, `geom.js`), `Stage`,
`data.json` and the scoped stylesheet all live inside this folder.

Pull it into any React project (18 or 19):

```bash
npm install @sloemo/typebob
```

```jsx
import { Typebob } from "@sloemo/typebob";

function App() {
  return (
    <div style={{ width: "100%", height: 420 }}>
      <Typebob />
    </div>
  );
}
```

The container sizes the scene; give it a width and height (or let it fill a
positioned parent). All styles are scoped under `.typebob-root`, and sizes
ride container query units so the component scales with its own box.

## Your own paragraphs

```jsx
// strings: face parade is chosen automatically
<Typebob paragraphs={["first paragraph.", "second one."]} />

// or pin the faces (1-based face numbers, walked as the text types)
<Typebob
  paragraphs={[
    { text: "a quiet one.", faces: [2, 2, 10, 21, 1] },
    { text: "and a loud one.", faces: [2, 2, 13, 24, 1] },
  ]}
/>
```

A missing final "." is added for you: bob becomes that period, so every
paragraph ends with one. `cps` sets the typing speed (default 24 characters
per second).

## Props

| prop | default | meaning |
| --- | --- | --- |
| `paragraphs` | built-in demo set | `string` / `string[]` / `{ text, faces? }[]`, looped |
| `cps` | `24` | typing speed, characters per second |
| `body` | `"circle"` | starting body: `circle`, `cloud`, `square`, `hexagon`, `pebble`, `triangle`, `starburst`, `diamond`, `trigon`, `droplet`. Later changes morph. |
| `tour` | `true` | auto body tour: one step per `tourMs` until it lands back on the start body |
| `tourMs` | `2000` | ms per tour step |
| `paused` | `false` | freeze the scene (a virtual clock; resume continues it) |
| `showBar` | `true` | the bottom body bar with one swatch per body |
| `onParagraph` | none | `(index) => void` when a paragraph finishes |
| `className`, `style` | none | passed through to the wrapper |

## Ref handle

```jsx
const bob = useRef(null);
<Typebob ref={bob} />

bob.current.setBody("cloud");   // same list as the body prop
bob.current.snapshot();         // { phase, run, chars, faceIdx, body, paragraphs }
bob.current.paragraphs;         // paragraphs in the loop
```

## Run the example

`example/index.html` is a no-build page that loads React from a CDN and the
built `dist/bob.js` next to it. Serve over http (ES modules reject `file://`):

```bash
node typebob/component/example/serve.mjs      # http://127.0.0.1:5185/example/
```

## Rebuilding

`src/` here is the source of truth. After any change inside it, re-bundle
`dist/`:

```bash
./build.sh          # or: npm run build
```

## License

MIT. See [LICENSE](LICENSE).
