// npm run check
import { readFileSync } from 'node:fs';
import { fitSpine, filterGesture, segCount, seg, bezK, bez1 } from '../src/geom/bezier';
import { makeSpiral } from '../src/geom/spiral';
import { build, faceAt } from '../src/model/build';
import { renderSVG } from '../src/render/svg';
import { bareFraction, walkStrips } from '../src/model/ops';
import { stageVolute, stageStem } from '../src/proofs/stages';
import type { Doc, RenderToggles } from '../src/model/types';
import type { V } from '../src/geom/vec';
let fails = 0;
const ok = (name: string, c: boolean, info = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'} ${name} ${info}`); };
// 1. an unsteady S becomes one clean inflection with few segments, G2 at joins
const raw: V[] = [];
for (let i = 0; i <= 120; i++) { const t = i / 120; raw.push([100 + 500 * t + Math.sin(i * 2.3) * 2.5, 300 + 120 * Math.sin(t * Math.PI * 2) + Math.cos(i * 1.7) * 2.5]); }
const sp = fitSpine(filterGesture(raw, 5, 2.5), 18);
const n = segCount(sp);
ok('S gesture fitted sparsely', n <= 3, `segments=${n}`);
let inflections = 0, prev = 0;
for (let i = 0; i < n; i++) for (let k = 0; k <= 20; k++) { const kk = bezK(seg(sp, i), k / 20); if (prev && Math.sign(kk) !== Math.sign(prev) && Math.abs(kk) > 1e-4) inflections++; if (Math.abs(kk) > 1e-4) prev = kk; }
ok('one clean inflection', inflections === 1, `inflections=${inflections}`);
// a demanding gesture forces several segments, which must join with G2
const raw2: V[] = [];
for (let i = 0; i <= 200; i++) { const t = i / 200; raw2.push([100 + 600 * t, 300 + 150 * Math.sin(t * Math.PI * 3.2) + 60 * Math.sin(t * 9)]); }
const sp2 = fitSpine(filterGesture(raw2, 2, 2.5), 3);
const n2 = segCount(sp2);
ok('complex gesture uses several segments', n2 >= 3, `segments=${n2}`);
let g2 = 0;
for (let j = 1; j < n2; j++) {
  const a = seg(sp2, j - 1), b = seg(sp2, j);
  const t1 = bez1(a, 1), t2 = bez1(b, 0);
  const ang = Math.abs(Math.atan2(t1[0] * t2[1] - t1[1] * t2[0], t1[0] * t2[0] + t1[1] * t2[1]));
  const dk = Math.abs(bezK(a, 1) - bezK(b, 0));
  g2 = Math.max(g2, dk + ang);
}
ok('G2 at internal joins', g2 < 1e-3, `max dk+dangle=${g2.toExponential(2)}`);
// 2. volutes: tangent entry and monotonically increasing curvature
for (const [P, T, C, r, turns] of [[[0, 0], [1, 0], [60, 90], 10, 1.5], [[0, 0], [0.8, 0.6], [-20, 80], 14, 1.2], [[0, 0], [1, 0], [40, -70], 8, 2.2]] as [V, V, V, number, number][]) {
  const s = makeSpiral(P, T, C, r, turns);
  const ks = s.samples.map((x) => Math.abs(x.k));
  let drops = 0;
  for (let i = 3; i < ks.length - 2; i++) if (ks[i] < ks[i - 1] * 0.995) drops++;
  const t0 = { tx: s.samples[1].x - s.samples[0].x, ty: s.samples[1].y - s.samples[0].y };
  const kk0 = Math.abs(s.samples[1].k) * Math.hypot(t0.tx, t0.ty) / 2;
  const entry = Math.abs(Math.atan2(T[0] * t0.ty - T[1] * t0.tx, T[0] * t0.tx + T[1] * t0.ty));
  ok(`volute r=${r} turns=${turns}: curvature rises`, drops === 0, `drops=${drops}`);
  ok(`volute r=${r}: tangent entry`, entry < kk0 * 1.5 + 1e-3, `angle=${entry.toFixed(4)} (chord allowance ${kk0.toFixed(4)})`);
  const last = s.samples[s.samples.length - 1];
  const eye = Math.hypot(last.x - C[0], last.y - C[1]);
  ok(`volute r=${r}: eye stays open`, eye >= r, `centreline at ${eye.toFixed(1)} vs eye ${r}`);
}
// 3. presets: bare rule, face inheritance, every toggle combination renders without NaN
const docs: [string, Doc][] = [['garter', JSON.parse(readFileSync('src/presets/garter.json', 'utf8'))], ['stirling', JSON.parse(readFileSync('src/presets/stirling.json', 'utf8'))], ['stage1', stageVolute()], ['stage2', stageStem()]];
for (const [name, d] of docs) {
  let minBare = 1;
  walkStrips(d, (s) => { minBare = Math.min(minBare, bareFraction(s)); });
  ok(`${name}: every strip ≥40% bare`, minBare >= 0.4, `min=${(minBare * 100).toFixed(0)}%`);
  const b = build(d);
  let inh = true;
  for (const g of b.all) for (const c of g.children) {
    const ev = g.strip.events.find((e) => e.kind === 'branch' && e.child === c.strip);
    if (ev && ev.kind === 'branch' && c.baseFace !== faceAt(g, ev.t * g.Lb, (ev.side === 'L' ? 1 : -1) * 0.35)) inh = false;
  }
  ok(`${name}: branches inherit the visible face`, inh);
  let nan = 0;
  for (let m = 0; m < 32; m++) {
    const t: RenderToggles = { flat: !!(m & 1), outline: !!(m & 2), midrib: !!(m & 4), shading: !!(m & 8), hatching: !!(m & 16) };
    if (renderSVG(d, { toggles: t }, b).svg.includes('NaN')) nan++;
  }
  ok(`${name}: 32 toggle combinations render cleanly`, nan === 0, `bad=${nan}`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
