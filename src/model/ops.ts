import { V, add, mul, perp, sub, dot, norm, clamp } from '../geom/vec';
import { Spine, mirrorSpine } from '../geom/bezier';
import { trackFromSpine } from '../geom/track';
import type { Doc, Strip, StripEvent, ClusterEvent, WidthKnot, Side } from './types';
import { SHEET, uid, defaultSettings, defaultPalette } from './types';

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export function emptyDoc(name = 'Untitled'): Doc {
  return { version: 1, name, seed: 1, settings: defaultSettings(), palette: defaultPalette(), strips: [] };
}

/** A default width profile: narrow root, swell, long taper. */
export function defaultWidth(L: number): WidthKnot[] {
  const w = clamp(L * 0.09, 26, 40);
  return [
    { t: 0, w: w * 0.7 },
    { t: 0.2, w: w * 1.1 },
    { t: 0.45, w: w * 0.85 },
    { t: 0.7, w: w * 1.0 },
    { t: 1, w: w * 0.7 },
  ];
}

export function newStrip(spine: Spine, width?: WidthKnot[]): Strip {
  const L = trackFromSpine(spine).L;
  return { id: uid('s'), spine, width: width ?? defaultWidth(L), events: [] };
}

/** Eye position for a new volute: on the concave side of the stem at arc fraction t. */
export function defaultEye(spine: Spine, t: number, eyeR: number, turns = 1.3): V {
  const tr = trackFromSpine(spine);
  const a = tr.at(t * tr.L);
  // look ahead for the turning direction
  const ahead = tr.at(Math.min(tr.L, t * tr.L + tr.L * 0.1));
  let k = a.k + ahead.k;
  if (Math.abs(k) < 1e-5) k = 1;
  const N = mul(perp([a.tx, a.ty]), Math.sign(k));
  const r0 = eyeR * (2.6 + turns * 0.9);
  // place it a little ahead so entry is a gentle turn in
  return add(add([a.x, a.y], mul(N, r0)), mul([a.tx, a.ty], r0 * 0.25));
}

export function flipSide(s: Side): Side {
  return s === 'L' ? 'R' : 'L';
}

/** Deep-mirror a strip about the sheet centre: positions reflect, sides and handedness swap. */
export function mirrorStrip(s: Strip, keepIds = false, topLevel = true): Strip {
  const m = clone(s);
  const cx = SHEET.cx;
  const mx = (p: V): V => (topLevel ? [2 * cx - p[0], p[1]] : [p[0], -p[1]]);
  m.spine = topLevel ? mirrorSpine(m.spine, cx) : m.spine.map((p) => [p[0], -p[1]] as V);
  if (!keepIds) m.id = uid('s');
  m.events = m.events.map((e) => mirrorEvent(e, mx, keepIds));
  return m;
}

function mirrorEvent(e: StripEvent, mx: (p: V) => V, keepIds: boolean): StripEvent {
  const id = keepIds ? e.id : uid('e');
  switch (e.kind) {
    case 'cluster':
      return { ...e, id, side: flipSide(e.side) };
    case 'turnover':
      return { ...e, id, edge: flipSide(e.edge) };
    case 'branch':
      return { ...e, id, side: flipSide(e.side), child: mirrorStrip(e.child, keepIds, false) };
    case 'volute':
      return { ...e, id, eye: mx(e.eye), hand: (e.hand * -1) as 1 | -1 };
    case 'roll':
      return { ...e, id, side: flipSide(e.side) };
  }
}

/** Fraction of a strip's arc length outside every cluster interval (both sides merged). */
export function bareFraction(s: Strip): number {
  const iv = s.events
    .filter((e): e is ClusterEvent => e.kind === 'cluster')
    .map((e) => [clamp(Math.min(e.t0, e.t1), 0, 1), clamp(Math.max(e.t0, e.t1), 0, 1)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let covered = 0, end = -1, start = -1;
  for (const [a, b] of iv) {
    if (a > end) {
      if (end > start) covered += end - start;
      start = a;
      end = b;
    } else end = Math.max(end, b);
  }
  if (end > start) covered += end - start;
  // terminal volute truncates the authored spine; clusters past it are not drawn
  return clamp(1 - covered, 0, 1);
}

/** Visit every strip in the doc (including branch children). */
export function walkStrips(doc: Doc, fn: (s: Strip, parent: Strip | null) => void) {
  const rec = (s: Strip, p: Strip | null) => {
    fn(s, p);
    for (const e of s.events) if (e.kind === 'branch') rec(e.child, s);
  };
  for (const s of doc.strips) rec(s, null);
}

export function findStrip(doc: Doc, id: string): { strip: Strip; parent: Strip | null } | null {
  let out: { strip: Strip; parent: Strip | null } | null = null;
  walkStrips(doc, (s, p) => {
    if (s.id === id) out = { strip: s, parent: p };
  });
  return out;
}

/** Re-derive a mirrored partner from its source (mirroring as an editing constraint). */
export function syncMirror(doc: Doc, sourceId: string) {
  const src = doc.strips.find((s) => s.id === sourceId);
  if (!src || !src.mirror || src.mirrorBroken) return;
  const idx = doc.strips.findIndex((s) => s.id === src.mirror);
  if (idx < 0) return;
  const partner = doc.strips[idx];
  if (partner.mirrorBroken) return;
  const m = mirrorStrip(src, true);
  m.id = partner.id;
  m.mirror = src.id;
  m.z = partner.z;
  m.mirrorBroken = false;
  // give mirrored events their own ids (stable by suffix)
  const reid = (s: Strip) => {
    for (const e of s.events) {
      e.id = e.id.endsWith('~') ? e.id.slice(0, -1) : e.id + '~';
      if (e.kind === 'branch') {
        e.child.id = e.child.id.endsWith('~') ? e.child.id.slice(0, -1) : e.child.id + '~';
        reid(e.child);
      }
    }
  };
  reid(m);
  doc.strips[idx] = m;
}

/** Add a strip and, when mirroring is on, its mirrored partner. */
export function addStrip(doc: Doc, s: Strip, mirror: boolean) {
  doc.strips.push(s);
  if (mirror) {
    const m = mirrorStrip(s, true);
    m.id = s.id + '~';
    m.mirror = s.id;
    s.mirror = m.id;
    const reid = (x: Strip) => {
      for (const e of x.events) {
        e.id += '~';
        if (e.kind === 'branch') {
          e.child.id += '~';
          reid(e.child);
        }
      }
    };
    reid(m);
    doc.strips.push(m);
  }
}

export function sideOfPoint(spine: Spine, t: number, q: V): Side {
  const tr = trackFromSpine(spine);
  const a = tr.at(t * tr.L);
  return dot(sub(q, [a.x, a.y]), perp([a.tx, a.ty])) >= 0 ? 'L' : 'R';
}

export { norm };

/** The convex (outer) side of a spine over [t0, t1]: foliage normally bursts outward. */
export function outerSide(spine: Spine, t0: number, t1: number): Side {
  const tr = trackFromSpine(spine);
  let k = 0;
  for (let i = 0; i <= 10; i++) k += tr.at(tr.L * (t0 + ((t1 - t0) * i) / 10)).k;
  // positive curvature turns toward L, so L is concave
  return k > 0 ? 'R' : 'L';
}
