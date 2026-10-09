// Type definitions for the packed typebob component (dist/bob.js, dist/bob.cjs).
import * as React from "react";

export type TypebobBody =
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

export interface TypebobParagraph {
  /** The paragraph text. A missing final "." is added: bob becomes the period. */
  text: string;
  /** Face parade (1-based face numbers) walked while the text types. */
  faces?: number[];
}

export type TypebobParagraphs = string | string[] | TypebobParagraph[];

export interface TypebobSnapshot {
  /** "wake" | "idle" | "typing" | "dot" | "dothold" | "release" | "lift". */
  phase: string;
  /** Index of the running paragraph. */
  run: number;
  /** Characters revealed so far. */
  chars: number;
  /** 1-based face currently shown. */
  faceIdx: number;
  /** Current body key. */
  body: TypebobBody;
  /** Number of paragraphs in the loop. */
  paragraphs: number;
}

export interface TypebobHandle {
  /** Morph the body to another silhouette (same list as the `body` prop). */
  setBody(key: TypebobBody): void;
  /** The component's raw state snapshot. */
  snapshot(): TypebobSnapshot;
  /** Number of paragraphs in the loop. */
  readonly paragraphs: number;
}

export interface TypebobProps {
  /**
   * The paragraphs bob types, in a loop. Strings are shorthand for
   * `{ text }`. Default: the built-in demo set.
   */
  paragraphs?: TypebobParagraphs;
  /** Typing speed, characters per second. Default 24. */
  cps?: number;
  /** Starting body (real ring morph to change later). Default "circle". */
  body?: TypebobBody;
  /** Auto body tour: one step per `tourMs` until it lands back on start. Default true. */
  tour?: boolean;
  /** ms per tour step. Default 2000. */
  tourMs?: number;
  /** Freeze the scene (a virtual clock; resume continues it). */
  paused?: boolean;
  /** Show the bottom body bar. Default true. */
  showBar?: boolean;
  /** Fired when a paragraph finishes (the period lands). */
  onParagraph?: (index: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Typebob: React.ForwardRefExoticComponent<
  TypebobProps & React.RefAttributes<TypebobHandle>
>;
