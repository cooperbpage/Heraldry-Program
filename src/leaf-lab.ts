import './style.css';
import { flatLeaf, defaultLeaf, REPERTOIRE, LeafParams } from './leaf/flat';

type NumKey = { [K in keyof LeafParams]: LeafParams[K] extends number ? K : never }[keyof LeafParams];
const SLIDERS: [NumKey, string, number, number, number, string][] = [
  ['lobes', 'Lobes per side', 0, 7, 1, 'How many lobes grow from each side of the midrib.'],
  ['fingers', 'Fingers per lobe', 1, 5, 1, 'How many fingers (serrations) each lobe divides into.'],
  ['depth', 'Lobe cut depth', 0, 1, 0.01, 'How far the cuts between lobes reach toward the midrib.'],
  ['fingerDepth', 'Finger separation', 0, 1, 0.01, 'Merged scallops (0) to separate fingers (1).'],
  ['pointed', 'Round ↔ pointed', 0, 1, 0.01, 'Round fingers (mollis) to pointed fingers (spinosus).'],
  ['hook', 'Finger hook', 0, 1, 0.01, 'How much each finger curves toward the leaf tip.'],
  ['bulb', 'Bulb', 0, 1, 0.01, 'Fingers swell toward their ends, with narrow necks.'],
  ['lean', 'Lobe lean', 0, 1, 0.01, 'Lobes sweep forward toward the tip.'],
  ['eye', 'Eye size', 0, 1, 0.01, 'The round hollow at the bottom of each slit between lobes.'],
  ['width', 'Width', 0.12, 0.5, 0.01, 'Half-width of the leaf relative to its length.'],
  ['widest', 'Widest point', 0.15, 0.8, 0.01, 'Where along the leaf it is widest.'],
  ['crowd', 'Crowd to tip', 0, 1, 0.01, 'Lobes spaced evenly (0) or crowding toward the tip (1).'],
  ['diminish', 'Diminish', 0, 1, 0.01, 'Lobes shrink toward the tip.'],
  ['tipFingers', 'Tip fingers', 1, 5, 1, 'Fingers on the terminal lobe (when the tip is lobed).'],
  ['stem', 'Stem length', 0, 0.5, 0.01, 'Length of the stem or tail.'],
  ['stemWidth', 'Stem width', 0.05, 0.6, 0.01, 'Width of the stem.'],
  ['asym', 'Asymmetry', 0.5, 1.5, 0.01, 'Size of the right side relative to the left.'],
  ['jitter', 'Irregularity', 0, 1, 0.01, 'Random variation of lobes and fingers.'],
];

let q: LeafParams = { ...defaultLeaf(), ...REPERTOIRE['Roman (mollis)'].p };
let guides = false;
let sweepKey: NumKey = 'pointed';

const root = document.getElementById('lab')!;
root.innerHTML = `
<div class="lab-stage"><svg id="leaf" viewBox="0 0 400 420"></svg></div>
<section class="lab-panel">
  <div class="wrap" id="presets"></div>
  <p class="note" id="note"></p>
  <div class="wrap">
    <label class="sel">Tip <select id="tip"><option value="lobed">lobed</option><option value="pointed">pointed</option><option value="rounded">rounded</option></select></label>
    <label class="sel">Sides <select id="sides"><option value="both">both</option><option value="left">left only</option><option value="right">right only</option></select></label>
    <button id="seed">New variation</button>
    <button id="guides" class="toggle">Show construction</button>
  </div>
  <div id="sliders"></div>
  <h3>Transform</h3>
  <p class="note">One parameter swept across its range, everything else held:</p>
  <label class="sel">Sweep <select id="sweepKey">${SLIDERS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
  <svg id="sweep" viewBox="0 0 1000 260"></svg>
</section>`;

const presetsEl = document.getElementById('presets')!;
presetsEl.innerHTML = Object.keys(REPERTOIRE).map((k) => `<button data-p="${k}">${k}</button>`).join('');
const slidersEl = document.getElementById('sliders')!;
slidersEl.innerHTML = SLIDERS.map(([k, label, min, max, step, help]) => `<label class="sl" title="${help}">${label}<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}"><output data-o="${k}"></output></label>`).join('');

function leafSVG(p: LeafParams, box: [number, number, number, number], withGuides: boolean, stroke = 1.6) {
  const L = flatLeaf(p);
  const [bx, by, bw, bh] = L.bbox;
  const [x, y, w, h] = box;
  const k = Math.min(w / bh, h / bw) * 0.92;
  const tf = `translate(${x + w / 2},${y + h / 2}) scale(${k}) rotate(-90) translate(${-(bx + bw / 2)},${-(by + bh / 2)})`;
  let g = `<g transform="${tf}">`;
  if (withGuides) {
    g += L.parts.map((pt) => `<path d="M${pt.ring.map((v) => v[0].toFixed(1) + ',' + v[1].toFixed(1)).join('L')}Z" fill="none" stroke="${pt.kind === 'finger' ? '#1d6fe0' : '#7a9'}" stroke-width="${0.8 / k}" opacity="0.7"/>`).join('');
  }
  g += `<path d="${L.d}" fill="#d42b2b" fill-opacity="${withGuides ? 0.55 : 1}" fill-rule="evenodd" stroke="#111" stroke-width="${stroke / k}" stroke-linejoin="round"/>`;
  g += L.lines.map((d) => `<path d="${d}" fill="none" stroke="#3a0c0c" stroke-width="${(stroke * 0.55) / k}" opacity="0.55"/>`).join('');
  if (withGuides) g += L.guides.roots.map((r) => `<circle cx="${r[0]}" cy="${r[1]}" r="${3 / k}" fill="#1d6fe0"/>`).join('') + L.guides.eyes.map((e) => `<circle cx="${e[0]}" cy="${e[1]}" r="${3 / k}" fill="#e0a01d"/>`).join('');
  return g + '</g>';
}

function render() {
  (document.getElementById('leaf') as unknown as SVGSVGElement).innerHTML = `<rect width="400" height="420" fill="#f6f1e6"/>` + leafSVG(q, [10, 10, 380, 400], guides);
  for (const [k] of SLIDERS) {
    const el = slidersEl.querySelector(`[data-k="${k}"]`) as HTMLInputElement;
    el.value = String(q[k]);
    (slidersEl.querySelector(`[data-o="${k}"]`) as HTMLElement).textContent = Number.isInteger(q[k]) ? String(q[k]) : (q[k] as number).toFixed(2);
  }
  (document.getElementById('tip') as HTMLSelectElement).value = q.tip;
  (document.getElementById('sides') as HTMLSelectElement).value = q.sides;
  document.getElementById('guides')!.classList.toggle('on', guides);
  const sl = SLIDERS.find((s) => s[0] === sweepKey)!;
  let sw = `<rect width="1000" height="260" fill="#f6f1e6"/>`;
  for (let i = 0; i < 5; i++) {
    const v = sl[2] + ((sl[3] - sl[2]) * i) / 4;
    const val = sl[4] >= 1 ? Math.round(v) : v;
    sw += leafSVG({ ...q, [sweepKey]: val }, [i * 200 + 10, 10, 180, 215], false, 1.2);
    sw += `<text x="${i * 200 + 100}" y="252" font-size="16" text-anchor="middle" font-family="Georgia">${sl[1]} ${sl[4] >= 1 ? val : val.toFixed(2)}</text>`;
  }
  (document.getElementById('sweep') as unknown as SVGSVGElement).innerHTML = sw;
}

presetsEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  const r = REPERTOIRE[b.dataset.p!];
  q = { ...defaultLeaf(), ...r.p, seed: q.seed };
  document.getElementById('note')!.textContent = r.note;
  render();
});
slidersEl.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  const k = el.dataset.k as NumKey;
  (q as unknown as Record<string, number>)[k] = +el.value;
  render();
});
document.getElementById('tip')!.addEventListener('change', (e) => {
  q.tip = (e.target as HTMLSelectElement).value as LeafParams['tip'];
  render();
});
document.getElementById('sides')!.addEventListener('change', (e) => {
  q.sides = (e.target as HTMLSelectElement).value as LeafParams['sides'];
  render();
});
document.getElementById('seed')!.addEventListener('click', () => {
  q.seed = (q.seed * 48271 + 11) % 100000;
  render();
});
document.getElementById('guides')!.addEventListener('click', () => {
  guides = !guides;
  render();
});
document.getElementById('sweepKey')!.addEventListener('change', (e) => {
  sweepKey = (e.target as HTMLSelectElement).value as NumKey;
  render();
});
(document.getElementById('sweepKey') as HTMLSelectElement).value = sweepKey;
document.getElementById('note')!.textContent = REPERTOIRE['Roman (mollis)'].note;
render();
