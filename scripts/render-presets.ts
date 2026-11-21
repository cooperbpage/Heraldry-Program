import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { renderSVG } from '../src/render/svg';
import { defaultToggles } from '../src/model/types';
import type { Doc } from '../src/model/types';
const out = process.argv[2] || 'out';
const names = process.argv.slice(3);
mkdirSync(out, { recursive: true });
for (const name of names) {
  const doc: Doc = JSON.parse(readFileSync(`src/presets/${name}.json`, 'utf8'));
  const t0 = Date.now();
  const { svg, built } = renderSVG(doc, { toggles: defaultToggles() });
  writeFileSync(`${out}/${name}.svg`, svg);
  console.log(name, built.pieces.length, 'pieces', (svg.length / 1024).toFixed(0) + 'KB', Date.now() - t0 + 'ms');
}
