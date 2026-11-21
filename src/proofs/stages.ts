import type { Doc, Strip } from '../model/types';
import { emptyDoc, defaultEye } from '../model/ops';
import type { V } from '../geom/vec';

/** Stage 1: a single volute with tangent entry, rising curvature and an open eye. */
export function stageVolute(): Doc {
  const doc = emptyDoc('Stage 1 · volute');
  const spine: V[] = [
    [140, 760], [230, 560], [430, 430], [640, 460],
    [760, 478], [840, 560], [820, 650],
  ];
  const s: Strip = {
    id: 'vol',
    spine,
    width: [{ t: 0, w: 34 }, { t: 0.3, w: 58 }, { t: 0.75, w: 46 }, { t: 1, w: 30 }],
    events: [],
  };
  const t = 0.8;
  const eyeR = 26;
  s.events.push({ kind: 'volute', id: 'v1', t, eye: defaultEye(spine, t, eyeR, 1.6), eyeR, turns: 1.6, hand: 1, mode: 'terminal' });
  doc.strips.push(s);
  return doc;
}

/** Stage 2: one stem, one recursive cluster, a measured bare span and one turnover. */
export function stageStem(): Doc {
  const doc = emptyDoc('Stage 2 · stem');
  const spine: V[] = [
    [120, 720], [260, 520], [470, 470], [600, 520],
    [720, 566], [790, 470], [860, 330],
  ];
  const s: Strip = {
    id: 'stem',
    spine,
    width: [{ t: 0, w: 36 }, { t: 0.2, w: 62 }, { t: 0.6, w: 50 }, { t: 1, w: 18 }],
    events: [
      { kind: 'turnover', id: 'f1', t: 0.42, length: 0.12, edge: 'L', crease: 38 },
      { kind: 'cluster', id: 'c1', t0: 0.6, t1: 0.86, side: 'L', size: 1.1, depth: 3, split: [1, 0.55, 0.35, 0.22] },
      { kind: 'cluster', id: 'c2', t0: 0.9, t1: 1, side: 'R', size: 0.8, depth: 2, split: [1, 0.5, 0.3] },
    ],
  };
  doc.strips.push(s);
  return doc;
}
