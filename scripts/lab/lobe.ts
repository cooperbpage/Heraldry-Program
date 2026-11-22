import { writeFileSync } from 'node:fs';
import { emptyDoc } from '../../src/model/ops';
import { renderSVG } from '../../src/render/svg';
import { defaultToggles } from '../../src/model/types';
const out = process.argv[2];
const d = emptyDoc('lobe');
d.settings.lobeDepth = 0.6;
for (let k = 0; k < 3; k++) {
  const y = 300 + k * 220;
  d.strips.push({ id: 's' + k, spine: [[100, y], [300, y - 10], [500, y + 10], [800, y]], width: [{ t: 0, w: 40 }, { t: 1, w: 30 }], events: [
    { kind: 'cluster', id: 'c' + k, t0: 0.2, t1: 0.32, side: 'R', size: 1.3, depth: 2, split: [1, 0.6], seed: k, curl: k === 2 ? 1 : 0, roll: k === 1 ? 1 : 0 } as any,
    { kind: 'cluster', id: 'd' + k, t0: 0.55, t1: 0.75, side: 'R', size: 1.3, depth: 3, split: [1, 0.7, 0.5], seed: k + 7, curl: 0.5, roll: 0.5 } as any,
  ] });
}
writeFileSync(`${out}/lobe.svg`, renderSVG(d, { toggles: defaultToggles(), noFrame: true }).svg);
