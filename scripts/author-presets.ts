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
  // white flutes radiating from behind the helm (lining up after a hidden turnover at the root)
  const fanDirs: [number, number, number, number][] = [
    // angle(deg), length, width, bend
    [-64, 120, 20, -0.25],
    [-46, 150, 22, -0.22],
    [-28, 175, 24, -0.15],
    [-10, 185, 24, -0.08],
    [10, 175, 22, 0.08],
    [30, 160, 22, 0.16],
    [50, 140, 20, 0.24],
    [68, 110, 18, 0.3],
  ];
  for (const [deg, len, w, bend] of fanDirs) {
    const a = (deg * Math.PI) / 180;
    const o: V = [512, 404];
    const d: V = [Math.cos(a), Math.sin(a)];
    const nrm: V = [-d[1], d[0]];
    const p1: V = [o[0] + d[0] * len, o[1] + d[1] * len];
    const c1: V = [o[0] + d[0] * len * 0.35, o[1] + d[1] * len * 0.35];
    const c2: V = [o[0] + d[0] * len * 0.7 + nrm[0] * len * bend, o[1] + d[1] * len * 0.7 + nrm[1] * len * bend];
    fans.push(S([o, c1, c2, p1], W([0, w * 0.7], [0.3, w], [0.75, w * 0.9], [1, w * 0.5]), () => [
      fold(0.12, 'L', 0.1, 20),
      cl(0.72, 1, bend >= 0 ? 'L' : 'R', 0.55, 2, [1, 0.7, 0.5]),
      cl(0.82, 1, bend >= 0 ? 'R' : 'L', 0.4, 2, [1, 0.6]),
    ], -10));
  }
  // upper sweep: out along the brow of the white fans, rising into a burst of leaves and a hook
  const up: V[] = [[516, 392], [585, 366], [650, 362], [688, 336], [724, 308], [716, 258], [676, 262]];
  const upper = S(up, W([0, 18], [0.25, 27], [0.6, 25], [1, 17]), (sp) => [
    cl(0.5, 0.76, 'out', 1.15, 3, [1, 0.62, 0.45, 0.3]),
    cl(0.22, 0.32, 'L', 0.7, 2, [1, 0.55, 0.35]),
    vol(sp, 0.86, 9, 1.1),
  ], 2);
  // middle sweep: out, turning down at the right into the lower scroll with an open eye
  const mid: V[] = [[516, 420], [600, 412], [700, 392], [734, 446], [756, 488], [722, 528], [684, 512]];
  const lowerBranch = S([[0, 0], [40, 12], [80, 30], [95, 60]], W([0, 16], [0.5, 19], [1, 10]), () => [
    cl(0.55, 1, 'L', 1.0, 3, [1, 0.6, 0.4, 0.25]),
  ]);
  const middle = S(mid, W([0, 20], [0.2, 30], [0.55, 28], [1, 19]), (sp) => [
    cl(0.42, 0.58, 'out', 1.0, 3, [1, 0.6, 0.42, 0.3]),
    cl(0.12, 0.27, 'R', 0.9, 2, [1, 0.6, 0.4]),
    br(0.64, 'L', 40, 15, lowerBranch),
    vol(sp, 0.84, 12, 1.25),
  ], 1);
  // broad lobed leaf lying across the fans just right of the helm
  const leafBand = S([[520, 446], [565, 440], [610, 452], [650, 462]], W([0, 24], [0.4, 32], [1, 18]), () => [
    cl(0.18, 0.46, 'L', 0.8, 3, [1, 0.7, 0.5, 0.3]),
    cl(0.7, 1, 'L', 0.9, 3, [1, 0.65, 0.4]),
  ], 3);
  return finish('Garter', [...fans, middle, upper, leafBand]);
}

// ---------------------------------------------------------------------------
// Stirling: heavy upright red lobes rising from gathered grey cloth; grey curls at the top.
function stirling(): Doc {
  const pal = { ...defaultPalette(), outer: '#a3161c', lining: '#b8b3ab', paper: '#f1e9da' };
  const grey: Strip[] = [];
  const g: [V[], number][] = [
    [[[510, 400], [560, 330], [620, 270], [610, 205]], 54],
    [[[514, 408], [600, 360], [680, 300], [690, 230]], 58],
    [[[514, 420], [610, 410], [690, 400], [740, 340]], 56],
    [[[514, 432], [590, 452], [650, 480], [700, 470]], 52],
    [[[512, 446], [560, 480], [600, 520], [620, 560]], 46],
  ];
  for (const [sp, w] of g)
    grey.push(S(sp, W([0, w * 0.7], [0.35, w], [0.8, w * 0.8], [1, w * 0.45]), (s) => [
      fold(0.1, 'R', 0.1, 15),
      cl(0.62, 0.95, 'L', 0.55, 2, [1, 0.7, 0.5]),
      vol(s, 0.9, 10, 1.0),
    ], -10));
  // top stem rising over the helm then turning over to a grey curl
  const topSp: V[] = [[512, 384], [540, 320], [590, 268], [640, 262], [686, 256], [700, 210], [668, 196]];
  const top = S(topSp, W([0, 26], [0.3, 38], [0.7, 32], [1, 22]), (sp) => [
    cl(0.3, 0.48, 'out', 1.1, 3, [1, 0.6, 0.45, 0.3]),
    fold(0.62, 'L', 0.1, 35),
    vol(sp, 0.84, 11, 1.2),
  ], 2);
  // the great upright mass at the right
  const massSp: V[] = [[514, 410], [600, 400], [680, 420], [716, 360], [740, 320], [740, 270], [722, 236]];
  const mass = S(massSp, W([0, 30], [0.3, 46], [0.7, 44], [1, 22]), () => [
    cl(0.48, 0.72, 'out', 1.25, 3, [1, 0.62, 0.45, 0.3]),
    cl(0.78, 1, 'L', 1.0, 3, [1, 0.6, 0.4]),
    cl(0.12, 0.24, 'L', 0.8, 2, [1, 0.6, 0.4]),
  ], 3);
  // lower hook descending beside the crown, ending in a scroll
  const lowSp: V[] = [[516, 440], [580, 470], [640, 470], [668, 520], [690, 566], [650, 600], [622, 572]];
  const low = S(lowSp, W([0, 30], [0.3, 42], [0.7, 38], [1, 24]), (sp) => [
    cl(0.34, 0.52, 'out', 1.0, 3, [1, 0.6, 0.4, 0.3]),
    vol(sp, 0.82, 11, 1.2),
  ], 2);
  return finish('Stirling', [...grey, top, mass, low], pal);
}

const out = process.argv[2] || 'src/presets';
mkdirSync(out, { recursive: true });
for (const [name, d] of [['garter', garter()], ['stirling', stirling()]] as const) {
  writeFileSync(`${out}/${name}.json`, JSON.stringify(d, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v), 1));
  console.log('wrote', name);
}
