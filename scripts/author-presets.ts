/**
 * Hand-authored presets. Only the viewer's right half is written here; the left half is its
 * mirror image, stored as independent strips linked by `mirror` (so either side can be broken
 * and edited on its own). Run: npm run presets
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import type { Doc, Strip, StripEvent, WidthKnot, Side } from '../src/model/types';
import { defaultSettings, defaultPalette } from '../src/model/types';
import { addStrip, defaultEye, outerSide } from '../src/model/ops';
import type { V } from '../src/geom/vec';

let n = 0;
const id = (p: string) => `${p}${++n}`;
const W = (...xs: [number, number][]): WidthKnot[] => xs.map(([t, w]) => ({ t, w }));
const cl = (t0: number, t1: number, side: Side | 'out' | 'in', size = 1, depth = 2, split = [1, 0.6, 0.4]): StripEvent => ({ kind: 'cluster', id: id('c'), t0, t1, side: side as Side, size, depth, split });
/** resolve 'out'/'in' cluster sides against the spine */
function resolve(spine: V[], evs: StripEvent[]) {
  for (const e of evs) if (e.kind === 'cluster' && ((e.side as string) === 'out' || (e.side as string) === 'in')) {
    const o = outerSide(spine, e.t0, e.t1);
    e.side = (e.side as string) === 'out' ? o : o === 'L' ? 'R' : 'L';
  }
  return evs;
}
const fold = (t: number, edge: Side, length = 0.1, crease = 35): StripEvent => ({ kind: 'turnover', id: id('f'), t, length, edge, crease });
const vol = (spine: V[], t: number, eyeR: number, turns = 1.3, eye?: V): StripEvent => ({ kind: 'volute', id: id('v'), t, eye: eye ?? defaultEye(spine, t, eyeR, turns), eyeR, turns, hand: 1, mode: 'terminal' });
const br = (t: number, side: Side, angle: number, rootWidth: number, child: Strip, crossing: 'behind' | 'front' = 'behind'): StripEvent => ({ kind: 'branch', id: id('b'), t, side, angle, rootWidth, crossing, child });
function S(spine: V[], width: WidthKnot[], events: (spine: V[]) => StripEvent[], z = 0): Strip {
  return { id: id('s'), spine, width, events: resolve(spine, events(spine)), z };
}

function finish(name: string, strips: Strip[], palette = defaultPalette(), settings = defaultSettings()): Doc {
  const doc: Doc = { version: 1, name, seed: 1, settings, palette, strips: [] };
  for (const s of strips) addStrip(doc, s, true);
  return doc;
}

// ---------------------------------------------------------------------------
// Garter: red acanthus over layered white fans; broad red bands, open red scroll eyes.
function garter(): Doc {
  const fans: Strip[] = [];
  // short, dense white fans layered close beside the helm, serrated along their length
  const fanDirs: [number, number, number, number, number][] = [
    // angle(deg), length, width, bend, root dy
    [-78, 120, 34, -0.2, -10],
    [-62, 150, 38, -0.18, -8],
    [-46, 170, 40, -0.14, -4],
    [-30, 180, 42, -0.1, 0],
    [-14, 185, 42, -0.05, 4],
    [2, 180, 40, 0.02, 8],
    [18, 170, 40, 0.08, 12],
    [34, 155, 38, 0.14, 16],
    [50, 135, 34, 0.2, 20],
  ];
  for (const [deg, len, w, bend, dy] of fanDirs) {
    const a = (deg * Math.PI) / 180;
    const o: V = [514, 410 + dy];
    const d: V = [Math.cos(a), Math.sin(a)];
    const nrm: V = [-d[1], d[0]];
    const p1: V = [o[0] + d[0] * len, o[1] + d[1] * len];
    const c1: V = [o[0] + d[0] * len * 0.35, o[1] + d[1] * len * 0.35];
    const c2: V = [o[0] + d[0] * len * 0.7 + nrm[0] * len * bend, o[1] + d[1] * len * 0.7 + nrm[1] * len * bend];
    const sa: Side = bend >= 0 ? 'L' : 'R', sb: Side = bend >= 0 ? 'R' : 'L';
    fans.push(S([o, c1, c2, p1], W([0, w * 0.7], [0.35, w], [0.8, w * 0.95], [1, w * 0.75]), () => [
      fold(0.06, 'L', 0.06, 20),
      cl(0.36, 0.5, sa, 0.45, 2, [1, 0.8]),
      cl(0.38, 0.5, sb, 0.35, 2, [1, 0.8]),
      cl(0.66, 1, sa, 0.55, 2, [1, 0.85, 0.7]),
      cl(0.74, 1, sb, 0.45, 2, [1, 0.8]),
    ], -10));
  }
  // upper band: climbs from the helm in an S to a tall open red volute at the top corner,
  // its outer edge throwing off forward-hooking lobes
  const up: V[] = [[516, 392], [570, 372], [600, 330], [620, 290], [640, 246], [692, 214], [736, 236], [770, 254], [764, 304], [724, 300]];
  const upper = S(up, W([0, 20], [0.2, 32], [0.4, 26], [0.62, 32], [1, 24]), (sp) => [
    cl(0.1, 0.2, 'out', 0.8, 3, [1, 0.6, 0.4]),
    cl(0.3, 0.44, 'out', 1.15, 3, [1, 0.62, 0.45, 0.3]),
    cl(0.32, 0.42, 'in', 0.6, 2, [1, 0.6]),
    cl(0.54, 0.66, 'out', 1.1, 3, [1, 0.62, 0.45, 0.3]),
    vol(sp, 0.8, 18, 0.85),
    cl(0.82, 0.92, 'out', 0.85, 3, [1, 0.6, 0.4]),
  ], 2);
  // lower band: out across the fans, then dropping beside the shield into an open red volute
  const mid: V[] = [[516, 422], [600, 424], [680, 416], [730, 444], [778, 472], [790, 530], [756, 556], [722, 580], [690, 548], [714, 528]];
  const middle = S(mid, W([0, 22], [0.15, 34], [0.35, 26], [0.6, 32], [1, 22]), (sp) => [
    cl(0.08, 0.22, 'L', 0.9, 3, [1, 0.7, 0.5, 0.3]),
    cl(0.1, 0.2, 'R', 0.55, 2, [1, 0.6]),
    cl(0.36, 0.5, 'out', 1.2, 3, [1, 0.62, 0.42, 0.3]),
    cl(0.58, 0.7, 'out', 1.0, 3, [1, 0.6, 0.4]),
    vol(sp, 0.84, 17, 0.9),
    cl(0.86, 0.95, 'out', 0.8, 2, [1, 0.6, 0.4]),
  ], 1);
  return finish('Garter', [...fans, middle, upper], { ...defaultPalette(), outer: '#c4262a', lining: '#eeeae2' });
}

// ---------------------------------------------------------------------------
// Stirling: heavy upright red lobes rising from gathered grey cloth; grey curls at the top.
function stirling(): Doc {
  const pal = { ...defaultPalette(), outer: '#a3161c', lining: '#a8a29a', paper: '#f1e9da' };
  const strips: Strip[] = [];
  // dense grey cloth gathered at the helm's base and shoulders: short, broad, overlapping folds
  const gathered: [number, number, number][] = [
    // angle, length, width
    [-74, 170, 60], [-56, 200, 66], [-38, 215, 68], [-20, 220, 68], [-2, 215, 66], [16, 200, 64], [34, 180, 60], [52, 160, 56], [70, 140, 50],
  ];
  for (const [deg, len, w] of gathered) {
    const a = (deg * Math.PI) / 180;
    const o: V = [516, 430];
    const d: V = [Math.cos(a), Math.sin(a)];
    const nrm: V = [-d[1], d[0]];
    const p1: V = [o[0] + d[0] * len, o[1] + d[1] * len];
    strips.push(S([o, [o[0] + d[0] * len * 0.35, o[1] + d[1] * len * 0.35], [p1[0] - d[0] * len * 0.3 + nrm[0] * 12, p1[1] - d[1] * len * 0.3 + nrm[1] * 12], p1], W([0, w * 0.85], [0.5, w], [1, w * 0.6]), () => [
      fold(0.06, 'R', 0.06, 10),
      cl(0.76, 1, 'L', 0.5, 2, [1, 0.8, 0.6]),
    ], -12));
  }
  // paler grey rising behind the red into small loose turnovers at the top corners
  const curls: [V[], number][] = [
    [[[510, 392], [528, 320], [556, 250], [598, 230], [632, 214], [632, 182], [606, 186]], 40],
    [[[514, 400], [590, 340], [650, 286], [700, 274], [736, 266], [744, 236], [720, 232]], 42],
  ];
  for (const [sp, w] of curls)
    strips.push(S(sp, W([0, w * 0.8], [0.35, w], [0.8, w * 0.8], [1, w * 0.55]), (s) => [
      fold(0.08, 'R', 0.08, 15),
      cl(0.55, 0.72, 'out', 0.45, 2, [1, 0.75, 0.55]),
      vol(s, 0.84, 8, 0.7),
    ], -10));
  // red stem rising close beside the helm, its heavy lobes stacked upward
  const r1Sp: V[] = [[516, 388], [566, 350], [602, 300], [612, 230]];
  strips.push(S(r1Sp, W([0, 22], [0.3, 34], [0.7, 30], [1, 20]), () => [
    cl(0.3, 0.5, 'out', 0.83, 3, [1, 0.62, 0.45, 0.3]),
    cl(0.6, 0.74, 'in', 0.6, 2, [1, 0.6, 0.4]),
    cl(0.84, 1, 'out', 0.75, 3, [1, 0.6, 0.4]),
  ], 3));
  // the outer upright mass: rises at once, heavy clustered lobes making a rounded, lobed edge
  const r2Sp: V[] = [[520, 408], [600, 400], [650, 380], [670, 330], [688, 280], [700, 250], [690, 214]];
  strips.push(S(r2Sp, W([0, 24], [0.3, 34], [0.7, 32], [1, 20]), () => [
    cl(0.3, 0.46, 'out', 0.83, 3, [1, 0.62, 0.45, 0.3]),
    cl(0.56, 0.72, 'out', 0.9, 3, [1, 0.62, 0.45, 0.3]),
    cl(0.6, 0.7, 'in', 0.52, 2, [1, 0.6, 0.4]),
    cl(0.86, 1, 'out', 0.75, 3, [1, 0.6, 0.4]),
  ], 3));
  // lower: a short C-scroll beside the gathered cloth, with a leaf cluster
  const lowSp: V[] = [[520, 446], [584, 450], [630, 470], [648, 506], [662, 536], [636, 562], [614, 542]];
  strips.push(S(lowSp, W([0, 22], [0.3, 32], [0.7, 30], [1, 22]), (sp) => [
    cl(0.28, 0.48, 'out', 0.83, 3, [1, 0.6, 0.4, 0.3]),
    vol(sp, 0.8, 10, 0.85),
  ], 2));
  return finish('Stirling', strips, pal);
}

const out = process.argv[2] || 'src/presets';
mkdirSync(out, { recursive: true });
for (const [name, d] of [['garter', garter()], ['stirling', stirling()]] as const) {
  writeFileSync(`${out}/${name}.json`, JSON.stringify(d, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v), 1));
  console.log('wrote', name);
}
