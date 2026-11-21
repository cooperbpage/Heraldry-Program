// Render presets to SVG plus the crop box of their mantling: node proof-svgs.mjs <outdir> name...
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { renderSVG } from '../src/render/svg';
import { defaultToggles } from '../src/model/types';
import type { Doc } from '../src/model/types';
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const boxes: Record<string, number[]> = {};
for (const name of process.argv.slice(3)) {
  const doc: Doc = JSON.parse(readFileSync(`src/presets/${name}.json`, 'utf8'));
  const { svg, built } = renderSVG(doc, { toggles: defaultToggles() });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of built.pieces) {
    const tr = p.track;
    for (let i = 0; i < tr.n; i += 2) {
      const h = Math.max(p.hL[i], p.hR[i]);
      x0 = Math.min(x0, tr.x[i] - h); x1 = Math.max(x1, tr.x[i] + h);
      y0 = Math.min(y0, tr.y[i] - h); y1 = Math.max(y1, tr.y[i] + h);
    }
  }
  const m = 16;
  boxes[name] = [x0 - m, y0 - m, x1 - x0 + 2 * m, y1 - y0 + 2 * m];
  writeFileSync(`${out}/${name}.svg`, svg);
}
writeFileSync(`${out}/boxes.json`, JSON.stringify(boxes));
