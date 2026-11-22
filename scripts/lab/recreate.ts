// Recreations of single plumes from the references, authored with the program's own data model.
import { writeFileSync, readFileSync } from 'node:fs';
import { emptyDoc, defaultEye } from '../../src/model/ops';
import { fitSpine, filterGesture } from '../../src/geom/bezier';
import { trackFromSpine } from '../../src/geom/track';
import { renderSVG } from '../../src/render/svg';
import { defaultToggles } from '../../src/model/types';
import type { Doc, Strip, StripEvent } from '../../src/model/types';
import type { V } from '../../src/geom/vec';
const out = process.argv[2];
const which = process.argv[3] || 'all';

// Blue lion (1562), upper-left plume. Reference pixels (original image) map to the sheet by
// X = 500 + (x - 135) * 3, Y = 500 + (y - 150) * 3.
/** Fit a smooth spine through traced points, as the Sweep tool fits a drawn gesture. */
export function traced(pts: V[], err = 3): V[] {
  const dense: V[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < 10; k++) {
      const t = k / 10, t2 = t * t, t3 = t2 * t;
      dense.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)) as V);
    }
  }
  dense.push(pts[pts.length - 1]);
  return fitSpine(filterGesture(dense, 3, 1.5), err);
}
/** Express a traced branch (sheet coords) in its parent's attachment frame at arc fraction t. */
export function local(parent: V[], t: number, world: V[]): { pts: V[]; t: number } {
  const tr = trackFromSpine(parent);
  // attach where the parent passes closest to the branch's first point
  let bi = 0, bd = Infinity;
  for (let i = 0; i < tr.n; i++) {
    const d = (tr.x[i] - world[0][0]) ** 2 + (tr.y[i] - world[0][1]) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  const tt = t >= 0 ? t : tr.s[bi] / tr.L;
  const a = tr.at(tt * tr.L);
  const ex: V = [a.tx, a.ty], ey: V = [-a.ty, a.tx];
  const o: V = world[0];
  const pts = world.map((p) => [(p[0] - o[0]) * ex[0] + (p[1] - o[1]) * ex[1], (p[0] - o[0]) * ey[0] + (p[1] - o[1]) * ey[1]] as V);
  // departure angle and side, read from the traced branch itself
  const k = Math.min(pts.length - 1, 1);
  const ang = (Math.atan2(pts[k][1], pts[k][0]) * 180) / Math.PI;
  return { pts, t: tt, angle: Math.abs(ang), side: (ang >= 0 ? 'L' : 'R') as 'L' | 'R' };
}

export function blueLionUpperLeft(): Doc {
  const d = emptyDoc('Blue lion 1562 · upper-left plume');
  d.palette = { outer: '#d42a26', lining: '#d9a640', ink: '#3a2516', paper: '#f6efdc' };
  d.settings = { sharpness: 0.5, recurve: 0.55, lobeDepth: 0.6, frequency: 0.5, taper: 0.45 };
  // traced on a 4x crop of the reference (crop px -> original = (px/4, 50 + py/4)), then to the sheet
  const M = (pts: V[]) => pts.map(([x, y]) => [500 + (x / 4 - 135) * 3, 500 + (50 + y / 4 - 150) * 3] as V);
  // the stem runs diagonally up and left from the helm into a leafy gold scroll at the top-left
  const stem = traced(M([[450, 510], [400, 470], [345, 430], [295, 385], [258, 335], [236, 290], [210, 258], [170, 240], [135, 248], [120, 272], [136, 290], [156, 280]]));
  const br = (pts: V[], width: [number, number][], events: StripEvent[]) => {
    const l = local(stem, -1, M(pts));
    return { t: l.t, angle: l.angle, side: l.side, child: { id: 'b' + Math.round(l.t * 1000), spine: traced(l.pts), width: width.map(([t, w]) => ({ t, w })), events } as Strip };
  };
  // the middle frond reaches left and ends in a hanging gold curl
  const mid = br([[300, 425], [250, 422], [196, 414], [146, 404], [104, 398], [80, 412], [88, 432], [108, 424]], [[0, 26], [0.5, 22], [1, 14]], [
    { kind: 'cluster', id: 'm1', t0: 0.1, t1: 0.45, side: 'L', size: 1.1, depth: 2, split: [1, 0.6], curl: 0.3, roll: 0.3 },
    { kind: 'cluster', id: 'm2', t0: 0.12, t1: 0.4, side: 'R', size: 0.9, depth: 2, split: [1, 0.6], curl: 0.4 },
    { kind: 'turnover', id: 'mt', t: 0.66, length: 0.22, edge: 'L', crease: 0 },
  ]);
  // the long lower tongue trails left along the bottom
  const low = br([[420, 500], [360, 522], [290, 532], [220, 526], [160, 512], [118, 492]], [[0, 26], [0.5, 22], [1, 12]], [
    { kind: 'cluster', id: 'l1', t0: 0.2, t1: 0.55, side: 'L', size: 1.2, depth: 2, split: [1, 0.6], curl: 0.5 },
    { kind: 'cluster', id: 'l2', t0: 0.6, t1: 0.9, side: 'R', size: 0.9, depth: 2, split: [1, 0.6], curl: 0.6 },
  ]);
  // a branch to the upper right with a turned-over gold edge, ending in a curled gold tip
  const up = br([[262, 352], [292, 340], [318, 330], [338, 314], [348, 296], [338, 284]], [[0, 18], [0.5, 16], [1, 10]], [
    { kind: 'roll', id: 'ur', t0: 0.05, t1: 0.7, side: 'L', amount: 0.55 },
    { kind: 'turnover', id: 'ut', t: 0.72, length: 0.3, edge: 'L', crease: 0 },
  ]);
  d.strips.push({
    id: 'bl',
    spine: stem,
    width: [{ t: 0, w: 30 }, { t: 0.3, w: 34 }, { t: 0.6, w: 28 }, { t: 1, w: 18 }],
    events: [
      { kind: 'branch', id: 'bm', t: mid.t, side: mid.side, angle: mid.angle, rootWidth: 22, crossing: 'behind', child: mid.child },
      { kind: 'branch', id: 'bl', t: low.t, side: low.side, angle: low.angle, rootWidth: 22, crossing: 'behind', child: low.child },
      { kind: 'branch', id: 'bu', t: up.t, side: up.side, angle: up.angle, rootWidth: 16, crossing: 'behind', child: up.child },
      // big fronds off the lower-left side of the stem
      { kind: 'cluster', id: 'c1', t0: 0.24, t1: 0.46, side: 'R', size: 1.3, depth: 2, split: [1, 0.6], curl: 0.4, roll: 0.3 },
      { kind: 'cluster', id: 'c2', t0: 0.5, t1: 0.62, side: 'L', size: 0.9, depth: 2, split: [1, 0.6], curl: 0.3 },
      // into the gold scroll at the top-left, with a red flick rising out of it
      { kind: 'turnover', id: 't1', t: 0.7, length: 0.16, edge: 'R', crease: 0 },
      { kind: 'cluster', id: 'c3', t0: 0.74, t1: 0.84, side: 'L', size: 1.0, depth: 2, split: [1, 0.6], curl: 1 },
    ],
  });
  return d;
}

// Saint Larry, right side, the middle plume: out from the helm along a band with lobes on its upper
// edge and a silver lining showing along its underside, then rolling round into a large open scroll.
// Traced on a 3x crop (crop px -> original = (px/3 + 220, py/3 + 50)).
export function saintLarryScroll(): Doc {
  const d = emptyDoc('Saint Larry · right middle plume');
  d.palette = { outer: '#2f6cc0', lining: '#a9aba8', ink: '#22303f', paper: '#f5f0e2' };
  d.settings = { sharpness: 0.55, recurve: 0.6, lobeDepth: 0.55, frequency: 0.5, taper: 0.4 };
  // traced on the comparison panel (panel px -> original = (215 + px/4.48, 95 + py/4.48))
  const M = (pts: V[]) => pts.map(([x, y]) => [520 + (x / 4.48 - 10) * 2.6, 380 + (95 + y / 4.48 - 160) * 2.6] as V);
  const stem = traced(M([[15, 258], [135, 226], [265, 178], [385, 136], [485, 146], [580, 190], [630, 260], [640, 338], [590, 420], [490, 465], [400, 440], [356, 360], [392, 290], [470, 278], [512, 318], [500, 356]]));
  d.strips.push({
    id: 'sl',
    spine: stem,
    width: [{ t: 0, w: 24 }, { t: 0.25, w: 28 }, { t: 0.55, w: 24 }, { t: 0.85, w: 16 }, { t: 1, w: 10 }],
    events: [
      // lobes on the upper edge of the rising band, tips curling over
      { kind: 'cluster', id: 'c1', t0: 0.04, t1: 0.3, side: 'R', size: 1.1, depth: 3, split: [1, 0.7, 0.5, 0.35], curl: 0.5, roll: 0.5 },
      // the lining shows along the underside: lobes turned over, and a rolled edge
      { kind: 'cluster', id: 'c0', t0: 0.06, t1: 0.26, side: 'L', size: 0.8, depth: 2, split: [1, 0.7, 0.5], curl: 1, roll: 0.8 },
      { kind: 'roll', id: 'r1', t0: 0.04, t1: 0.36, side: 'L', amount: 0.5 },
      // the outer rim of the scroll rolls over to show a crescent of lining
      { kind: 'roll', id: 'r2', t0: 0.42, t1: 0.7, side: 'R', amount: 0.5 },
      // lobes inside the ring, curling toward the eye
      { kind: 'cluster', id: 'c3', t0: 0.62, t1: 0.82, side: 'L', size: 0.8, depth: 2, split: [1, 0.6, 0.4], curl: 0.4 },
    ],
  });
  return d;
}

export const docs: Record<string, Doc> = { bluelion: blueLionUpperLeft(), saintlarry: saintLarryScroll() };
if (out) for (const [k, d] of Object.entries(docs)) if (which === 'all' || which === k) writeFileSync(`${out}/${k}.svg`, renderSVG(d, { toggles: defaultToggles(), noFrame: true }).svg);
void readFileSync;
void defaultEye;
