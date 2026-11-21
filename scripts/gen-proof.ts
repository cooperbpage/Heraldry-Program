import { writeFileSync, mkdirSync } from 'node:fs';
import { emptyDoc, newStrip, addStrip } from '../src/model/ops';
import { fitSpine, filterGesture } from '../src/geom/bezier';
import { compose, sweepsFromEnvelope } from '../src/model/compose';
import { renderSVG } from '../src/render/svg';
import { defaultToggles } from '../src/model/types';
import type { V } from '../src/geom/vec';
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const gesture = (f: (t: number) => V, n = 80): V[] => Array.from({ length: n + 1 }, (_, i) => { const p = f(i / n); return [p[0] + Math.sin(i * 2.1) * 2, p[1] + Math.cos(i * 1.3) * 2] as V; });
for (const seed of [1, 2, 3]) {
  const doc = emptyDoc('sweeps');
  doc.seed = seed;
  const sweeps: V[][] = [
    gesture((t) => [512 + 240 * t, 390 - 150 * Math.sin(t * 2.4) + 40 * t]),
    gesture((t) => [512 + 250 * t, 420 + 10 * Math.sin(t * 3) + 90 * t * t]),
    gesture((t) => [514 + 130 * t, 440 + 160 * t - 40 * t * t]),
  ];
  for (const g of sweeps) { const s = newStrip(fitSpine(filterGesture(g, 5, 2.5), 18)); s.sweep = true; addStrip(doc, s, true); }
  compose(doc);
  writeFileSync(`${out}/sweeps-${seed}.svg`, renderSVG(doc, { toggles: defaultToggles() }).svg);
}
{
  const doc = emptyDoc('envelope');
  const env: V[] = [];
  for (let i = 0; i <= 120; i++) { const a = (i / 120) * Math.PI * 2; env.push([500 + 290 * Math.cos(a), 420 + 200 * Math.sin(a) * (Math.sin(a) < 0 ? 1.1 : 0.9)]); }
  sweepsFromEnvelope(doc, env, 18, true);
  compose(doc);
  writeFileSync(`${out}/envelope.svg`, renderSVG(doc, { toggles: defaultToggles() }).svg);
}
