// Type definitions for the packed bob component (dist/bob.js, dist/bob.cjs).
import * as React from "react";

export type BobBody =
  | "circle"
  | "cloud"
  | "square"
  | "hexagon"
  | "pebble"
  | "triangle"
  | "starburst"
  | "diamond"
  | "trigon"
  | "droplet";

export interface BobSnapshot {
  /** 0-based index of the resting face. */
  i: number;
  /** "hold" or "morph". */
  phase: string;
  [key: string]: unknown;
}

export interface BobHandle {
  /** Morph from wherever the face is to face n (1-based, 1..24). Ignored mid-morph. */
  goto(n: number): void;
  /** Step one face forward (dir 1) or back (dir -1). */
  advance(dir: number): void;
  /** Toggle play/pause. While paused, a goto switches instantly. */
  toggle(): void;
  /** Point the eyes at a normalized coordinate (-1..1 on both axes). */
  setCursor(x: number, y: number): void;
  /** The engine's raw state snapshot. */
  snapshot(): BobSnapshot;
  /** Total faces (24). */
  readonly faces: number;
}

export interface BobProps {
  /** px width of the rendered bob (the SVG scales to it). Default 320. */
  size?: number;
  /** Start face, 1-based (1..24). Default 1. Read at mount. */
  face?: number;
  /** Restrict the auto-cycle to a subset, e.g. "2,3,5". */
  only?: string;
  /** ms each face holds before morphing (0 = engine default). */
  hold?: number;
  /** true = don't auto-cycle; drive it through the ref instead. */
  drive?: boolean;
  /** Starting body; later changes are real morphs. Default "circle". */
  body?: BobBody;
  /** Freeze the animation. */
  paused?: boolean;
  /** Eyes follow the pointer across the element. Default true. */
  lookAtCursor?: boolean;
  /** Fired whenever the resting face changes. */
  onFace?: (index: number, total: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Bob: React.ForwardRefExoticComponent<
  BobProps & React.RefAttributes<BobHandle>
>;
