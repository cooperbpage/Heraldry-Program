import { writeFileSync, mkdirSync } from 'node:fs';
import { stageVolute, stageStem } from '../src/proofs/stages';
import { renderSVG } from '../src/render/svg';
import { defaultToggles } from '../src/model/types';
const out = process.argv[2] || 'out';
mkdirSync(out, { recursive: true });
for (const [name, doc] of [['01-volute', stageVolute()], ['02-stem', stageStem()]] as const) {
  const t0 = Date.now();
  const { svg, built } = renderSVG(doc, { toggles: defaultToggles(), noFrame: true });
  writeFileSync(`${out}/${name}.svg`, svg);
  console.log(name, built.pieces.length, 'pieces', (svg.length / 1024).toFixed(0) + 'KB', Date.now() - t0 + 'ms');
}
