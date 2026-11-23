import { writeFileSync } from 'node:fs';
import { flatLeaf, defaultLeaf, REPERTOIRE, LeafParams } from '../../src/leaf/flat';
const out = process.argv[2];
const leaf = (p: LeafParams, x: number, y: number, w: number, h: number) => {
  const L = flatLeaf(p); const [bx, by, bw, bh] = L.bbox; const k = Math.min(w / bh, h / bw) * 0.9;
  return `<g transform="translate(${x + w / 2},${y + h / 2}) scale(${k}) rotate(-90) translate(${-(bx + bw / 2)},${-(by + bh / 2)})"><path d="${L.d}" fill="#d42b2b" fill-rule="evenodd" stroke="#111" stroke-width="${1.3 / k}" stroke-linejoin="round"/>${L.lines.map((d) => `<path d="${d}" fill="none" stroke="#3a0c0c" stroke-width="${0.7 / k}" opacity="0.5"/>`).join('')}</g>`;
};
const base = { ...defaultLeaf(), ...REPERTOIRE['Roman (mollis)'].p };
const rows: [keyof LeafParams, string, (number | string)[]][] = [
  ['lobes', 'Lobes per side', [1, 2, 3, 4, 6]],
  ['fingers', 'Fingers per lobe', [1, 2, 3, 4, 5]],
  ['pointed', 'Round → pointed', [0, 0.3, 0.55, 0.8, 1]],
  ['depth', 'Lobe cut depth', [0.2, 0.4, 0.6, 0.8, 0.95]],
  ['fingerDepth', 'Finger separation', [0, 0.3, 0.5, 0.75, 1]],
  ['lean', 'Lobe lean', [0, 0.3, 0.5, 0.75, 1]],
  ['tip', 'Tip type', ['lobed', 'pointed', 'rounded', 'lobed', 'lobed']],
  ['sides', 'Sides', ['both', 'left', 'right', 'both', 'both']],
];
const CW = 150, CH = 190, LW = 170;
let body = '';
rows.forEach(([k, label, vals], r) => {
  body += `<text x="10" y="${r * CH + CH / 2}" font-size="17" font-family="Georgia" fill="#2a241f">${label}</text>`;
  vals.forEach((v, i) => {
    if (k === 'tip' && i > 2) return; if (k === 'sides' && i > 2) return;
    const p = { ...base, [k]: v, ...(k === 'tip' && i === 0 ? {} : {}) } as LeafParams;
    body += leaf(p, LW + i * CW, r * CH + 5, CW, CH - 30);
    body += `<text x="${LW + i * CW + CW / 2}" y="${r * CH + CH - 8}" font-size="13" text-anchor="middle" font-family="Georgia" fill="#5a4f45">${v}</text>`;
  });
});
const W = LW + 5 * CW + 10, H = rows.length * CH;
writeFileSync(`${out}/sweeps.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#f6f1e6"/>${body}</svg>`);
