import { writeFileSync } from 'node:fs';
import { blueLionUpperLeft } from './recreate';
import { renderSVG } from '../../src/render/svg';
import { defaultToggles } from '../../src/model/types';
for (const id of ['bm', 'bl', 'bu']) {
  const d = blueLionUpperLeft();
  const s = d.strips[0];
  s.events = s.events.filter((e) => e.kind === 'branch' && e.id === id);
  for (const e of s.events) if (e.kind === 'branch') { e.child.events = []; console.log(id, e.t.toFixed(3), e.side, e.angle.toFixed(1), JSON.stringify(e.child.spine.slice(0, 4).map((p) => p.map(Math.round)))); }
  writeFileSync(process.argv[2] + `/dbg-${id}.svg`, renderSVG(d, { toggles: defaultToggles(), noFrame: true }).svg);
}
