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
  // broad white fans spreading sideways at mid-height, overlapping, tips split into pointed fingers
  const fanDirs: [number, number, number, number][] = [
    // angle(deg), length, width, bend
    [-44, 150, 34, -0.18],
    [-30, 178, 38, -0.14],
    [-16, 196, 38, -0.08],
    [-3, 200, 36, 0.0],
    [14, 180, 36, 0.08],
    [30, 160, 34, 0.14],
    [46, 135, 32, 0.2],
  ];
  for (const [deg, len, w, bend] of fanDirs) {
    const a = (deg * Math.PI) / 180;
    const o: V = [512, 418];
    const d: V = [Math.cos(a), Math.sin(a)];
    const nrm: V = [-d[1], d[0]];
    const p1: V = [o[0] + d[0] * len, o[1] + d[1] * len];
    const c1: V = [o[0] + d[0] * len * 0.35, o[1] + d[1] * len * 0.35];
    const c2: V = [o[0] + d[0] * len * 0.7 + nrm[0] * len * bend, o[1] + d[1] * len * 0.7 + nrm[1] * len * bend];
    fans.push(S([o, c1, c2, p1], W([0, w * 0.75], [0.35, w], [0.8, w * 0.95], [1, w * 0.7]), () => [
      fold(0.1, 'L', 0.08, 20),
      cl(0.7, 1, bend >= 0 ? 'L' : 'R', 0.6, 2, [1, 0.85, 0.7]),
      cl(0.8, 1, bend >= 0 ? 'R' : 'L', 0.45, 2, [1, 0.8]),
    ], -10));
  }
  // upper sweep: rises over the fans into a leafy top and an open, leafy curl
  const up: V[] = [[516, 388], [575, 350], [640, 300], [700, 294], [752, 290], [758, 342], [716, 352]];
  const upper = S(up, W([0, 16], [0.3, 25], [0.65, 24], [1, 18]), (sp) => [
    cl(0.12, 0.24, 'in', 0.8, 3, [1, 0.6, 0.4]),
    cl(0.12, 0.24, 'out', 0.7, 2, [1, 0.6, 0.4]),
    cl(0.32, 0.52, 'out', 1.3, 3, [1, 0.62, 0.45, 0.3]),
    cl(0.36, 0.5, 'in', 0.8, 3, [1, 0.6, 0.4]),
    vol(sp, 0.8, 15, 0.85),
    cl(0.82, 0.94, 'out', 1.0, 3, [1, 0.6, 0.4]),
  ], 2);
  // middle band: out across the fans, turning down at the right into the lower scroll's open eye
  const mid: V[] = [[516, 418], [600, 410], [690, 392], [738, 424], [776, 452], [756, 510], [704, 502]];
  const lowerBranch = S([[0, 0], [40, 10], [75, 26], [96, 56]], W([0, 15], [0.5, 18], [1, 12]), () => [
    cl(0.5, 1, 'L', 1.2, 3, [1, 0.6, 0.4, 0.25]),
    cl(0.6, 1, 'R', 0.8, 2, [1, 0.6, 0.4]),
  ]);
  const middle = S(mid, W([0, 17], [0.2, 26], [0.55, 25], [1, 19]), (sp) => [
    cl(0.16, 0.3, 'R', 1.0, 3, [1, 0.6, 0.4]),
    cl(0.16, 0.3, 'L', 0.8, 3, [1, 0.6, 0.4]),
    cl(0.42, 0.6, 'out', 1.35, 3, [1, 0.62, 0.42, 0.3]),
    cl(0.44, 0.58, 'in', 0.8, 2, [1, 0.6, 0.4]),
    br(0.64, 'L', 40, 14, lowerBranch),
    vol(sp, 0.8, 16, 0.95),
    cl(0.82, 0.94, 'out', 1.0, 3, [1, 0.6, 0.4]),
  ], 1);
  // broad lobed leaf lying across the lower fans just right of the helm
  const leafBand = S([[520, 446], [570, 442], [620, 455], [665, 468]], W([0, 22], [0.4, 30], [1, 18]), () => [
    cl(0.15, 0.42, 'L', 0.9, 3, [1, 0.7, 0.5, 0.3]),
    cl(0.2, 0.4, 'R', 0.6, 2, [1, 0.6]),
    cl(0.65, 0.95, 'L', 1.0, 3, [1, 0.65, 0.4]),
    cl(0.7, 0.95, 'R', 0.7, 2, [1, 0.6, 0.4]),
  ], 3);
  return finish('Garter', [...fans, middle, upper, leafBand], { ...defaultPalette(), outer: '#c4262a', lining: '#eeeae2' });
}

// ---------------------------------------------------------------------------
// Stirling: heavy upright red lobes rising from gathered grey cloth; grey curls at the top.
function stirling(): Doc {
  const pal = { ...defaultPalette(), outer: '#a3161c', lining: '#b8b3ab', paper: '#f1e9da' };
  const grey: Strip[] = [];
  // a gathered body of grey cloth behind the helm, rising into open curls at the top
  const g: [V[], number, number | null][] = [
    [[[508, 392], [520, 320], [540, 250], [592, 226], [632, 208], [628, 160], [596, 170]], 60, 0.8],
    [[[512, 398], [580, 340], [640, 270], [690, 262], [732, 256], [742, 214], [712, 206]], 62, 0.8],
    [[[514, 410], [600, 390], [660, 360], [700, 330]], 64, null],
    [[[514, 424], [590, 420], [640, 440], [680, 470]], 60, null],
    [[[512, 440], [560, 470], [600, 500], [620, 540]], 52, null],
  ];
  for (const [sp, w, vt] of g)
    grey.push(S(sp, W([0, w * 0.8], [0.35, w], [0.8, w * 0.8], [1, w * 0.55]), (s) => [
      fold(0.08, 'R', 0.08, 15),
      cl(0.55, 0.72, 'out', 0.6, 2, [1, 0.75, 0.55]),
      ...(vt ? [vol(s, vt, 12, 0.95)] : [cl(0.82, 1, 'out', 0.6, 2, [1, 0.75, 0.55])]),
    ], -10));
  // red stem rising close beside the helm, its lobes stacked upward
  const r1Sp: V[] = [[516, 384], [566, 350], [602, 300], [612, 234]];
  const r1 = S(r1Sp, W([0, 22], [0.3, 32], [0.7, 28], [1, 18]), () => [
    cl(0.3, 0.5, 'out', 1.1, 3, [1, 0.62, 0.45, 0.3]),
    cl(0.6, 0.74, 'in', 0.8, 2, [1, 0.6, 0.4]),
    cl(0.84, 1, 'out', 0.9, 3, [1, 0.6, 0.4]),
  ], 3);
  // the great upright mass at the right: out, then turning up with heavy stacked lobes
  const r2Sp: V[] = [[516, 404], [610, 408], [680, 392], [702, 340], [718, 300], [716, 260], [700, 228]];
  const r2 = S(r2Sp, W([0, 24], [0.3, 34], [0.7, 32], [1, 20]), () => [
    cl(0.2, 0.3, 'R', 0.8, 2, [1, 0.6, 0.4]),
    cl(0.44, 0.6, 'out', 1.2, 3, [1, 0.62, 0.45, 0.3]),
    cl(0.68, 0.8, 'in', 0.9, 3, [1, 0.6, 0.4]),
    cl(0.88, 1, 'out', 1.0, 3, [1, 0.6, 0.4]),
  ], 3);
  // lower hook descending beside the crown into a leafy scroll
  const lowSp: V[] = [[516, 438], [580, 452], [636, 462], [660, 506], [680, 548], [648, 580], [622, 556]];
  const low = S(lowSp, W([0, 22], [0.3, 32], [0.7, 30], [1, 22]), (sp) => [
    cl(0.3, 0.48, 'out', 1.0, 3, [1, 0.6, 0.4, 0.3]),
    vol(sp, 0.8, 12, 0.95),
    cl(0.83, 0.93, 'out', 0.7, 2, [1, 0.6, 0.4]),
  ], 2);
  return finish('Stirling', [...grey, r1, r2, low], pal);
}

const out = process.argv[2] || 'src/presets';
mkdirSync(out, { recursive: true });
for (const [name, d] of [['garter', garter()], ['stirling', stirling()]] as const) {
  writeFileSync(`${out}/${name}.json`, JSON.stringify(d, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v), 1));
  console.log('wrote', name);
}
