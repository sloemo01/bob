// src/index.js — the public surface: two drop-in components.
//
//   Bob      — 24 morphing faces, live eyes (the character alone)
//   Typebob  — the typing scene: bob types paragraphs and becomes the period
//
// Everything they need (Stage, the morph/clock/geom engine, data.json, the
// scoped styles) sits in this folder.
export { default as Bob } from "./components/Bob.jsx";
export { default as Typebob } from "./components/Typebob.jsx";
