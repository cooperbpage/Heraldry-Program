import { writeFileSync } from 'node:fs';
import { emptyDoc } from '../../src/model/ops';
import { renderSVG } from '../../src/render/svg';
import { defaultToggles } from '../../src/model/types';
import type { Doc } from '../../src/model/types';
const out = process.argv[2];
const docs: Record<string, Doc> = {};
{
  const d = emptyDoc('swirl');
  d.strips.push({ id: 'a', spine: [[300, 420], [330, 330], [420, 290], [500, 320], [560, 345], [580, 420], [555, 490], [530, 550], [540, 610], [575, 640]], width: [{ t: 0, w: 60 }, { t: 0.5, w: 54 }, { t: 1, w: 38 }], events: [{ kind: 'turnover', id: 't', t: 0.42, length: 0.3, edge: 'L', crease: 0 }] });
  docs.swirl = d;
}
{
  const d = emptyDoc('leafy');
  d.strips.push({ id: 'b', spine: [[300, 420], [330, 330], [420, 290], [500, 320], [560, 345], [580, 420], [555, 490], [530, 550], [540, 610], [575, 640]], width: [{ t: 0, w: 50 }, { t: 0.5, w: 46 }, { t: 1, w: 30 }], events: [
    { kind: 'cluster', id: 'c1', t0: 0.12, t1: 0.3, side: 'R', size: 1, depth: 3, split: [1, 0.6, 0.4, 0.3] },
    { kind: 'turnover', id: 't', t: 0.45, length: 0.28, edge: 'L', crease: 0 },
    { kind: 'cluster', id: 'c2', t0: 0.66, t1: 0.82, side: 'R', size: 1, depth: 3, split: [1, 0.6, 0.4, 0.3] },
  ] });
  docs.leafy = d;
}
for (const [k, d] of Object.entries(docs)) writeFileSync(`${out}/${k}.svg`, renderSVG(d, { toggles: defaultToggles(), noFrame: true }).svg);
