// typebob stylesheet, injected once per document by the component.
//
// Every selector is scoped under .typebob-root so the component can drop into
// any host page without leaking styles. Sizes ride container query units
// (cqmin) so the scene scales with the component's own box, not the viewport;
// the vmin declarations stay in front as the fallback for engines without
// container units.
export const TYPEOB_CSS = `
.typebob-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 220px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  container-type: size;
  --glow-rgb: 242 242 242;
}

/* the line: every character occupies its final slot from the first frame
   (invisible), so the centred layout NEVER reflows as characters arrive */
.typebob-root #line {
  position: relative;
  max-width: min(84%, 780px);
  color: #f2f2f2;
  font: 400 clamp(17px, 3.1vmin, 30px)/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, sans-serif;
  font-size: clamp(17px, 3.1cqmin, 30px);
  letter-spacing: 0.005em;
  white-space: pre-wrap;
  text-align: center;
  transition: opacity 0.34s ease;
}
.typebob-root[data-phase="release"] #line { opacity: 0; }
.typebob-root[data-phase="wake"] #line .ch,
.typebob-root[data-phase="lift"] #line .ch { opacity: 0; transition: none; }

.typebob-root #line .ch { opacity: 0; transition: opacity 0.11s ease; }
.typebob-root #line .ch.on { opacity: 1; }

/* zero-height baseline marker: its bottom edge rides the text baseline */
.typebob-root #blm { display: inline-block; width: 0; height: 0; vertical-align: baseline; }

/* the blinking write cursor, glided every frame */
.typebob-root #caret {
  position: absolute; left: 0; top: 0;
  width: max(2px, 0.07em); height: 1.1em;
  opacity: 0; transition: opacity 0.18s ease;
  will-change: transform;
  pointer-events: none;
}
.typebob-root #caret.on { opacity: 1; }
.typebob-root #caret i { display: block; width: 100%; height: 100%; background: #f2f2f2; }
.typebob-root #caret.on i { filter: drop-shadow(0 0 0.06em rgb(var(--glow-rgb) / 0.7)); }

/* hot ink: every character that lands flashes a glow and cools to plain */
.typebob-root #line .ch.on {
  opacity: 1;
  animation: typebob-ink-cool 1600ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
}
@keyframes typebob-ink-cool {
  0%   { text-shadow: 0 0 18px rgb(var(--glow-rgb) / 0.95), 0 0 7px rgb(255 255 255 / 0.6), 0 0 2px rgb(255 255 255 / 0.85); }
  30%  { text-shadow: 0 0 14px rgb(var(--glow-rgb) / 0.6), 0 0 5px rgb(255 255 255 / 0.35); }
  65%  { text-shadow: 0 0 10px rgb(var(--glow-rgb) / 0.24), 0 0 3px rgb(255 255 255 / 0.12); }
  100% { text-shadow: 0 0 8px rgb(var(--glow-rgb) / 0), 0 0 2px rgb(var(--glow-rgb) / 0); }
}

/* the cast glow: a soft slab of light to the caret's LEFT */
.typebob-root #glow {
  position: absolute; left: 0; top: 0;
  width: 34px; height: 44px;
  background: radial-gradient(ellipse 100% 100% at 100% 50%,
    rgb(var(--glow-rgb) / 0.60) 0%,
    rgb(var(--glow-rgb) / 0.22) 40%,
    rgb(var(--glow-rgb) / 0.06) 68%,
    rgb(var(--glow-rgb) / 0) 92%);
  mix-blend-mode: screen;
  opacity: 0;
  transition: opacity 0.16s ease;
  pointer-events: none;
  will-change: transform, width, height, filter;
}
.typebob-root #glow.on { opacity: 1; }

/* bob: small, sized with the text, placed every frame as a centre point */
.typebob-root #bob {
  position: absolute; left: 0; top: 0;
  width: clamp(26px, 4.6vmin, 44px);
  width: clamp(26px, 4.6cqmin, 44px);
  aspect-ratio: 1 / 1;
  will-change: transform;
  pointer-events: none;
  transform: translate(-9999px, -9999px) translate(-50%, -50%);
}
.typebob-root #bob svg { width: 100%; height: 100%; display: block; }
.typebob-root #bob * { user-select: none; -webkit-user-select: none; }

/* the body bar: one swatch per body, bottom-centre */
.typebob-root #bar {
  position: absolute;
  left: 50%; bottom: 18px;
  transform: translateX(-50%);
  display: flex; gap: 8px;
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  z-index: 5;
}
.typebob-root #bar .bod {
  width: 22px; height: 22px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.18);
  background: var(--f, #d9d9d9);
  padding: 0; margin: 0;
  cursor: pointer;
  outline: none;
  transition: transform 0.14s ease, box-shadow 0.14s ease;
}
.typebob-root #bar .bod:hover { transform: scale(1.12); }
.typebob-root #bar .bod.on {
  box-shadow: 0 0 0 2px #0e0e11, 0 0 0 3.5px rgba(255,255,255,0.85);
}
`;
