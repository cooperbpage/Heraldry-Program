import type { V } from '../geom/vec';
import type { Spine } from '../geom/bezier';

/** Which side of the strip, looking along its direction of travel (root to tip). */
export type Side = 'L' | 'R';

export interface WidthKnot {
  t: number;
  w: number;
}

interface EventBase {
  id: string;
  /** created by the composer; a manual edit clears this so Reseed keeps the event */
  gen?: boolean;
}

export interface ClusterEvent extends EventBase {
  kind: 'cluster';
  t0: number;
  t1: number;
  side: Side;
  /** lobe length relative to local strip width (1 = default) */
  size: number;
  /** recursion depth: 1 = lobes only, 2 = lobes split into leaflets, 3 = leaflets split again */
  depth: number;
  /** relative sizes of the parts a lobe splits into: first is the dominant tongue */
  split: number[];
  /** per-cluster variation seed */
  seed?: number;
}

export interface TurnoverEvent extends EventBase {
  kind: 'turnover';
  t: number;
  /** foreshortening span (normalised arc length) */
  length: number;
  /** the edge that rolls over and passes in front */
  edge: Side;
  /** crease obliquity in degrees (0 = straight across) */
  crease: number;
}

export interface BranchEvent extends EventBase {
  kind: 'branch';
  t: number;
  side: Side;
  /** departure angle from the parent's tangent, degrees, toward `side` */
  angle: number;
  rootWidth: number;
  crossing: 'behind' | 'front';
  child: Strip;
}

export interface VoluteEvent extends EventBase {
  kind: 'volute';
  t: number;
  /** eye centre in the same frame as the strip's spine */
  eye: V;
  eyeR: number;
  turns: number;
  /** +1 / -1: flipping mirrors the eye across the stem */
  hand: 1 | -1;
  mode: 'terminal' | 'branching';
  /** branching mode: width of the coil's root */
  width?: number;
  crossing?: 'behind' | 'front';
}

export type StripEvent = ClusterEvent | TurnoverEvent | BranchEvent | VoluteEvent;

export interface Strip {
  id: string;
  /**
   * Cubic Bézier spine, root to tip. Top-level strips use sheet coordinates. Branch children
   * use their attachment frame: origin at the attachment point, +x along the parent's tangent,
   * +y along the parent's left normal, so they follow the parent when it is reshaped.
   */
  spine: Spine;
  width: WidthKnot[];
  events: StripEvent[];
  /** draw order among top-level strips (higher = in front) */
  z?: number;
  /** id of the mirrored counterpart (mirroring is an editing constraint) */
  mirror?: string;
  mirrorBroken?: boolean;
  gen?: boolean;
  /** the authored sweep this strip came from in generative mode */
  sweep?: boolean;
}

export interface Settings {
  sharpness: number; // 0 rounded acanthus .. 1 pointed
  recurve: number; // 0 .. 1
  lobeDepth: number; // 0 .. 1
  frequency: number; // 0 .. 1 cluster frequency (composer)
  taper: number; // 0 .. 1
}

export interface RenderToggles {
  flat: boolean;
  outline: boolean;
  midrib: boolean;
  shading: boolean;
  hatching: boolean;
}

export interface Palette {
  outer: string;
  lining: string;
  ink: string;
  paper: string;
}

export interface Doc {
  version: 1;
  name: string;
  seed: number;
  settings: Settings;
  palette: Palette;
  strips: Strip[];
}

export const SHEET = { w: 1000, h: 1000, cx: 500 };
/** The fixed frame the mantling is composed around. */
export const FRAME = {
  helm: { x: 500, y: 400, w: 124, h: 150 },
  shield: { x: 390, y: 505, w: 220, h: 270 },
  /** strips should root near here (behind the helm) */
  anchor: [500, 392] as V,
};

export const defaultSettings = (): Settings => ({ sharpness: 0.55, recurve: 0.6, lobeDepth: 0.55, frequency: 0.5, taper: 0.5 });
export const defaultToggles = (): RenderToggles => ({ flat: true, outline: true, midrib: true, shading: true, hatching: false });
export const defaultPalette = (): Palette => ({ outer: '#b3202a', lining: '#efe7d6', ink: '#2a1a17', paper: '#fbf8f1' });

let idc = 0;
export const uid = (p = 'e') => `${p}${Date.now().toString(36)}${(idc++).toString(36)}`;
