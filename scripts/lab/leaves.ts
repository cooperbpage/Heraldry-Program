import { writeFileSync } from 'node:fs';
import { flatLeaf, defaultLeaf, REPERTOIRE, LeafParams } from '../../src/leaf/flat';
const out = process.argv[2];
const cell = (q: LeafParams, label: string, x: number, y: number, s = 1, guides = false) => {
  const L = flatLeaf(q);
  const [bx, by, bw, bh] = L.bbox;
  const k = (s * 230) / Math.max(bw, bh);
  // tip up: leaf x -> screen -y; centre the bbox in the cell
  const tf = `translate(${x + 130},${y + 135}) scale(${k}) rotate(-90) translate(${-(bx + bw / 2)},${-(by + bh / 2)})`;
  let g = `<g transform="${tf}">`;
  if (guides) g += L.parts.map((p) => `<path d="M${p.ring.map((v) => v[0].toFixed(1) + ',' + v[1].toFixed(1)).join('L')}Z" fill="none" stroke="#0af" stroke-width="${0.5 / k}" opacity="0.5"/>`).join('');
  g += `<path d="${L.d}" fill="#d42b2b" fill-opacity="${guides ? 0.85 : 1}" fill-rule="evenodd" stroke="#111" stroke-width="${1.4 / k}" stroke-linejoin="round"/>`;
  g += L.lines.map((d) => `<path d="${d}" fill="none" stroke="#111" stroke-width="${0.8 / k}" opacity="0.6"/>`).join('');
  if (guides) g += L.guides.eyes.map((e) => `<circle cx="${e[0]}" cy="${e[1]}" r="${2.5 / k}" fill="#0af"/>`).join('');
  g += `</g><text x="${x + 130}" y="${y + 280}" font-size="14" text-anchor="middle" font-family="Georgia">${label}</text>`;
  return g;
};
let body = '';
const names = Object.keys(REPERTOIRE);
names.forEach((n, i) => { body += cell({ ...defaultLeaf(), ...REPERTOIRE[n].p }, n, (i % 4) * 260, Math.floor(i / 4) * 300, 1, true); });
writeFileSync(`${out}/repertoire.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="600" viewBox="0 0 1040 600"><rect width="1040" height="600" fill="#f1ebdd"/>${body}</svg>`);
// one large leaf
{
  const a = { ...defaultLeaf(), ...REPERTOIRE['Roman (mollis)'].p };
  const b = { ...defaultLeaf(), ...REPERTOIRE['Heraldic flame'].p };
  writeFileSync(`${out}/one.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="600" viewBox="0 0 520 300"><rect width="520" height="300" fill="#f1ebdd"/>${cell(a, '', 0, 0, 1, false)}${cell(b, '', 260, 0, 1, false)}</svg>`);
}
