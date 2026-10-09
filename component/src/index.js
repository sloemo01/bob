// src/index.js — the public surface: the drop-in component.
//
// Everything it needs (Stage, the morph/clock/geom engine, data.json) sits in
// this folder, so `import { Bob } from "<this folder>/src"` is enough.
export { default as Bob } from "./components/Bob.jsx";
